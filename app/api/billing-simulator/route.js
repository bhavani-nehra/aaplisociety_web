import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { calculateMonthlyInterest, roundInterest } from "../../../utils/interestUtils";
import { allocatePayment } from "@/lib/billing/allocation-math";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function twoDp(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}
function isoDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return String(d).split("T")[0];
}
// ---------------------------------------------------------------------------
// ARCHITECTURE: Two-state immutable snapshot model
//
// BILL STATE (immutable, set at generation, NEVER mutated after):
//   openingPrincipal, openingInterest   — carried from prior month's closing
//   currentCharges, currentInterest     — this month's new amounts
//   billPrincipalBalance                = openingPrincipal + currentCharges
//   billInterestBalance                 = openingInterest + currentInterest
//   totalBillDue                        = billPrincipalBalance + billInterestBalance
//
// CLOSING STATE (computed after payment, stored separately):
//   paymentAmount, interestCleared, principalCleared
//   closingPrincipal                    = billPrincipalBalance - principalCleared
//   closingInterest                     = billInterestBalance - interestCleared
//   closingTotal                        = closingPrincipal + closingInterest
//
// NEXT MONTH CARRY:
//   openingPrincipal = previousMonth.closingPrincipal  (ONLY)
//   openingInterest  = previousMonth.closingInterest   (ONLY)
// ---------------------------------------------------------------------------
function runSimulation(config, member, actions) {
  // carry: the single source of truth for what flows into the next bill.
  // openingPrincipal/Interest = previous month's closingPrincipal/Interest ONLY.
  let carry = {
    openingPrincipal: twoDp(member.openingPrincipal),
    openingInterest: twoDp(member.openingInterest),
    advanceCredit: twoDp(member.advanceCredit || 0),
  };
  // oldestUnpaidDueDate: interest anchor. Set when there is outstanding principal,
  // cleared when fully paid. Persists across months if never fully cleared.
  let oldestUnpaidDueDate = null;
  const snapshots = [];
  // currentBill: the single active unpaid bill entry for the allocator.
  // Each generate REPLACES this — prior outstanding is already absorbed into
  // openingPrincipal/Interest, so there is never more than one entry.
  // { billPeriodId, dueDate, remainingPrincipal, remainingInterest, totalBillDue }
  let currentBill = null;
  for (const action of actions) {
    // ------------------------------------------------------------------
    // GENERATE
    // ------------------------------------------------------------------
    if (action.type === "generate") {
      const { year, month } = action;
      const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
      // Opening balances come EXCLUSIVELY from carry (prior closing state).
      const openingPrincipal = twoDp(carry.openingPrincipal);
      const openingInterest = twoDp(carry.openingInterest);
      // Interest anchor: oldest outstanding due date, or previous month's due date.
      const dueDate = new Date(year, month - 1, 10);
      if (openingPrincipal > 0 && !oldestUnpaidDueDate) {
        // First time we have outstanding principal — anchor to previous month's due.
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        oldestUnpaidDueDate = new Date(prevYear, prevMonth - 1, 10);
      }
      const oldestDueDate = oldestUnpaidDueDate ||
        new Date(year, month - 1 === 0 ? 11 : month - 2, 10);
      const { currInt: currentInterest } = calculateMonthlyInterest({
        remainingPrincipal: openingPrincipal,
        remInt: 0,
        annualRate: config.interestRate,
        interestRounding: config.interestRounding,
      });
      const currentCharges =
        action.charges != null ? action.charges : config.charges;
      // IMMUTABLE bill state — never mutated after creation.
      const billPrincipalBalance = twoDp(openingPrincipal + currentCharges);
      const billInterestBalance = twoDp(openingInterest + currentInterest);
      const totalBillDue = twoDp(billPrincipalBalance + billInterestBalance);
      const bill = {
        billPeriodId,
        billYear: year,
        billMonth: month,
        generationDate: isoDate(action.generationDate),
        dueDate: isoDate(dueDate),
        oldestDueDate: isoDate(oldestDueDate),
        openingPrincipal,
        openingInterest,
        currentCharges,
        currentInterest,
        billPrincipalBalance,
        billInterestBalance,
        totalBillDue,
        // Aliases for test cases & UI
        charges: currentCharges,
        prevRemPrincipal: openingPrincipal,
        prevRemInt: openingInterest,
        currInt: currentInterest,
        principalBalance: billPrincipalBalance,
        interestBalance: billInterestBalance,
        balanceAmount: totalBillDue,
        totalAmount: totalBillDue,
        amountPaid: 0,
        status: "Unpaid",
      };
      // Replace currentBill — prior outstanding already absorbed into opening balances.
      // The allocator sees ONE bill at a time; no double-counting possible.
      currentBill = {
        billPeriodId,
        dueDate: isoDate(dueDate),
        remainingPrincipal: billPrincipalBalance,
        remainingInterest: billInterestBalance,
        totalBillDue,
      };
      // If no payment follows, next month carries the full bill balance.
      carry.openingPrincipal = billPrincipalBalance;
      carry.openingInterest = billInterestBalance;
      const carryIn = {
        openingPrincipal,
        openingInterest,
        advanceCredit: carry.advanceCredit,
      };
      snapshots.push({
        billPeriodId,
        generationDate: isoDate(action.generationDate),
        bill,           // IMMUTABLE — never touched after this line
        closing: null,  // populated by PAY action
        payment: null,
        carryIn,
        carryOut: {
          openingPrincipal: billPrincipalBalance,
          openingInterest: billInterestBalance,
          advanceCredit: carry.advanceCredit,
        },
      });
    }
    // ------------------------------------------------------------------
    // PAY
    // ------------------------------------------------------------------
    if (action.type === "pay") {
      const { billPeriodId, paymentDate, amount } = action;
      const snapshot = snapshots.find((s) => s.billPeriodId === billPeriodId);
      // Build allocator input from mutable remaining balances
      // currentBill is the single consolidated entry — no double-counting possible.
      if (!currentBill) {
        // No bill generated yet — ignore stray payment.
        continue;
      }
      // Ledger V2: single-bill allocation via the shared pure function — this
      // simulator already assumes at most one active bill (per its own
      // "currentBill" design), so it's a direct fit, not a reimplementation.
      const result = allocatePayment({
        closingPrincipal: currentBill.remainingPrincipal,
        closingInterest: currentBill.remainingInterest,
        payment: amount,
      });
      const advCredit = result.advanceCredit;
      const breakdown = {
        interestCleared: result.interestPaid,
        principalCleared: result.principalPaid,
        advanceCredit: result.advanceCredit,
      };
      currentBill.remainingPrincipal = result.closingPrincipal;
      currentBill.remainingInterest = result.closingInterest;
      carry.advanceCredit = twoDp(carry.advanceCredit + advCredit);
      // Zero-normalize to prevent phantom balances from float residuals.
      const eps = 0.005;
      const closingPrincipal = currentBill.remainingPrincipal < eps ? 0 : currentBill.remainingPrincipal;
      const closingInterest = currentBill.remainingInterest < eps ? 0 : currentBill.remainingInterest;
      const closingTotal = twoDp(closingPrincipal + closingInterest);
      // Apply normalized values back so next generate reads clean carry.
      currentBill.remainingPrincipal = closingPrincipal;
      currentBill.remainingInterest = closingInterest;
      // Reset oldestUnpaidDueDate when fully cleared.
      if (closingPrincipal <= 0) oldestUnpaidDueDate = null;
      // Next month's opening derives ONLY from closing state.
      carry.openingPrincipal = closingPrincipal;
      carry.openingInterest = closingInterest;
      const simPayment = {
        billPeriodId,
        paymentDate: isoDate(paymentDate),
        amount,
        interestCleared: twoDp(result.interestPaid),
        principalCleared: twoDp(result.principalPaid),
        advanceCredit: twoDp(advCredit),
        breakdown,
      };
      const closingSnapshot = {
        paymentAmount: amount,
        interestCleared: twoDp(result.interestPaid),
        principalCleared: twoDp(result.principalPaid),
        closingPrincipal,
        closingInterest,
        closingTotal,
      };
      const newCarryOut = {
        openingPrincipal: closingPrincipal,
        openingInterest: closingInterest,
        advanceCredit: carry.advanceCredit,
      };
      if (snapshot) {
        snapshot.payment = simPayment;
        snapshot.closing = closingSnapshot;
        snapshot.carryOut = newCarryOut;
      }
    }
  }
  // Final carryOut on last snapshot (if last action was a generate with no payment)
  if (snapshots.length > 0) {
    const last = snapshots[snapshots.length - 1];
    if (!last.payment) {
      last.carryOut = {
        openingPrincipal: carry.openingPrincipal,
        openingInterest: carry.openingInterest,
        advanceCredit: carry.advanceCredit,
      };
    }
  }
  const finalCarry = {
    openingPrincipal: carry.openingPrincipal,
    openingInterest: carry.openingInterest,
    advanceCredit: carry.advanceCredit,
  };
  // Ledger = monthly snapshot summary. Each row independent — no cumulative balance.
  // closingTotal = totalBillDue when no payment; closing.closingTotal when paid.
  const ledger = snapshots.map((s) => {
    const totalBillDue = s.bill.totalBillDue;
    const amountPaid = s.payment ? s.payment.amount : 0;
    const balance = s.closing ? s.closing.closingTotal : totalBillDue;
    return {
      billPeriodId: s.billPeriodId,
      generationDate: s.bill.generationDate,
      dueDate: s.bill.dueDate,
      totalBillDue,
      amountPaid,
      balance,
      status: s.payment
        ? balance <= 0.005 ? "Paid" : "Partial"
        : "Unpaid",
      principalDue: s.bill.billPrincipalBalance,
      interestDue: s.bill.billInterestBalance,
      interestCleared: s.payment ? s.payment.interestCleared : 0,
      principalCleared: s.payment ? s.payment.principalCleared : 0,
    };
  });
  return { snapshots, ledger, finalCarry };
}
// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------
function buildTestCases(snapshots, config) {
  const results = [];
  function tc(name, passed, expected, actual, note = "") {
    results.push({ name, passed, expected, actual, note });
  }
  // 1. bill_invariant: totalBillDue === billPrincipalBalance + billInterestBalance
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      const b = s.bill;
      const sum = twoDp(b.billPrincipalBalance + b.billInterestBalance);
      if (Math.abs(sum - b.totalBillDue) > 0.01) {
        allOk = false;
        failNote = `${b.billPeriodId}: p=${b.billPrincipalBalance}+i=${b.billInterestBalance}=${sum} ≠ ${b.totalBillDue}`;
        break;
      }
    }
    tc("bill_invariant", allOk,
      "totalBillDue === billPrincipalBalance + billInterestBalance",
      allOk ? "all pass" : failNote,
      "Every bill must satisfy the balance equation");
  }
  // 2. principal_accumulates: billPrincipalBalance = openingPrincipal + currentCharges
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      const b = s.bill;
      const expected = twoDp(b.openingPrincipal + b.currentCharges);
      if (Math.abs(expected - b.billPrincipalBalance) > 0.01) {
        allOk = false;
        failNote = `${b.billPeriodId}: opening=${b.openingPrincipal}+charges=${b.currentCharges}=${expected} ≠ ${b.billPrincipalBalance}`;
        break;
      }
    }
    tc("principal_accumulates", allOk,
      "billPrincipalBalance === openingPrincipal + currentCharges",
      allOk ? "all pass" : failNote,
      "Principal includes all prior unpaid plus current charges");
  }
  // 3. interest_accumulates: billInterestBalance = openingInterest + currentInterest
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      const b = s.bill;
      const expected = twoDp(b.openingInterest + b.currentInterest);
      if (Math.abs(expected - b.billInterestBalance) > 0.01) {
        allOk = false;
        failNote = `${b.billPeriodId}: openingInt=${b.openingInterest}+currInt=${b.currentInterest}=${expected} ≠ ${b.billInterestBalance}`;
        break;
      }
    }
    tc("interest_accumulates", allOk,
      "billInterestBalance === openingInterest + currentInterest",
      allOk ? "all pass" : failNote,
      "Interest includes all prior unpaid plus new current interest");
  }
  // 4. bill_state_immutable: bill fields unchanged after payment (closing state is separate)
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      if (!s.payment || !s.closing) continue;
      const b = s.bill;
      const c = s.closing;
      // bill totals must still equal original (not post-payment values)
      const sum = twoDp(b.billPrincipalBalance + b.billInterestBalance);
      if (Math.abs(sum - b.totalBillDue) > 0.01) {
        allOk = false;
        failNote = `${b.billPeriodId}: bill mutated after payment — p=${b.billPrincipalBalance} i=${b.billInterestBalance} total=${b.totalBillDue}`;
        break;
      }
      // closing must be <= bill (can't clear more than billed)
      if (c.closingPrincipal > b.billPrincipalBalance + 0.01 ||
          c.closingInterest > b.billInterestBalance + 0.01) {
        allOk = false;
        failNote = `${b.billPeriodId}: closing > bill — closP=${c.closingPrincipal}>billP=${b.billPrincipalBalance} or closI=${c.closingInterest}>billI=${b.billInterestBalance}`;
        break;
      }
    }
    tc("bill_state_immutable", allOk,
      "bill state unchanged after payment; closing ≤ bill",
      allOk ? "all pass" : failNote,
      "Bill snapshot must be immutable; closing derived separately");
  }
  // 5. closing_formula: closingPrincipal = billPrincipalBalance - principalCleared
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      if (!s.payment || !s.closing) continue;
      const b = s.bill;
      const c = s.closing;
      // closingTotal = closingPrincipal + closingInterest
      const expectedTotal = twoDp(c.closingPrincipal + c.closingInterest);
      if (Math.abs(expectedTotal - c.closingTotal) > 0.01) {
        allOk = false;
        failNote = `${b.billPeriodId}: closP=${c.closingPrincipal}+closI=${c.closingInterest}=${expectedTotal} ≠ closingTotal=${c.closingTotal}`;
        break;
      }
    }
    tc("closing_formula", allOk,
      "closingTotal === closingPrincipal + closingInterest",
      allOk ? "all pass" : failNote,
      "Closing state arithmetic integrity");
  }
  // 6. carry_forward_source: next month opening === prev month closing
  {
    let allOk = true;
    let failNote = "";
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];
      const prevCarryOut = prev.carryOut;
      const currCarryIn = curr.carryIn;
      if (Math.abs(prevCarryOut.openingPrincipal - currCarryIn.openingPrincipal) > 0.01 ||
          Math.abs(prevCarryOut.openingInterest - currCarryIn.openingInterest) > 0.01) {
        allOk = false;
        failNote = `${curr.billPeriodId}: carryIn p=${currCarryIn.openingPrincipal}/i=${currCarryIn.openingInterest} ≠ prevCarryOut p=${prevCarryOut.openingPrincipal}/i=${prevCarryOut.openingInterest}`;
        break;
      }
    }
    tc("carry_forward_source", allOk,
      "next month carryIn === prev month carryOut",
      allOk ? "all pass" : failNote,
      "Carry-forward must derive only from previous month closing state");
  }
  // 7. interest_when_principal: currentInterest > 0 iff openingPrincipal > 0
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      const b = s.bill;
      const shouldHaveInterest = b.openingPrincipal > 0;
      if (shouldHaveInterest && b.currentInterest === 0) {
        allOk = false;
        failNote = `${b.billPeriodId}: openingPrincipal=${b.openingPrincipal} but currentInterest=0`;
        break;
      }
      if (!shouldHaveInterest && b.currentInterest !== 0) {
        allOk = false;
        failNote = `${b.billPeriodId}: no principal but currentInterest=${b.currentInterest}`;
        break;
      }
    }
    tc("interest_when_principal", allOk,
      "currentInterest > 0 iff openingPrincipal > 0",
      allOk ? "all pass" : failNote,
      "Interest always applies when principal is outstanding");
  }
  // 8. interest_formula: currentInterest ≈ openingPrincipal × rate/1200
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      const b = s.bill;
      if (b.currentInterest === 0) continue;
      const expected = roundInterest(
        (b.openingPrincipal * config.interestRate) / 1200,
        config.interestRounding
      );
      if (Math.abs(expected - b.currentInterest) > 0.02) {
        allOk = false;
        failNote = `${b.billPeriodId}: expected≈${expected} got ${b.currentInterest}`;
        break;
      }
    }
    tc("interest_formula", allOk,
      "currentInterest ≈ round(openingPrincipal × rate/1200)",
      allOk ? "all pass" : failNote,
      "Simple interest: principal × annual_rate / 1200");
  }
  // 9. no_interest_on_interest: currentInterest based on principal only
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      const b = s.bill;
      const maxAllowed = twoDp(
        roundInterest(
          (b.openingPrincipal * config.interestRate) / 1200,
          config.interestRounding
        ) + 0.01
      );
      if (b.currentInterest > maxAllowed) {
        allOk = false;
        failNote = `${b.billPeriodId}: currentInterest=${b.currentInterest} > max(principal only)=${maxAllowed}`;
        break;
      }
    }
    tc("no_interest_on_interest", allOk,
      "currentInterest computed on principal only (non-compounding)",
      allOk ? "all pass" : failNote,
      "Interest must not compound on prior interest");
  }
  // 10. interest_first_alloc: interest cleared before principal when INTEREST_FIRST
  {
    let allOk = true;
    let failNote = "";
    if (config.allocationMode === "INTEREST_FIRST") {
      for (const s of snapshots) {
        const p = s.payment;
        const b = s.bill;
        if (!p) continue;
        if (b.billInterestBalance > 0.005 && p.principalCleared > 0.005 &&
            p.interestCleared < b.billInterestBalance - 0.01) {
          allOk = false;
          failNote = `${s.billPeriodId}: billInterest=${b.billInterestBalance} but interestCleared=${p.interestCleared}, principalCleared=${p.principalCleared}`;
          break;
        }
      }
    }
    tc("interest_first_alloc", allOk,
      "INTEREST_FIRST: interest fully cleared before principal",
      allOk ? "all pass" : failNote,
      "Payment allocation: interest first, then principal");
  }
  // 11. carry_non_negative: carryOut balances never negative
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      const co = s.carryOut;
      if (co.openingPrincipal < -0.01 || co.openingInterest < -0.01) {
        allOk = false;
        failNote = `${s.billPeriodId}: negative carryOut p=${co.openingPrincipal} i=${co.openingInterest}`;
        break;
      }
    }
    tc("carry_non_negative", allOk,
      "carryOut principal and interest always >= 0",
      allOk ? "all pass" : failNote,
      "Carry-forward balances never go negative");
  }
  // 12. advance_credit: overpayment produces advance credit
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      const p = s.payment;
      if (!p) continue;
      const totalDue = s.bill.totalBillDue;
      if (p.amount > totalDue + 0.01 && p.advanceCredit < 0.005) {
        allOk = false;
        failNote = `${s.billPeriodId}: paid=${p.amount} > due=${totalDue} but advanceCredit=${p.advanceCredit}`;
        break;
      }
    }
    tc("advance_credit", allOk,
      "overpayment → advanceCredit > 0",
      allOk ? "all pass" : failNote,
      "Overpayment must produce advance credit");
  }
  // 13. ledger_snapshot: balance = totalBillDue - amountPaid per month
  {
    let allOk = true;
    let failNote = "";
    for (const s of snapshots) {
      const amountPaid = s.payment ? s.payment.amount : 0;
      const expectedBalance = s.closing ? s.closing.closingTotal : s.bill.totalBillDue;
      const derivedBalance = twoDp(s.bill.totalBillDue - amountPaid);
      // closingTotal must equal totalBillDue - amountPaid (within epsilon)
      if (Math.abs(expectedBalance - derivedBalance) > 0.01) {
        allOk = false;
        failNote = `${s.billPeriodId}: totalDue=${s.bill.totalBillDue} paid=${amountPaid} expected=${derivedBalance} closing=${expectedBalance}`;
        break;
      }
    }
    tc("ledger_snapshot", allOk,
      "balance === totalBillDue - amountPaid per month",
      allOk ? "all pass" : failNote,
      "Monthly ledger snapshot arithmetic integrity");
  }
  // 14. zero_interest_rate: no interest when rate is 0
  {
    let allOk = true;
    let failNote = "";
    if (config.interestRate === 0) {
      for (const s of snapshots) {
        if (s.bill.currentInterest !== 0) {
          allOk = false;
          failNote = `${s.billPeriodId}: interestRate=0 but currentInterest=${s.bill.currentInterest}`;
          break;
        }
      }
    }
    tc("zero_interest_rate",
      config.interestRate === 0 ? allOk : true,
      "currentInterest === 0 when interestRate === 0",
      config.interestRate === 0
        ? allOk ? "all pass" : failNote
        : "not applicable (rate > 0)",
      "Zero interest rate produces zero interest");
  }
  return results;
}
// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.dashboard.view");
    if (!gate.ok) return gate.response;
    const { config, member, actions } = await request.json();
    if (!member || !actions?.length) {
      return NextResponse.json(
        { error: "member and actions required" },
        { status: 400 }
      );
    }
    const cfg = {
      interestRate: config?.interestRate ?? 18,
      interestRounding: config?.interestRounding ?? "TWO_DECIMAL",
      allocationMode: config?.allocationMode ?? "INTEREST_FIRST",
      charges: config?.charges ?? 0,
    };
    const { snapshots, ledger, finalCarry } = runSimulation(cfg, member, actions);
    const testCases = buildTestCases(snapshots, cfg);
    return NextResponse.json({
      success: true,
      config: cfg,
      snapshots,
      ledger,
      finalCarry,
      testCases,
    });
  } catch (error) {
    console.error("Billing simulator error:", error);
    return NextResponse.json(
      { error: "Simulation failed" },
      { status: 500 }
    );
  }
}
