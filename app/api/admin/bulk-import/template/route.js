/**
 * GET /api/admin/bulk-import/template
 * 7-sheet Excel:
 *   Sheet1  = Society (identical to society_upload_template.xlsx)
 *   Sheets 2-7 = Members (identical structure to member_import_template.xlsx)
 */
import { NextResponse } from "next/server";
import { buildWorkbook, addSheetFromAoa, workbookBuffer } from "@/lib/excelParse";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { SHEETS, ENUMS, getSheet } from "@/lib/import/importSchema";

// §17/§20 - the optional sheets are generated FROM the schema rather than
// hardcoded like sheets 1-6 above.
//
// Sheets 1-6 stay literal on purpose: societies already have that workbook
// downloaded, and a generated version that differed by even a column order
// would invalidate files that are part-way through being filled in. The new
// sheets have no such history, so they are derived and cannot drift from the
// validator.
const OPTIONAL_SHEET_IDS = [
  "vehicles",
  "emergencyContacts",
  "commercialCategories",
  "shops",
  "businesses",
  "amenities",
];

/** One example value per column, chosen to be obviously fake but well-formed. */
const EXAMPLES = {
  vehicles: ["101", "MH01AB1234", "Four-Wheeler", "Maruti", "Swift", "White", "Petrol", "P-12", "", "9876543210"],
  emergencyContacts: ["101", "Sunita Deshpande", "Mother", "9876543211", "9876543212", "sunita@example.com", "12 MG Road, Pune", "Yes"],
  commercialCategories: ["Grocery", 10, "Yes"],
  shops: ["S-01", "A", 0, "Shop", "Nikhil Joshi", "9876543213", "nikhil@example.com", "101", 450, "Rented out", "Meera Rao", "9876543214", "2025-04-01", "2027-03-31", "Meera Provisions", "Grocery", "27AABCU9603R1ZX"],
  businesses: ["S-01", "Meera Provisions", "Meera Retail LLP", "Grocery", "Daily needs and packaged food", "9876543214", "9876543214", "meera@example.com", "27AABCU9603R1ZX", "LIC-2025-0912", "09:30", "21:00", "Sunday"],
  amenities: ["Clubhouse Gym", "Sports", "Podium Level 2", "Cardio and weights", "OPEN", "06:00", "22:00", "EVERYONE", 25, "QR", "Ravi Kamble", "9876543215"],
};

/**
 * Describe what a column will accept, in the admin's words.
 *
 * This is the §20 change: the rules the validator enforces were previously
 * knowable only by failing an import and reading the errors. Now they are on
 * the sheet, above the column they govern.
 */
