import mongoose from "mongoose";
import ChartOfAccount from "@/models/ChartOfAccount";
import JournalLine from "@/models/JournalLine";
import FinancialYear from "@/models/FinancialYear";
import Asset from "@/models/Asset";
import { getLedgerSummary, getAccountLedger } from "@/lib/services/GeneralLedgerService";
import { listSchedules } from "@/lib/services/ScheduleService";
import { getPreviousFinancialYear } from "@/lib/services/FinancialYearService";
import Fund from "@/models/Fund";

// Phase 2.18 of the accounting-system revamp (docs/accounting-system-ARD.md
// §8): Financial Statements. Every function here is a pure aggregation over
// Phase 2.9's General Ledger (via getLedgerSummary/getAccountLedger) — no
// embedded business logic, no new source-of-truth data (§1). The one
// judgment call: Income/Expense accounts are never "closed" to Equity with a
// posted journal entry in this system (no year-end closing entry), so the
// Balance Sheet shows the year's Income & Expenditure surplus/deficit as a
// synthetic, unposted "Current Year Surplus/(Deficit)" line under Equity —
// standard practice for this kind of small-body accounting, and it's exactly
// what makes Assets == Liabilities + Equity hold, since double-entry
// guarantees Assets - Liabilities - Equity(excl. surplus) always equals the
// unclosed Income-Expense net.
//
// Both statements are COMPARATIVE (current FY + immediately preceding FY side
// by side) to match the statutory Indian co-op society format — two "Amt
// (Rs)" columns, one per year, exactly how every registered society's
// auditor-signed Balance Sheet / Income & Expenditure Account is laid out.

export class FinancialStatementsServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FinancialStatementsServiceError";
    this.status = status;
  }
}

function round2(n) {
  const r = Math.round(Number(n) * 100) / 100;
  return r === 0 ? 0 : r; // never -0: a zero balance must print 0.00, not -0.00
}

function oid(id) {
  return new mongoose.Types.ObjectId(String(id));
}

async function requireFinancialYear(societyId, financialYearId) {
  const fy = await FinancialYear.findOne({ _id: financialYearId, societyId, isDeleted: false }).lean();
  if (!fy) throw new FinancialStatementsServiceError(404, "Financial Year not found");
  return fy;
}

/** account-type-aware signed→magnitude conversion, shared by every statement below. */
function amountFor(row, type) {
  if (!row) return 0;
  const creditSideTypes = ["Liability", "Equity", "Income"];
  const wantSide = creditSideTypes.includes(type) ? "Cr" : "Dr"; // Asset/Expense are debit-natured
  return row.side === wantSide ? row.balance : -row.balance;
}

/** Per-account current/prior figures for a set of account types, merged into one row per account. */
async function getComparativeRows(societyId, currentFYId, priorFYId, types) {
  const [curSummary, priorSummary] = await Promise.all([
    getLedgerSummary(societyId, { financialYearId: currentFYId }),
    priorFYId ? getLedgerSummary(societyId, { financialYearId: priorFYId }) : Promise.resolve([]),
  ]);
  const curByAccount = new Map(curSummary.map((r) => [r.accountId, r]));
  const priorByAccount = new Map(priorSummary.map((r) => [r.accountId, r]));

  const accountIds = new Set([...curByAccount.keys(), ...priorByAccount.keys()]);
  const accounts = await ChartOfAccount.find({ _id: { $in: [...accountIds] }, type: { $in: types } })
    .select("name type scheduleCode")
    .lean();

  return accounts
    .map((a) => {
      const id = String(a._id);
      const current = round2(amountFor(curByAccount.get(id), a.type));
      const prior = round2(amountFor(priorByAccount.get(id), a.type));
      return { accountId: id, name: a.name, type: a.type, scheduleCode: a.scheduleCode, current, prior };
    })
    .filter((r) => Math.abs(r.current) >= 0.005 || Math.abs(r.prior) >= 0.005);
}

