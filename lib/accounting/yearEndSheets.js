/**
 * The two year-end sheets (Balance Sheet and Income & Expenditure) laid out
 * like a society's printed statements: Liabilities | Assets and
 * Expenditure | Income side by side, prior-year column outside, current-year
 * column inside, "Amt (Rs)", "As per report of even date", and the three
 * signatures. Ported from sheetsHtml() in scripts/fy-cycle.js so the page and
 * the script print the same thing.
 *
 * Input is exactly what getBalanceSheet() / getIncomeAndExpenditure() return.
 */

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const hx = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plain = (x) => (x === "" || x == null ? "" : (Math.abs(Number(x)) < 0.005 ? 0 : Number(x)).toFixed(2));

// A group with several accounts prints a heading, each account in the inner
// column and the group total in the outer column. A one-account group prints
// on a single line.
function sheetSide(groups, linePrefix = "") {
  const rows = [];
  for (const g of groups || []) {
    if (g.accounts.length === 1) {
      const a = g.accounts[0];
      rows.push({ prior: a.prior, label: linePrefix + a.name, total: a.current, kind: "line" });
      continue;
    }
    rows.push({ label: g.label, kind: "head" });
    for (const a of g.accounts) rows.push({ prior: a.prior, label: linePrefix + a.name, sub: a.current, kind: "sub" });
    rows.push({ prior: g.totalPrior, label: "", total: g.totalCurrent, kind: "total" });
  }
  return rows;
}

function sheetTable(leftHead, rightHead, left, right, totals, priorLabel, curLabel) {
  const len = Math.max(left.length, right.length);
  const cell = (r) => {
    if (!r) return '<td class="n"></td><td></td><td class="n"></td><td class="n"></td>';
    const cls = r.kind === "head" ? ' class="h"' : "";
    return `<td class="n">${plain(r.prior)}</td><td${cls}>${hx(r.label)}</td><td class="n">${plain(r.sub)}</td><td class="n">${plain(r.total)}</td>`;
  };
  const body = Array.from({ length: len }, (_, i) => `<tr>${cell(left[i])}${cell(right[i])}</tr>`).join("\n");
  const pad = Math.max(0, 22 - len);
  const blank = Array.from({ length: pad }, () => '<tr><td class="n">&nbsp;</td><td></td><td></td><td></td><td class="n"></td><td></td><td></td><td></td></tr>').join("\n");
  return `<table class="sheet">
<thead><tr><th>${hx(priorLabel)}</th><th>${hx(leftHead)}</th><th></th><th>${hx(curLabel)}</th><th>${hx(priorLabel)}</th><th>${hx(rightHead)}</th><th></th><th>${hx(curLabel)}</th></tr></thead>
<tbody>
${body}
${blank}
</tbody>
<tfoot><tr><td class="n">${plain(totals.leftPrior)}</td><td class="tot">TOTAL</td><td></td><td class="n">${plain(totals.leftCur)}</td><td class="n">${plain(totals.rightPrior)}</td><td class="tot">TOTAL</td><td></td><td class="n">${plain(totals.rightCur)}</td></tr></tfoot>
</table>`;
}

function asOfText(date) {
  const d = new Date(date);
  const day = d.getDate();
  const sfx = day % 10 === 1 && day !== 11 ? "ST" : day % 10 === 2 && day !== 12 ? "ND" : day % 10 === 3 && day !== 13 ? "RD" : "TH";
  return `${day}${sfx} ${d.toLocaleString("en-GB", { month: "long" }).toUpperCase()}, ${d.getFullYear()}`;
}

/** Balance Sheet rows for both sides plus totals. */
export function balanceSheetLayout(bs) {
  const left = [
    ...sheetSide(bs.equity),
    ...sheetSide(bs.liabilities),
    { prior: bs.priorYearSurplusOrDeficit, label: "Income & Expenditure — Excess of Income over Exp. (this year)", total: bs.currentYearSurplusOrDeficit, kind: "line" },
  ];
  return {
    left,
    right: sheetSide(bs.assets),
    totals: {
      leftPrior: r2(bs.totalLiabilitiesPrior + bs.totalEquityInclSurplusPrior),
      leftCur: r2(bs.totalLiabilitiesCurrent + bs.totalEquityInclSurplusCurrent),
      rightPrior: bs.totalAssetsPrior,
      rightCur: bs.totalAssetsCurrent,
    },
  };
}

/** Income & Expenditure rows for both sides plus totals. */
export function incomeExpenditureLayout(ie) {
  const left = [...sheetSide(ie.expense, "To "), ...(ie.depreciationGroup ? sheetSide([ie.depreciationGroup]) : [])];
  const right = sheetSide(ie.income);
  const sCur = ie.surplusOrDeficitCurrent;
  const sPri = ie.surplusOrDeficitPrior;
  if (sCur >= 0) left.push({ prior: sPri >= 0 ? sPri : "", label: "To Excess of Income", total: sCur, kind: "line" });
  else right.push({ prior: sPri < 0 ? -sPri : "", label: "By Excess of Expenditure", total: -sCur, kind: "line" });
  return {
    left,
    right,
    totals: {
      leftPrior: r2(ie.totalExpensePrior + Math.max(sPri, 0)),
      leftCur: r2(ie.totalExpenseCurrent + Math.max(sCur, 0)),
      rightPrior: r2(ie.totalIncomePrior + Math.max(-sPri, 0)),
      rightCur: r2(ie.totalIncomeCurrent + Math.max(-sCur, 0)),
    },
  };
}

