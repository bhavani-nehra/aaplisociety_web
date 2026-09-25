// Field set for a HISTORICAL bill — a pre-validated paper record of a month
// that happened before the society joined the platform. Lifted unchanged out of
// /api/superadmin/bill-history-import so the route and scripts/fy-cycle.js
// write identical records.
//
// Convention (from the original route): historical bills are ALWAYS Paid with
// zero live balances. The real unpaid debt at entry lives in
// Member.openingPrincipal / openingInterest; keeping these bills open would
// make generation and payment allocation count that debt twice.
export function buildHistoricalBillFields({
  societyId,
  memberId,
  periodId,
  billMonth, // 0-indexed
  billYear,
  importedFinancialYear,
  dueDate,
  charges, // Map<string, number>
  openingPrincipal,
  openingInterest,
  currentCharges,
  currentInterest,
  billPrincipal,
  billInterest,
  totalBillDue,
  amountPaid, // what was really paid; omitted = treated as settled (the importer's original convention)
  advanceCredit = 0,
  batchId,
  fileName = "BillHistory",
  remarks = "",
}) {
  const closingPrincipal = 0;
  const closingInterest = 0;
  return {
    societyId,
    memberId,
    billPeriodId: periodId,
    billMonth,
    billYear,
    openingPrincipal,
    openingInterest,
    currentCharges,
    currentInterest,
    billPrincipalBalance: billPrincipal,
    billInterestBalance: billInterest,
    totalBillDue,
    closingPrincipal,
    closingInterest,
    closingTotal: closingPrincipal + closingInterest,
    previousBalance: openingPrincipal + openingInterest,
    previousPrincipal: openingPrincipal,
    previousInterest: openingInterest,
    monthInterest: currentInterest,
    interestAmount: currentInterest,
    principalBalance: 0,
    interestBalance: 0,
    totalAmount: totalBillDue,
    amountPaid: amountPaid ?? totalBillDue, // omitted = fully settled; the debt is carried in openingPrincipal
    advanceApplied: advanceCredit,
    balanceAmount: 0,
    charges,
    status: "Paid",
    dueDate,
    importedFrom: "BulkImport",
    // Not produced by GenerationService — a pre-validated paper-record import,
    // so it is explicitly outside the Ledger V2 engine versioning.
    calculationVersion: 0,
    engineVersion: "Legacy Import",
    isLocked: true,
    isHistoricalArchive: true,
    importedFinancialYear,
    importBatchId: batchId,
    importMetadata: {
      fileName,
      uploadedAt: new Date(),
      rowNumber: 0,
      validationStatus: "Valid",
    },
    notes: remarks,
  };
}
