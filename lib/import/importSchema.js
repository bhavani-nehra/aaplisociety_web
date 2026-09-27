// lib/import/importSchema.js
//
// SINGLE SOURCE OF TRUTH for the society import (Society + 6 member sheets).
//
// This module is imported by BOTH:
//   - app/api/admin/bulk-import/schema/route.js  (serialises it to the client)
//   - app/api/admin/bulk-import/route.js         (re-validates on submit)
//
// That is the whole point. The browser gets the rules once, enforces them
// live on every keystroke, and only POSTs when the entire workbook is clean.
// The server re-runs the identical rules on submit because a client-side
// check is a UX affordance, never a security boundary.
//
// Sheet indices match the existing template route exactly:
//   0  Society
//   1  1. Basic Info (Required)
//   2  2. Additional Details
//   3  3. Parking Slots
//   4  4. Family Members
//   5  5. Owner History
//   6  6. Tenant History

export const SCHEMA_VERSION = "2026-09-27.1";

// ── Reusable validators, expressed as data ──────────────────────────────────
// Everything below must be JSON-serialisable so the exact same object can be
// shipped to the browser. No functions, no regex literals - regexes travel as
// strings and are rebuilt with `new RegExp` on both sides.

export const PATTERNS = {
  email: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$",
  phoneIN: "^[6-9]\\d{9}$",
  pan: "^[A-Z]{5}[0-9]{4}[A-Z]$",
  ifsc: "^[A-Z]{4}0[A-Z0-9]{6}$",
  flatNo: "^[A-Za-z0-9][A-Za-z0-9\\-/ ]{0,15}$",
  wing: "^[A-Za-z0-9]{0,6}$",
  isoDate: "^\\d{4}-\\d{2}-\\d{2}$",
};

export const ENUMS = {
  // Flat-level status. Must match the ownershipType enum in models/Member.js.
  ownershipType: ["Owner-Occupied", "Rented", "Vacant", "Under-Dispute"],
  // Person-level, used by User.profiles — a different concept, keep both.
  occupancyType: ["Owner", "Tenant"],
    flatType: ["1BHK", "2BHK", "3BHK", "4BHK", "5BHK+", "Studio", "Penthouse", "Shop", "Office"],
  parkingType: ["Open", "Covered", "Stilt"],
  vehicleType: ["Two-Wheeler", "Four-Wheeler"],
  relation: [
    "Spouse",
    "Son",
    "Daughter",
    "Father",
    "Mother",
    "Brother",
    "Sister",
    "Other",
  ],
  bloodGroup: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"],
  yesNo: ["Yes", "No"],

};

/**
 * Column descriptor shape:
 *   key        - the exact column name used by the parser (keep the trailing *)
 *   label      - what the admin sees
 *   type       - text | number | email | phone | date | select | money | area
 *   required   - hard-fail when empty
 *   pattern    - PATTERNS key
 *   options    - ENUMS key, for type "select"
 *   min / max  - numeric bounds
 *   width      - grid hint, px
 *   help       - shown in the column header tooltip
 *   unique     - "sheet" for per-sheet uniqueness
 *   fk         - { sheet, column } this value must exist in
 */

