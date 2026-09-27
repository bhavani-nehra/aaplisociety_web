/**
 * GET /api/admin/bulk-import/template
 * 7-sheet Excel (Society + 6 member sheets). Shops, amenities, vehicles and
 * emergency contacts are managed in-app by the society admin, not imported.
 *   Sheet1  = Society (identical to society_upload_template.xlsx)
 *   Sheets 2-7 = Members (identical structure to member_import_template.xlsx)
 */
import { NextResponse } from "next/server";
import { buildWorkbook, addSheetFromAoa, workbookBuffer } from "@/lib/excelParse";
import { validateAdminRequest } from "@/lib/admin-middleware";

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
    ["flatNo*", "slotNumber", "type", "vehicleType", "vehicleNumber", "vehicleName"],
    ["1310", "P-A-101", "Stilt", "Four-Wheeler", "MH05AB1234", "Swift"],
    ["1310", "P-A-102", "Open", "Two-Wheeler", "", ""],
    ["1310", "P-A-103", "", "", "", ""],
    ["1310", "P-A-104", "Covered", "Four-Wheeler", "", ""],
    [],
    ["INSTRUCTIONS"],
    ["Required: flatNo* and slotNumber only. type defaults to Open, vehicleType to Two-Wheeler."],
    ["vehicleNumber / vehicleName are optional. Everything else (emergency contacts, shops, amenities) is added in the app."],
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
  const buf = await workbookBuffer(wb);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="BulkImport_Template.xlsx"',
    },
  });
}