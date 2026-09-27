import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import ImportStaging from "@/models/ImportStaging";
import { getSocietySnapshot } from "@/lib/import/societySnapshot";
import ExcelJS from "exceljs";
import { authorize } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/members/preview-import
 *
 * ## Two bugs fixed here, one of which breaks this feature entirely on Vercel
 *
 * ### 1. It wrote the uploaded file to disk (BROKEN IN PRODUCTION)
 *
 *     const tempDir = join(process.cwd(), 'temp');
 *     const tempFilePath = join(tempDir, `preview-${Date.now()}.xlsx`);
 *     await writeFile(tempFilePath, buffer);
 *     ...
 *     return NextResponse.json({ tempFilePath, ... })
 *
 * ...and `confirm-import` then read that path back. On Vercel the filesystem
 * outside `/tmp` is read-only, so `writeFile` throws EROFS and preview 500s
 * every time. Even writing to `/tmp` would not save it: preview and confirm
 * are separate requests that routinely land on different instances, and the
 * instance is often recycled while the admin reads the preview grid — which is
 * the whole purpose of the step.
 *
 * This works flawlessly on localhost, which is why it shipped.
 *
 * Now the *parsed rows* are staged in Mongo with a 1-hour TTL. Instance
 * independent, smaller than the .xlsx, and it means confirm does no Excel
 * parsing at all (previously every import parsed the same workbook twice).
 *
 * ### 2. Every click re-read the entire member collection
 *
 *     const existingMembers = await Member.find({ societyId }).select(...)
 *
 * Unbounded, uncached, on every preview. Excel validation is iterative by
 * nature — upload, see errors, fix, re-upload — so a single import session ran
 * this 4-6 times. Now it comes from a 5-minute cached snapshot shared with
 * every other validator.
 *
 * ### 3. Identical re-uploads are now free
 *
 * The file is hashed. If the same admin re-uploads a byte-identical sheet
 * (extremely common: they click twice, or fix a different file and re-upload
 * the wrong one) the cached validation is returned with zero parsing and zero
 * database reads.
 */
export async function POST(request) {
  try {
    const gate = await authorize(request, "member.member.import");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role === "Accountant") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    // Below Vercel's 4.5MB edge limit, so oversized sheets fail with our
    // message rather than a bodyless platform rejection.
    if (file.size > 4 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Max 4MB. Split the sheet or remove embedded images." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(buffer).digest("hex");

    // --- Cache hit: same file, same society, still staged -------------------
    const existing = await ImportStaging.findOne({
      societyId: decoded.societyId,
      kind: "members",
      fileHash,
      consumedAt: null,
    }).lean();

    if (existing) {
      return NextResponse.json({
        success: true,
        cached: true,
        stagingId: String(existing._id),
        rowCount: existing.rowCount,
        validation: existing.validation,
        sheets: existing.validation?.sheets ?? null,
        isEnhancedTemplate: existing.validation?.isEnhancedTemplate ?? false,
      });
    }

    // --- Parse --------------------------------------------------------------
    if (!buffer.length) {
      return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch {
      return NextResponse.json(
        { error: "That file is not a valid Excel workbook. Upload the .xlsx template." },
        { status: 400 },
      );
    }
    const firstSheet = workbook.worksheets[0];
    if (!firstSheet) {
      return NextResponse.json({ error: "Workbook has no sheets" }, { status: 400 });
    }
    const isEnhancedTemplate = firstSheet.name.includes("Basic Info");

    // The original serialised EVERY cell of EVERY sheet into the response,
    // including address/row/col metadata per cell. For a 500-row enhanced
    // template with six sheets that is a multi-megabyte JSON payload the grid
    // barely uses. Cap it to what the preview grid actually renders.
    const PREVIEW_ROW_CAP = 200;
    const sheets = {};
    workbook.worksheets.forEach((sheet) => {
      const rows = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber > PREVIEW_ROW_CAP) return;
        const cells = [];
        row.eachCell({ includeEmpty: true }, (c) => cells.push(c.value ?? null));
        rows.push(cells);
      });
      sheets[sheet.name] = { rows, truncated: sheet.rowCount > PREVIEW_ROW_CAP, totalRows: sheet.rowCount };
    });

    const basicSheet = isEnhancedTemplate
      ? workbook.getWorksheet("1. Basic Info (Required)") || firstSheet
      : firstSheet;

    // --- Validate against the cached snapshot -------------------------------
    const snapshot = await getSocietySnapshot(decoded.societyId);
    const validation = validateRows(basicSheet, snapshot);
    validation.sheets = sheets;
    validation.isEnhancedTemplate = isEnhancedTemplate;

    // --- Stage --------------------------------------------------------------
    const staged = await ImportStaging.create({
      societyId: decoded.societyId,
      createdBy: decoded.userId,
      kind: "members",
      fileHash,
      fileName: file.name,
      rows: validation.parsedRows,
      validation: { ...validation, parsedRows: undefined },
      rowCount: validation.parsedRows.length,
    });

    return NextResponse.json({
      success: true,
      cached: false,
      // Replaces `tempFilePath`. Pass this to /api/members/confirm-import.
      stagingId: String(staged._id),
      // Kept so an older client that still reads `previewId` does not break.
      previewId: String(staged._id),
      rowCount: staged.rowCount,
      sheets,
      validation: { ...validation, parsedRows: undefined },
      isEnhancedTemplate,
      expiresAt: staged.expiresAt,
    });
  } catch (error) {
    console.error("Preview error:", error);
    return NextResponse.json(
      { error: "Preview failed" },
      { status: 500 },
    );
  }
}

