// 4-sheet Bill History template — build (server-prefilled) and parse.
// final_audit_fix_plan/bill-history-upgrade.md §39 EXACT TEMPLATE.
import {
  buildWorkbook,
  addSheetFromAoa,
  workbookBuffer,
  loadWorkbook,
  worksheetToJson,
  neutralizeCell,
} from "../excelParse.js";

function flatId(m) {
  return `${m.wing}-${m.flatNo}`;
}

export async function buildHistoryTemplate({ society, members, window }) {
  const wb = buildWorkbook();

  // Sheet 1: Flats
  const flatsAoa = [
    ["Flat", "Owner", "Monthly bill amount", "Opening principal", "Opening interest", "Opening advance"],
    ...members.map((m) => [
      flatId(m),
      m.ownerName || "",
      "", // optional, blank = system calculates
      m.openingPrincipal || 0,
      m.openingInterest || 0,
      m.advanceCredit || 0,
    ]),
  ];
  addSheetFromAoa(wb, "Flats", flatsAoa);

  // Sheet 2: Paid — one column per history month
  const paidHeader = ["Flat", ...window.periods];
  const paidAoa = [
    paidHeader,
    ...members.map((m) => [flatId(m), ...window.periods.map(() => "")]),
  ];
  addSheetFromAoa(wb, "Paid", paidAoa);

  // Sheet 3: Rate table — empty, admin-filled only if a rate changed mid-history
  addSheetFromAoa(wb, "Rate table", [["Billing head", "From month", "Amount"]]);

  // Sheet 4: Exceptions — empty, usually stays empty
  addSheetFromAoa(wb, "Exceptions", [
    ["Flat", "Month", "Bill amount", "Interest charged", "Payment date", "Payment method", "Remarks"],
  ]);

  return workbookBuffer(wb);
}

function requireSheet(wb, name) {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`Bill History template is missing the required "${name}" sheet`);
  return ws;
}

// §17 FILE SECURITY — an uploaded workbook is attacker-controlled. Checked
// before ExcelJS ever touches the bytes: real zip magic, a size ceiling well
// above any real 4-sheet history workbook, and per-sheet row/col caps after
// load so a crafted workbook can't blow up memory during reconstruction.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — generous for a 4-sheet workbook
const MAX_SHEET_ROWS = 5000; // matches lib/excelParse.js's parseXlsxSafely cap
const MAX_SHEET_COLS = 60; // Paid sheet can have up to ~12 month columns + Flat; leaves headroom

export async function parseHistoryTemplate(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length === 0) throw new Error("Uploaded file is empty");
  if (buffer.length > MAX_UPLOAD_BYTES)
    throw new Error(`Uploaded file is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`);
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK" — real .xlsx is a zip
  if (!isZip) throw new Error("Uploaded file is not a valid .xlsx workbook");

  const wb = await loadWorkbook(buffer);
  for (const ws of wb.worksheets) {
    if (ws.rowCount > MAX_SHEET_ROWS)
      throw new Error(`Sheet "${ws.name}" has too many rows (max ${MAX_SHEET_ROWS})`);
    if (ws.columnCount > MAX_SHEET_COLS)
      throw new Error(`Sheet "${ws.name}" has too many columns (max ${MAX_SHEET_COLS})`);
  }

  const flatsSheet = requireSheet(wb, "Flats");
  const flatsRows = worksheetToJson(flatsSheet, { defval: "" });
  const flats = flatsRows.map((r) => ({
    flat: String(r["Flat"] || "").trim(),
    owner: neutralizeCell(String(r["Owner"] || "").trim()),
    monthlyBillAmount: r["Monthly bill amount"] === "" ? null : Number(r["Monthly bill amount"]),
    openingPrincipal: Number(r["Opening principal"]) || 0,
    openingInterest: Number(r["Opening interest"]) || 0,
    openingAdvance: Number(r["Opening advance"]) || 0,
  }));

  const paidSheet = requireSheet(wb, "Paid");
  const paidRows = worksheetToJson(paidSheet, { defval: "" });
  const periodCols = paidRows.length
    ? Object.keys(paidRows[0]).filter((k) => k !== "Flat")
    : [];
  const paid = paidRows.map((r) => {
    const row = { flat: String(r["Flat"] || "").trim() };
    for (const p of periodCols) {
      const raw = r[p];
      if (String(raw).trim().toUpperCase() === "NA") row[p] = "NA";
      else row[p] = raw === "" ? 0 : Number(raw);
    }
    return row;
  });

  const rateSheet = requireSheet(wb, "Rate table");
  const rateTable = worksheetToJson(rateSheet, { defval: "" })
    .filter((r) => String(r["Billing head"] || "").trim())
    .map((r) => ({
      billingHead: String(r["Billing head"]).trim(),
      fromMonth: String(r["From month"]).trim(),
      amount: Number(r["Amount"]) || 0,
    }));

  const exceptionsSheet = requireSheet(wb, "Exceptions");
  const exceptions = worksheetToJson(exceptionsSheet, { defval: "" })
    .filter((r) => String(r["Flat"] || "").trim())
    .map((r) => ({
      flat: String(r["Flat"]).trim(),
      month: String(r["Month"]).trim(),
      billAmount: r["Bill amount"] === "" ? null : Number(r["Bill amount"]),
      interestCharged: r["Interest charged"] === "" ? null : Number(r["Interest charged"]),
      paymentDate: r["Payment date"] || null,
      paymentMethod: neutralizeCell(r["Payment method"] || "") || null,
      remarks: neutralizeCell(r["Remarks"] || ""),
    }));

  return { flats, paid, rateTable, exceptions };
}
