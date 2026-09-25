import { isContraAccount } from "@/lib/accounting/standardAccounts.js";
import mongoose from "mongoose";
import ChartOfAccount from "@/models/ChartOfAccount";
import Voucher from "@/models/Voucher";
import FinancialYear from "@/models/FinancialYear";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap";

// Phase 2.10 of the accounting-system revamp (docs/accounting-system-ARD.md
// §6.5). A guided workflow that seeds a Financial Year's opening balances as
// ONE opening voucher: each account's opening balance on its natural side,
// plus a single balancing figure posted to the "opening fund" account (the
// Income & Expenditure / General Fund — the society's accumulated net worth).
//
// Guard (§6.5): opening balances may only be entered while the FY is Draft and
// before any other voucher exists in it. Posting goes through
// AccountingEngine.process (the OpeningBalance posting rule reads the lines
// off the payload), so opening entries obey the same integrity guarantees as
// everything else — no route writes a JournalEntry directly.

export class OpeningBalanceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "OpeningBalanceServiceError";
    this.status = status;
  }
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Validates the requested opening entries against the Chart of Accounts and
 * computes the balancing line. Pure-ish: reads accounts (optionally within a
 * session) but writes nothing.
 * @returns {{ lines, totalDebit, totalCredit, balancing }}
 */
async function buildOpeningLines(societyId, { entries, openingFundAccountId }, session = null) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new OpeningBalanceServiceError(400, "At least one opening balance entry is required");
  }
  if (!openingFundAccountId) {
    throw new OpeningBalanceServiceError(400, "openingFundAccountId (the account that absorbs the balancing figure) is required");
  }

  const ids = [...new Set([...entries.map((e) => String(e.accountId)), String(openingFundAccountId)])];
  const q = ChartOfAccount.find({ _id: { $in: ids }, societyId, isDeleted: false });
  if (session) q.session(session);
  const accounts = await q.lean();
  const byId = new Map(accounts.map((a) => [String(a._id), a]));

  const lines = [];
  let totalDebit = 0;
  let totalCredit = 0;

  for (const entry of entries) {
    const acc = byId.get(String(entry.accountId));
    if (!acc) {
      throw new OpeningBalanceServiceError(422, `Account ${entry.accountId} not found in this society's Chart of Accounts`);
    }
    if (!acc.isActive) {
      throw new OpeningBalanceServiceError(422, `Account "${acc.name}" (${acc.code}) is inactive`);
    }
    const amount = round2(entry.amount);
    if (!(amount > 0)) {
      throw new OpeningBalanceServiceError(422, `Opening amount for "${acc.name}" must be greater than zero`);
    }
    // Side defaults to the account's natural (normal) balance; caller may
    // override (e.g. an overdrawn bank = Credit on an asset account).
    const side = entry.side || (isContraAccount(acc) ? "Credit" : acc.normalBalance);
    if (side !== "Debit" && side !== "Credit") {
      throw new OpeningBalanceServiceError(422, `Invalid side "${side}" for "${acc.name}"`);
    }
    if (side === "Debit") totalDebit += amount;
    else totalCredit += amount;
    lines.push({ accountId: String(acc._id), side, amount, narration: `Opening: ${acc.name}` });
  }

  totalDebit = round2(totalDebit);
  totalCredit = round2(totalCredit);

  const fundAcc = byId.get(String(openingFundAccountId));
  if (!fundAcc) throw new OpeningBalanceServiceError(422, "openingFundAccountId not found in Chart of Accounts");
  if (!fundAcc.isActive) throw new OpeningBalanceServiceError(422, `Opening fund account "${fundAcc.name}" is inactive`);

  // Balancing figure → opening fund account.
  const netDr = round2(totalDebit - totalCredit);
  let balancing = null;
  if (Math.abs(netDr) >= 0.005) {
    const side = netDr > 0 ? "Credit" : "Debit";
    const amount = Math.abs(netDr);
    balancing = { accountId: String(fundAcc._id), side, amount, narration: `Opening fund (balancing): ${fundAcc.name}` };
    lines.push(balancing);
  }

  return { lines, totalDebit, totalCredit, balancing };
}

/** Guard: FY must be Draft and contain no other (non-cancelled) voucher yet. */
async function assertOpeningAllowed(societyId, financialYearId, session) {
  const fy = await FinancialYear.findOne({ _id: financialYearId, societyId, isDeleted: false }).session(session);
  if (!fy) throw new OpeningBalanceServiceError(404, "Financial Year not found");
  if (fy.status !== "Draft") {
    throw new OpeningBalanceServiceError(
      409,
      `Opening balances can only be entered while the Financial Year is Draft (current status: ${fy.status})`,
    );
  }
  const existing = await Voucher.countDocuments({
    societyId,
    financialYearId,
    isDeleted: false,
    status: { $ne: "Cancelled" },
  }).session(session);
  if (existing > 0) {
    throw new OpeningBalanceServiceError(
      409,
      "This Financial Year already has vouchers — opening balances must be the first entry. Reverse/cancel existing vouchers first, or use a manual adjustment instead.",
    );
  }
  return fy;
}