/**
 * Pure function over the sheet + the in-memory snapshot. No database access at
 * all, which is what makes re-validation cheap.
 */
function validateRows(sheet, snapshot) {
  const issues = [];
  const parsedRows = [];
  const validCount = { valid: 0, errors: 0, warnings: 0, duplicates: 0 };
  const norm = (s) => String(s ?? "").trim().toLowerCase();

  const existingFlats = new Set(Object.keys(snapshot.byWingFlat));
  const existingEmailOwner = snapshot.emailOwner;
  const existingPhones = new Set(snapshot.phones);

  const headers = [];
  sheet.getRow(1).eachCell((c) => headers.push(String(c.value).trim()));

  const fileFlats = new Set();
  const fileEmails = new Map();
  const filePhones = new Set();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const rowData = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) rowData[header] = cell.value;
    });

    const get = (k) => String(rowData[k] ?? rowData[`${k}*`] ?? "").trim();
    const flatNo = get("flatNo");
    const wing = get("wing");
    const ownerName = get("ownerName");
    const contactNumber = get("contactNumber");
    const emailPrimary = get("emailPrimary");
    const carpetAreaSqft = Number(rowData["carpetAreaSqft"] ?? rowData["carpetAreaSqft*"] ?? 0);

    if (!flatNo || flatNo === "INSTRUCTIONS:") return;

    const cellIssues = {};
    if (!ownerName) { cellIssues.ownerName = { type: "ERROR", message: "Owner name is required" }; validCount.errors++; }
    if (!emailPrimary) { cellIssues.emailPrimary = { type: "ERROR", message: "Email is required" }; validCount.errors++; }
    else if (!emailPrimary.includes("@")) { cellIssues.emailPrimary = { type: "ERROR", message: "Invalid email format" }; validCount.errors++; }
    if (!contactNumber) { cellIssues.contactNumber = { type: "ERROR", message: "Contact number is required" }; validCount.errors++; }
    else if (contactNumber.length < 10) { cellIssues.contactNumber = { type: "ERROR", message: "Contact must be at least 10 digits" }; validCount.errors++; }
    if (!carpetAreaSqft || carpetAreaSqft <= 0) { cellIssues.carpetAreaSqft = { type: "ERROR", message: "Valid area required (must be > 0)" }; validCount.errors++; }

    const flatKey = `${norm(wing)}-${norm(flatNo)}`;
    if (existingFlats.has(flatKey)) {
      cellIssues.flatNo = { type: "DUPLICATE_DB", message: `Flat ${wing}-${flatNo} already exists in database` };
      validCount.duplicates++;
    }
    const ownerNorm = norm(ownerName);
    const emailNorm = norm(emailPrimary);
    if (emailNorm && existingEmailOwner[emailNorm] && existingEmailOwner[emailNorm] !== ownerNorm) {
      cellIssues.emailPrimary = { type: "DUPLICATE_DB", message: "Email already exists in database for a different owner" };
      validCount.duplicates++;
    }
    if (contactNumber && existingPhones.has(norm(contactNumber))) {
      cellIssues.contactNumber = { type: "DUPLICATE_DB", message: "Phone already exists in database" };
      validCount.duplicates++;
    }

    if (fileFlats.has(flatKey)) {
      cellIssues.flatNo = { type: "DUPLICATE_FILE", message: `Duplicate flat ${wing}-${flatNo} in this file` };
      validCount.duplicates++;
    } else fileFlats.add(flatKey);

    const priorOwner = fileEmails.get(emailNorm);
    if (emailNorm && priorOwner !== undefined && priorOwner !== ownerNorm) {
      cellIssues.emailPrimary = { type: "DUPLICATE_FILE", message: "Duplicate email in file for a different owner" };
      validCount.duplicates++;
    } else if (emailNorm) fileEmails.set(emailNorm, ownerNorm);

    if (contactNumber && filePhones.has(norm(contactNumber))) {
      cellIssues.contactNumber = { type: "DUPLICATE_FILE", message: "Duplicate phone in file" };
      validCount.duplicates++;
    } else if (contactNumber) filePhones.add(norm(contactNumber));

    if (!wing) { cellIssues.wing = { type: "WARNING", message: "Wing not specified (will be empty)" }; validCount.warnings++; }

    if (Object.keys(cellIssues).length === 0) validCount.valid++;
    else issues.push({ sheet: sheet.name, row: rowNumber, flatNo, cellIssues });

    // Stage the normalised row so confirm-import never re-parses the workbook.
    parsedRows.push({
      rowNumber, flatNo, wing, ownerName, contactNumber,
      emailPrimary: emailNorm || null,
      carpetAreaSqft,
      hasBlockingError: Object.values(cellIssues).some((i) => i.type === "ERROR"),
      raw: rowData,
    });
  });

  return { issues, validCount, parsedRows };
}