function ruleFor(col) {
  const parts = [];
  parts.push(col.required ? "Required." : "Optional.");
  if (col.options) parts.push(`One of: ${ENUMS[col.options].join(" / ")}.`);
  if (col.pattern === "isoDate") parts.push("Date as YYYY-MM-DD, e.g. 2025-04-01.");
  if (col.pattern === "hhmm") parts.push("24-hour time as HH:mm, e.g. 09:30.");
  if (col.pattern === "phoneIN") parts.push("10 digits, starting 6-9.");
  if (col.pattern === "email") parts.push("A valid email address.");
  if (col.pattern === "gstin") parts.push("15-character GSTIN.");
  if (col.pattern === "pan") parts.push("10-character PAN, e.g. ABCDE1234F.");
  if (typeof col.min === "number" || typeof col.max === "number") {
    parts.push(`Between ${col.min ?? 0} and ${col.max ?? "no limit"}.`);
  }
  if (col.unique === "sheet") parts.push("Must be unique on this sheet.");
  if (col.fk) {
    const target = getSheet(col.fk.sheet);
    parts.push(`Must already exist in "${target?.title || col.fk.sheet}".`);
  }
  if (col.help) parts.push(col.help);
  return parts.join(" ");
}
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  const wb = buildWorkbook();
  // ── Sheet 1: Society (exact same as society_upload_template.xlsx) ──
  const societyHeaders = [
    "Society Name",
    "Registration No",
    "Address",
    "Date of Registration",
    "PAN No",
    "TAN No",
    "Admin Full Name",
    "Admin Email",
    "Contact Person",
    "Contact Email",
    "Contact Phone",
    "Bill Creation Day*",
    "Payment Upload Day*",
    "Bill Due Day*",
    "Interest Starts After Due Date (Days)",
    "Maintenance Rate (Per Sq Ft)",
    "Sinking Fund Rate (Per Sq Ft)",
    "Repair Fund Rate (Per Sq Ft)",
    "Water Charges (Fixed)",
    "Security Charges (Fixed)",
    "Electricity Charges (Fixed)",
    "Open Parking TW (Per Vehicle)",
    "Open Parking FW (Per Vehicle)",
    "Covered Parking TW (Per Vehicle)",
    "Covered Parking FW (Per Vehicle)",
  ];
  const societySample = [
    "Godbole Heights",
    "MH/2010/001",
    "Adharwadi, Kalyan, Maharashtra",
    "01/04/2010",
    "AABCG1234D",
    "MUMG12345A",
    "Ramesh Patil",
    "admin@godboleheights.com",
    "Suresh Patil",
    "secretary@godboleheights.com",
    "9876543210",
    1,
    30,
    30,
    15,
    "1.5",
    "0.5",
    "0.25",
    "150",
    "200",
    "100",
    "100",
    "150",
    "200",
    "300",
  ];
  addSheetFromAoa(wb, "Society", [societyHeaders, societySample], {
    colWidths: societyHeaders.map((h) => Math.max(h.length + 4, 18)),
  });
  // ── Sheets 2-7: Members (exact same structure as member_import_template.xlsx) ──
  // Sheet 2: Basic Info
  const basicInfoRows = [
   ["flatNo*", "wing", "floor", "ownerName*", "contactNumber*", "emailPrimary*", "carpetAreaSqft*", "flatType", "ownershipType", "openingPrincipal", "openingInterest", "advanceCredit"],
["1310", "A", 13, "Arjun Rastogi", "9876543210", "arjun@example.com", 1800, "2BHK", "Owner-Occupied", 0, 0, 0],
["202", "B", 2, "Priya Sharma (with dues)", "9876500000", "priya@example.com", 1200, "2BHK", "Owner-Occupied", 5000, 875, 0],
  [],
    ["INSTRUCTIONS:"],
    ["* = Required fields"],
    ["flatType options: 1BHK, 2BHK, 3BHK, 4BHK, 5BHK+, Studio, Penthouse, Shop, Office"],
    ["ownershipType: Owner-Occupied, Rented, Vacant, Under-Dispute"],
    [],
    ["FINANCIAL FIELDS (Opening Balances as on cutover date):"],
    ["openingPrincipal = Total principal dues (maintenance, water, parking etc.) outstanding BEFORE this system. Enter 0 for new members."],
    ["openingInterest  = Interest already accrued on old dues as on cutover date. Enter 0 for new members or if no historic interest."],
    ["RULE: System will always clear openingInterest FIRST, then openingPrincipal (Interest Satisfy First rule)."],
  ];
  // Sheet 3: Additional Details
  const additionalRows = [
    // The Aadhaar column is kept in place, and only in place: removing it would
    // shift every column after it and silently corrupt older files that people
    // have already filled in. Renaming it says what happened; the importer
    // reads the cell and drops the value (D1).
    ["flatNo*", "panCard", "aadhaar (not collected — leave blank)", "alternateContact", "whatsappNumber", "emailSecondary", "builtUpAreaSqft", "possessionDate"],
    ["1310", "ABCDE1234F", "123456789012", "9123456789", "9876543210", "arjun.alt@example.com", 2000, "2024-01-15"],
  ];
  // Sheet 4: Parking Slots
  const parkingRows = [
    ["flatNo*", "slotNumber", "type", "vehicleType"],
    ["1310", "P-A-101", "Stilt", "Four-Wheeler"],
    ["1310", "P-A-102", "Open", "Two-Wheeler"],
    ["1310", "P-A-103", "Open", "Two-Wheeler"],
    ["1310", "P-A-104", "Covered", "Four-Wheeler"],
    [],
    ["INSTRUCTIONS"],
    ["Type: Stilt (one-time purchase, NOT billed monthly) | Open | Covered"],
    ["VehicleType: Two-Wheeler | Four-Wheeler"],
    ["One row = one parking slot. Add multiple rows for multiple slots per flat."],
    ["Stilt slots will NOT generate monthly parking charges. Open/Covered will."],
  ];
  // Sheet 5: Family Members
  const familyRows = [
    ["flatNo*", "name", "relation", "age", "contactNumber", "occupation"],
    ["1310", "Aarav Rastogi", "Son", 12, "", "Student"],
  ];
  // Sheet 6: Owner History
  const ownerRows = [
    ["flatNo*", "ownerSequence", "ownerName", "contactNumber", "emailPrimary", "panCard", "ownershipStartDate", "ownershipEndDate", "purchaseAmount", "saleAmount"],
    ["1310", 1, "Previous Owner Name", "9123456789", "prev@example.com", "OLDPN1234A", "2015-01-01", "2020-06-30", 2500000, 3200000],
    [],
    ["NOTE: Only add previous owners (not current owner)"],
  ];
  // Sheet 7: Tenant History
  const tenantRows = [
    ["flatNo*", "tenantSequence", "name", "contactNumber", "email", "panCard", "startDate", "endDate", "depositAmount", "rentPerMonth", "isCurrent"],
    ["1311", 1, "Past Tenant", "9999999998", "tenant1@example.com", "TEN111234A", "2020-01-01", "2022-12-31", 50000, 20000, "No"],
    ["1311", 2, "Current Tenant", "9999999999", "tenant2@example.com", "TEN221234B", "2023-01-01", "", 60000, 25000, "Yes"],
    [],
    ["NOTE: Leave endDate blank for current tenant"],
    ["isCurrent: Yes or No"],
  ];
  const memberSheets = [
    { name: "1. Basic Info (Required)", rows: basicInfoRows },
    { name: "2. Additional Details", rows: additionalRows },
    { name: "3. Parking Slots", rows: parkingRows },
    { name: "4. Family Members", rows: familyRows },
    { name: "5. Owner History", rows: ownerRows },
    { name: "6. Tenant History", rows: tenantRows },
  ];
  for (const { name, rows } of memberSheets) {
    const headerRow = rows[0];
    addSheetFromAoa(wb, name, rows, {
      colWidths: headerRow.map((h) => Math.max(String(h || "").length + 4, 16)),
    });
  }
  // ── Sheets 7-12: the optional domain sheets, generated from the schema ──
  //
  // Four rows per sheet, in this order:
  //   1. the column key the parser reads (this is the row that must survive)
  //   2. the human label
  //   3. what the column accepts - enum values, format, uniqueness, links
  //   4. a worked example
  //
  // The example row is left in the file deliberately. An admin who deletes it
  // and types over it is the intended use; one who leaves it gets a single
  // obviously-fake row flagged at preview rather than a silent empty import.
  for (const id of OPTIONAL_SHEET_IDS) {
    const sheet = SHEETS.find((sh) => sh.id === id);
    if (!sheet) continue;
    const keys = sheet.columns.map((c) => c.key);
    const rows = [
      keys,
      sheet.columns.map((c) => c.label),
      sheet.columns.map(ruleFor),
      EXAMPLES[id] || [],
    ];
    addSheetFromAoa(wb, sheet.excelName, rows, {
      colWidths: keys.map((k) => Math.max(String(k).length + 4, 18)),
    });
  }

  const buf = await workbookBuffer(wb);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="BulkImport_Template.xlsx"',
    },
  });
}