import FinancialYear from "@/models/FinancialYear";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import { buildBillByHeadLines } from "@/lib/accounting/billHeadAccounts.js";
import "@/lib/accounting/bootstrap";

// Producer-wiring for the BillGenerated event (docs/accounting-system-ARD.md
// §6.10/§8) — the posting rule and event type existed since Phase 2.6/2.7 but
// nothing in the actual billing path ever emitted it, so bills never reached
// the ledger even though payments did. Mirrors
// lib/accounting/paymentLedgerPosting.js: gated on accountingConfig.enabled
// (zero behavior change for opted-out societies), accepts an optional
// caller-owned session so it joins lib/billing/generationService.js's
// existing Bill+AuditEvent transaction where one exists.
//
// Posts only the NEW charge this period (currentCharges + currentInterest),
// never Bill.totalBillDue — see the `default:BillGenerated` posting rule's
// comment in lib/accounting/postingRules/defaultRules.js for why using the
// cumulative running balance would double-post every carried-forward rupee.
export async function postBillToLedger(societyId, { bill, actorUserId, session } = {}) {
  const config = await getFiscalConfig(societyId, session);
  if (!config.enabled) return null;

  // Use the bill's own period date (dueDate), NOT bill.generatedAt — the
  // latter is always the real wall-clock moment the document was created,
  // never the simulated period the bill is nominally for. A billing
  // simulator generates bills for months spanning the past and future
  // relative to "now"; attributing every posting to whichever Financial
  // Year happens to be "current" in real time silently misfiles (or
  // altogether loses, once real time crosses into a different FY mid-run)
  // every entry outside that one window. Found via the Accounting Lab: a
  // full year of simulated bills all landed in one real-time FY regardless
  // of their nominal month, and a bill dated before the FY's own start
  // (e.g. simulating March when the FY starts in April) failed outright.
  const asOf = bill.dueDate ? new Date(bill.dueDate) : bill.generatedAt ? new Date(bill.generatedAt) : new Date();
  const query = FinancialYear.findOne({
    societyId,
    isDeleted: false,
    startDate: { $lte: asOf },
    endDate: { $gte: asOf },
  });
  if (session) query.session(session);
  const financialYear = await query;
  if (!financialYear) {
    const err = new Error(
      "Accounting is enabled for this society but no Financial Year covers this bill's generation date — create one before generating bills.",
    );
    err.status = 409;
    throw err;
  }

  const currentCharges = Number(bill.currentCharges) || 0;
  const currentInterest = Number(bill.currentInterest) || 0;
  const receivableIncrease = Math.round((currentCharges + currentInterest) * 100) / 100;
  if (receivableIncrease <= 0) return null; // nothing new charged this period — no entry to post

  // Split by billing head when the society's accounts allow it.
  const chargesObj = bill.charges instanceof Map ? Object.fromEntries(bill.charges) : bill.charges || {};
  const byHead = await buildBillByHeadLines({
    societyId,
    charges: chargesObj,
    currentCharges,
    currentInterest,
    session,
  }).catch(() => null);

  const event = createAccountingEvent({
    type: EVENT_TYPES.BILL_GENERATED,
    societyId,
    financialYearId: financialYear._id,
    sourceModule: "Billing",
    sourceRef: String(bill._id),
    actorUserId,
    idempotencyKey: `bill:${bill._id}`,
    payload: {
      ...(byHead ? { kind: "ByHead", lines: byHead.lines } : {}),
      receivableIncrease: byHead ? byHead.receivableIncrease : receivableIncrease,
      currentCharges,
      currentInterest,
      narration: `Bill generated for ${bill.billPeriodId}`,
      date: asOf,
    },
  });

  return engineProcess(event, session ? { session } : {});
}