/** Groups comparative rows by ChartOfAccount.scheduleCode, carrying both years' totals. */
async function groupBySchedule(societyId, rows) {
  const schedules = await listSchedules(societyId);
  const scheduleByCode = new Map(schedules.map((s) => [s.code, s]));

  const groups = new Map();
  for (const row of rows) {
    const key = row.scheduleCode || "__unscheduled__";
    if (!groups.has(key)) {
      const sched = row.scheduleCode ? scheduleByCode.get(row.scheduleCode) : null;
      groups.set(key, {
        scheduleCode: row.scheduleCode || null,
        label: sched?.label || (row.scheduleCode ? `Schedule ${row.scheduleCode}` : "Unscheduled"),
        displayOrder: sched?.displayOrder ?? 999,
        accounts: [],
        totalCurrent: 0,
        totalPrior: 0,
      });
    }
    const g = groups.get(key);
    g.accounts.push(row);
    g.totalCurrent = round2(g.totalCurrent + row.current);
    g.totalPrior = round2(g.totalPrior + row.prior);
  }
  return [...groups.values()].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** Per-asset depreciation charged in a given Financial Year (not a ledger read — Asset.depreciationRuns is the source). */
async function getDepreciationRows(societyId, financialYearId) {
  if (!financialYearId) return [];
  const assets = await Asset.find({ societyId, isDeleted: false, "depreciationRuns.financialYearId": financialYearId })
    .select("name depreciationRuns")
    .lean();
  return assets.map((a) => ({
    name: a.name,
    amount: round2(
      a.depreciationRuns.filter((r) => String(r.financialYearId) === String(financialYearId)).reduce((s, r) => s + r.amount, 0),
    ),
  }));
}

/** Accrual-basis Income & Expenditure Account — comparative (current FY + prior FY). */
export async function getIncomeAndExpenditure(societyId, financialYearId) {
  const fy = await requireFinancialYear(societyId, financialYearId);
  const priorFy = await getPreviousFinancialYear(societyId, fy);

  // Depreciation Expense accounts are broken out per-asset below rather than
  // shown as one flat ledger line — exclude them here or the depreciation
  // total would be counted twice (once as a lump ledger row, once per-asset).
  const depreciationAccountIds = new Set(
    (await Asset.find({ societyId, isDeleted: false }).distinct("linkedDepreciationExpenseAccountId")).map(String),
  );

  const rows = await getComparativeRows(societyId, fy._id, priorFy?._id, ["Income", "Expense"]);
  const incomeRows = rows.filter((r) => r.type === "Income");
  const expenseRows = rows.filter((r) => r.type === "Expense" && !depreciationAccountIds.has(r.accountId));
  // Grouped by schedule for the statutory presentation — StatutoryStatements
  // renders every side (assets/liabilities/income/expense) as ScheduleGroups,
  // same shape getBalanceSheet already produces for assets/liabilities/equity.
  const [income, expense] = await Promise.all([
    groupBySchedule(societyId, incomeRows),
    groupBySchedule(societyId, expenseRows),
  ]);

  const [depreciationCurrent, depreciationPrior] = await Promise.all([
    getDepreciationRows(societyId, fy._id),
    priorFy ? getDepreciationRows(societyId, priorFy._id) : Promise.resolve([]),
  ]);
  const depreciationNames = [...new Set([...depreciationCurrent, ...depreciationPrior].map((d) => d.name))];
  const depreciation = depreciationNames.map((name) => ({
    name,
    current: depreciationCurrent.find((d) => d.name === name)?.amount || 0,
    prior: depreciationPrior.find((d) => d.name === name)?.amount || 0,
  }));

  const totalDepreciationCurrent = round2(depreciation.reduce((s, d) => s + d.current, 0));
  const totalDepreciationPrior = round2(depreciation.reduce((s, d) => s + d.prior, 0));

  // FIX (empty Expenditure side): `depreciation` is a flat [{name,current,prior}]
  // array, but StatutoryStatements renders every side as SCHEDULE GROUPS
  // ({label, accounts[], totalCurrent, totalPrior}). The page spread the flat
  // rows straight into the group list, so each one rendered as a blank
  // particulars cell with an em-dash in both amount columns -- the depreciation
  // was inside the Expenditure TOTAL but invisible as line items.
  //
  // Emit a correctly-shaped group as well, so the per-asset depreciation prints
  // as real indented lines under a "Depreciation" heading, the way the auditor's
  // statutory format lists Water Pump / Electric Fixture / C.C.TV separately.
  const depreciationGroup =
    depreciation.length > 0
      ? {
          scheduleCode: null,
          label: "Depreciation",
          displayOrder: 900, // always last on the Expenditure side
          accounts: depreciation.map((d) => ({
            accountId: `dep:${d.name}`,
            name: d.name,
            type: "Expense",
            scheduleCode: null,
            current: d.current,
            prior: d.prior,
          })),
          totalCurrent: totalDepreciationCurrent,
          totalPrior: totalDepreciationPrior,
        }
      : null;
  const totalIncomeCurrent = round2(incomeRows.reduce((s, r) => s + r.current, 0));
  const totalIncomePrior = round2(incomeRows.reduce((s, r) => s + r.prior, 0));
  const totalExpenseCurrent = round2(expenseRows.reduce((s, r) => s + r.current, 0) + totalDepreciationCurrent);
  const totalExpensePrior = round2(expenseRows.reduce((s, r) => s + r.prior, 0) + totalDepreciationPrior);

  return {
    financialYearId: String(fy._id),
    financialYearLabel: fy.label,
    priorFinancialYearLabel: priorFy?.label || null,
    income,
    expense,
    depreciation,
    // Renderable, schedule-group-shaped version of `depreciation` (see above).
    depreciationGroup,
    totalIncomeCurrent,
    totalIncomePrior,
    totalExpenseCurrent,
    totalExpensePrior,
    surplusOrDeficitCurrent: round2(totalIncomeCurrent - totalExpenseCurrent),
    surplusOrDeficitPrior: round2(totalIncomePrior - totalExpensePrior),
  };
}

/** Balance Sheet as of a Financial Year's end date — comparative (current FY + prior FY), cumulative position not FY-scoped movement. */
export async function getBalanceSheet(societyId, financialYearId) {
  const fy = await requireFinancialYear(societyId, financialYearId);
  const priorFy = await getPreviousFinancialYear(societyId, fy);

  const rows = await getComparativeRows(societyId, fy._id, priorFy?._id, ["Asset", "Liability", "Equity"]);
  const assetRows = rows.filter((r) => r.type === "Asset");
  const liabilityRows = rows.filter((r) => r.type === "Liability");
  const equityRows = rows.filter((r) => r.type === "Equity");

  const ie = await getIncomeAndExpenditure(societyId, financialYearId);

  const [assets, liabilities, equity] = await Promise.all([
    groupBySchedule(societyId, assetRows),
    groupBySchedule(societyId, liabilityRows),
    groupBySchedule(societyId, equityRows),
  ]);

  const totalAssetsCurrent = round2(assetRows.reduce((s, r) => s + r.current, 0));
  const totalAssetsPrior = round2(assetRows.reduce((s, r) => s + r.prior, 0));
  const totalLiabilitiesCurrent = round2(liabilityRows.reduce((s, r) => s + r.current, 0));
  const totalLiabilitiesPrior = round2(liabilityRows.reduce((s, r) => s + r.prior, 0));
  const totalEquityExclSurplusCurrent = round2(equityRows.reduce((s, r) => s + r.current, 0));
  const totalEquityExclSurplusPrior = round2(equityRows.reduce((s, r) => s + r.prior, 0));
  const totalEquityInclSurplusCurrent = round2(totalEquityExclSurplusCurrent + ie.surplusOrDeficitCurrent);
  const totalEquityInclSurplusPrior = round2(totalEquityExclSurplusPrior + ie.surplusOrDeficitPrior);

  return {
    financialYearId: String(fy._id),
    financialYearLabel: fy.label,
    priorFinancialYearLabel: priorFy?.label || null,
    asOf: fy.endDate,
    priorAsOf: priorFy?.endDate || null,
    assets,
    liabilities,
    equity,
    currentYearSurplusOrDeficit: ie.surplusOrDeficitCurrent,
    priorYearSurplusOrDeficit: ie.surplusOrDeficitPrior,
    totalAssetsCurrent,
    totalAssetsPrior,
    totalLiabilitiesCurrent,
    totalLiabilitiesPrior,
    totalEquityInclSurplusCurrent,
    totalEquityInclSurplusPrior,
    isBalancedCurrent: Math.abs(round2(totalAssetsCurrent - (totalLiabilitiesCurrent + totalEquityInclSurplusCurrent))) < 0.005,
    isBalancedPrior: priorFy ? Math.abs(round2(totalAssetsPrior - (totalLiabilitiesPrior + totalEquityInclSurplusPrior))) < 0.005 : true,
  };
}

/** Cash-basis Receipts & Payments Statement — every movement through a Bank/Cash account, labeled by its contra account(s). */
export async function getReceiptsAndPayments(societyId, financialYearId) {
  const fy = await requireFinancialYear(societyId, financialYearId);

  const cashBankAccounts = await ChartOfAccount.find({ societyId, subType: { $in: ["Bank", "Cash"] }, isDeleted: false })
    .select("_id name")
    .lean();
  const cashBankIds = cashBankAccounts.map((a) => a._id);
  const cashBankIdSet = new Set(cashBankIds.map(String));
  if (cashBankIds.length === 0) {
    return { financialYearId: String(fy._id), financialYearLabel: fy.label, receipts: [], payments: [], totalReceipts: 0, totalPayments: 0, netCashMovement: 0, openingBalance: 0, closingBalance: 0 };
  }

  const lines = await JournalLine.find({
    societyId,
    financialYearId,
    accountId: { $in: cashBankIds },
    status: { $in: ["Posted", "Reversed"] },
  })
    .sort({ date: 1 })
    .lean();

  const entryIds = [...new Set(lines.map((l) => String(l.journalEntryId)))];
  const allEntryLines = await JournalLine.find({ journalEntryId: { $in: entryIds.map(oid) } }).lean();
  const linesByEntry = new Map();
  for (const l of allEntryLines) {
    const key = String(l.journalEntryId);
    if (!linesByEntry.has(key)) linesByEntry.set(key, []);
    linesByEntry.get(key).push(l);
  }
  const contraAccounts = await ChartOfAccount.find({ _id: { $in: allEntryLines.map((l) => l.accountId) } }).select("name").lean();
  const accountNameById = new Map(contraAccounts.map((a) => [String(a._id), a.name]));

  const receipts = [];
  const payments = [];
  for (const line of lines) {
    const siblings = (linesByEntry.get(String(line.journalEntryId)) || []).filter((l) => !cashBankIdSet.has(String(l.accountId)));
    const contraLabel = siblings.length > 0 ? siblings.map((s) => accountNameById.get(String(s.accountId)) || "Unknown").join(", ") : "(inter Bank/Cash transfer)";
    const entry = {
      date: line.date,
      voucherId: String(line.voucherId),
      journalLineId: String(line._id),
      amount: line.amount,
      narration: line.narration || "",
      contra: contraLabel,
    };
    if (line.side === "Debit") receipts.push(entry);
    else payments.push(entry);
  }

  const totalReceipts = round2(receipts.reduce((s, r) => s + r.amount, 0));
  const totalPayments = round2(payments.reduce((s, r) => s + r.amount, 0));

  const perAccountLedgers = await Promise.all(cashBankIds.map((id) => getAccountLedger(societyId, id, { financialYearId })));
  const openingBalance = round2(perAccountLedgers.reduce((s, l) => s + (l.openingSide === "Dr" ? l.openingBalance : -l.openingBalance), 0));
  const closingBalance = round2(perAccountLedgers.reduce((s, l) => s + (l.closingSide === "Dr" ? l.closingBalance : -l.closingBalance), 0));

  return {
    financialYearId: String(fy._id),
    financialYearLabel: fy.label,
    receipts,
    payments,
    totalReceipts,
    totalPayments,
    netCashMovement: round2(totalReceipts - totalPayments),
    openingBalance,
    closingBalance,
  };
}

/** General Fund movement for the year: real ledger opening/transfers/closing, plus the year's (unposted) surplus for context. */
export async function getGeneralFundStatement(societyId, financialYearId) {
  const fy = await requireFinancialYear(societyId, financialYearId);
  const funds = await Fund.find({ societyId, fundType: "GeneralFund", isDeleted: false }).lean();
  if (funds.length === 0) {
    throw new FinancialStatementsServiceError(404, "No General Fund is registered for this society (see Phase 2.13 Fund Management)");
  }

  const ledgers = await Promise.all(funds.map((f) => getAccountLedger(societyId, f.linkedAccountId, { financialYearId })));
  const openingBalance = round2(ledgers.reduce((s, l) => s + (l.openingSide === "Cr" ? l.openingBalance : -l.openingBalance), 0));
  const closingBalance = round2(ledgers.reduce((s, l) => s + (l.closingSide === "Cr" ? l.closingBalance : -l.closingBalance), 0));
  const transfers = ledgers.flatMap((l) => l.lines).map((l) => ({ date: l.date, voucherNumber: l.voucherNumber, amount: l.credit - l.debit, narration: l.narration }));

  const ie = await getIncomeAndExpenditure(societyId, financialYearId);

  return {
    financialYearId: String(fy._id),
    financialYearLabel: fy.label,
    funds: funds.map((f) => ({ fundId: String(f._id), name: f.name })),
    openingBalance,
    transfers,
    closingBalance,
    currentYearSurplusOrDeficit: ie.surplusOrDeficitCurrent,
    note: "currentYearSurplusOrDeficit is the year's Income & Expenditure result — it is not posted into this fund's ledger balance unless a fund transfer explicitly appropriates it.",
  };
}