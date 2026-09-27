// Derives a society's Bill-History window: FY start .. the month before its
// first live period. Everything comes from society config — nothing hardcoded.
// (final_audit_fix_plan/bill-history-upgrade.md §A, §36-11/12/13)

function addMonths(periodId, delta) {
  const [y, m] = periodId.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function periodIdFromYearMonth0(year, month0) {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

export function getBillHistoryWindow(society) {
  const startMonth0 =
    society?.accountingConfig?.financialYearDefaults?.startMonth ?? 3; // default April
  const firstLivePeriodId = society?.onboarding?.joinPeriodId;
  if (!firstLivePeriodId) {
    throw new Error("society.onboarding.joinPeriodId is required to derive a history window");
  }

  const [liveYear, liveMonth1] = firstLivePeriodId.split("-").map(Number);
  const liveMonth0 = liveMonth1 - 1;

  // Which FY does the live period fall in? FY "starts" at startMonth0 each
  // calendar year; if the live month is before startMonth0, the FY began
  // the previous calendar year.
  const fyStartYear = liveMonth0 >= startMonth0 ? liveYear : liveYear - 1;
  const fyStartPeriodId = periodIdFromYearMonth0(fyStartYear, startMonth0);

  const periods = [];
  let cursor = fyStartPeriodId;
  while (cursor < firstLivePeriodId) {
    periods.push(cursor);
    cursor = addMonths(cursor, 1);
  }

  return {
    periods,
    fyStartPeriodId,
    lastHistoryPeriodId: periods.length ? periods[periods.length - 1] : null,
    firstLivePeriodId,
  };
}
