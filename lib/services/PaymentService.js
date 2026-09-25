import mongoose from "mongoose";
import Transaction from "@/models/Transaction";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import AuditLog from "@/models/AuditLog";
import { getFinancialYear } from "@/lib/date-utils";
import { getBillPayFinalDate } from "../../utils/interestUtils";
import { postPaymentToLedger as postPaymentToLedgerShared } from "@/lib/accounting/paymentLedgerPosting";
import {
  allocateAcrossCumulativeBills,
  applyAllocationToBill,
  outstandingForBills,
  splitPaymentAgainstDues,
} from "@/lib/billing/paymentApplication";

/**
 * Phase 2.6/2.7/2.8 wiring (docs/accounting-system-ARD.md §8 Phase-2.6 build
 * note): posts a PaymentRecorded AccountingEvent inside the SAME session as
 * the Transaction it mirrors, so the receivables sub-ledger write and the
 * double-entry Journal Entry commit or roll back together (§6.10, §9.2).
 * Thin wrapper around the shared helper (lib/accounting/paymentLedgerPosting.js)
 * that billing-simulator/pay-real and v1/bills/[id]/pay also use — this is
 * the only one of the three that can pass its own session, since it's the
 * only route with a caller-owned transaction wrapping the whole write.
 */
function postPaymentToLedger(session, { societyId, transaction, paymentMode, paymentDate, notes, actorUserId, appliedToDues, advance }) {
  return postPaymentToLedgerShared(societyId, {
    transaction, paymentMode, paymentDate, notes, actorUserId, appliedToDues, advance, session,
  });
}

/**
 * Thrown for expected, caller-facing failures (bad input, not found, business
 * rule violations). Route handlers map `.status` straight to the HTTP
 * response. Anything else (DB errors, bugs) propagates as a normal Error and
 * the route's catch-all returns 500, same as before this extraction.
 */
export class PaymentServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "PaymentServiceError";
    this.status = status;
  }
}

/**
 * Extracted from app/api/payments/record/route.js (Phase 2.1 of the
 * accounting-system revamp — see docs/accounting-system-ARD.md §9 Phase 2.1).
 * Behavior-preserving extraction: every branch, field, and response shape
 * below is unchanged from the original route handler, only wrapped in a
 * Mongo session so the Member/Bill/Transaction/AuditLog writes commit or
 * roll back together. This is also the injection point Phase 2.6 (Accounting
 * Engine core) will hook into — see the ARD's §9.4 note on the other two live
 * payment-recording routes that still need to be migrated onto a shared
 * service before that phase can guarantee 100% posting coverage.
 *
 * NOTE (preserved from the original route, not introduced here): the
 * opening-balance branch below does not write an AuditLog entry, unlike the
 * normal-bills branch. This asymmetry is pre-existing; it is not fixed here
 * to keep this extraction behavior-preserving. Flagged for the Validation
 * Engine (§6.15) to catch once it exists.
 *
 * @param {object} input
 * @param {string} input.memberId
 * @param {string} input.societyId
 * @param {number} input.amount
 * @param {string} input.paymentMode
 * @param {string} [input.paymentDate]
 * @param {string} [input.chequeNo]
 * @param {string} [input.bankName]
 * @param {string} [input.upiId]
 * @param {string} [input.transactionRef]
 * @param {string} [input.notes]
 * @param {string} input.actorUserId
 * @param {string} input.actorRole
 * @returns {Promise<object>} the same shape the route previously returned as JSON
 */