/** Read-only preview: computes the balancing figure + proposed lines without posting. */
export async function previewOpeningBalances(societyId, { entries, openingFundAccountId }) {
  const { lines, totalDebit, totalCredit, balancing } = await buildOpeningLines(societyId, {
    entries,
    openingFundAccountId,
  });
  return {
    lines,
    totalDebit,
    totalCredit,
    balancing,
    balances: Math.abs(round2(totalDebit - totalCredit)) < 0.005 || !!balancing,
  };
}

/**
 * Posts the opening balances as one voucher and marks the FY's opening
 * balances confirmed — all in a single transaction, so the guard checks,
 * the posting, and the confirmation flag can never drift apart.
 */
export async function postOpeningBalances(
  societyId,
  { financialYearId, entries, openingFundAccountId, date, narration },
  actorUserId,
) {
  if (!financialYearId) throw new OpeningBalanceServiceError(400, "financialYearId is required");

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const fy = await assertOpeningAllowed(societyId, financialYearId, session);
      const { lines } = await buildOpeningLines(societyId, { entries, openingFundAccountId }, session);

      const event = createAccountingEvent({
        type: EVENT_TYPES.OPENING_BALANCE,
        societyId,
        financialYearId,
        sourceModule: "OpeningBalance",
        actorUserId,
        idempotencyKey: `opening:${financialYearId}`,
        payload: {
          lines,
          narration: narration || `Opening balances as at ${new Date(fy.startDate).toISOString().slice(0, 10)}`,
          date: date || fy.startDate,
        },
      });

      const posted = await engineProcess(event, { session });

      fy.openingBalancesConfirmed = true;
      await fy.save({ session });

      result = { voucher: posted.voucher, journalEntry: posted.journalEntry };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * The door left for the case assertOpeningAllowed exists to catch: other
 * vouchers already exist in this FY, so the normal opening slip can no
 * longer be the first entry — but a starting balance can still genuinely be
 * missing from the books. This posts it as a dated correction instead of an
 * opening voucher (MANUAL_ADJUSTMENT, not OPENING_BALANCE — nothing about the
 * engine or the posting rule cares which one wrote the lines), and still
 * marks the FY's opening-balance step confirmed, because it now is.
 *
 * Before this existed, the only door out of "already has entries" was
 * "ask your accountant to review the Ledger" — a page with no button that
 * does this, and no obvious one either. That is a dead end, not an answer.
 */
export async function postOpeningBalanceCorrection(
  societyId,
  { financialYearId, entries, openingFundAccountId, date, narration },
  actorUserId,
) {
  if (!financialYearId) throw new OpeningBalanceServiceError(400, "financialYearId is required");

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const fy = await FinancialYear.findOne({ _id: financialYearId, societyId, isDeleted: false }).session(session);
      if (!fy) throw new OpeningBalanceServiceError(404, "Financial Year not found");
      if (fy.status === "Locked") {
        throw new OpeningBalanceServiceError(409, `Financial Year ${fy.label} is locked — this correction has to go through Auditor Mode instead.`);
      }

      const { lines } = await buildOpeningLines(societyId, { entries, openingFundAccountId }, session);

      const event = createAccountingEvent({
        type: EVENT_TYPES.MANUAL_ADJUSTMENT,
        societyId,
        financialYearId,
        sourceModule: "Manual",
        actorUserId,
        payload: {
          lines,
          narration: narration || `Missing opening balance, entered late as at ${new Date(fy.startDate).toISOString().slice(0, 10)}`,
          date: date || fy.startDate,
        },
      });

      const posted = await engineProcess(event, { session });

      fy.openingBalancesConfirmed = true;
      await fy.save({ session });

      result = { voucher: posted.voucher, journalEntry: posted.journalEntry };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * The other door: this Financial Year genuinely started from nothing (a
 * brand-new society, or one whose books really were empty on day one). No
 * voucher to post — just marks the step done so the checklist and the
 * warning banner stop asking for something that never existed.
 */
export async function confirmZeroOpeningBalance(societyId, financialYearId) {
  if (!financialYearId) throw new OpeningBalanceServiceError(400, "financialYearId is required");
  const fy = await FinancialYear.findOne({ _id: financialYearId, societyId, isDeleted: false });
  if (!fy) throw new OpeningBalanceServiceError(404, "Financial Year not found");
  fy.openingBalancesConfirmed = true;
  await fy.save();
  return { financialYearId: String(fy._id) };
}

/** Whether opening balances are done for a FY, and whether entry is still allowed. */
export async function getOpeningStatus(societyId, financialYearId) {
  const fy = await FinancialYear.findOne({ _id: financialYearId, societyId, isDeleted: false }).lean();
  if (!fy) throw new OpeningBalanceServiceError(404, "Financial Year not found");
  const voucherCount = await Voucher.countDocuments({
    societyId,
    financialYearId,
    isDeleted: false,
    status: { $ne: "Cancelled" },
  });
  return {
    financialYearId: String(fy._id),
    fyStatus: fy.status,
    openingBalancesConfirmed: !!fy.openingBalancesConfirmed,
    voucherCount,
    canEnterOpening: fy.status === "Draft" && voucherCount === 0,
  };
}
