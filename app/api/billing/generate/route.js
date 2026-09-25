// app/api/billing/generate/route.js
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Transaction from "@/models/Transaction";
import Society from "@/models/Society";
import Bill from "@/models/Bill";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import cache from "@/lib/cache";
import { generateBill } from "@/lib/billing/generationService";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import { postAdvanceAppliedToLedger } from "@/lib/accounting/advanceLedgerPosting";
import renderBillHtml from "@/lib/bill-renderer";
import { isCommercialUnit } from "@/lib/commercial/constants";
import { authorize } from "@/lib/rbac/authorize";
export async function POST(request) {
  const gate = await authorize(request, "billing.bill.generate");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    // Legacy deny-list removed: authorize() above (billing.bill.generate) is
    // the real gate now. It harmlessly no-op'd for RBAC-only staff tokens
    // (decoded.role is undefined for those, never matches), but decoded.societyId
    // below did not — that field only exists on legacy-shaped tokens.

    const { year, month, bills, memberIds } = await request.json();
    if (!year || !month)
      return NextResponse.json({ error: "Year and month are required" }, { status: 400 });
    if (month < 1 || month > 12)
      return NextResponse.json({ error: "Month must be between 1 and 12" }, { status: 400 });

    const societyId = gate.context.societyId || decoded.societyId;
    const society = await Society.findById(societyId).lean();
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    // Ledger V2: the SERVER is the single source of truth for money. Any
    // client-provided breakdown / totalAmount is ignored here — charges are
    // recomputed from BillingHeads inside GenerationService. The request body's
    // `bills` array is used ONLY to select which members to generate for.
    let targetMemberIds = [];
    if (Array.isArray(bills) && bills.length > 0) {
      targetMemberIds = bills.map((b) => String(b.memberId)).filter(Boolean);
    } else {
      const q = { societyId, isDeleted: { $ne: true } };
      if (Array.isArray(memberIds) && memberIds.length > 0) q._id = { $in: memberIds };
      const members = await Member.find(q).select("_id").lean();
      targetMemberIds = members.map((m) => String(m._id));
    }

    // Commercial (Shop/Office) units are billed exclusively through the
    // dedicated Commercial billing wizard, never through this residential
    // generator — skip them here rather than silently billing them at the
    // wrong (residential) rate.
    const skipErrors = [];
    if (targetMemberIds.length) {
      const targetMembers = await Member.find({ _id: { $in: targetMemberIds } })
        .select("_id flatType")
        .lean();
      const commercialIds = new Set(
        targetMembers.filter((m) => isCommercialUnit(m)).map((m) => String(m._id)),
      );
      if (commercialIds.size) {
        for (const id of commercialIds) {
          skipErrors.push({ memberId: id, error: "Commercial unit — use the Commercial billing wizard instead" });
        }
        targetMemberIds = targetMemberIds.filter((id) => !commercialIds.has(id));
      }
    }

    if (!targetMemberIds.length)
      return NextResponse.json({ error: "No members/bills found to generate" }, { status: 400 });

    const billPeriod = `${year}-${String(month).padStart(2, "0")}`;
    const billTemplate = society?.billTemplate;
    const financialYear = month >= 4 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
    const startDate = new Date(year, month - 1, 1);

    const createdBills = [];
    const errors = [...skipErrors];

    for (const memberId of targetMemberIds) {
      try {
        // 1) CANONICAL bill — all financial math, invariants, and the
        //    BILL_GENERATED audit event live inside GenerationService. This
        //    route no longer computes opening balances, interest, or totals.
        const bill = await generateBill({
          societyId,
          memberId,
          year: Number(year),
          month: Number(month),
          performedBy: decoded.userId,
        });

        // 2) PRESENTATION only — render HTML from the engine's already-computed
        //    numbers (precomputedCurrInt / precomputedMonthInterest). The
        //    renderer never recomputes interest, so the stored bill and its
        //    HTML can no longer diverge (root cause of the ₹17.50 vs ₹21 bug).
        const member = await Member.findById(memberId)
          .select("flatNo wing ownerName carpetAreaSqft contactNumber emailPrimary advanceCredit openingBalance")
          .lean();
        const breakdown =
          bill.charges instanceof Map
            ? Object.fromEntries(bill.charges)
            : bill.charges || {};
        const [unpaidBills, recentTransactions] = await Promise.all([
          Bill.find({
            societyId,
            memberId,
            status: { $in: ["Unpaid", "Partial", "Overdue"] },
            billPeriodId: { $ne: billPeriod },
            isDeleted: { $ne: true },
          })
            .sort({ billYear: 1, billMonth: 1 })
            .lean(),
          Transaction.find({ societyId, memberId })
            .sort({ date: -1 })
            .limit(10)
            .lean(),
        ]);
        const renderResult = renderBillHtml(billTemplate?.html || "", society, member, {
          breakdown,
          totalAmount: bill.currentCharges,
          previousBalance: parseFloat((bill.openingPrincipal + bill.openingInterest).toFixed(2)),
          prevRemPrincipal: bill.openingPrincipal,
          prevRemInt: bill.openingInterest,
          precomputedCurrInt: bill.currentInterest,
          precomputedMonthInterest: bill.billInterestBalance,
          balanceAmount: bill.balanceAmount,
          status: bill.status,
          newBalance: bill.totalBillDue,
          billPeriod,
          billDate: startDate,
          dueDate: bill.dueDate,
          unpaidBills,
          recentTransactions,
        });
        await Bill.updateOne({ _id: bill._id }, { $set: { billHtml: renderResult.html } });

        // 3) Ledger debit Transaction (side-effect only — no math; uses the
        //    engine's total directly).
        const lastTxn = await Transaction.findOne({ memberId, societyId, isReversed: false })
          .sort({ date: -1, createdAt: -1 })
          .lean();
        const prevBal = parseFloat((lastTxn?.balanceAfterTransaction ?? member?.openingBalance ?? 0).toFixed(2));
        const transaction = await Transaction.create({
          transactionId: Transaction.generateTransactionId(),
          societyId,
          memberId,
          date: startDate,
          type: "Debit",
          category: "Maintenance",
          description: `Bill for ${billPeriod}`,
          amount: parseFloat(((bill.currentCharges || 0) + (bill.currentInterest || 0)).toFixed(2)),
          balanceAfterTransaction: parseFloat((prevBal + (bill.currentCharges || 0) + (bill.currentInterest || 0)).toFixed(2)),
          paymentMode: "System",
          createdBy: decoded.userId,
          billPeriodId: billPeriod,
          financialYear,
          billHtml: renderResult.html,
        });

        // 4) Apply any stored advance credit THROUGH the AllocationEngine so
        //    there is no independent advance math here. Skip for Scheduled bills
        //    (not yet live). generateBill blocks duplicates, so a retry cannot
        //    double-apply advance.
        if (bill.status !== "Scheduled" && (member?.advanceCredit || 0) > 0) {
          const applied = Math.min(parseFloat(member.advanceCredit.toFixed(2)), bill.totalBillDue);
          if (applied > 0) {
            await applyPaymentToBill({ billId: bill._id, payment: applied, performedBy: decoded.userId });
            await Member.updateOne({ _id: memberId }, { $inc: { advanceCredit: -applied } });
            await postAdvanceAppliedToLedger(String(societyId), { bill, amount: applied, actorUserId: decoded.userId });
          }
        }

        createdBills.push(transaction._id);
      } catch (err) {
        if (err.code === "P4_DUPLICATE") {
          errors.push({ memberId, error: `Bill already exists for ${billPeriod}` });
        } else if (err.code === "MEMBER_NOT_FOUND") {
          errors.push({ memberId, error: "Member not found" });
        } else if (err.code && /^[BP]\d/.test(err.code)) {
          errors.push({ memberId, error: `Invariant ${err.code}: ${err.message}` });
        } else {
          console.error(`Error creating bill for ${memberId}:`, err);
          errors.push({ memberId, error: err.message });
        }
      }
    }

    await cache.delPattern(`billing:list:${decoded.societyId}:*`);
    await cache.del(`billing:generated:${decoded.societyId}`);
    await cache.del(`payments:outstanding:${decoded.societyId}`);
    await cache.del(`admin:stats:global`);
    // New/updated bills for potentially every member in the society - the
    // mobile app's per-member bill/ledger cache is stale until this clears.
    await cache.delPattern(`v1:bills:${decoded.societyId}:member:*`);
    await cache.delPattern(`v1:ledger:${decoded.societyId}:member:*`);

    return NextResponse.json({
      success: true,
      message: `Generated ${createdBills.length} bill(s)`,
      billsGenerated: createdBills.length,
      billsFailed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Bill generation error:", error);
    return NextResponse.json({ error: "Failed to generate bills" }, { status: 500 });
  }
}