export async function recordPayment({
  memberId,
  societyId,
  amount,
  paymentMode,
  paymentDate,
  chequeNo,
  bankName,
  upiId,
  transactionRef,
  notes,
  actorUserId,
  actorRole,
}) {
  if (!memberId || !amount) {
    throw new PaymentServiceError(400, "Member ID and amount are required");
  }
  if (!paymentMode) {
    throw new PaymentServiceError(400, "Payment mode is required");
  }
  if (amount <= 0) {
    throw new PaymentServiceError(
      400,
      "Payment amount must be greater than zero",
    );
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await recordPaymentWithinSession(session, {
        memberId,
        societyId,
        amount,
        paymentMode,
        paymentDate,
        chequeNo,
        bankName,
        upiId,
        transactionRef,
        notes,
        actorUserId,
        actorRole,
      });
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function recordPaymentWithinSession(session, params) {
  const {
    memberId,
    societyId,
    amount,
    paymentMode,
    paymentDate,
    chequeNo,
    bankName,
    upiId,
    transactionRef,
    notes,
    actorUserId,
    actorRole,
  } = params;

  const member = await Member.findOne({
    _id: memberId,
    societyId,
  }).session(session);
  if (!member) {
    throw new PaymentServiceError(404, "Member not found");
  }

  // Guard: reject payment from MEMBER portal if past billPayFinalDay.
  // Admin / Secretary must be able to record late payments.
  const society = await Society.findById(societyId)
    .select("config")
    .session(session)
    .lean();
  const billPayFinalDay = society?.config?.billPayFinalDay || 0;
  if (billPayFinalDay > 0 && actorRole === "Member") {
    const oldestBill = await Bill.findOne({
      memberId,
      societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue"] },
      isDeleted: false,
    })
      .sort({ billYear: 1, billMonth: 1 })
      .session(session)
      .lean();
    if (oldestBill) {
      const finalDate = getBillPayFinalDate(
        oldestBill.billYear,
        oldestBill.billMonth + 1, // billMonth is 0-indexed; getBillPayFinalDate expects 1-indexed
        billPayFinalDay,
      );
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (finalDate && today > finalDate) {
        throw new PaymentServiceError(
          400,
          `Payment not accepted. The payment deadline for bill period ${String(
            oldestBill.billMonth + 1,
          ).padStart(
            2,
            "0",
          )}/${oldestBill.billYear} was ${finalDate.toLocaleDateString(
            "en-IN",
          )}. Please contact the admin to process this payment.`,
        );
      }
    }
  }

  const unpaidBills = await Bill.find({
    memberId,
    societyId,
    status: { $in: ["Unpaid", "Partial", "Overdue", "Scheduled"] },
    isDeleted: false,
  })
    .sort({ billYear: 1, billMonth: 1 })
    .session(session);

  const hasOpeningBalance =
    (member.openingPrincipal || 0) + (member.openingInterest || 0) > 0;
  const memberTotalPayable =
    unpaidBills.reduce((s, b) => s + (b.balanceAmount || 0), 0) +
    (member.openingPrincipal || 0) +
    (member.openingInterest || 0);
  if (memberTotalPayable <= 0 && unpaidBills.length === 0) {
    throw new PaymentServiceError(
      400,
      "No outstanding bills found for this member",
    );
  }

  // If no bills but has opening balance, create a synthetic bill for allocation
  if (unpaidBills.length === 0 && hasOpeningBalance) {
    const openingInt = parseFloat((member.openingInterest || 0).toFixed(2));
    const openingPrin = parseFloat((member.openingPrincipal || 0).toFixed(2));
    const paid = parseFloat(amount);
    let intCleared = Math.min(paid, openingInt);
    let remaining = parseFloat((paid - intCleared).toFixed(2));
    let prinCleared = Math.min(remaining, openingPrin);
    let advance = parseFloat((remaining - prinCleared).toFixed(2));
    const newOpeningInt = parseFloat((openingInt - intCleared).toFixed(2));
    const newOpeningPrin = parseFloat((openingPrin - prinCleared).toFixed(2));
    await Member.findByIdAndUpdate(
      memberId,
      {
        $set: {
          openingInterest: Math.max(0, newOpeningInt),
          openingPrincipal: Math.max(0, newOpeningPrin),
        },
        ...(advance > 0 ? { $inc: { advanceCredit: advance } } : {}),
      },
      { session },
    );

    const lastTxn = await Transaction.findOne({
      memberId,
      societyId,
      isReversed: false,
    })
      .sort({ date: -1, createdAt: -1 })
      .session(session)
      .lean();
    const prevBal =
      lastTxn?.balanceAfterTransaction ?? member.openingBalance ?? 0;
    const newBal = parseFloat((prevBal - paid).toFixed(2));
    const [txn] = await Transaction.create(
      [
        {
          transactionId: Transaction.generateTransactionId(),
          date: paymentDate ? new Date(paymentDate) : new Date(),
          memberId,
          societyId,
          type: "Credit",
          category: "Payment",
          description: `Payment received (opening balance) via ${paymentMode || "Cash"}${notes ? ` - ${notes}` : ""}`,
          amount: paid,
          balanceAfterTransaction: newBal,
          paymentMode: paymentMode || "Cash",
          chequeNo,
          bankName,
          upiId,
          transactionRef,
          notes,
          createdBy: actorUserId,
          financialYear: getFinancialYear(new Date()),
          paymentBreakdown: {
            interestCleared: intCleared,
            principalCleared: prinCleared,
            advanceCredit: advance,
          },
        },
      ],
      { session },
    );

    await postPaymentToLedger(session, {
      societyId,
      transaction: txn,
      paymentMode,
      paymentDate,
      notes,
      actorUserId,
      appliedToDues: parseFloat((intCleared + prinCleared).toFixed(2)),
      advance,
    });

    const breakdown = {
      interestCleared: intCleared,
      principalCleared: prinCleared,
      advanceCredit: advance,
    };
    return {
      success: true,
      message: "Payment recorded successfully against opening balance",
      transaction: {
        transactionId: txn.transactionId,
        amount: paid,
        previousBalance: prevBal,
        newBalance: newBal,
        breakdown,
        advanceCredit: advance > 0 ? advance : undefined,
      },
    };
  }

  // Migrate legacy bills that have balanceAmount but no principalBalance/interestBalance split
  const normalizedBills = unpaidBills.map((b) => {
    const bill = b.toObject ? b.toObject() : { ...b };
    if (
      (bill.principalBalance || 0) === 0 &&
      (bill.interestBalance || 0) === 0 &&
      (bill.balanceAmount || 0) > 0
    ) {
      const intBal = parseFloat(
        (bill.monthInterest || bill.interestAmount || 0).toFixed(2),
      );
      const prinBal = parseFloat(
        Math.max(0, bill.balanceAmount - intBal).toFixed(2),
      );
      bill.interestBalance = intBal;
      bill.principalBalance = prinBal;
    }
    return bill;
  });

  // INTEREST-FIRST ALLOCATION over CUMULATIVE bills (see allocateAcrossCumulativeBills)
  const {
    billUpdates,
    advanceCredit,
    breakdown,
  } = allocateAcrossCumulativeBills(
    parseFloat(amount),
    normalizedBills,
    society?.config?.adjustmentApplicationMode || "INTEREST_FIRST",
  );

  // Outstanding BEFORE this payment is applied — drives the receivable/advance
  // split used by the ledger posting below.
  const outstandingBefore = outstandingForBills(normalizedBills);
  const { appliedToDues, advance: advancePortion } = splitPaymentAgainstDues(
    parseFloat(amount),
    outstandingBefore,
  );

  const billsUpdated = [];
  const allocations = [];
  for (const update of billUpdates) {
    const bill = unpaidBills.find(
      (b) => String(b._id) === String(update.billId),
    );
    if (!bill) continue;
    // THE CARRY-FORWARD FIX: one writer updates the canonical closing_* fields
    // (which generationService#resolveOpeningBalances reads for next month's
    // opening balance) together with the legacy mirrors. Previously only the
    // legacy fields moved, so every payment was invisible to the next bill and
    // arrears + interest compounded forever on already-settled principal.
    const paidBefore = bill.amountPaid || 0;
    applyAllocationToBill(bill, update, { actorUserId });
    await bill.save({ session });
    allocations.push({
      billId: bill._id,
      interestCleared: parseFloat(update.interestCleared) || 0,
      principalCleared: parseFloat(update.principalCleared) || 0,
      attributed: parseFloat(((bill.amountPaid || 0) - paidBefore).toFixed(2)),
    });
    billsUpdated.push({
      billId: bill._id,
      billPeriod: bill.billPeriodId,
      interestCleared: parseFloat(update.interestCleared),
      principalCleared: parseFloat(update.principalCleared),
      newStatus: bill.status,
    });
  }

  if (advanceCredit > 0) {
    await Member.findByIdAndUpdate(
      memberId,
      { $inc: { advanceCredit } },
      { session },
    );
  }

  const lastTransaction = await Transaction.findOne({
    memberId,
    societyId,
    isReversed: false,
  })
    .sort({ date: -1, createdAt: -1 })
    .session(session)
    .lean();
  const currentLedgerBalance =
    lastTransaction?.balanceAfterTransaction ?? member.openingBalance ?? 0;
  const paymentAmount = parseFloat(amount);
  const newLedgerBalance = currentLedgerBalance - paymentAmount;

  const [transaction] = await Transaction.create(
    [
      {
        transactionId: Transaction.generateTransactionId(),
        date: paymentDate ? new Date(paymentDate) : new Date(),
        memberId,
        societyId,
        type: "Credit",
        category: "Payment",
        description: `Payment received via ${paymentMode || "Cash"}${notes ? ` - ${notes}` : ""}`,
        amount: paymentAmount,
        balanceAfterTransaction: newLedgerBalance,
        paymentMode: paymentMode || "Cash",
        chequeNo,
        bankName,
        upiId,
        transactionRef,
        notes,
        createdBy: actorUserId,
        financialYear: getFinancialYear(new Date()),
        paymentBreakdown: breakdown,
        allocations,
      },
    ],
    { session },
  );

  await AuditLog.create(
    [
      {
        userId: actorUserId,
        societyId,
        action: "RECORD_PAYMENT",
        newData: {
          memberId,
          memberName: member.ownerName,
          roomNo: member.roomNo,
          wing: member.wing,
          amount: paymentAmount,
          paymentMode,
          previousBalance: currentLedgerBalance,
          newBalance: newLedgerBalance,
          billsUpdated,
          breakdown,
        },
        timestamp: new Date(),
      },
    ],
    { session },
  );

  await postPaymentToLedger(session, {
    societyId,
    transaction,
    paymentMode,
    paymentDate,
    notes,
    actorUserId,
    appliedToDues,
    advance: advancePortion,
  });

  const societyConfig = society?.config || {};
  const showBreakdown = societyConfig.memberPaymentBreakdownVisible !== false;
  return {
    success: true,
    message: "Payment recorded successfully",
    transaction: {
      transactionId: transaction.transactionId,
      amount: paymentAmount,
      previousBalance: currentLedgerBalance,
      newBalance: newLedgerBalance,
      billsUpdated,
      ...(showBreakdown ? { breakdown } : {}),
      advanceCredit: advanceCredit > 0 ? advanceCredit : undefined,
    },
  };
}