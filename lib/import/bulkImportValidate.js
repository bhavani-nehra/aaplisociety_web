// lib/import/bulkImportValidate.js
//
// Everything about turning an uploaded workbook into "is this importable,
// row by row" lives here — the ONE place, not duplicated between the
// preview endpoint and the commit endpoint. That duplication is exactly
// what caused the role-seeding duplicate-role incident earlier this
// session; not repeating it here.
//
// runPreviewChecks() does every check the real import will do — including
// the DB reads (society name taken, admin/member emails already
// registered) — but writes nothing. Its full result is cached by the
// preview route (see app/api/admin/bulk-import/preview/route.js +
// models/BulkImportPreview.js) so the commit step can read it back and
// skip re-querying the DB for things already confirmed seconds earlier.

import Society from "@/models/Society";
import User from "@/models/User";
import { worksheetToJson } from "@/lib/excelParse";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function rowToSocietyPayload(row) {
  const charges = [
    {
      label: "Maintenance Charges",
      type: "Per Sq Ft",
      vehicleType: null,
      value: parseFloat(row["Maintenance Rate (Per Sq Ft)"]) || 0,
      isActive: true,
    },
    {
      label: "Sinking Fund",
      type: "Per Sq Ft",
      vehicleType: null,
      value: parseFloat(row["Sinking Fund Rate (Per Sq Ft)"]) || 0,
      isActive: true,
    },
    {
      label: "Repair Fund",
      type: "Per Sq Ft",
      vehicleType: null,
      value: parseFloat(row["Repair Fund Rate (Per Sq Ft)"]) || 0,
      isActive: true,
    },
    {
      label: "Water Charges",
      type: "Fixed",
      vehicleType: null,
      value: parseFloat(row["Water Charges (Fixed)"]) || 0,
      isActive: true,
    },
    {
      label: "Security Charges",
      type: "Fixed",
      vehicleType: null,
      value: parseFloat(row["Security Charges (Fixed)"]) || 0,
      isActive: true,
    },
    {
      label: "Electricity Charges",
      type: "Fixed",
      vehicleType: null,
      value: parseFloat(row["Electricity Charges (Fixed)"]) || 0,
      isActive: true,
    },
    {
      label: "Open Parking - Two Wheeler",
      type: "Per Vehicle",
      vehicleType: "Two-Wheeler",
      value: parseFloat(row["Open Parking TW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Open Parking TW (Per Vehicle)"]) > 0,
    },
    {
      label: "Open Parking - Four Wheeler",
      type: "Per Vehicle",
      vehicleType: "Four-Wheeler",
      value: parseFloat(row["Open Parking FW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Open Parking FW (Per Vehicle)"]) > 0,
    },
    {
      label: "Covered Parking - Two Wheeler",
      type: "Per Vehicle",
      vehicleType: "Two-Wheeler",
      value: parseFloat(row["Covered Parking TW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Covered Parking TW (Per Vehicle)"]) > 0,
    },
    {
      label: "Covered Parking - Four Wheeler",
      type: "Per Vehicle",
      vehicleType: "Four-Wheeler",
      value: parseFloat(row["Covered Parking FW (Per Vehicle)"]) || 0,
      isActive: parseFloat(row["Covered Parking FW (Per Vehicle)"]) > 0,
    },
  ];
  return {
    societyName: row["Society Name"]?.toString().trim(),
    registrationNo: row["Registration No"]?.toString().trim() || "",
    address: row["Address"]?.toString().trim() || "",
    dateOfRegistration: row["Date of Registration"]?.toString().trim() || "",
    panNo: row["PAN No"]?.toString().trim() || "",
    tanNo: row["TAN No"]?.toString().trim() || "",
    fullName: row["Admin Full Name"]?.toString().trim(),
    email: row["Admin Email"]?.toString().trim().toLowerCase(),
    personOfContact: row["Contact Person"]?.toString().trim() || "",
    contactEmail: row["Contact Email"]?.toString().trim() || "",
    contactPhone: row["Contact Phone"]?.toString().trim() || "",
    config: {
      charges,
      interestRate: parseFloat(row["Interest Rate %"]) || 21,
      billGenerationDay: parseInt(row["Bill Creation Day*"]),
      paymentUploadDay: parseInt(row["Payment Upload Day*"]),
      billDueDay: parseInt(row["Bill Due Day*"]),
      interestAfterDays:
        parseInt(row["Interest Starts After Due Date (Days)"]) || 15,
    },
  };
}

