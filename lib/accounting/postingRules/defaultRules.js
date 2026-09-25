import { EVENT_TYPES } from "@/lib/accounting/events.js";

// Phase 2.7 — the seeded default-tier posting rules (societyId: null). These
// cover the accounting events the current billing system actually produces,
// plus generic manual/opening-balance rules. They are DATA, not code: an
// admin can add per-society overrides (higher-priority rules that shadow
// these) without touching the engine.
//
// IMPORTANT: these rules reference accounts by resolver KEY only. They post
// nothing until a society has (a) enabled accounting, (b) built its Chart of
// Accounts, and (c) mapped the named accounts in its fiscal configuration.
// Until then, resolveAccountKey throws a clear "not configured" error and the
// engine rolls back — no half-posted vouchers.

export const DEFAULT_POSTING_RULES = [
  // ── Payment received (Cash) ────────────────────────────────────────────────
  // Dr Cash, Cr Member Receivable. Higher priority than the bank default so a
  // Cash payment matches this first.
  //
  // NOTE ON THE CREDIT SIDE (bug fix): the credit legs use `appliedToDues` and
  // `advance`, NOT the gross `amount`. Crediting the full amount to Member
  // Receivable drove that asset negative whenever a member paid more than the
  // dues actually raised (BillGenerated only debits Receivable with the new
  // charge for the period). An over-collection is not a negative asset — it is
  // 'Advance Received From Members', a liability, exactly as it appears on the
  // statutory society Balance Sheet.
  {
    systemKey: "default:PaymentRecorded:cash",
    eventType: EVENT_TYPES.PAYMENT_RECORDED,
    description: "Payment received in cash",
    voucherType: "Receipt",
    priority: 10,
    conditions: [{ field: "paymentMode", op: "eq", value: "Cash" }],
    lineSpecs: [
      { accountKey: "cash", side: "Debit", amountKey: "amount", narration: "Cash received" },
      { accountKey: "memberReceivable", side: "Credit", amountKey: "appliedToDues", optional: true, narration: "Against member dues" },
      { accountKey: "memberAdvance", side: "Credit", amountKey: "advance", optional: true, narration: "Advance received from member" },
    ],
  },
  // ── Payment received (bank/other, default) ─────────────────────────────────
  {
    systemKey: "default:PaymentRecorded:bank",
    eventType: EVENT_TYPES.PAYMENT_RECORDED,
    description: "Payment received to bank (default)",
    voucherType: "Receipt",
    priority: 1,
    conditions: [],
    lineSpecs: [
      { accountKey: "defaultBank", side: "Debit", amountKey: "amount", narration: "Bank receipt" },
      { accountKey: "memberReceivable", side: "Credit", amountKey: "appliedToDues", optional: true, narration: "Against member dues" },
      { accountKey: "memberAdvance", side: "Credit", amountKey: "advance", optional: true, narration: "Advance received from member" },
    ],
  },
  // ── Bill generated ─────────────────────────────────────────────────────────
  // Dr Member Receivable, Cr Maintenance Income (current charges), Cr Interest
  // Income (current interest, optional — skipped when zero). The Debit side
  // is `receivableIncrease` (= currentCharges + currentInterest), NOT
  // Bill.totalBillDue: totalBillDue is the member's cumulative running
  // balance (opening + current), and the opening portion was already posted
  // to Receivable by the PREVIOUS month's BillGenerated event (or the
  // Opening Balance Wizard, for a member's first bill). Using totalBillDue
  // here would double-post every carried-forward rupee and fail
  // assertBalanced the moment a member has any opening balance — caught by
  // accounting-smoke.unit.test.js once a second month was added.
  {
    systemKey: "default:BillGenerated",
    eventType: EVENT_TYPES.BILL_GENERATED,
    description: "Maintenance bill raised on a member",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    lineSpecs: [
      { accountKey: "memberReceivable", side: "Debit", amountKey: "receivableIncrease", narration: "Bill raised" },
      { accountKey: "maintenanceIncome", side: "Credit", amountKey: "currentCharges", narration: "Maintenance charges" },
      { accountKey: "interestIncome", side: "Credit", amountKey: "currentInterest", optional: true, narration: "Interest on arrears" },
    ],
  },
  // Same bill, income split by billing head: the caller supplies the lines
  // (Dr Receivable, Cr each head's income/fund account, Cr Interest). Outranks
  // the single-line rule above; a society without this rule installed falls
  // back to that one because the payload still carries receivableIncrease etc.
  {
    systemKey: "default:BillGenerated:byHead",
    eventType: EVENT_TYPES.BILL_GENERATED,
    description: "Maintenance bill raised on a member, income split by billing head",
    voucherType: "Journal",
    priority: 5,
    conditions: [{ field: "kind", op: "eq", value: "ByHead" }],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Interest accrued (standalone) ──────────────────────────────────────────
  {
    systemKey: "default:InterestAccrued",
    eventType: EVENT_TYPES.INTEREST_ACCRUED,
    description: "Interest accrued on overdue dues",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    lineSpecs: [
      { accountKey: "memberReceivable", side: "Debit", amountKey: "interestAmount", narration: "Interest charged" },
      { accountKey: "interestIncome", side: "Credit", amountKey: "interestAmount", narration: "Interest income" },
    ],
  },
  // ── Manual journal voucher ─────────────────────────────────────────────────
  // The user picks the accounts/amounts; the payload carries the full lines.
  {
    systemKey: "default:ManualAdjustment",
    eventType: EVENT_TYPES.MANUAL_ADJUSTMENT,
    description: "Manual/adjustment journal voucher (lines supplied by user)",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Opening balance ────────────────────────────────────────────────────────
  // The Opening Balance Wizard (Phase 2.10) supplies the lines.
  {
    systemKey: "default:OpeningBalance",
    eventType: EVENT_TYPES.OPENING_BALANCE,
    description: "Opening balance entry (lines supplied by wizard)",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Asset purchase ─────────────────────────────────────────────────────────
  // The Asset Register (Phase 2.11) knows the asset's linked Fixed Asset
  // account and the funding (bank/cash) account, so it supplies the lines:
  // Dr Fixed Asset, Cr Bank/Cash.
  {
    systemKey: "default:AssetPurchased",
    eventType: EVENT_TYPES.ASSET_PURCHASED,
    description: "Fixed asset purchased (lines supplied by Asset Register)",
    voucherType: "Payment",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Depreciation ───────────────────────────────────────────────────────────
  // Dr Depreciation Expense, Cr Accumulated Depreciation (per asset).
  {
    systemKey: "default:DepreciationPosted",
    eventType: EVENT_TYPES.DEPRECIATION_POSTED,
    description: "Depreciation charged (lines supplied by Asset Register)",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Asset disposal ─────────────────────────────────────────────────────────
  // Removes cost + accumulated depreciation, books sale proceeds and gain/loss.
  {
    systemKey: "default:AssetDisposed",
    eventType: EVENT_TYPES.ASSET_DISPOSED,
    description: "Fixed asset disposed (lines supplied by Asset Register)",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Liability incurred ─────────────────────────────────────────────────────
  // Vendor bill / loan drawn / deposit received / tax accrued — contra account
  // (expense, asset, bank) varies per liability type, so the Liability
  // Register (Phase 2.12) supplies the full lines: Dr contra, Cr Liability.
  {
    systemKey: "default:LiabilityIncurred",
    eventType: EVENT_TYPES.LIABILITY_INCURRED,
    description: "Liability incurred (lines supplied by Liability Register)",
    voucherType: "Journal",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Liability payment ──────────────────────────────────────────────────────
  // Paying down a vendor/loan/deposit/tax liability: Dr Liability, Cr Bank/Cash.
  {
    systemKey: "default:LiabilityPaymentMade",
    eventType: EVENT_TYPES.LIABILITY_PAYMENT_MADE,
    description: "Payment made against a liability (lines supplied by Liability Register)",
    voucherType: "Payment",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Society expense incurred (Lab / manual expense booking) ────────────────
  // Dr Expense, Cr Bank/Cash. Lines supplied by the caller so any expense head
  // in the Chart of Accounts can be booked without a bespoke rule per head.
  {
    systemKey: "default:ExpenseRecorded",
    eventType: EVENT_TYPES.MANUAL_ADJUSTMENT,
    description: "Society expense booked against a bank/cash account",
    voucherType: "Payment",
    priority: 5,
    conditions: [{ field: "kind", op: "eq", value: "Expense" }],
    linesFromPayload: true,
    lineSpecs: [],
  },
  // ── Reserve / fund transfer ─────────────────────────────────────────────────
  // Fund Management (Phase 2.13): appropriation between funds, cash
  // contribution into a fund, or a fund drawdown. Which accounts move varies
  // per call, so the Fund service supplies the full lines.
  {
    systemKey: "default:ReserveTransfer",
    eventType: EVENT_TYPES.RESERVE_TRANSFER,
    description: "Fund transfer / contribution / drawdown (lines supplied by Fund Management)",
    voucherType: "Contra",
    priority: 1,
    conditions: [],
    linesFromPayload: true,
    lineSpecs: [],
  },
];