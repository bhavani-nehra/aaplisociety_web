import FinancialYear from "@/models/FinancialYear";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap";

// A member paid more than they owed: the surplus sits in the books as a
// liability, "Advance Received From Members" (see paymentLedgerPosting.js).
// When the NEXT bill is raised and that advance is used against it, the bill's
// balance and the member's advance both go down — but nothing moved the money
// inside the books, so Dues from Members and Advance Received From Members
// both stayed too high by the amount used (found by scripts/verify-scenarios.js:
// ₹230.00 used, both accounts ₹230.00 out).
//
//   Dr Advance Received From Members   <applied>
//   Cr Dues from Members               <applied>
//
// Idempotent per bill, gated on accounting being switched on, same as every
// other producer.
export async function postAdvanceAppliedToLedger(societyId, { bill, amount, actorUserId, session } = {}) {
  const applied = Math.round((Number(amount) || 0) * 100) / 100;
  if (!(applied > 0)) return null;
  const config = await getFiscalConfig(societyId, session);
  if (!config.enabled) return null;
  const m = config.defaultAccountMappings || {};
  if (!m.memberAdvanceAccountId || !m.memberReceivableAccountId) return null;

  const asOf = bill.dueDate ? new Date(bill.dueDate) : new Date();
  const query = FinancialYear.findOne({
    societyId,
    isDeleted: false,
    startDate: { $lte: asOf },
    endDate: { $gte: asOf },
  });
  if (session) query.session(session);
  const financialYear = await query;
  if (!financialYear) {
    const err = new Error("Accounting is enabled but no Financial Year covers this bill — create one before applying advances.");
    err.status = 409;
    throw err;
  }

  const event = createAccountingEvent({
    type: EVENT_TYPES.MANUAL_ADJUSTMENT,
    societyId,
    financialYearId: financialYear._id,
    sourceModule: "Billing",
    sourceRef: String(bill._id),
    actorUserId,
    idempotencyKey: `advanceApplied:${bill._id}`,
    payload: {
      date: asOf,
      narration: `Advance adjusted against the bill for ${bill.billPeriodId}`,
      lines: [
        { accountId: String(m.memberAdvanceAccountId), side: "Debit", amount: applied, narration: "Advance used" },
        { accountId: String(m.memberReceivableAccountId), side: "Credit", amount: applied, narration: "Against member dues" },
      ],
    },
  });
  return engineProcess(event, session ? { session } : {});
}