function parseDateOrNull(value) {
  if (!value && value !== 0) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function yes(value) {
  return ["yes", "true", "1", "y"].includes(String(value ?? "").trim().toLowerCase());
}

/**
 * Walks every row of the Basic Info sheet and classifies each one — never
 * stops at the first bad row, so a preview can show "27 of 30 ready, 3 need
 * fixing" instead of one error at a time. `rowResults` is the ordered,
 * UI-facing view; `members`/`errors` are the same data reshaped for the
 * existing Phase 3 creation code, which only ever needed the valid ones.
 */
export function parseMemberRows(
  basicInfoRows,
  parkingByFlat,
  additionalByFlat = {},
  familyByFlat = {},
  ownersByFlat = {},
  tenantsByFlat = {},
) {
  const members = [];
  const errors = [];
  const rowResults = [];
  const seenFlats = new Set();
  const seenEmails = new Map(); // email -> normalized ownerName it was first seen with
  for (let i = 0; i < basicInfoRows.length; i++) {
    const row = basicInfoRows[i];
    const rowNum = i + 2;
    // The template separates real data from the trailing instructions/notes
    // block, but not reliably with one fully blank row — the notes text
    // (e.g. "* = Required fields", "RULE: ...", "openingPrincipal = ...")
    // often lands directly in the flatNo* column with every other column
    // blank. That shape — flatNo* has text, nothing else on the row does —
    // is exactly what a real flat can never look like, so it's the actual
    // signal to stop, not a literal blank row or the word "INSTRUCTION".
    if (Object.values(row).every((v) => v === "" || v == null)) break;
    const flatNo = String(row["flatNo*"] || row["flatNo"] || "").trim();
    const wing = String(row["wing"] || "").trim();
    const ownerNameRaw = String(row["ownerName*"] || row["ownerName"] || "").trim();
    const contactRaw = String(row["contactNumber*"] || row["contactNumber"] || "").trim();
    const areaRaw = String(row["carpetAreaSqft*"] || row["carpetAreaSqft"] || "").trim();
    const looksLikeTrailingNote =
      flatNo && !wing && !ownerNameRaw && !contactRaw && !areaRaw;
    if (
      looksLikeTrailingNote ||
      flatNo.toUpperCase().startsWith("INSTRUCTION") ||
      flatNo === "flatNo*"
    ) {
      // Once the notes block starts, every row after it is notes too —
      // stop entirely rather than skip-and-continue, or a real data row
      // typed below the notes by mistake would be silently swallowed
      // instead of imported or flagged.
      break;
    }
    if (!flatNo) {
      const msg = "Flat No is required — this row is otherwise blank or the flat number wasn't filled in";
      errors.push({ label: `Row ${rowNum}`, errors: [msg] });
      rowResults.push({ rowNum, flatNo: "", wing: "", ownerName: ownerNameRaw, status: "error", messages: [msg] });
      continue;
    }
    const label = `Row ${rowNum} (${wing}-${flatNo})`;
    // Required field checks
    const rowErrors = [];
    if (!ownerNameRaw) rowErrors.push("Owner Name is required");
    if (!contactRaw) rowErrors.push("Contact Number is required");
    const carpetArea = parseFloat(
      row["carpetAreaSqft*"] || row["carpetAreaSqft"] || 0,
    );
    if (!carpetArea || carpetArea <= 0)
      rowErrors.push("Carpet Area (Sq Ft) must be greater than 0");
    const emailRaw = String(row["emailPrimary*"] || row["emailPrimary"] || "")
      .trim()
      .toLowerCase();
    if (emailRaw && !EMAIL_RE.test(emailRaw))
      rowErrors.push(`Email "${emailRaw}" doesn't look like a real email address — check for a missing @ or a typo`);
    const flatKey = `${wing.toLowerCase()}-${flatNo.toLowerCase()}`;
    if (seenFlats.has(flatKey)) {
      rowErrors.push(`Duplicate flat ${wing}-${flatNo} in member sheet`);
    } else {
      seenFlats.add(flatKey);
    }
    if (emailRaw) {
      // One person can legitimately own/rent multiple flats in the same
      // society and reuse the same email across those rows — only flag it
      // as a mistake when the SAME email shows up under a DIFFERENT owner
      // name (the actual signal of a copy-paste error), not on every reuse.
      const ownerNameNorm = ownerNameRaw.toLowerCase();
      const priorOwnerName = seenEmails.get(emailRaw);
      if (priorOwnerName !== undefined && priorOwnerName !== ownerNameNorm) {
        rowErrors.push(
          `Duplicate email "${emailRaw}" in member sheet (used by a different owner name)`,
        );
      } else {
        seenEmails.set(emailRaw, ownerNameNorm);
      }
    }
    if (rowErrors.length) {
      errors.push({ label, errors: rowErrors });
      rowResults.push({ rowNum, flatNo, wing, ownerName: ownerNameRaw, status: "error", messages: rowErrors });
      continue;
    }
    const openingPrincipal = parseFloat(row["openingPrincipal"] || 0) || 0;
    const openingInterest = parseFloat(row["openingInterest"] || 0) || 0;
    const slots = (parkingByFlat[flatNo] || [])
      .map((p) => ({
        slotNumber: String(p["slotNumber"] || "").trim(),
        type: String(p["type"] || "Open").trim(),
        vehicleType: String(p["vehicleType"] || "Two-Wheeler").trim(),
        monthlyBilling: String(p["type"] || "").trim() !== "Stilt",
        vehicleNumber: String(p["vehicleNumber"] || "").trim().toUpperCase(),
        vehicleName: String(p["vehicleName"] || "").trim(),
      }))
      .filter((s) => s.slotNumber);
    const additional = additionalByFlat[flatNo] || {};
    const familyMembers = (familyByFlat[flatNo] || []).map((f) => ({
      name: String(f.name || "").trim(),
      relation: String(f.relation || "").trim(),
      age: f.age === "" || f.age == null ? undefined : Number(f.age),
      contactNumber: String(f.contactNumber || "").trim(),
      occupation: String(f.occupation || "").trim(),
    })).filter((f) => f.name);
    const ownerHistory = (ownersByFlat[flatNo] || []).map((o) => ({
      ownerName: String(o.ownerName || "").trim(),
      contactNumber: String(o.contactNumber || "").trim(),
      emailPrimary: String(o.emailPrimary || "").trim().toLowerCase(),
      panCard: String(o.panCard || "").trim(),
      ownershipStartDate: parseDateOrNull(o.ownershipStartDate),
      ownershipEndDate: parseDateOrNull(o.ownershipEndDate),
      purchaseAmount: Number(o.purchaseAmount || 0),
      saleAmount: Number(o.saleAmount || 0),
      isCurrent: false,
    })).filter((o) => o.ownerName && o.contactNumber && o.ownershipStartDate);
    const allTenants = (tenantsByFlat[flatNo] || []).map((t) => ({
      name: String(t.name || "").trim(),
      contactNumber: String(t.contactNumber || "").trim(),
      email: String(t.email || "").trim().toLowerCase(),
      panCard: String(t.panCard || "").trim(),
      startDate: parseDateOrNull(t.startDate),
      endDate: parseDateOrNull(t.endDate),
      depositAmount: Number(t.depositAmount || 0),
      rentPerMonth: Number(t.rentPerMonth || 0),
      isCurrent: yes(t.isCurrent),
    })).filter((t) => t.name && t.contactNumber && t.startDate);
    const currentTenant = allTenants.find((t) => t.isCurrent) || null;

    const member = {
      flatNo,
      wing,
      floor: row.floor === "" || row.floor == null ? undefined : Number(row.floor),
      ownerName: ownerNameRaw,
      carpetAreaSqft: carpetArea,
      builtUpAreaSqft: additional.builtUpAreaSqft === "" || additional.builtUpAreaSqft == null ? undefined : Number(additional.builtUpAreaSqft),
      flatType: String(row.flatType || "2BHK").trim(),
      ownershipType: String(row.ownershipType || "Owner-Occupied").trim(),
      contactNumber: contactRaw,
      emailPrimary: emailRaw || null,
      alternateContact: String(additional.alternateContact || "").trim(),
      whatsappNumber: String(additional.whatsappNumber || "").trim(),
      emailSecondary: String(additional.emailSecondary || "").trim().toLowerCase(),
      panCard: String(additional.panCard || "").trim(),
      // aadhaar deliberately absent — no longer collected (D1).
      possessionDate: parseDateOrNull(additional.possessionDate),
      openingPrincipal,
      openingInterest,
      openingBalance: parseFloat((openingPrincipal + openingInterest).toFixed(2)),
      parkingSlots: slots,
      familyMembers,
      ownerHistory,
      tenantHistory: allTenants.filter((t) => !t.isCurrent),
      currentTenant,
      isDeleted: false,
      advanceCredit: 0,
    };
    members.push(member);
    rowResults.push({ rowNum, flatNo, wing, ownerName: ownerNameRaw, status: "pending-ok", messages: [] });
  }
  return { members, errors, rowResults };
}

function rowsFor(wb, sheetNames, prefix) {
  const name = sheetNames.find((n) => n.startsWith(prefix));
  return name ? worksheetToJson(wb.getWorksheet(name), { defval: "" }) : [];
}
function groupByFlat(rows) {
  const out = {};
  for (const r of rows) {
    const flat = String(r["flatNo*"] || r.flatNo || "").trim();
    if (!flat || flat.toUpperCase().startsWith("INSTRUCTION")) continue;
    (out[flat] ||= []).push(r);
  }
  return out;
}

/**
 * The full "is this importable" pass — parsing plus every DB-dependent
 * check — with nothing written. Always returns a complete, ordered result
 * (never throws/early-returns on the first bad row), so a preview screen
 * can show every row's status at once instead of one error per round-trip.
 *
 * @param {object} wb  a loaded workbook (see lib/excelParse.js loadWorkbook)
 */
export async function runPreviewChecks(wb) {
  const sheetNames = wb.worksheets.map((ws) => ws.name);
  if (sheetNames.length < 1) {
    return {
      ok: false,
      fatalError: "File must have at least 1 sheet (Society data in Sheet 'Society')",
    };
  }

  const societySheet = wb.worksheets[0];
  const societyRows = worksheetToJson(societySheet, { defval: "" });
  if (!societyRows.length) {
    return {
      ok: false,
      fatalError: "Sheet 'Society' has no data rows. Fill in the first row with society details.",
    };
  }
  if (societyRows.length > 1) {
    return {
      ok: false,
      fatalError:
        `Sheet 'Society' has ${societyRows.length} data rows — it must have exactly 1. ` +
        `The template ships with a pre-filled SAMPLE row as an example. Edit that row in place ` +
        `with your real data — do NOT add a new row below it, the system always reads row 1.`,
    };
  }

  const societyPayload = rowToSocietyPayload(societyRows[0]);
  const societyErrors = [];
  const societyAdvisories = [];

  if (!societyPayload.societyName) societyErrors.push("Society Name is required");
  if (!societyPayload.fullName) societyErrors.push("Admin Full Name is required");
  if (!societyPayload.email) societyErrors.push("Admin Email is required");
  else if (!EMAIL_RE.test(societyPayload.email))
    societyErrors.push(`Admin Email "${societyPayload.email}" is not valid`);

  const scheduleErrors = [
    ["Bill Creation Day*", societyPayload.config.billGenerationDay],
    ["Payment Upload Day*", societyPayload.config.paymentUploadDay],
    ["Bill Due Day*", societyPayload.config.billDueDay],
  ]
    .filter(([, value]) => !Number.isInteger(value) || value < 1 || value > 31)
    .map(([label]) => `${label} must be a whole number from 1 to 31.`);
  societyErrors.push(...scheduleErrors);

  if (societyPayload.societyName) {
    const nameExists = await Society.findOne({
      name: societyPayload.societyName,
      isDeleted: { $ne: true },
    }).lean();
    if (nameExists)
      societyErrors.push(
        `Society "${societyPayload.societyName}" already exists in the system (id: ${nameExists.societyId})`,
      );
  }

  let multiSocietyAdminUserId = null;
  if (societyPayload.email) {
    const emailExists = await User.findOne({ email: societyPayload.email }).lean();
    if (emailExists) {
      if (["Admin", "SOCIETY_ADMIN"].includes(emailExists.role)) {
        multiSocietyAdminUserId = String(emailExists._id);
        societyAdvisories.push(
          `${societyPayload.email} already has a login — they'll be made Admin of this society too, using that existing account. No new password.`,
        );
      } else {
        societyErrors.push(
          `Admin email "${societyPayload.email}" is already registered to a non-admin account (${emailExists.role}) — choose a different email`,
        );
      }
    }
  }

  const activeCharges = societyPayload.config.charges.filter((c) => c.value > 0);
  const warnings = [];
  if (activeCharges.length === 0) {
    warnings.push(
      "No billing head rates filled in Society sheet — all charges are ₹0. You can update them in Society Config after import, but bills generated will be ₹0 until then.",
    );
  }

  // Member sheets
  const basicInfoSheetName = sheetNames[1];
  const basicInfoRows = basicInfoSheetName
    ? worksheetToJson(wb.getWorksheet(basicInfoSheetName), { defval: "", blankrows: true })
    : [];
  const parkingSheetName = sheetNames[3];
  const parkingByFlat = {};
  if (parkingSheetName && wb.getWorksheet(parkingSheetName)) {
    for (const p of worksheetToJson(wb.getWorksheet(parkingSheetName), { defval: "" })) {
      const fn = String(p["flatNo"] || "").trim();
      if (!fn || fn.toUpperCase().startsWith("INSTRUCTION") || fn === "flatNo") continue;
      if (!parkingByFlat[fn]) parkingByFlat[fn] = [];
      parkingByFlat[fn].push(p);
    }
  }
  const additionalByFlat = Object.fromEntries(
    rowsFor(wb, sheetNames, "2. Additional").map((r) => [String(r["flatNo*"] || r.flatNo || "").trim(), r]),
  );
  const familyByFlat = groupByFlat(rowsFor(wb, sheetNames, "4. Family"));
  const ownersByFlat = groupByFlat(rowsFor(wb, sheetNames, "5. Owner"));
  const tenantsByFlat = groupByFlat(rowsFor(wb, sheetNames, "6. Tenant"));

  const { members: validMembers, errors: memberErrors, rowResults } = parseMemberRows(
    basicInfoRows,
    parkingByFlat,
    additionalByFlat,
    familyByFlat,
    ownersByFlat,
    tenantsByFlat,
  );

  if (rowResults.length === 0) {
    const hint =
      basicInfoRows.length > 0
        ? `Sheet has ${basicInfoRows.length} data rows but none could be parsed — check that the 'flatNo*' column is filled and not renamed.`
        : "Sheet '1. Basic Info (Required)' is empty.";
    societyErrors.push(hint);
  }

  // Member emails that already belong to an account elsewhere attach as a
  // new profile on that existing account instead of erroring — resolved
  // here (once, with a DB read) so commit never needs to re-check it.
  const memberEmails = [
    ...new Set(rowResults.filter((r) => r.status === "pending-ok").map((r) => {
      const m = validMembers.find((vm) => vm.flatNo === r.flatNo && vm.wing === r.wing);
      return m?.emailPrimary;
    }).filter(Boolean)),
  ];
  const existingMemberEmailMap = [];
  if (memberEmails.length > 0) {
    const existingUsers = await User.find(
      { email: { $in: memberEmails } },
      { email: 1, username: 1 },
    ).lean();
    for (const u of existingUsers) {
      existingMemberEmailMap.push([u.email, { _id: String(u._id), username: u.username || null }]);
    }
  }
  const existingEmailSet = new Set(existingMemberEmailMap.map(([e]) => e));

  // Finalize row statuses: pending-ok -> ok or warning (existing account).
  for (const r of rowResults) {
    if (r.status !== "pending-ok") continue;
    const m = validMembers.find((vm) => vm.flatNo === r.flatNo && vm.wing === r.wing);
    if (m?.emailPrimary && existingEmailSet.has(m.emailPrimary)) {
      r.status = "warning";
      r.messages = [`${m.emailPrimary} already has a login — this flat will be added to that existing account, not a new one.`];
    } else {
      r.status = "ok";
    }
  }

  // Plan 02 §21 — interval-overlap validation for ownership/tenancy periods.
  // Declared as a cross-sheet rule in importSchema.js (ownerHistoryNoOverlap /
  // tenantHistoryNoOverlap) and implemented in lib/import/validateWorkbook.js —
  // but that engine is never invoked; this file is the one the preview route
  // actually calls. Without this, two owners with overlapping dates on the
  // same flat imported cleanly. Checked here, in the one place that runs.
  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    const aEndMs = aEnd ? aEnd.getTime() : Infinity;
    const bEndMs = bEnd ? bEnd.getTime() : Infinity;
    return aStart.getTime() <= bEndMs && bStart.getTime() <= aEndMs;
  }
  function checkNoOverlap(byFlat, startKey, endKey, label) {
    for (const [flatNo, rows] of Object.entries(byFlat)) {
      const periods = rows
        .map((r) => ({ start: parseDateOrNull(r[startKey]), end: parseDateOrNull(r[endKey]) }))
        .filter((p) => p.start);
      for (let i = 0; i < periods.length; i++) {
        for (let j = i + 1; j < periods.length; j++) {
          if (rangesOverlap(periods[i].start, periods[i].end, periods[j].start, periods[j].end)) {
            societyErrors.push(
              `Flat ${flatNo}: two ${label} periods overlap. Close the previous one's end date before the next one starts.`,
            );
          }
        }
      }
    }
  }
  checkNoOverlap(ownersByFlat, "ownershipStartDate", "ownershipEndDate", "ownership");
  checkNoOverlap(tenantsByFlat, "startDate", "endDate", "tenancy");

  // A number plate belongs to one vehicle: the same vehicleNumber on two
  // parking rows is a data-entry error.
  const seenPlates = new Set();
  for (const p of Object.values(parkingByFlat).flat()) {
    const plate = String(p["vehicleNumber"] || "").trim().toUpperCase();
    if (!plate) continue;
    if (seenPlates.has(plate)) societyErrors.push(`Vehicle number "${plate}" appears more than once in Parking Slots.`);
    seenPlates.add(plate);
  }

  const hasBlockingMemberErrors = rowResults.some((r) => r.status === "error");
  const ok = societyErrors.length === 0 && !hasBlockingMemberErrors && validMembers.length > 0;

  return {
    ok,
    societyPayload,
    societyErrors,
    societyAdvisories,
    multiSocietyAdminUserId,
    warnings,
    activeChargesCount: activeCharges.length,
    rowResults,
    validMembers,
    existingMemberEmailMap,
    memberRowsTotal: rowResults.length,
    memberRowsOk: rowResults.filter((r) => r.status === "ok").length,
    memberRowsWarning: rowResults.filter((r) => r.status === "warning").length,
    memberRowsError: rowResults.filter((r) => r.status === "error").length,
  };
}
