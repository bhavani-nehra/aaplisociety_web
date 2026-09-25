import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Shop from "@/models/Shop";
import Society from "@/models/Society";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import renderBillHtml from "@/lib/bill-renderer";
import cache from "@/lib/cache";
import { generateBill } from "@/lib/billing/generationService";
import { recordBillDebit, applyStoredAdvance } from "@/lib/billing/postGeneration";
import { notifyBillCreated } from "@/lib/v1/notify";
import { mapLimit } from "@/lib/concurrency";
import { ndjsonResponse } from "@/lib/ndjson-stream";
import { transactionDeleteFilterForRegenerate } from "@/lib/billing/regenerateFilter";
import { authorize } from "@/lib/rbac/authorize";
import { writeBillGenerationReceipt } from "@/lib/billing/billGenerationReceipts";

// Each member's bill generation was previously awaited one at a time — for
// 84 members at ~2.5s/member (several sequential Mongo round trips each,
// crossing regions between the Vercel function and the DB) that serialized
// to 3-4 minutes, right up against the 5-minute function limit, with zero
// feedback to the admin waiting on it. Different members never touch each
// other's Bill/Member/Transaction docs, so generating them concurrently is
// safe — only cap concurrency to avoid exhausting the DB connection pool.
const CONCURRENCY = 8;

