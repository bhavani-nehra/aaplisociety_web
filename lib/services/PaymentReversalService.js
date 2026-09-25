import mongoose from "mongoose";
import Transaction from "@/models/Transaction";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Voucher from "@/models/Voucher";
import AuditLog from "@/models/AuditLog";
import {
  allocateAcrossCumulativeBills,
  applyAllocationToBill,
  deriveBillStatus,
  twoDp,
} from "@/lib/billing/paymentApplication";
import { reverseVoucher } from "@/lib/services/JournalEntryService";
import { rebuildMemberLedgerBalances } from "@/lib/billing/memberLedger";
import cache from "@/lib/cache";

export class PaymentReversalError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "PaymentReversalError";
    this.status = status;
  }
}

const OPEN = ["Unpaid", "Partial", "Overdue", "Scheduled"];

async function assertReversible(societyId, txn) {
  const [member, bills] = await Promise.all([
    Member.findOne({ _id: txn.memberId, societyId }).lean(),
    Bill.find({ societyId, memberId: txn.memberId, isDeleted: { $ne: true }, isHistoricalArchive: { $ne: true } }).sort({ billPeriodId: 1 }).lean(),
  ]);
  if (!member) throw new PaymentReversalError(404, "Member not found");
  const later = bills.find((b) => +new Date(b.generatedAt) > +new Date(txn.createdAt));
  if (later) {
    throw new PaymentReversalError(
      409,
      `A later bill (${later.billPeriodId}) was raised after this payment, so its opening balance already reflects it. Reverse the payments made since first, or correct this with a journal entry.`,
    );
  }
  if (txn.allocations?.length) {
    const gained = twoDp(txn.paymentBreakdown?.advanceCredit || 0);
    if (gained > 0 && twoDp(member.advanceCredit || 0) + 0.005 < gained) {
      throw new PaymentReversalError(409, "The advance this payment created has already been used against a later bill. Reverse that first, or correct it with a journal entry.");
    }
  } else {
    if (bills.some((b) => (b.advanceApplied || 0) > 0)) {
      throw new PaymentReversalError(409, "This older payment cannot be reversed automatically because advance was applied to a bill. Use a journal entry.");
    }
    const lastGenerated = Math.max(0, ...bills.map((b) => +new Date(b.generatedAt)));
    const others = await Transaction.find({ societyId, memberId: txn.memberId, category: "Payment", type: "Credit", isReversed: { $ne: true } }).select("createdAt").lean();
    if (others.some((p) => +new Date(p.createdAt) < lastGenerated)) {
      throw new PaymentReversalError(409, "This older payment was made before a later bill was raised, so it cannot be reversed automatically. Use a journal entry.");
    }
  }
}

/**
 * Reverses a recorded payment EVERYWHERE it landed.
 *
 * The Payments page used to write a mirror row on the member ledger and flag
 * the payment reversed — and stop there. The bills stayed Paid, the member's
 * advance stayed credited, and the books kept the cash receipt, so the three
 * disagreed. Now:
 *
 *   books    the receipt voucher is reversed (Dr/Cr swapped) — idempotent, so a
 *            retry after a half-finished attempt just carries on
 *   bills    the exact interest/principal the payment cleared is put back on
 *            each bill it touched (payments recorded from now on carry that
 *            allocation; older ones are replayed instead, see below)
 *   advance  what the payment added to the member's advance is taken back
 *   ledger   the payment and its mirror drop out; balances are re-derived
 */
