// app/api/bills/collection-sheet/commit/route.js
//
// The only route in this feature that writes.
//
// It re-runs every check the verify route ran. Verify is a convenience for the
// UI; it is NOT a permission grant. A client could skip verify entirely and
// POST here directly, so the validation has to be duplicated. That duplication
// is deliberate.
//
// Idempotency: the client sends a `commitToken` it generated when the grid was
// opened. Every Transaction this commit writes carries it, so a double-click,
// a retry after a timeout, or a stuck cron finds the first run and does not
// post the same collections twice.
//
// Writes go through the member-level allocator (recordPayment), one row at a
// time, each in its own Mongo transaction.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Transaction from "@/models/Transaction";
import Receipt from "@/models/Receipt";
import ScheduledBillRun from "@/models/ScheduledBillRun";
import { getSocietySnapshot, invalidateSocietySnapshot } from "@/lib/import/societySnapshot";
import { verifyRow, configFingerprint, money } from "@/lib/billing/ledgerSignature";
import { issueReceiptNo } from "@/lib/billing/receiptIssuance";
import { notifyPaymentReceived } from "@/lib/v1/notify";
import { recordPayment, PaymentServiceError } from "@/lib/services/PaymentService";
import cache from "@/lib/cache";

/** Same convention app/api/billing/upload-payments/route.js already uses for its Receipt.filename. */
function receiptFilename(member, billPeriodId) {
  const nameParts = (member?.ownerName || "member").trim().split(/\s+/);
  const nameSlug = nameParts.length > 1 ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}` : nameParts[0];
  const flatSlug = `${member?.wing || ""}-${member?.flatNo || ""}`;
  return `${nameSlug}_${flatSlug}_${billPeriodId}_receipt`.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VALID_MODES = ["Cash", "Cheque", "NEFT", "IMPS", "UPI", "Card", "Online"];
const TOLERANCE = 0.01;
// The sheet offers IMPS and Card; the ledger's paymentMode list does not have
// them, so they post as Online and the original mode stays in the notes.
const TXN_MODE = { IMPS: "Online", Card: "Online" };

export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.bill.generate");
    if (!gate.ok) return gate.response;
    const societyId = gate.context.societyId;
    const userId = gate.context.userId;

    const body = await request.json();
    const {
      periodId,
      fingerprint,
      rows,
      commitToken,
      mode: flowMode,
      scheduleFor,
      nextPeriodId,
      billSeries = "RESIDENTIAL",
    } = body || {};

    if (!commitToken) {
      return NextResponse.json(
        { error: "commitToken is required", code: "NO_TOKEN" },
        { status: 400 },
      );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows submitted" }, { status: 400 });
    }

    await connectDB();

    // ---- Idempotency gate ------------------------------------------------
    const existing = await Transaction.findOne({ societyId, commitToken })
      .select("_id createdAt")
      .lean();
    if (existing) {
      return NextResponse.json({
        success: true,
        alreadyCommitted: true,
        committedAt: existing.createdAt,
        message: "These collections were already posted.",
      });
    }

    const snapshot = await getSocietySnapshot(societyId);
    const currentFingerprint = configFingerprint({
      config: snapshot.config,
      heads: snapshot.heads,
    });
    if (fingerprint && fingerprint !== currentFingerprint) {
      return NextResponse.json(
        {
          error: "Billing configuration changed. Reload the sheet and verify again.",
          code: "STALE_FINGERPRINT",
          action: "REFETCH",
        },
        { status: 409 },
      );
    }

    // Only rows that actually record money need writing. Rows the admin left
    // blank are declarations of "unpaid", which require no write at all --
    // the balance already carries forward by itself.
    const paying = rows.filter(
      (r) => String(r.mode || "").trim() && Number(r.amountPaid) > 0,
    );
    if (paying.length === 0) {
      return NextResponse.json({
        success: true,
        recorded: 0,
        message: "No collections to post. All flats were marked unpaid.",
      });
    }

    const billIds = paying.map((r) => String(r.billId));
    const bills = await Bill.find({ societyId, _id: { $in: billIds } })
      .select("memberId billPeriodId billSeries totalBillDue amountPaid status openingPrincipal openingInterest currentCharges billPrincipal balanceAmount")
      .lean();
    const billMap = new Map(bills.map((b) => [String(b._id), b]));

    // ---- Re-validate every row before anything is written ----------------
    const rejected = [];
    const toRecord = [];
    for (const input of paying) {
      const billId = String(input.billId);
      const bill = billMap.get(billId);
      if (!bill) {
        rejected.push({ billId, code: "BILL_NOT_FOUND" });
        continue;
      }
      if (billSeries && bill.billSeries !== billSeries) {
        rejected.push({ billId, code: "WRONG_SERIES" });
        continue;
      }

      const alreadyPaid = money(bill.amountPaid ?? 0);
      const billDue = money(bill.totalBillDue);
      const remainingDue = money(Math.max(0, billDue - alreadyPaid));
      const openingDue = money((bill.openingPrincipal || 0) + (bill.openingInterest || 0));
      const currentCharges = money(
        bill.currentCharges != null
          ? bill.currentCharges
          : (bill.billPrincipal || 0) - (bill.openingPrincipal || 0),
      );
      let systemStatus = "UNPAID";
      if (alreadyPaid >= billDue && billDue > 0) systemStatus = "PAID";
      else if (alreadyPaid > 0) systemStatus = "PARTIAL";

      const ledger = {
        billId,
        memberId: String(bill.memberId),
        periodId: bill.billPeriodId,
        openingDue,
        currentCharges,
        billDue,
        remainingDue,
        alreadyPaid,
        systemStatus,
      };
      if (!verifyRow(ledger, currentFingerprint, input.sig)) {
        rejected.push({ billId, code: "TAMPERED" });
        continue;
      }

      const enteredAmount = money(input.amountPaid);
      const payMode = String(input.mode).trim();
      if (!VALID_MODES.includes(payMode)) {
        rejected.push({ billId, code: "MODE_INVALID" });
        continue;
      }
      if (systemStatus === "PAID") {
        rejected.push({ billId, code: "ALREADY_SETTLED" });
        continue;
      }
      if (enteredAmount <= 0) {
        rejected.push({ billId, code: "AMOUNT_OUT_OF_BOUNDS", maxAllowed: remainingDue });
        continue;
      }
      // More than what is outstanding is accepted only with the admin's
      // explicit per-row confirmation — verify/route asked for it already.
      const rawOverpay = money(Math.max(0, enteredAmount - remainingDue));
      if (rawOverpay > TOLERANCE && !input.overpayAsAdvance) {
        rejected.push({ billId, code: "OVERPAY_NEEDS_CONFIRM", maxAllowed: remainingDue });
        continue;
      }
      toRecord.push({ bill, enteredAmount, payMode, remarks: String(input.remarks || "").slice(0, 240), openingDue });
    }

    if (rejected.length > 0) {
      // All or nothing at the validation stage: nothing is written when any
      // row fails, so the admin never has to guess which half landed.
      return NextResponse.json(
        {
          error: "Some rows failed re-validation at commit time. Nothing was posted.",
          code: "COMMIT_REJECTED",
          rejected,
        },
        { status: 409 },
      );
    }

    const payerMemberIds = [...new Set(toRecord.map((r) => String(r.bill.memberId)))];
    const payerMembers = await Member.find({ _id: { $in: payerMemberIds } }).select("ownerName wing flatNo").lean();
    const memberByIdMap = new Map(payerMembers.map((m) => [String(m._id), m]));

    // ---- Write: one recordPayment per row --------------------------------
    // The member-level allocator (lib/services/PaymentService.js) — the same
    // one the Record Payment drawer uses. Per row, in one Mongo transaction:
    // interest-first across every open bill of the member, any remainder to
    // advanceCredit, the ledger Transaction with its running balance, and the
    // Journal Entry. This route used to allocate by hand, insertMany
    // Transactions carrying fields the schema dropped (commitToken, billId),
    // and post the ledger afterwards outside any transaction.
    const recorded = [];
    const failed = [];
    const receiptDocs = [];
    for (const r of toRecord) {
      const memberId = String(r.bill.memberId);
      try {
        const out = await recordPayment({
          memberId,
          societyId: String(societyId),
          amount: r.enteredAmount,
          paymentMode: TXN_MODE[r.payMode] || r.payMode,
          notes: `Collection sheet ${r.bill.billPeriodId}${TXN_MODE[r.payMode] ? ` (${r.payMode})` : ""}${r.remarks ? ` - ${r.remarks}` : ""}`,
          actorUserId: userId,
          actorRole: "Admin", // staff-only route (billing.bill.generate); only "Member" is ever restricted
        });
        const transactionId = out.transaction.transactionId;
        const t = await Transaction.findOneAndUpdate(
          { societyId, transactionId },
          { $set: { commitToken, billPeriodId: r.bill.billPeriodId } },
          { new: true },
        ).lean();
        const bd = t?.paymentBreakdown || {};
        const advance = money(bd.advanceCredit);
        const after = await Bill.findById(r.bill._id).select("balanceAmount billSeries").lean();
        recorded.push({ transaction: t, memberId, amount: r.enteredAmount, advance, period: r.bill.billPeriodId });
        receiptDocs.push({
          receiptNo: await issueReceiptNo(r.bill),
          filename: receiptFilename(memberByIdMap.get(memberId), r.bill.billPeriodId),
          billId: r.bill._id,
          billPeriodId: r.bill.billPeriodId,
          memberId: r.bill.memberId,
          societyId,
          billSeries: r.bill.billSeries,
          amount: r.enteredAmount,
          amountReceived: r.enteredAmount,
          amountApplied: money(r.enteredAmount - advance),
          interestApplied: money(bd.interestCleared),
          principalApplied: money(bd.principalCleared),
          advanceCreditCreated: advance,
          remainingBalance: money(after?.balanceAmount),
          settlementStatus: money(after?.balanceAmount) > 0 ? "Partial" : "Paid",
          previousBalanceSnapshot: r.openingDue,
          paymentMode: r.payMode,
          paidAt: t?.date || new Date(),
          transactionId,
          status: "Generated",
        });
      } catch (err) {
        if (!(err instanceof PaymentServiceError)) console.error(`collection-sheet/commit: row ${r.bill.billPeriodId} for ${memberId} failed:`, err.message);
        failed.push({ billId: String(r.bill._id), memberId, error: err.message });
      }
    }

    if (!recorded.length) {
      return NextResponse.json(
        { error: failed[0]?.error || "No payment could be recorded. Nothing was posted.", code: "COMMIT_FAILED", failed },
        { status: 500 },
      );
    }

    // Best-effort: a missing receipt stays visible and one-click fixable on
    // /admin/receipts (app/api/admin/receipts/gaps/route.js); the money has
    // moved either way, so it is reported rather than undone.
    let receiptGapCount = 0;
    const insertedReceipts = await Receipt.insertMany(receiptDocs, { ordered: false }).catch((e) => {
      console.error("collection-sheet/commit: receipt insert failed:", e.message);
      return e.insertedDocs || [];
    });
    if (insertedReceipts.length !== receiptDocs.length) {
      receiptGapCount = receiptDocs.length - insertedReceipts.length;
      console.error(`collection-sheet/commit: wrote ${insertedReceipts.length}/${receiptDocs.length} receipts.`);
    }

    // Close the WHOLE period, not just the bills that got paid this round.
    // A flat marked "unpaid" on the collection sheet was still processed —
    // its balance simply carries forward as a normal debt from here, same
    // as a paid one, it just doesn't stay pinned to the app's home screen
    // as this period's own urgent bill once the admin has moved on.
    await Bill.updateMany(
      { societyId, billPeriodId: periodId, billSeries, isDeleted: { $ne: true } },
      { $set: { periodClosed: true } },
    );

    // Nobody was ever told their payment landed via this route — the same
    // gap fixed on the single-payment /api/payments/record path.
    await Promise.all(
      recorded.map((r) =>
        notifyPaymentReceived({
          transactionId: r.transaction?._id,
          societyId,
          memberId: r.memberId,
          amount: r.amount,
          period: r.period,
        }).catch((e) => console.error("notifyPaymentReceived failed:", e.message)),
      ),
    );

    // ---- Optional: schedule next month -----------------------------------
    let scheduled = null;
    if (flowMode === "schedule" && scheduleFor && nextPeriodId) {
      const runAt = new Date(`${scheduleFor}T02:00:00.000Z`);
      if (!Number.isNaN(runAt.getTime())) {
        await ScheduledBillRun.findOneAndUpdate(
          { societyId, periodId: nextPeriodId, billSeries },
          {
            $set: {
              societyId,
              periodId: nextPeriodId,
              billSeries,
              runAt,
              status: "SCHEDULED",
              createdBy: userId,
            },
          },
          { upsert: true, new: true },
        );
        scheduled = runAt;
      }
    }

    // Invalidate everything this touched.
    await Promise.all([
      cache.del(`billing:generated:${societyId}`),
      cache.del(`payments:outstanding:${societyId}`),
      cache.delPattern(`collection:sheet:${societyId}:${billSeries}:${periodId}:*`),
      invalidateSocietySnapshot(societyId),
      // Every member on this collection sheet just had a payment posted.
      cache.delPattern(`v1:bills:${societyId}:member:*`),
      cache.delPattern(`v1:ledger:${societyId}:member:*`),
    ]);

    return NextResponse.json({
      success: true,
      recorded: recorded.length,
      totalAmount: money(recorded.reduce((a, r) => a + r.amount, 0)),
      totalAdvanceCredit: money(recorded.reduce((a, r) => a + r.advance, 0)),
      scheduled,
      periodId,
      ...(receiptGapCount > 0 || failed.length > 0
        ? {
            warning: [
              failed.length > 0
                ? `${failed.length} payment(s) could not be recorded: ${failed[0].error}. The others were posted.`
                : null,
              receiptGapCount > 0
                ? `${receiptGapCount} receipt(s) could not be generated (fix on the Receipts page).`
                : null,
            ]
              .filter(Boolean)
              .join(" "),
            receiptGapCount,
            failed,
          }
        : {}),
    });
  } catch (error) {
    console.error("collection-sheet/commit error:", error);
    return NextResponse.json(
      { error: "Commit failed" },
      { status: 500 },
    );
  }
}