// Ledger V2: THIN WRAPPER over the shared GenerationService. Contains no
// billing math of its own — charges/interest/totals are recomputed from
// BillingHeads inside generateBill(). The request body's `bills` array is
// used ONLY to select which members to generate for; any client-supplied
// amounts are ignored, same policy as /api/billing/generate.
export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.bill.generate");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const {
      billMonth,
      billYear,
      bills,
      forceRegenerate,
      publishMode = "config",
      scheduledPushDate = null,
      billSeries = "RESIDENTIAL",
    } = await request.json();
    if (billMonth === undefined || !billYear || !bills) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }
    // ?dryRun=1 — same Plan phase Setup already has (design doc §6), applied
    // to billing. Read-only: computes what each member's bill WOULD be via
    // lib/billing/billPreview.js's pure-function-only path, writes nothing,
    // and returns before any of the write logic below ever runs.
    const { searchParams } = new URL(request.url);
    if (searchParams.get("dryRun") === "1") {
      if (!["RESIDENTIAL", "COMMERCIAL"].includes(billSeries)) {
        return NextResponse.json({ error: "billSeries must be RESIDENTIAL or COMMERCIAL" }, { status: 400 });
      }
      const memberIds = [...new Set(bills.map((b) => String(b.memberId)).filter(Boolean))];
      if (!memberIds.length) return NextResponse.json({ error: "No members to preview" }, { status: 400 });
      const { previewBillsForMembers } = await import("@/lib/billing/billPreview");
      const preview = await previewBillsForMembers({
        societyId: decoded.societyId, memberIds, year: billYear, month: billMonth + 1, billSeries,
      });
      return NextResponse.json({ dryRun: true, ...preview });
    }
    if (!["RESIDENTIAL", "COMMERCIAL"].includes(billSeries)) {
      return NextResponse.json({ error: "billSeries must be RESIDENTIAL or COMMERCIAL" }, { status: 400 });
    }
    if (!["config", "now", "schedule"].includes(publishMode)) {
      return NextResponse.json({ error: "publishMode must be config, now, or schedule" }, { status: 400 });
    }
    if (publishMode === "schedule") {
      const d = new Date(scheduledPushDate);
      if (!scheduledPushDate || Number.isNaN(d.getTime()) || d <= new Date()) {
        return NextResponse.json({ error: "Choose a future scheduled push date" }, { status: 400 });
      }
    }
    const month = billMonth + 1; // client sends 0-indexed month
    const billPeriodId = `${billYear}-${String(month).padStart(2, "0")}`;
    const societyId = decoded.societyId;

    // Block generation for periods that have locked historical bills.
    const historicalExists = await Bill.findOne({
      societyId,
      billPeriodId,
      billSeries,
      $or: [{ isHistoricalArchive: true }, { importedFrom: "BulkImport" }, { isLocked: true }],
      isDeleted: { $ne: true },
    });
    if (historicalExists) {
      return NextResponse.json(
        {
          error: `Cannot generate bills for ${billPeriodId} — this period has locked historical (imported) records. Historical bills are immutable audit records.`,
          isHistoricalPeriod: true,
        },
        { status: 409 },
      );
    }

    const existing = await Bill.findOne({ societyId, billPeriodId, billSeries });
    if (existing) {
      if (!forceRegenerate) {
        return NextResponse.json(
          { error: `${billSeries === "COMMERCIAL" ? "Commercial bills" : "Bills"} for ${billPeriodId} already exist`, canForce: true },
          { status: 409 },
        );
      }
      // Explicit admin-confirmed regeneration — delete and recreate via the
      // same canonical engine, never patch financial values in place. Only
      // THIS series' bills/transactions are touched.
      const staleBillIds = (
        await Bill.find({ societyId, billPeriodId, billSeries }).select("_id").lean()
      ).map((b) => b._id);
      await Bill.deleteMany({ societyId, billPeriodId, billSeries });
      await Transaction.deleteMany(
        transactionDeleteFilterForRegenerate(societyId, billPeriodId, staleBillIds),
      );
    }

    const memberIds = [...new Set(bills.map((b) => String(b.memberId)).filter(Boolean))];
    if (!memberIds.length)
      return NextResponse.json({ error: "No members to generate for" }, { status: 400 });

    const society = await Society.findById(societyId).lean();

    async function generateOneMember(memberId) {
      const bill = await generateBill({
        societyId,
        memberId,
        year: billYear,
        month,
        performedBy: decoded.userId,
        publishMode,
        scheduledFor: scheduledPushDate,
        billClass: billSeries,
      });

      // `memberId` is the unit id — a Shop._id on the commercial path (a shop
      // has no Member row). Always fetching from Member here returned null
      // for every commercial bill and fed a blank object into rendering,
      // notification and the advance-credit step below. Normalised to the
      // same field names bill-renderer.js already expects, so nothing
      // downstream needs a billSeries-aware branch of its own.
      const unit =
        billSeries === "COMMERCIAL"
          ? await Shop.findById(memberId)
              .select("shopNo wing ownerName ownerPhone ownerEmail ownerMemberId areaSqft")
              .lean()
          : await Member.findById(memberId)
              .select("flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary advanceCredit openingBalance")
              .lean();
      const member =
        unit && billSeries === "COMMERCIAL"
          ? {
              flatNo: unit.shopNo,
              wing: unit.wing,
              ownerName: unit.ownerName,
              carpetAreaSqft: unit.areaSqft,
              contactNumber: unit.ownerPhone,
              emailPrimary: unit.ownerEmail,
              advanceCredit: 0, // shops carry no advance-credit concept
              openingBalance: 0,
              ownerMemberId: unit.ownerMemberId ? String(unit.ownerMemberId) : null,
            }
          : unit;
      const breakdown =
        bill.charges instanceof Map ? Object.fromEntries(bill.charges) : bill.charges || {};
      const unitFilter = billSeries === "COMMERCIAL" ? { shopId: memberId } : { memberId };
      const [unpaidBills, recentTransactions] = await Promise.all([
        Bill.find({
          societyId,
          ...unitFilter,
          status: { $in: ["Unpaid", "Partial", "Overdue"] },
          billPeriodId: { $ne: billPeriodId },
          isDeleted: { $ne: true },
        })
          .sort({ billYear: 1, billMonth: 1 })
          .lean(),
        Transaction.find({ societyId, ...unitFilter }).sort({ date: -1 }).limit(10).lean(),
      ]);
      const renderResult = renderBillHtml(null, society, member, {
        breakdown,
        totalAmount: bill.currentCharges,
        previousBalance: parseFloat((bill.openingPrincipal + bill.openingInterest).toFixed(2)),
        prevRemPrincipal: bill.openingPrincipal,
        prevRemInt: bill.openingInterest,
        precomputedCurrInt: bill.currentInterest,
        precomputedMonthInterest: bill.billInterestBalance,
        balanceAmount: bill.balanceAmount,
        status: bill.status,
        billPeriod: billPeriodId,
        billDate: new Date(billYear, billMonth, 1),
        dueDate: bill.dueDate,
        unpaidBills,
        recentTransactions,
      });
      await Bill.updateOne({ _id: bill._id }, { $set: { billHtml: renderResult.billHtml || renderResult.html } });

      await recordBillDebit({
        societyId, bill, member, unitId: memberId, billSeries, billPeriodId, actorUserId: decoded.userId,
      });

      // Apply any stored advance credit THROUGH the AllocationEngine — no
      // independent advance math here. Skip Scheduled bills (not yet live).
      await applyStoredAdvance({ bill, member, unitId: memberId, actorUserId: decoded.userId });

      // Notify the owning member if the shop is linked to one — a shop id has
      // no device tokens / notification recipient of its own.
      const notifyTargetId = billSeries === "COMMERCIAL" ? member?.ownerMemberId || null : memberId;
      if (bill.status !== "Scheduled" && notifyTargetId) {
        await notifyBillCreated({ billId: bill._id, societyId, memberId: notifyTargetId, amount: bill.totalBillDue, period: billPeriodId });
      }
      return { billId: bill._id, flat: `${member?.wing || ""}-${member?.flatNo || ""}`, ownerName: member?.ownerName };
    }

    function classifyError(err, memberId) {
      if (err.code === "P4_DUPLICATE") return { memberId, error: `Bill already exists for ${billPeriodId}` };
      if (err.code === "MEMBER_NOT_FOUND") return { memberId, error: "Member not found" };
      if (err.code === "SHOP_NOT_FOUND") return { memberId, error: "Shop not found" };
      if (err.code && /^[BP]\d/.test(err.code)) return { memberId, error: `Invariant ${err.code}: ${err.message}` };
      // Raw Mongo duplicate-key (11000) — the app-level P4_DUPLICATE guard
      // should have caught this earlier; landing here means it slipped past
      // (e.g. a race between two concurrent generation runs). Report it as
      // the same "already exists" case rather than surfacing a raw driver
      // error to the admin.
      if (err.code === 11000) return { memberId, error: `Bill already exists for ${billPeriodId}` };
      console.error(`Error creating bill for ${memberId}:`, err);
      return { memberId, error: err.message };
    }

    const runStartedAt = new Date();

    return ndjsonResponse(async (emit) => {
      const createdBills = [];
      const errors = [];

      try {
        await mapLimit(memberIds, CONCURRENCY, generateOneMember, (settled, memberId, done, total) => {
          if (settled.status === "fulfilled") {
            createdBills.push(settled.value.billId);
            emit({ type: "progress", done, total, memberId, flat: settled.value.flat, ownerName: settled.value.ownerName, ok: true });
          } else {
            errors.push(classifyError(settled.reason, memberId));
            emit({ type: "progress", done, total, memberId, ok: false, error: settled.reason.message });
          }
        });

        await cache.delPattern(`billing:list:${societyId}:*`);
        await cache.del(`billing:generated:${societyId}`);
        await cache.del(`payments:outstanding:${societyId}`);
        await cache.del(`admin:stats:global`);
        // New bills for every member in this run - the mobile app's per-member
        // cache must not serve last period's bills/ledger after this.
        await cache.delPattern(`v1:bills:${societyId}:member:*`);
        await cache.delPattern(`v1:ledger:${societyId}:member:*`);
      } catch (runError) {
        // The run itself blew up mid-way (not a single member's failure,
        // which is already captured in `errors` above) — record that too,
        // then let ndjsonResponse's own catch emit the {type:"error"} line
        // exactly as it already does. Nothing about that behaviour changes.
        await writeBillGenerationReceipt({
          societyId, billPeriodId, billSeries, actorId: decoded.userId, startedAt: runStartedAt,
          publishMode, error: runError.message,
        }).catch((e) => console.error("[billing] generation receipt write failed:", e?.message));
        throw runError;
      }

      // Receipt write is additive and best-effort — a failure here must
      // never turn a successful bill run into an error response.
      await writeBillGenerationReceipt({
        societyId, billPeriodId, billSeries, actorId: decoded.userId, startedAt: runStartedAt,
        publishMode, counts: { created: createdBills.length, failed: errors.length }, errors,
      }).catch((e) => console.error("[billing] generation receipt write failed:", e?.message));

      return {
        success: true,
        message: `Generated ${createdBills.length} bill(s)`,
        billPeriodId,
        billSeries,
        count: createdBills.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined,
        publishMode,
        scheduledPushDate: publishMode === "schedule" ? scheduledPushDate : null,
      };
    });
  } catch (error) {
    console.error("Generate final bills error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