// Keys MUST match rowToSocietyPayload() in app/api/admin/bulk-import/route.js
// verbatim, and the order matches the admin's Excel so a clipboard paste lands
// positionally with no mapping layer.
const SOCIETY_COLUMNS = [
  { key: "Society Name", label: "Society Name", type: "text", required: true, width: 220 },
  { key: "Registration No", label: "Registration No", type: "text", width: 160 },
  { key: "Address", label: "Address", type: "text", required: true, width: 280 },
  // Stored as a raw string by the import route, so DD/MM/YYYY is accepted.
  { key: "Date of Registration", label: "Date of Registration", type: "text", width: 140 },
  { key: "PAN No", label: "PAN No", type: "text", pattern: "pan", width: 120, help: "AABCG1234A" },
  { key: "TAN No", label: "TAN No", type: "text", width: 120 },
  { key: "Admin Full Name", label: "Admin Full Name", type: "text", required: true, width: 180 },
  {
    key: "Admin Email",
    label: "Admin Email",
    type: "email",
    required: true,
    pattern: "email",
    width: 240,
    help: "The society admin signs in with this. Must not already exist.",
    remoteCheck: "adminEmailAvailable",
  },
  { key: "Contact Person", label: "Contact Person", type: "text", width: 180 },
  { key: "Contact Email", label: "Contact Email", type: "email", pattern: "email", width: 220 },
  { key: "Contact Phone", label: "Contact Phone", type: "phone", pattern: "phoneIN", width: 130 },
  // max: 31, not 28 — safeConfigDate() (utils/dateUtils.js) already clamps
  // to the real last day of whatever month it lands in (Feb 28/29 stays
  // Feb, never rolls to March), so there was never a real reason to block
  // a perfectly normal "due on the 30th" from being entered.
  { key: "Bill Creation Day*", label: "Bill Creation Day", type: "number", min: 1, max: 31, required: true, width: 120 },
  { key: "Payment Upload Day*", label: "Payment Upload Day", type: "number", min: 1, max: 31, required: true, width: 130 },
  { key: "Bill Due Day*", label: "Bill Due Day", type: "number", min: 1, max: 31, required: true, width: 110 },
  { key: "Interest Starts After Due Date (Days)", label: "Grace Days", type: "number", min: 0, max: 90, width: 110 },
  { key: "Maintenance Rate (Per Sq Ft)", label: "Maintenance /sqft", type: "money", min: 0, width: 140 },
  { key: "Sinking Fund Rate (Per Sq Ft)", label: "Sinking Fund /sqft", type: "money", min: 0, width: 140 },
  { key: "Repair Fund Rate (Per Sq Ft)", label: "Repair Fund /sqft", type: "money", min: 0, width: 140 },
  { key: "Water Charges (Fixed)", label: "Water (fixed)", type: "money", min: 0, width: 120 },
  { key: "Security Charges (Fixed)", label: "Security (fixed)", type: "money", min: 0, width: 120 },
  { key: "Electricity Charges (Fixed)", label: "Electricity (fixed)", type: "money", min: 0, width: 130 },
  { key: "Open Parking TW (Per Vehicle)", label: "Open Parking – 2W", type: "money", min: 0, width: 140 },
  { key: "Open Parking FW (Per Vehicle)", label: "Open Parking – 4W", type: "money", min: 0, width: 140 },
  { key: "Covered Parking TW (Per Vehicle)", label: "Covered Parking – 2W", type: "money", min: 0, width: 150 },
  { key: "Covered Parking FW (Per Vehicle)", label: "Covered Parking – 4W", type: "money", min: 0, width: 150 },
];

const BASIC_INFO_COLUMNS = [
  {
    key: "flatNo*",
    label: "Flat No",
    type: "text",
    required: true,
    pattern: "flatNo",
    width: 100,
    unique: "wing+flatNo",
  },
  { key: "wing", label: "Wing", type: "text", pattern: "wing", width: 80, unique: "wing+flatNo" },
  { key: "floor", label: "Floor", type: "number", min: -2, max: 100, width: 80 },
  { key: "ownerName*", label: "Owner Name", type: "text", required: true, width: 200 },
  {
    key: "contactNumber*",
    label: "Contact",
    type: "phone",
    required: true,
    pattern: "phoneIN",
    width: 130,
  },
  {
    key: "emailPrimary*",
    label: "Email",
    type: "email",
    pattern: "email",
    width: 240,
    unique: "ownerScopedEmail",
    help:
      "Login email. The SAME email may repeat across flats owned by the SAME person — " +
      "they get one account with a profile per flat. A repeat under a different owner name is an error.",
    remoteCheck: "memberEmailAvailable",
  },
  {
    key: "carpetAreaSqft*",
    label: "Carpet Area",
    type: "area",
    required: true,
    min: 1,
    max: 20000,
    width: 120,
  },
  // The import route reads built-up area from the Additional sheet, not here.
{ key: "flatType", label: "Flat Type", type: "select", options: "flatType", width: 120 },
 {
  key: "ownershipType",
  label: "Ownership",
  type: "select",
  options: "ownershipType",
  width: 150,
  help: "Rented pulls the tenant's name onto bills; Owner-Occupied uses the owner's.",
},
  { key: "openingPrincipal", label: "Opening Principal", type: "money", min: 0, width: 140 },
  { key: "openingInterest", label: "Opening Interest", type: "money", min: 0, width: 140 },
  { key: "advanceCredit", label: "Advance Credit", type: "money", min: 0, width: 130 },
];

const ADDITIONAL_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "panCard", label: "PAN", type: "text", pattern: "pan", width: 130 },
  // D1: kept so the column position is stable for files already in
  // circulation, but the importer drops whatever is in it.
  {
    key: "aadhaar",
    label: "Aadhaar (not collected)",
    type: "text",
    width: 150,
    ignored: true,
    help: "No longer collected — leave blank. Anything entered here is discarded on import.",
  },
  { key: "alternateContact", label: "Alt Contact", type: "phone", pattern: "phoneIN", width: 130 },
  { key: "whatsappNumber", label: "WhatsApp", type: "phone", pattern: "phoneIN", width: 130 },
  { key: "emailSecondary", label: "Alt Email", type: "email", pattern: "email", width: 240 },
  { key: "builtUpAreaSqft", label: "Built-up Area", type: "area", min: 0, max: 25000, width: 130 },
  { key: "possessionDate", label: "Possession Date", type: "date", pattern: "isoDate", width: 140 },
];