/**
 * Every Balance Sheet account that moved between the start of the year
 * (prior-year column, which is this year's opening position) and the end.
 */
export function movementSinceOpening(bs) {
  const rows = [];
  const groups = [
    ...(bs.assets || []).map((g) => ({ ...g, side: "Asset" })),
    ...(bs.liabilities || []).map((g) => ({ ...g, side: "Liability" })),
    ...(bs.equity || []).map((g) => ({ ...g, side: "Fund" })),
  ];
  for (const g of groups) {
    for (const a of g.accounts) {
      const change = r2(a.current - a.prior);
      rows.push({ key: String(a.accountId), side: g.side, group: g.label, name: a.name, opening: a.prior, closing: a.current, change, why: reasonFor(a.name, g.side, change) });
    }
  }
  rows.push({
    key: "ie",
    side: "Fund",
    group: "Income & Expenditure",
    name: "Income & Expenditure — this year",
    opening: bs.priorYearSurplusOrDeficit,
    closing: bs.currentYearSurplusOrDeficit,
    change: r2(bs.currentYearSurplusOrDeficit - bs.priorYearSurplusOrDeficit),
    why: "income − expenditure",
  });
  return rows;
}

function reasonFor(name, side, change) {
  if (Math.abs(change) < 0.005) return "no movement";
  const n = String(name).toLowerCase();
  if (side === "Asset" && /bank|cash/.test(n)) return "collections received − expenses paid";
  if (side === "Asset" && /receivable|dues|debtor|member/.test(n)) return "bills raised − dues collected";
  if (/advance/.test(n)) return "advance received − advance used against bills";
  if (/sinking|repair|reserve|fund/.test(n)) return "contributions billed to the fund";
  if (/depreciation/.test(n)) return "depreciation for the year";
  return "entries posted during the year";
}

/** Full standalone HTML document: one A4-landscape page per sheet. */
export function yearEndSheetsHtml(society, bs, ie) {
  const asOf = asOfText(bs.asOf);
  const cur = bs.financialYearLabel;
  const prior = bs.priorFinancialYearLabel || "—";
  const name = String(society?.name || "Society").toUpperCase();
  const B = balanceSheetLayout(bs);
  const I = incomeExpenditureLayout(ie);
  const bsHtml = sheetTable("LIABILITIES", "ASSETS", B.left, B.right, B.totals, prior, cur);
  const ieHtml = sheetTable("EXPENDITURE", "INCOME", I.left, I.right, I.totals, prior, cur);
  const foot = `<div class="foot"><div>AS PER REPORT OF EVEN DATE</div><div class="sign"><div>FOR ${hx(name)}</div><div class="who"><span>CHAIRMAN</span><span>SECRETARY</span><span>TREASURER</span></div></div></div>`;
  const page = (title, table) => `<section class="page"><div class="amt">Amt (Rs)</div><h1>${hx(name)}</h1><h2>${title}</h2>${table}${foot}</section>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${hx(society?.name || "Society")} — ${hx(cur)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e9e9e9; font: 12.5px/1.35 "Segoe UI", Arial, sans-serif; color: #111; }
  .page { background: #fff; width: 277mm; margin: 12px auto; padding: 8mm 8mm 6mm; page-break-after: always; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
  .page:last-child { page-break-after: auto; }
  h1 { margin: 0; text-align: center; font-size: 15px; letter-spacing: .02em; }
  h2 { margin: 2px 0 6px; text-align: center; font-size: 13px; font-weight: 700; }
  .amt { text-align: right; font-weight: 700; font-size: 12px; }
  table.sheet { width: 100%; border-collapse: collapse; table-layout: fixed; border: 2px solid #111; }
  .sheet th, .sheet td { border-left: 1px solid #111; border-right: 1px solid #111; padding: 2px 5px; height: 21px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sheet td { border-bottom: 1px solid #777; }
  .sheet thead th { border-top: 2px solid #111; border-bottom: 2px solid #111; font-weight: 700; text-align: center; background: #f4f4f4; }
  .sheet th:nth-child(1), .sheet th:nth-child(5) { width: 9%; }
  .sheet th:nth-child(2), .sheet th:nth-child(6) { width: 24%; }
  .sheet th:nth-child(3), .sheet th:nth-child(7) { width: 8.5%; }
  .sheet th:nth-child(4), .sheet th:nth-child(8) { width: 8.5%; }
  .sheet td.n { text-align: right; font-variant-numeric: tabular-nums; }
  .sheet td:nth-child(2), .sheet td:nth-child(6) { white-space: normal; text-overflow: clip; line-height: 1.25; }
  .sheet td.h { font-weight: 700; text-decoration: underline; }
  .sheet tfoot td { border-top: 2px solid #111; border-bottom: 2px solid #111; font-weight: 700; }
  .sheet td:nth-child(4) { border-right: 2px solid #111; }
  .tot { text-align: center; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14mm; font-weight: 700; }
  .sign { text-align: right; }
  .who { display: flex; gap: 22mm; margin-top: 14mm; }
  @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; width: auto; } }
</style></head><body>
${page(`BALANCE SHEET AS AT ${asOf}`, bsHtml)}
${page(`INCOME &amp; EXPENDITURE ACCOUNT FOR THE YEAR ENDED ${asOf}`, ieHtml)}
</body></html>
`;
}
