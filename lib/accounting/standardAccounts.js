/**
 * AapliSociety Accounting — the standard Chart of Accounts
 * ============================================================================
 * The account heads a statutory Maharashtra co-operative housing society
 * Balance Sheet and Income & Expenditure statement actually print. Schedule
 * codes follow §6.3 of docs/accounting-system-ARD.md.
 *
 * Lifted out of app/api/accounting/quick-setup/route.js on 2026-08-27. It had
 * been defined inside that route and exported from it, which meant anything
 * else needing to know "what a fully set-up society looks like" had to import
 * from a route handler. The setup-state service needs exactly that list to
 * report which heads are missing, and the guided setup (Phase 3) needs it to
 * say what it is about to create — so it belongs in lib/, with the route as
 * one consumer among several.
 *
 * See docs/accounting-guided-ux/00-plan.md.
 * ============================================================================
 */

export const STANDARD_ACCOUNTS = [
  // ── Assets ───────────────────────────────────────────────────────────────
  { key: "cash", code: "1001", name: "Cash in Hand", type: "Asset", subType: "Cash", scheduleCode: "H" },
  { key: "bank", code: "1002", name: "Cash at Bank", type: "Asset", subType: "Bank", scheduleCode: "H" },
  { key: "receivable", code: "1003", name: "Dues from Members", type: "Asset", subType: "Receivable", scheduleCode: "G" },
  { key: "bankFD", code: "1010", name: "Bank Fixed Deposit", type: "Asset", subType: "Investment", scheduleCode: "F" },
  { key: "landBuilding", code: "1020", name: "Land & Building", type: "Asset", subType: "FixedAsset", scheduleCode: "E" },
  { key: "fixedAssets", code: "1021", name: "Fixed Assets", type: "Asset", subType: "FixedAsset", scheduleCode: "E" },
  { key: "accumDep", code: "1029", name: "Accumulated Depreciation", type: "Asset", subType: "FixedAsset", scheduleCode: "E" },
  { key: "securityDeposit", code: "1030", name: "Security Deposit", type: "Asset", subType: "Other", scheduleCode: "G" },
  { key: "propertyTaxAdvance", code: "1031", name: "Property Tax Paid in Advance", type: "Asset", subType: "Other", scheduleCode: "G" },

  // ── Liabilities ──────────────────────────────────────────────────────────
  // memberAdvance is REQUIRED by the fixed PaymentRecorded posting rules: an
  // over-collection credits this liability instead of driving Dues from
  // Members negative (the ₹-30,149.45 defect).
  { key: "memberAdvance", code: "2001", name: "Advance Received From Members", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "auditFeePayable", code: "2010", name: "Audit Fee Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "accountWritingPayable", code: "2011", name: "Account Writing Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "electricityPayable", code: "2012", name: "Electricity Charges Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "waterPayable", code: "2013", name: "Water Charges Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "salaryPayable", code: "2014", name: "Salary / Security Charges Payable", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "tdsPayable", code: "2015", name: "TDS Payable", type: "Liability", subType: "StatutoryLiability", scheduleCode: "D" },

  // ── Equity / Funds ────────────────────────────────────────────────────
  { key: "shareCapital", code: "3000", name: "Share Capital", type: "Equity", subType: "ShareCapital", scheduleCode: "A" },
  { key: "generalFund", code: "3001", name: "General Fund", type: "Equity", subType: "GeneralFund", scheduleCode: "C" },
  { key: "reserveFund", code: "3002", name: "Reserve Fund", type: "Equity", subType: "ReserveFund", scheduleCode: "B" },
  { key: "sinkingFund", code: "3003", name: "Sinking Fund", type: "Equity", subType: "SinkingFund", scheduleCode: "B" },
  { key: "repairFund", code: "3004", name: "Building Repair & Development Fund", type: "Equity", subType: "RepairFund", scheduleCode: "B" },
  // The account real society books actually carry forward year to year —
  // last year's audited closing surplus becomes this year's opening figure,
  // the same way Reserve/Sinking/Repair Fund balances already do (see
  // Opening Balances' own "Balancing Fund account" — this is meant to be
  // the one picked there, not General Fund, which is a separately
  // appropriated reserve). No closing journal entry needed for this: the
  // Opening Balances posting already computes this as the balancing figure
  // across every other account entered, which is mathematically exactly the
  // accumulated surplus, by definition of double-entry.
  { key: "retainedSurplus", code: "3005", name: "Income & Expenditure A/c", type: "Equity", subType: "RetainedSurplus", scheduleCode: "C" },

  // ── Income ─────────────────────────────────────────────────────────────
  // The reference statutory I&E Account does NOT show one lumped "Maintenance
  // Income" line — it shows "BY Members Contribution" broken into the same
  // heads the society bills on (Rep.& Maint., Property Tax, Water, Electricity,
  // Service Charges, Insurance, Parking, Non-occupancy), then Interest on
  // Arrears, Bank Interest and Misc. Income as separate lines. Seeding those
  // heads is what lets the Income side print with real detail instead of two
  // rows.
  { key: "maintenanceIncome", code: "4001", name: "Members Contribution - Rep. & Maint.", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "interestIncome", code: "4002", name: "Interest on Arrears", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "bankInterestIncome", code: "4003", name: "Bank Interest (S.B. A/c)", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "miscIncome", code: "4004", name: "Misc. Income", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "propertyTaxIncome", code: "4005", name: "Members Contribution - Property Tax", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "waterIncome", code: "4006", name: "Members Contribution - Water Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "electricityIncome", code: "4007", name: "Members Contribution - Electricity Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "serviceChargesIncome", code: "4008", name: "Members Contribution - Service Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "insuranceIncome", code: "4009", name: "Members Contribution - Insurance Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "parkingIncome", code: "4010", name: "Parking Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "nonOccupancyIncome", code: "4011", name: "Non-occupancy Charges", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "bankInterestTdccIncome", code: "4012", name: "Bank Interest (T.D.C.C. S.B. A/c)", type: "Income", subType: "Income", scheduleCode: "I" },
  { key: "scrapSaleIncome", code: "4013", name: "Scrap Sale", type: "Income", subType: "Income", scheduleCode: "I" },

  // ── Expenses ─────────────────────────────────────────────────────────
  // Extended from 9 heads to the ~20 the reference Expenditure side actually
  // prints (AGM, Function, Discount to Members, TDS, Computer, Professional
  // Charges, Gardening, Postage, C.C.TV, Medical, Printing & Stationery,
  // Account Writing, Inverter), so the Lab's I&E can look like the auditor's.
  { key: "repairsExpense", code: "5001", name: "Rep. & Maint.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "propertyTaxExpense", code: "5002", name: "Property Tax", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "waterExpense", code: "5003", name: "Water Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "electricityExpense", code: "5004", name: "Electricity Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "insuranceExpense", code: "5005", name: "Insurance Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "salaryExpense", code: "5006", name: "Salary & Wages / Security Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "auditFeeExpense", code: "5007", name: "Audit Fee", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "bankChargesExpense", code: "5008", name: "Bank Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "miscExpense", code: "5009", name: "Misc. Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "printingExpense", code: "5010", name: "Printing & Stationery", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "agmExpense", code: "5011", name: "AGM Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "functionExpense", code: "5012", name: "Function", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "discountToMembersExpense", code: "5013", name: "Discount to Members", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "tdsExpense", code: "5014", name: "TDS", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "computerExpense", code: "5015", name: "Computer Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "professionalChargesExpense", code: "5016", name: "Professional Charges", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "gardeningExpense", code: "5017", name: "Gardening", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "postageExpense", code: "5018", name: "Postage", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "cctvExpense", code: "5019", name: "C.C.TV Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "depreciationExpense", code: "5020", name: "Depreciation", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "medicalExpense", code: "5021", name: "Medical Exp.", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "accountWritingExpense", code: "5022", name: "Accounts Writing", type: "Expense", subType: "Expense", scheduleCode: "J" },
  { key: "inverterExpense", code: "5023", name: "Inverter", type: "Expense", subType: "Expense", scheduleCode: "J" },
];

export const STANDARD_ACCOUNT_CODES = STANDARD_ACCOUNTS.map((a) => a.code);

/**
 * Real accounts a specific society may hold that aren't universal enough to
 * force on every society's Chart of Accounts (so they're never counted as
 * "missing" and never nag anyone who doesn't have them) — but common enough
 * to offer as one-click adds rather than making an admin type the whole
 * thing by hand. Same lifecycle as STANDARD_ACCOUNTS once adopted: renames,
 * deactivates and deletes all go through the normal lock-matrix rules.
 *
 * Sourced from a real audited FY24-25 Balance Sheet: a builder-funded water
 * line liability and a bank FD auto-sweep facility, both one-off enough to
 * belong to this list rather than the required template.
 */
export const OPTIONAL_ACCOUNTS = [
  { key: "waterLineFromBuilder", code: "2020", name: "Water Line (Recd. From Builder)", type: "Liability", subType: "Payable", scheduleCode: "D" },
  { key: "bankSweepFD", code: "1011", name: "Bank FD (Auto-sweep)", type: "Asset", subType: "Investment", scheduleCode: "F" },
  // A society banking with two banks prints each as its own line.
  { key: "bankSecondAccount", code: "1012", name: "Cash at Bank (2nd A/c)", type: "Asset", subType: "Bank", scheduleCode: "H" },
  // "Cost of Land & Bldg." on the capital side of a builder-handed-over
  // society's Balance Sheet, the counterpart of the Land & Bldg. asset.
  { key: "costOfLandBuilding", code: "3006", name: "Cost of Land & Bldg.", type: "Equity", subType: "CorpusFund", scheduleCode: "B" },
];

/**
 * Accounts whose balance is the OPPOSITE of their type's natural side — an
 * asset that is a credit. Accumulated Depreciation reduces Fixed Assets, so
 * opening it as a debit would ADD it to them. Chart accounts derive
 * normalBalance from type alone, so contra-ness is decided here.
 */
export function isContraAccount(acc) {
  if (!acc) return false;
  const std = STANDARD_ACCOUNTS.find((a) => a.key === "accumDep");
  return (std && acc.code === std.code) || /accumulated depreciation/i.test(String(acc.name || ""));
}

export default STANDARD_ACCOUNTS;
