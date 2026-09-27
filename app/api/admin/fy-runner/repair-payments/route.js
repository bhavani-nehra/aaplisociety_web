// POST /api/admin/fy-runner/repair-payments
// body: { apply?: boolean, memberIds?: string[] }
// Web port of scripts/fy-cycle.js::repairPayments. Payments applied by the
// OLD oldest-first allocator left the newest bill still owing what the
// member had actually paid — ledger vouchers were right, the BILL records
// are wrong. This resets each member's live (non-historical) bills to
// as-generated and replays their payments, oldest bill first, through the
// current (corrected) allocator.
// apply:false (default) = scan only, shows before/after per member, nothing
// written. apply:true = actually replays and saves for the given memberIds
// (or every repairable member if omitted).
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import { isCommercialUnit } from "@/lib/commercial/constants";
import { outstandingForBills, allocateAcrossCumulativeBills, applyAllocationToBill, twoDp } from "@/lib/billing/paymentApplication";

const isResidential = (m) => !isCommercialUnit(m);
const isHistoryTxn = (t) => /^history/.test(String(t.notes || ""));
const OPEN = ["Unpaid", "Partial", "Overdue"];

export async function POST(request) {
  const gate = await authorize(request, "finance.accounting.manage");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const societyId = gate.context.societyId;
    const apply = !!body.apply;
    const wantIds = Array.isArray(body.memberIds) ? new Set(body.memberIds.map(String)) : null;

    const members = (await Member.find({ societyId, isDeleted: { $ne: true } }).lean()).filter(isResidential);
    const results = [];

    for (const m of members) {
      if (wantIds && !wantIds.has(String(m._id))) continue;
      const label = `${m.wing ? m.wing + "-" : ""}${m.flatNo}`;

      const txns = (await Transaction.find({ societyId, memberId: m._id, type: "Credit", category: "Payment", isReversed: { $ne: true } }).sort({ date: 1, createdAt: 1 }).lean()).filter((t) => !isHistoryTxn(t));
      if (!txns.length) continue;

      const bills = await Bill.find({ societyId, memberId: m._id, isDeleted: { $ne: true }, isHistoricalArchive: { $ne: true } }).sort({ billPeriodId: 1 });
      if (!bills.length) continue;

      if (bills.some((b) => (b.advanceApplied || 0) > 0)) {
        results.push({ memberId: String(m._id), flat: label, skipped: true, reason: "Advance was applied to a bill — cannot replay automatically" });
        continue;
      }
      const lastGen = Math.max(...bills.map((b) => +new Date(b.generatedAt)));
      if (txns.some((t) => +new Date(t.createdAt) < lastGen)) {
        results.push({ memberId: String(m._id), flat: label, skipped: true, reason: "A payment was made between bill generations — cannot replay automatically" });
        continue;
      }

      const before = outstandingForBills(bills.filter((b) => OPEN.includes(b.status)).map((b) => b.toObject()));

      // Reset to as-generated (in-memory clone if not applying — never
      // mutate a Mongoose doc's live state without saving it).
      const working = apply ? bills : bills.map((b) => b.toObject());
      for (const b of working) {
        const reset = {
          newPrincipalBalance: twoDp((b.openingPrincipal || 0) + (b.currentCharges || 0)),
          newInterestBalance: twoDp((b.openingInterest || 0) + (b.currentInterest || 0)),
          newBalanceAmount: undefined, // set below via applyAllocationToBill's own totalBillDue read
          newAmountPaid: 0,
          newStatus: "Unpaid",
        };
        reset.newBalanceAmount = b.totalBillDue;
        applyAllocationToBill(b, reset, { actorUserId: String(gate.context.userId) });
      }

      const oldAdvance = twoDp(txns.reduce((t, x) => t + (x.paymentBreakdown?.advanceCredit || 0), 0));
      let advance = twoDp((m.advanceCredit || 0) - oldAdvance);
      const breakdownUpdates = [];
      for (const t of txns) {
        const open = working.filter((b) => OPEN.includes(b.status)).map((b) => (apply ? b.toObject() : b));
        const r = allocateAcrossCumulativeBills(t.amount, open);
        for (const u of r.billUpdates) {
          const target = working.find((b) => String(b._id) === String(u.billId));
          if (target) applyAllocationToBill(target, u, { actorUserId: String(gate.context.userId) });
        }
        advance = twoDp(advance + r.advanceCredit);
        breakdownUpdates.push({ transactionId: t._id, breakdown: r.breakdown });
      }

      const after = outstandingForBills(working.filter((b) => OPEN.includes(b.status)).map((b) => (apply ? b.toObject() : b)));

      if (apply) {
        for (const b of working) await b.save();
        await Member.updateOne({ _id: m._id }, { $set: { advanceCredit: advance } });
        for (const u of breakdownUpdates) await Transaction.updateOne({ _id: u.transactionId }, { $set: { paymentBreakdown: u.breakdown } });
      }

      results.push({ memberId: String(m._id), flat: label, before, after, advance, paymentsReplayed: txns.length, applied: apply });
    }

    return NextResponse.json({ apply, results });
  } catch (err) {
    console.error("fy-runner/repair-payments error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
