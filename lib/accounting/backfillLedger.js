// Shared by the fy-runner "Backfill missing ledger entries" repair tool
// (app/api/admin/fy-runner/backfill-ledger/route.js) AND the fiscalConfig
// setup step (lib/accounting/setupSteps.js) — bills/payments generated
// before accounting was switched on for a society never reached the ledger
// (postBillToLedger/postPaymentToLedger no-op while config.enabled is
// false), and nothing retries them once it flips true.
//
// Every caller finds any bill/payment with no matching Voucher yet (keyed
// by "bill:<id>" / "payment:<id>") and posts it through the same functions
// the live app uses. Deliberately no cap on how many it processes in one
// call — it is safe to run partially: each item is independent, already-
// posted items are skipped (idempotencyKey), and a call that stops partway
// (timeout, crash) leaves nothing broken — calling it again finishes the
// rest. That's the whole strategy for "large backfill" instead of a queue:
// idempotent-by-construction means there is no unsafe partial state to
// guard against.
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Voucher from "@/models/Voucher";
import FinancialYear from "@/models/FinancialYear";
import { postBillToLedger } from "@/lib/accounting/billLedgerPosting";
import { postPaymentToLedger } from "@/lib/accounting/paymentLedgerPosting";
import { twoDp } from "@/lib/billing/paymentApplication";

const isHistoryTxn = (t) => /^history/.test(String(t.notes || ""));

// billYear/billMonth are `required: true` on the schema (models/Bill.js) —
// unlike dueDate/generatedAt, which can be null on rows written by an older
// import path — so this fallback always resolves to a real date instead of
// silently dropping the bill out of every future scan.
function billDate(b) {
  if (b.dueDate) return new Date(b.dueDate);
  if (b.generatedAt) return new Date(b.generatedAt);
  if (Number.isFinite(b.billYear) && Number.isFinite(b.billMonth)) return new Date(b.billYear, b.billMonth, 15);
  return null;
}

// A duplicate-key error on the (societyId, idempotencyKey) unique index
// means a concurrent call already posted this exact bill/payment between
// our existence check and our insert — that's a successful outcome, not a
// failure, and must never be reported as one.
const isDuplicateIdempotencyKey = (err) => err && (err.code === 11000 || /E11000/.test(String(err.message)));

async function postOne(fn, label) {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (isDuplicateIdempotencyKey(err)) return { ok: true, alreadyPosted: true };
    return { ok: false, label, code: err.code || err.name || "ERROR", message: err.message };
  }
}

export async function backfillMissingLedgerEntries({ societyId, financialYear, actorUserId, apply = false }) {
  const sid = String(societyId);
  const within = (d) => d && new Date(d) >= new Date(financialYear.startDate) && new Date(d) <= new Date(financialYear.endDate);

  const [bills, txns] = await Promise.all([
    Bill.find({ societyId, isDeleted: { $ne: true } }).sort({ billPeriodId: 1 }).lean(),
    Transaction.find({ societyId, type: "Credit", category: "Payment", isReversed: { $ne: true } }).sort({ date: 1 }).lean(),
  ]);

  const unresolvedBills = [];
  const inFyBills = bills.filter((b) => {
    if (b.isHistoricalArchive) return false;
    if ((b.currentCharges || 0) + (b.currentInterest || 0) <= 0) return false;
    const d = billDate(b);
    if (!d) {
      unresolvedBills.push(String(b._id));
      return false;
    }
    return within(d);
  });
  const unresolvedTxns = [];
  const inFyTxns = txns.filter((t) => {
    if (isHistoryTxn(t)) return false;
    if (!t.date) {
      unresolvedTxns.push(String(t._id));
      return false;
    }
    return within(t.date);
  });

  const keys = [...inFyBills.map((b) => `bill:${b._id}`), ...inFyTxns.map((t) => `payment:${t._id}`)];
  const have = new Set(
    (await Voucher.find({ societyId, idempotencyKey: { $in: keys } }).select("idempotencyKey").lean()).map((v) => v.idempotencyKey),
  );
  const missBills = inFyBills.filter((b) => !have.has(`bill:${b._id}`));
  const missTxns = inFyTxns.filter((t) => !have.has(`payment:${t._id}`));

  const summary = {
    financialYearLabel: financialYear.label,
    billsInFy: inFyBills.length,
    billsMissing: missBills.length,
    paymentsInFy: inFyTxns.length,
    paymentsMissing: missTxns.length,
    // Not silently dropped: these had neither dueDate/generatedAt NOR a
    // billYear+billMonth (bills), or no date at all (payments) — reported
    // so a human can go fix the row instead of it vanishing from every scan.
    unresolvedBillIds: unresolvedBills,
    unresolvedPaymentIds: unresolvedTxns,
  };

  if (!apply) return { apply: false, summary };

  const failed = [];
  let nb = 0;
  let np = 0;
  for (const b of missBills) {
    const result = await postOne(() => postBillToLedger(sid, { bill: b, actorUserId }), `bill:${b._id}`);
    if (result.ok) nb++;
    else failed.push({ type: "bill", id: String(b._id), billPeriodId: b.billPeriodId, ...result });
  }
  for (const t of missTxns) {
    const pb = t.paymentBreakdown || {};
    const result = await postOne(
      () =>
        postPaymentToLedger(sid, {
          transaction: t,
          paymentMode: t.paymentMode,
          paymentDate: t.date,
          notes: t.notes,
          actorUserId,
          appliedToDues: twoDp((pb.interestCleared || 0) + (pb.principalCleared || 0)),
          advance: twoDp(pb.advanceCredit || 0),
        }),
      `payment:${t._id}`,
    );
    if (result.ok) np++;
    else failed.push({ type: "payment", id: String(t._id), ...result });
  }

  return { apply: true, summary, posted: { bills: nb, payments: np }, failed };
}

// Sweeps every Financial Year the society has, not just "the current one" —
// a society can enable accounting well after more than one FY's worth of
// bills/payments already exist (e.g. it delayed setup across a year-end).
// No isPostable/Locked filter here: a locked FY's bills still deserve to be
// tried (each attempt is isolated via postOne — a FY_LOCKED rejection from
// the engine lands in `failed`, it does not stop the sweep).
export async function backfillAllFinancialYears({ societyId, actorUserId, apply = false }) {
  const years = await FinancialYear.find({ societyId, isDeleted: { $ne: true } }).sort({ startDate: 1 }).lean();
  const perYear = [];
  let totalBills = 0;
  let totalPayments = 0;
  const allFailed = [];
  for (const fy of years) {
    const result = await backfillMissingLedgerEntries({ societyId, financialYear: fy, actorUserId, apply });
    perYear.push({ financialYearId: String(fy._id), ...result });
    if (result.posted) {
      totalBills += result.posted.bills;
      totalPayments += result.posted.payments;
    }
    if (result.failed?.length) allFailed.push(...result.failed.map((f) => ({ ...f, financialYearId: String(fy._id) })));
  }
  return { apply, years: perYear, posted: { bills: totalBills, payments: totalPayments }, failed: allFailed };
}