const PARKING_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "slotNumber", label: "Slot No", type: "text", required: true, width: 110, unique: "sheet" },
  { key: "type", label: "Type", type: "select", options: "parkingType", width: 120, help: "Optional, defaults to Open. Stilt slots are never billed monthly." },
  { key: "vehicleType", label: "Vehicle", type: "select", options: "vehicleType", width: 150, help: "Optional, defaults to Two-Wheeler." },
  { key: "vehicleNumber", label: "Vehicle No", type: "text", width: 140, unique: "sheet", help: "Optional. Registration number, e.g. MH01AB1234." },
  { key: "vehicleName", label: "Vehicle Name", type: "text", width: 160, help: "Optional. e.g. Swift, Activa." },
];

const FAMILY_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "name", label: "Name", type: "text", required: true, width: 200 },
  { key: "relation", label: "Relation", type: "select", options: "relation", required: true, width: 130 },
  { key: "age", label: "Age", type: "number", min: 0, max: 120, width: 80 },
  { key: "contactNumber", label: "Contact", type: "phone", pattern: "phoneIN", width: 130 },
  { key: "occupation", label: "Occupation", type: "text", width: 160 },
];

const OWNER_HISTORY_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "ownerSequence", label: "Seq", type: "number", min: 1, width: 70, help: "1 = earliest owner." },
  { key: "ownerName", label: "Previous Owner", type: "text", required: true, width: 200 },
  { key: "contactNumber", label: "Contact", type: "phone", pattern: "phoneIN", required: true, width: 130 },
  { key: "emailPrimary", label: "Email", type: "email", pattern: "email", width: 240 },
  { key: "panCard", label: "PAN", type: "text", pattern: "pan", width: 130 },
  { key: "ownershipStartDate", label: "Owned From", type: "date", pattern: "isoDate", required: true, width: 140 },
  { key: "ownershipEndDate", label: "Owned To", type: "date", pattern: "isoDate", width: 140, afterField: "ownershipStartDate" },
  { key: "purchaseAmount", label: "Purchase ₹", type: "money", min: 0, width: 140 },
  { key: "saleAmount", label: "Sale ₹", type: "money", min: 0, width: 140 },
];

const TENANT_HISTORY_COLUMNS = [
  { key: "flatNo*", label: "Flat No", type: "text", required: true, width: 100, fk: { sheet: "basicInfo", column: "flatNo*" } },
  { key: "tenantSequence", label: "Seq", type: "number", min: 1, width: 70 },
  { key: "name", label: "Tenant Name", type: "text", required: true, width: 200 },
  { key: "contactNumber", label: "Contact", type: "phone", pattern: "phoneIN", required: true, width: 130 },
  { key: "email", label: "Email", type: "email", pattern: "email", width: 240 },
  { key: "panCard", label: "PAN", type: "text", pattern: "pan", width: 130 },
  { key: "startDate", label: "Lease Start", type: "date", pattern: "isoDate", required: true, width: 140 },
  { key: "endDate", label: "Lease End", type: "date", pattern: "isoDate", width: 140, afterField: "startDate" },
  { key: "depositAmount", label: "Deposit ₹", type: "money", min: 0, width: 130 },
  { key: "rentPerMonth", label: "Rent / month ₹", type: "money", min: 0, width: 140 },
  { key: "isCurrent", label: "Current?", type: "select", options: "yesNo", width: 110, help: "Only one tenant per flat may be Current." },
];

export const SHEETS = [
  {
    id: "society",
    index: 0,
    excelName: "Society",
    title: "Society",
    subtitle: "One row. Identity, contact and billing configuration.",
    icon: "building",
    mode: "single", // renders as a form, not a grid
    required: true,
    minRows: 1,
    maxRows: 1,
    columns: SOCIETY_COLUMNS,
  },
  {
    id: "basicInfo",
    index: 1,
    excelName: "1. Basic Info (Required)",
    title: "Members",
    subtitle: "One row per flat. This sheet drives every other sheet.",
    icon: "users",
    mode: "grid",
    required: true,
    minRows: 1,
    maxRows: 2000,
    keyColumn: "flatNo*",
    columns: BASIC_INFO_COLUMNS,
  },
  {
    id: "additional",
    index: 2,
    excelName: "2. Additional Details",
    title: "Additional Details",
    subtitle: "Optional. One row per flat, at most.",
    icon: "idcard",
    mode: "grid",
    required: false,
    maxRows: 2000,
    keyColumn: "flatNo*",
    uniqueByKey: true,
    columns: ADDITIONAL_COLUMNS,
  },
  {
    id: "parking",
    index: 3,
    excelName: "3. Parking Slots",
    title: "Parking",
    subtitle: "Optional. Several slots per flat allowed.",
    icon: "car",
    mode: "grid",
    required: false,
    maxRows: 5000,
    keyColumn: "flatNo*",
    columns: PARKING_COLUMNS,
  },
  {
    id: "family",
    index: 4,
    excelName: "4. Family Members",
    title: "Family",
    subtitle: "Optional. Several members per flat allowed.",
    icon: "family",
    mode: "grid",
    required: false,
    maxRows: 8000,
    keyColumn: "flatNo*",
    columns: FAMILY_COLUMNS,
  },
  {
    id: "ownerHistory",
    index: 5,
    excelName: "5. Owner History",
    title: "Owner History",
    subtitle: "Optional. Past owners, for the flat ledger.",
    icon: "history",
    mode: "grid",
    required: false,
    maxRows: 5000,
    keyColumn: "flatNo*",
    columns: OWNER_HISTORY_COLUMNS,
  },
  {
    id: "tenantHistory",
    index: 6,
    excelName: "6. Tenant History",
    title: "Tenant History",
    subtitle: "Optional. Past and current tenants.",
    icon: "key",
    mode: "grid",
    required: false,
    maxRows: 5000,
    keyColumn: "flatNo*",
    columns: TENANT_HISTORY_COLUMNS,
  },
];


