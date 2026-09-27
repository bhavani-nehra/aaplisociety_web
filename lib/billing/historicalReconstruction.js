// HistoricalBillReconstructionService (§11). Reuses existing billing math
// only — never a second billing engine. Output stays in memory; nothing is
// written to the Bill collection here (§38 — nothing real until Confirm,
// which this plan does not implement yet).
//
// Error handling contract (§24/§27): a bad cell for ONE flat/month must
// never crash the whole batch. Every failure path pushes a structured
// { flat, period, code, message, severity } entry and continues to the
// next flat/month — the caller decides what to do with BLOCKING vs
// WARNING entries. Nothing here throws past this function's boundary.
import { calculateMonthlyInterest } from "../../utils/interestUtils.js";
import { allocatePayment, deriveStatus } from "./allocation-math.js";
import { validateBillInvariants, validateCarryForward } from "./invariants.js";

const twoDp = (n) => parseFloat((Number(n) || 0).toFixed(2));

function findException(exceptions, flat, period) {
  return exceptions.find((e) => e.flat === flat && e.month === period) || null;
}

// Number() coerces "", null, [], {} to 0 or NaN inconsistently — this is the
// one place raw Excel cell values become money, so it must reject anything
// that isn't actually a finite number instead of silently producing 0/NaN.
function toFiniteAmount(raw) {
  if (raw === "" || raw === null || raw === undefined) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

export function reconstructHistory({ window, parsedTemplate, society }) {
  const { flats, paid, rateTable, exceptions } = parsedTemplate;
  const annualRate = society?.config?.interestRate || 0;
  const interestRounding = society?.config?.interestRounding || "TWO_DECIMAL";

  const errors = [];
  const warnings = [];
  const billsByFlat = {};

  // ── Pre-pass: structural checks across the whole template ────────────────
  const seenFlats = new Set();
  const dedupedFlats = [];
  for (const flatRow of flats) {
    const flat = String(flatRow.flat || "").trim();
    if (!flat) continue; // blank row, not an error — Excel trailing blank rows are normal
    if (seenFlats.has(flat)) {
      errors.push({
        flat, period: null, code: "DUPLICATE_FLAT", severity: "BLOCKING",
        message: `Flat ${flat} appears more than once in the Flats sheet — only the first row is used`,
      });
      continue;
    }
    seenFlats.add(flat);
    dedupedFlats.push(flatRow);
  }

  const paidByFlat = new Map();
  for (const p of paid) {
    const flat = String(p.flat || "").trim();
    if (!flat) continue;
    if (paidByFlat.has(flat)) {
      errors.push({
        flat, period: null, code: "DUPLICATE_FLAT_PAID_ROW", severity: "BLOCKING",
        message: `Flat ${flat} appears more than once in the Paid sheet — only the first row is used`,
      });
      continue;
    }
    paidByFlat.set(flat, p);
  }

  // Paid-sheet rows with no matching Flats-sheet definition (SOURCE ONLY, §6) —
  // can't be billed (no opening balances / monthly amount to reconstruct
  // from), flagged so the admin knows data was ignored rather than silently
  // dropped.
  for (const flat of paidByFlat.keys()) {
    if (!seenFlats.has(flat)) {
      warnings.push({
        flat, period: null, code: "SOURCE_ONLY", severity: "WARNING",
        message: `Flat ${flat} has Paid-sheet data but no Flats-sheet row — ignored`,
      });
    }
  }

  // ── Main pass: flat x month reconstruction ────────────────────────────────
  for (const flatRow of dedupedFlats) {
    const flat = String(flatRow.flat).trim();
    const paidRow = paidByFlat.get(flat);
    if (!paidRow) {
      errors.push({ flat, period: null, code: "NO_PAID_ROW", severity: "BLOCKING", message: `No Paid-sheet row for flat ${flat}` });
      continue;
    }

    const openingPrincipalSeed = toFiniteAmount(flatRow.openingPrincipal);
    const openingInterestSeed = toFiniteAmount(flatRow.openingInterest);
    if (Number.isNaN(openingPrincipalSeed) || Number.isNaN(openingInterestSeed)) {
      errors.push({ flat, period: null, code: "INVALID_OPENING_BALANCE", severity: "BLOCKING", message: `Flat ${flat}: opening principal/interest is not a valid number` });
      continue;
    }
    if (openingPrincipalSeed < 0 || openingInterestSeed < 0) {
      errors.push({ flat, period: null, code: "NEGATIVE_OPENING_BALANCE", severity: "BLOCKING", message: `Flat ${flat}: opening principal/interest cannot be negative` });
      continue;
    }

    let openingPrincipal = twoDp(openingPrincipalSeed);
    let openingInterest = twoDp(openingInterestSeed);
    let prevBillLike = null;
    let brokenSoFar = false; // once one month fails, later months' continuity is meaningless noise — suppress cascade
    const bills = [];

    for (const period of window.periods) {
      const rawPaid = paidRow[period];
      if (rawPaid === "NA") continue; // NOT BILLABLE — no bill record at all (§5, §39 rule 1)

      if (brokenSoFar) {
        errors.push({ flat, period, code: "SKIPPED_AFTER_PRIOR_FAILURE", severity: "WARNING", message: `Flat ${flat} / ${period}: skipped, an earlier month in this flat's series already failed` });
        continue;
      }

      const exception = findException(exceptions, flat, period);

      // Continuity: this month's opening must equal previous month's closing.
      try {
        validateCarryForward(prevBillLike, openingPrincipal, openingInterest, period);
      } catch (e) {
        errors.push({ flat, period, code: e.code, severity: "BLOCKING", message: e.message });
        brokenSoFar = true;
        continue;
      }

      // Current charges: Exceptions override > Rate table for this month > Sheet 1 flat amount.
      let currentCharges;
      if (exception && exception.billAmount != null) {
        currentCharges = toFiniteAmount(exception.billAmount);
      } else {
        const rateOverride = rateTable
          .filter((r) => r.fromMonth <= period)
          .sort((a, b) => (a.fromMonth < b.fromMonth ? 1 : -1))[0];
        currentCharges = toFiniteAmount(rateOverride ? rateOverride.amount : flatRow.monthlyBillAmount ?? 0);
      }
      if (Number.isNaN(currentCharges)) {
        errors.push({ flat, period, code: "INVALID_CHARGE_AMOUNT", severity: "BLOCKING", message: `Flat ${flat} / ${period}: bill charge amount is not a valid number` });
        brokenSoFar = true;
        continue;
      }
      if (currentCharges < 0) {
        errors.push({ flat, period, code: "NEGATIVE_CHARGE_AMOUNT", severity: "BLOCKING", message: `Flat ${flat} / ${period}: bill charge amount cannot be negative` });
        brokenSoFar = true;
        continue;
      }
      currentCharges = twoDp(currentCharges);

      // Current interest: Exceptions override > society rule on opening principal.
      let currentInterest;
      if (exception && exception.interestCharged != null) {
        currentInterest = toFiniteAmount(exception.interestCharged);
        if (Number.isNaN(currentInterest)) {
          errors.push({ flat, period, code: "INVALID_INTEREST_OVERRIDE", severity: "BLOCKING", message: `Flat ${flat} / ${period}: Exceptions-sheet interest override is not a valid number` });
          brokenSoFar = true;
          continue;
        }
        if (currentInterest < 0) {
          errors.push({ flat, period, code: "NEGATIVE_INTEREST_OVERRIDE", severity: "BLOCKING", message: `Flat ${flat} / ${period}: Exceptions-sheet interest override cannot be negative` });
          brokenSoFar = true;
          continue;
        }
      } else {
        const { currInt } = calculateMonthlyInterest({
          remainingPrincipal: openingPrincipal,
          annualRate,
          interestRounding,
        });
        currentInterest = currInt;
      }
      currentInterest = twoDp(currentInterest);

      const amountPaid = toFiniteAmount(rawPaid);
      if (Number.isNaN(amountPaid)) {
        errors.push({ flat, period, code: "INVALID_PAID_AMOUNT", severity: "BLOCKING", message: `Flat ${flat} / ${period}: Paid-sheet amount "${rawPaid}" is not a valid number or "NA"` });
        brokenSoFar = true;
        continue;
      }

      const totalBillDue = twoDp(openingPrincipal + openingInterest + currentCharges + currentInterest);
      const closingPrincipalBeforePayment = twoDp(openingPrincipal + currentCharges);
      const closingInterestBeforePayment = twoDp(openingInterest + currentInterest);

      let allocation;
      try {
        allocation = allocatePayment({
          closingPrincipal: closingPrincipalBeforePayment,
          closingInterest: closingInterestBeforePayment,
          payment: twoDp(amountPaid),
        });
      } catch (e) {
        errors.push({ flat, period, code: e.code || "PAYMENT_ALLOCATION_FAILED", severity: "BLOCKING", message: `Flat ${flat} / ${period}: ${e.message}` });
        brokenSoFar = true;
        continue;
      }

      const status = deriveStatus({ balanceAmount: allocation.balanceAmount, amountPaid });

      const bill = {
        flat,
        billPeriodId: period,
        openingPrincipal,
        openingInterest,
        currentCharges,
        currentInterest,
        totalBillDue,
        amountPaid: twoDp(amountPaid),
        closingPrincipal: allocation.closingPrincipal,
        closingInterest: allocation.closingInterest,
        balanceAmount: allocation.balanceAmount,
        advanceCredit: allocation.advanceCredit,
        status,
        // No per-head breakdown in this phase (Sheet 1 gives one amount per
        // flat) — a single bucket keeps B3 (charges sum == currentCharges)
        // meaningful instead of vacuously skipped.
        charges: { "Historical Charges": currentCharges },
      };

      try {
        validateBillInvariants(bill);
      } catch (e) {
        errors.push({ flat, period, code: e.code, severity: "BLOCKING", message: e.message });
        brokenSoFar = true;
        continue;
      }

      bills.push(bill);
      prevBillLike = bill;
      openingPrincipal = bill.closingPrincipal;
      openingInterest = bill.closingInterest;
    }

    billsByFlat[flat] = bills;
  }

  return { billsByFlat, errors, warnings };
}
