// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL "apply a payment to a Bill document" helper.
//
// THE BUG THIS FILE FIXES
// -----------------------
// lib/billing/generationService.js#resolveOpeningBalances derives next month's
// opening balance from the previous bill's CLOSING fields:
//
//     const p = prevBill.closingPrincipal ?? prevBill.billPrincipalBalance ?? ...
//     const i = prevBill.closingInterest  ?? prevBill.billInterestBalance  ?? ...
//
// but lib/services/PaymentService.js only ever wrote the *legacy* running-balance
// fields when a payment came in:
//
//     bill.interestBalance  = update.newInterestBalance;
//     bill.principalBalance = update.newPrincipalBalance;
//     bill.balanceAmount    = update.newBalanceAmount;
//     bill.amountPaid       = update.newAmountPaid;
//     bill.status           = update.newStatus;
//     // closingPrincipal / closingInterest / closingTotal ← NEVER UPDATED
//
// `closingPrincipal` therefore kept its generation-time value
// (openingPrincipal + currentCharges, the "nobody has paid yet" default set in
// computeBill), so every payment was INVISIBLE to the carry-forward. Next
// month re-opened on the full pre-payment arrears and charged interest on
// principal the member had already cleared. That is exactly the reported
// symptom: 1,395 -> 2,814 -> 4,258 -> 5,726 ... every bill "Paid" yet the due
// climbing every single month, with interest compounding on ghost arrears.
//
// Fix: ONE writer for bill payment state, which updates the canonical closing_*
// fields and the legacy mirrors together so they can never drift again.
// ─────────────────────────────────────────────────────────────────────────────

import { allocatePaymentInterestFirst } from "@/utils/interestUtils";

const twoDp = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Status from the remaining balance — epsilon-guarded for float dust. */
export function deriveBillStatus({ balanceAmount, amountPaid, totalAmount }) {
  if (twoDp(balanceAmount) <= 0.005) return "Paid";
  if (twoDp(amountPaid) > 0) return "Partial";
  // Balances are cumulative: a payment brings every open bill's balance down,
  // but its cash is attributed to the oldest bill only. A bill whose balance
  // has fallen below what it was billed for has been paid towards.
  if (totalAmount != null && twoDp(balanceAmount) < twoDp(totalAmount) - 0.005) return "Partial";
  return "Unpaid";
}

/**
 * Applies one allocation result to a Bill (mongoose doc or plain object) and
 * keeps EVERY balance representation in sync:
 *
 *   canonical : closingPrincipal, closingInterest, closingTotal, balanceAmount
 *   legacy    : principalBalance, interestBalance, monthInterest, interestAmount
 *   payment   : amountPaid, status
 *
 * @param {object} bill    Bill document to mutate.
 * @param {object} update  { newPrincipalBalance, newInterestBalance, newBalanceAmount, newAmountPaid, newStatus? }
 * @param {object} meta    { actorUserId }
 * @returns {object} bill (mutated, NOT saved — caller owns the session/save)
 */
export function applyAllocationToBill(bill, update, { actorUserId } = {}) {
  const principal = Math.max(0, twoDp(update.newPrincipalBalance));
  const interest = Math.max(0, twoDp(update.newInterestBalance));
  const balance = twoDp(principal + interest);
  const amountPaid = twoDp(update.newAmountPaid);

  // ── canonical (what resolveOpeningBalances actually reads) ──────────────
  bill.closingPrincipal = principal;
  bill.closingInterest = interest;
  bill.closingTotal = balance;
  bill.balanceAmount = balance;

  // ── legacy mirrors (kept in lockstep; §15 migration window) ─────────────
  bill.principalBalance = principal;
  bill.interestBalance = interest;
  bill.monthInterest = interest;
  bill.interestAmount = interest;

  bill.amountPaid = amountPaid;
  bill.status = update.newStatus || deriveBillStatus({ balanceAmount: balance, amountPaid });
  bill.lastModifiedAt = new Date();
  if (actorUserId) bill.lastModifiedBy = actorUserId;

  return bill;
}

/**
 * What a member ACTUALLY owes right now across their open bills.
 *
 * The Accounting Lab used to auto-pay `bill.totalBillDue`, which is the
 * CUMULATIVE running balance (opening + current), not the outstanding amount.
 * Once arrears carried forward, that overpaid by the full arrears every single
 * month — which is why Member Receivable landed at ₹-30,149.45 (a credit
 * balance sitting on the asset side of the Balance Sheet) while Cash showed
 * ₹40,427.11 against only ₹10,277.66 of income ever billed.
 *
 * @returns {number} sum of remaining balances, never negative
 */