export async function reversePayment({ societyId, transactionId, reason, actorUserId, actorRole }) {
  const txn = await Transaction.findOne({ _id: transactionId, societyId, category: "Payment", type: "Credit" });
  if (!txn) throw new PaymentReversalError(404, "Payment not found");
  if (txn.isReversed) throw new PaymentReversalError(409, "Payment is already reversed");

  // Refuse BEFORE touching anything: reversing the books first and then finding
  // the bills cannot follow would leave the two disagreeing.
  await assertReversible(societyId, txn);

  // 1) the books
  const voucher = await Voucher.findOne({ societyId, idempotencyKey: `payment:${txn._id}`, isDeleted: false });
  let booksReversed = false;
  if (voucher && voucher.status !== "Reversed") {
    await reverseVoucher(String(societyId), String(voucher._id), {
      reason: `Payment ${txn.transactionId} reversed${reason ? `: ${reason}` : ""}`,
      actorUserId,
    });
    booksReversed = true;
  }

  // 2) bills, advance and member ledger together
  const session = await mongoose.startSession();
  let summary;
  try {
    await session.withTransaction(async () => {
      const t = await Transaction.findById(txn._id).session(session);
      const member = await Member.findOne({ _id: t.memberId, societyId }).session(session);
      if (!member) throw new PaymentReversalError(404, "Member not found");
      const bills = await Bill.find({ societyId, memberId: t.memberId, isDeleted: { $ne: true }, isHistoricalArchive: { $ne: true } })
        .sort({ billPeriodId: 1 })
        .session(session);

      // Every bill raised AFTER this payment opened on a balance that already
      // reflected it (and charged interest on that lower balance). Putting the
      // money back on the older bill alone would leave those later bills
      // understating what is owed, and the interest already billed cannot be
      // recomputed. Reverse from the newest payment backwards instead.
      const later = bills.find((b) => +new Date(b.generatedAt) > +new Date(t.createdAt));
      if (later) {
        throw new PaymentReversalError(
          409,
          `A later bill (${later.billPeriodId}) was raised after this payment, so its opening balance already reflects it. Reverse the payments made since first, or correct this with a journal entry.`,
        );
      }

      if (t.allocations?.length) {
        // exact inverse of what this payment did
        for (const a of t.allocations) {
          const bill = bills.find((b) => String(b._id) === String(a.billId));
          if (!bill) continue;
          const principal = twoDp((bill.closingPrincipal ?? bill.principalBalance ?? 0) + (a.principalCleared || 0));
          const interest = twoDp((bill.closingInterest ?? bill.interestBalance ?? 0) + (a.interestCleared || 0));
          const balance = twoDp(principal + interest);
          const paid = Math.max(0, twoDp((bill.amountPaid || 0) - (a.attributed || 0)));
          applyAllocationToBill(
            bill,
            {
              newPrincipalBalance: principal,
              newInterestBalance: interest,
              newBalanceAmount: balance,
              newAmountPaid: paid,
              newStatus: deriveBillStatus({ balanceAmount: balance, amountPaid: paid, totalAmount: bill.totalAmount }),
            },
            { actorUserId },
          );
          await bill.save({ session });
        }
        const gained = twoDp(t.paymentBreakdown?.advanceCredit || 0);
        if (gained > 0) {
          if (twoDp(member.advanceCredit || 0) + 0.005 < gained) {
            throw new PaymentReversalError(409, "The advance this payment created has already been used against a later bill. Reverse that first, or correct it with a journal entry.");
          }
          member.advanceCredit = twoDp((member.advanceCredit || 0) - gained);
          await member.save({ session });
        }
      } else {
        // Recorded before allocations were kept: put the member's bills back to
        // as-generated and replay every OTHER payment. Only sound when every
        // payment came after the last bill was raised.
        if (bills.some((b) => (b.advanceApplied || 0) > 0)) {
          throw new PaymentReversalError(409, "This older payment cannot be reversed automatically because advance was applied to a bill. Use a journal entry.");
        }
        const lastGenerated = Math.max(0, ...bills.map((b) => +new Date(b.generatedAt)));
        const paymentsOfMember = await Transaction.find({ societyId, memberId: t.memberId, category: "Payment", type: "Credit", isReversed: { $ne: true } })
          .sort({ date: 1, createdAt: 1 })
          .session(session);
        if (paymentsOfMember.some((p) => +new Date(p.createdAt) < lastGenerated)) {
          throw new PaymentReversalError(409, "This older payment was made before a later bill was raised, so it cannot be reversed automatically. Use a journal entry.");
        }
        for (const b of bills) {
          applyAllocationToBill(
            b,
            {
              newPrincipalBalance: twoDp((b.openingPrincipal || 0) + (b.currentCharges || 0)),
              newInterestBalance: twoDp((b.openingInterest || 0) + (b.currentInterest || 0)),
              newBalanceAmount: b.totalBillDue,
              newAmountPaid: 0,
              newStatus: "Unpaid",
            },
            { actorUserId },
          );
        }
        let advance = twoDp((member.advanceCredit || 0) - paymentsOfMember.reduce((s, p) => s + (p.paymentBreakdown?.advanceCredit || 0), 0));
        for (const p of paymentsOfMember) {
          if (String(p._id) === String(t._id)) continue;
          const open = bills.filter((b) => OPEN.includes(b.status)).map((b) => b.toObject());
          const r = allocateAcrossCumulativeBills(p.amount, open);
          for (const u of r.billUpdates) applyAllocationToBill(bills.find((b) => String(b._id) === String(u.billId)), u, { actorUserId });
          advance = twoDp(advance + r.advanceCredit);
          p.paymentBreakdown = r.breakdown;
          await p.save({ session });
        }
        for (const b of bills) await b.save({ session });
        member.advanceCredit = advance;
        await member.save({ session });
      }

      // ledger: the payment and its mirror both drop out, balances re-derived
      const reversalId = Transaction.generateTransactionId();
      await Transaction.create(
        [
          {
            transactionId: reversalId,
            date: new Date(),
            memberId: t.memberId,
            societyId,
            type: "Debit",
            category: "Adjustment",
            description: `Reversal of ${t.transactionId}${reason ? ` - ${reason}` : ""}`,
            amount: t.amount,
            balanceAfterTransaction: 0,
            billPeriodId: t.billPeriodId,
            paymentMode: "System",
            notes: reason || "",
            createdBy: actorUserId,
            financialYear: t.financialYear,
            isReversed: true,
            reversalTransactionId: t.transactionId,
          },
        ],
        { session },
      );
      t.isReversed = true;
      t.reversalTransactionId = reversalId;
      await t.save({ session });
      await rebuildMemberLedgerBalances({ societyId, memberId: t.memberId, session });

      await AuditLog.create(
        [
          {
            userId: actorUserId,
            societyId,
            action: "REVERSE_PAYMENT",
            newData: { transactionId: t.transactionId, amount: t.amount, reason, booksReversed, actorRole },
            timestamp: new Date(),
          },
        ],
        { session },
      );
      summary = { reversalTransactionId: reversalId, memberId: String(t.memberId), amount: t.amount };
    });
  } finally {
    await session.endSession();
  }

  await cache.del(`v1:ledger:${societyId}:member:${summary.memberId}`, `v1:bills:${societyId}:member:${summary.memberId}`);
  await cache.del(`payments:outstanding:${societyId}`);
  return { ...summary, booksReversed };
}
