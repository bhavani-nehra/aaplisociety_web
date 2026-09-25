import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Transaction from "@/models/Transaction";
import { twoDp } from "@/lib/billing/paymentApplication";

/**
 * Recomputes a member's running ledger balance from the bills and the
 * non-reversed transactions, oldest first, starting from what the member owed
 * when their first bill opened. A bill's Debit is what that bill ADDED (charge +
 * interest), never its cumulative total.
 *
 * Used after a payment is reversed: the reversed pair drops out of the ledger,
 * so every later row's balance has to be re-derived. Returns the number of
 * rows that changed.
 */
export async function rebuildMemberLedgerBalances({ societyId, memberId, session = null }) {
  const bq = Bill.find({ societyId, memberId, isDeleted: { $ne: true } }).sort({ billPeriodId: 1 }).lean();
  const mq = Member.findById(memberId).select("openingBalance").lean();
  const tq = Transaction.find({ societyId, memberId, isReversed: { $ne: true } }).sort({ date: 1, createdAt: 1 });
  if (session) {
    bq.session(session);
    mq.session(session);
    tq.session(session);
  }
  const [bills, member, txs] = await Promise.all([bq, mq, tq]);
  let bal = twoDp(bills.length ? (bills[0].openingPrincipal || 0) + (bills[0].openingInterest || 0) : member?.openingBalance || 0);
  let changed = 0;
  for (const t of txs) {
    let amount = t.amount;
    if (t.type === "Debit" && t.category === "Maintenance") {
      const b = bills.find((x) => (t.referenceId ? String(x._id) === String(t.referenceId) : x.billPeriodId === t.billPeriodId));
      if (b) amount = twoDp((b.currentCharges || 0) + (b.currentInterest || 0));
    }
    bal = twoDp(bal + (t.type === "Debit" ? amount : -amount));
    if (Math.abs(amount - t.amount) > 0.005 || Math.abs((t.balanceAfterTransaction || 0) - bal) > 0.005) {
      await Transaction.updateOne({ _id: t._id }, { $set: { amount, balanceAfterTransaction: bal } }, session ? { session } : {});
      changed++;
    }
  }
  return changed;
}