// ── Cross-sheet rules ───────────────────────────────────────────────────
// Declared as data so the browser can run them without shipping code.

export const CROSS_RULES = [
  {
    id: "flatMustExist",
    message: "Flat {value} is not in the Members sheet",
    kind: "fk",
    appliesTo: ["additional", "parking", "family", "ownerHistory", "tenantHistory"],
  },
  {
    id: "columnForeignKeys",
    kind: "columnFk",
    // No sheet/column here on purpose: it reads every column's own `fk`
    // descriptor, so it covers sheets added later without being edited.
  },
  {
    id: "ownerScopedEmail",
    kind: "ownerScopedEmail",
    sheet: "basicInfo",
    emailColumn: "emailPrimary*",
    ownerColumn: "ownerName*",
    message:
      'Email "{value}" is already used by a different owner ({other}). ' +
      "Reusing an email is only allowed when the same person owns several flats.",
  },
  {
    id: "oneCurrentTenant",
    kind: "atMostOne",
    sheet: "tenantHistory",
    groupBy: "flatNo*",
    whenColumn: "isCurrent",
    whenValue: "Yes",
    message: "Flat {group} has more than one tenant marked Current",
  },
  // ── Plan 02 §21: overlapping periods ────────────────────────────────────
  //
  // Per-row date validation already catches "Owned To before Owned From"
  // (the `afterField` on the column). What it cannot see is two rows for the
  // SAME flat whose periods overlap — two people recorded as owning one flat
  // at once, or two tenancies running together.
  //
  // That is not a typo, it is a contradiction: the flat's history then says
  // two different things about the same date, and every report built on it
  // inherits the ambiguity. It has to be caught at import, because afterwards
  // there is no way to tell which row is wrong.
  //
  // An OPEN period (no end date) is treated as running to the present, so a
  // second owner starting while the previous one is still open is an overlap
  // — which is exactly the "forgot to close the last owner" case.
  {
    id: "ownerHistoryNoOverlap",
    kind: "noOverlap",
    sheet: "ownerHistory",
    groupBy: "flatNo*",
    startColumn: "ownershipStartDate",
    endColumn: "ownershipEndDate",
    message:
      "Flat {group}: this ownership period overlaps another row ({other}). " +
      "Close the previous owner's period before the next one starts.",
  },
  {
    id: "tenantHistoryNoOverlap",
    kind: "noOverlap",
    sheet: "tenantHistory",
    groupBy: "flatNo*",
    startColumn: "startDate",
    endColumn: "endDate",
    message:
      "Flat {group}: this tenancy overlaps another row ({other}). " +
      "A flat cannot have two tenants at the same time.",
  },
  {
    // A number plate belongs to one vehicle, society-wide.
    id: "parkingVehicleUnique",
    kind: "uniqueByKey",
    sheet: "parking",
    column: "vehicleNumber",
    message: "Vehicle {value} is listed more than once",
  },
  {
    id: "additionalOnePerFlat",
    kind: "uniqueByKey",
    sheet: "additional",
    column: "flatNo*",
    message: "Flat {value} appears more than once in Additional Details",
  },
];

/** Everything the client needs, in one payload. */
export function buildClientSchema() {
  return {
    schemaVersion: SCHEMA_VERSION,
    patterns: PATTERNS,
    enums: ENUMS,
    sheets: SHEETS,
    crossRules: CROSS_RULES,
    limits: {
      maxTotalRows: 20000,
      maxPayloadBytes: 4_000_000, // Vercel's hard body limit is 4.5 MB
    },
  };
}

export function getSheet(id) {
  return SHEETS.find((s) => s.id === id);
}
