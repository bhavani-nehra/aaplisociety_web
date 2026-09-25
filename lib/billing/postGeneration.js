import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import { postAdvanceAppliedToLedger } from "@/lib/accounting/advanceLedgerPosting";

// The two steps /api/bills/generate-final runs on every freshly generated bill
// that change money: the member-ledger Debit row, and applying any stored
// advance credit. Lifted out of the route unchanged so the route and the
// scripts/fy-cycle.js harness execute the exact same code — no second copy to
// drift. `member` is the normalised unit (Member, or a Shop mapped to member
// field names) exactly as the route builds it.

/** Debit row on the member ledger for a newly generated bill. */
export async function recordBillDebit({ societyId, bill, member, unitId, billSeries, billPeriodId, actorUserId }) {
  const unitFilter = billSeries === "COMMERCIAL" ? { shopId: unitId } : { memberId: unitId };
  const lastTxn = await Transaction.findOne({ societyId, isReversed: false, ...unitFilter })
    .sort({ date: -1, createdAt: -1 })
    .lean();
  const prevBal = parseFloat((lastTxn?.balanceAfterTransaction ?? member?.openingBalance ?? 0).toFixed(2));
  // What this bill ADDS to what the member owes — the new charge and interest.
  // bill.totalBillDue also contains every earlier unpaid month (each bill opens
  // on the previous closing), so debiting it re-added arrears each month and the
  // running balance grew far past what was actually owed.
  const added = parseFloat(((bill.currentCharges || 0) + (bill.currentInterest || 0)).toFixed(2));
  return Transaction.create({
    transactionId: Transaction.generateTransactionId(),
    date: bill.generatedAt || new Date(),
    // Transaction.memberId is required — a shop with no linked owner has
    // no member id to give it, so it falls back to the shop's own id
    // (same convention Bill.memberId uses). shopId is the field every
    // commercial lookup actually keys on.
    memberId: billSeries === "COMMERCIAL" ? member?.ownerMemberId || unitId : unitId,
    shopId: billSeries === "COMMERCIAL" ? unitId : null,
    billSeries,
    societyId,
    type: "Debit",
    category: "Maintenance",
    description: `Bill generated for ${billPeriodId}`,
    amount: added,
    balanceAfterTransaction: parseFloat((prevBal + added).toFixed(2)),
    paymentMode: "System",
    referenceId: bill._id,
    referenceModel: "Bill",
    billPeriodId,
    createdBy: actorUserId,
  });
}

/**
 * Apply stored advance credit THROUGH the AllocationEngine — no independent
 * advance math here. Skips Scheduled bills (not yet live). Returns the amount
 * applied (0 when nothing was).
 */
export async function applyStoredAdvance({ bill, member, unitId, actorUserId }) {
  if (bill.status === "Scheduled" || !((member?.advanceCredit || 0) > 0)) return 0;
  const applied = Math.min(parseFloat(member.advanceCredit.toFixed(2)), bill.totalBillDue);
  if (applied <= 0) return 0;
  const ar = await applyPaymentToBill({ billId: bill._id, payment: applied, performedBy: actorUserId });
  await Bill.updateOne(
    { _id: bill._id },
    { $inc: { advanceApplied: applied }, $set: { status: ar.balanceAmount > 0 ? "Unpaid" : "Paid" } },
  );
  await Member.updateOne({ _id: unitId }, { $inc: { advanceCredit: -applied } });
  // The advance moved from a liability to settling dues — the books must say so.
  await postAdvanceAppliedToLedger(String(bill.societyId), { bill, amount: applied, actorUserId });
  return applied;
}