export function outstandingForBills(bills = []) {
  // Each bill's closingTotal is CUMULATIVE — resolveOpeningBalances() seeds
  // the next bill's opening balance straight from the previous bill's
  // closingPrincipal/closingInterest (lib/billing/generationService.js), so
  // an unpaid bill for month N already carries every prior unpaid month's
  // balance inside its own closingTotal. Summing closingTotal across several
  // simultaneously-open bills therefore counts the same carried-forward
  // rupees once per bill still sitting open — e.g. April unpaid (₹1,435) +
  // May unpaid (₹2,894.81, which already includes April's ₹1,435) summed to
  // ₹4,329.81 of "outstanding" when the member actually owed ₹2,894.81. That
  // inflated figure fed splitPaymentAgainstDues() as the cap, letting it
  // classify money that should have gone to the Advance liability as
  // "applied to dues" instead — over-crediting Member Receivable until it
  // went negative (an asset showing a credit balance).
  //
  // The true total owed is simply the LATEST (co bill period) bill's
  // closingTotal — every older open bill's balance is already folded into it.
  if (!bills.length) return 0;
  const latest = bills.reduce((best, b) => {
    if (!best) return b;
    if (b.billYear !== best.billYear) return b.billYear > best.billYear ? b : best;
    return b.billMonth > best.billMonth ? b : best;
  }, null);
  const closing =
    latest.closingTotal ??
    latest.balanceAmount ??
    twoDp((latest.closingPrincipal || 0) + (latest.closingInterest || 0));
  return Math.max(0, twoDp(closing));
}

/**
 * Splits a received amount into the part that settles real dues and the part
 * that is a genuine advance. The advance part must NOT credit Member
 * Receivable (that drives the asset negative) — it is a liability of the
 * society ('Advance Received From Members' on the statutory Balance Sheet,
 * exactly the "Advance Recd. From Members ₹20,576.00" line in the reference
 * format).
 */
export function splitPaymentAgainstDues(amount, outstanding) {
  const paid = twoDp(amount);
  const due = Math.max(0, twoDp(outstanding));
  const appliedToDues = twoDp(Math.min(paid, due));
  return { appliedToDues, advance: twoDp(paid - appliedToDues) };
}

/**
 * Applies ONE payment to a member's open bills when those bills are CUMULATIVE.
 *
 * Every engine-generated bill opens on the previous bill's closing, so an older
 * open bill's balance is already folded into the newest bill's balance (see
 * outstandingForBills). Walking the payment down the bills oldest-first — the
 * old FIFO — spends the same rupees twice: a member who owed Sep ₹2,412.50 and
 * Oct ₹3,849.41 (which includes Sep) and paid the ₹3,849.41 in full cleared
 * Sep, then put the remaining ₹1,436.91 against Oct, leaving ₹2,412.50 of Oct
 * "owed" — and next month's bill opened on it.
 *
 * Correct: the payment reduces the newest bill's balance (interest first, then
 * principal, unless PRINCIPAL_FIRST) and the same rupees reduce each older
 * bill's own balance, capped at what that bill holds. Whatever exceeds the
 * newest bill's balance is the advance.
 *
 * Same return shape as allocatePaymentInterestFirst, so callers swap directly.
 */
export function allocateAcrossCumulativeBills(paymentAmount, bills, mode = "INTEREST_FIRST") {
  const period = (b) => b.billYear * 12 + b.billMonth;
  const sorted = [...bills].sort((x, y) => period(x) - period(y));
  const latest = sorted[sorted.length - 1] || null;
  const runs = new Map(sorted.map((b) => [String(b._id), allocatePaymentInterestFirst(paymentAmount, [b], mode)]));
  const main = latest ? runs.get(String(latest._id)) : null;
  const appliedToDues = twoDp((main?.totalInterestCleared || 0) + (main?.totalPrincipalCleared || 0));

  // Balances are cumulative, so every open bill's balance comes down by the same
  // payment — but the CASH must be counted once. Attribute it oldest-first over
  // each bill's OWN slice (its balance minus the bill before it), so that
  // summing amountPaid across a member's bills gives the cash actually received.
  const balanceOf = (b) => twoDp(b.balanceAmount ?? (b.principalBalance || 0) + (b.interestBalance || 0));
  let remaining = appliedToDues;
  let previous = 0;
  const attributed = new Map();
  for (const b of sorted) {
    const balance = balanceOf(b);
    const slice = Math.max(0, twoDp(balance - previous));
    const take = Math.min(remaining, slice);
    attributed.set(String(b._id), twoDp(take));
    remaining = twoDp(remaining - take);
    previous = balance;
  }
  const billUpdates = sorted.map((b) => {
    const u = runs.get(String(b._id)).billUpdates[0];
    const newAmountPaid = twoDp((b.amountPaid || 0) + attributed.get(String(b._id)));
    const after = twoDp(u.newBalanceAmount);
    const newStatus = after <= 0.005 ? "Paid" : after < balanceOf(b) - 0.005 || newAmountPaid > 0 ? "Partial" : "Unpaid";
    return { ...u, newAmountPaid, newStatus };
  });
  return {
    billUpdates,
    totalInterestCleared: main?.totalInterestCleared || 0,
    totalPrincipalCleared: main?.totalPrincipalCleared || 0,
    advanceCredit: main?.advanceCredit ?? twoDp(paymentAmount),
    breakdown: main?.breakdown || { interestCleared: 0, principalCleared: 0, advanceCredit: twoDp(paymentAmount) },
  };
}

export { twoDp };
