/**
 * POST /api/admin/bulk-import/preview
 *
 * Parses the uploaded workbook and runs every check the real import would
 * run — including the DB reads (society name taken? admin/member emails
 * already registered?) — but writes nothing. Returns a full per-row result
 * so the UI can show every sheet's status at once instead of the old
 * "submit, wait, get one error, fix, resubmit" loop.
 *
 * The validated result is cached (BulkImportPreview, 30 min TTL) under a
 * previewId the client gets back. Committing — POST /api/admin/bulk-import
 * with that previewId — reads the cache instead of re-parsing the file and
 * re-running the DB checks, so a retry after a mid-import failure never
 * repeats work this endpoint already did.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { loadWorkbook } from "@/lib/excelParse";
import { runPreviewChecks } from "@/lib/import/bulkImportValidate";
import BulkImportPreview from "@/models/BulkImportPreview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  await connectDB();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  let wb;
  try {
    const bytes = await file.arrayBuffer();
    // Untrusted upload: parsed with exceljs, not xlsx's own reader — xlsx's
    // parser has an unfixed prototype-pollution + ReDoS CVE
    // (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9).
    wb = await loadWorkbook(Buffer.from(bytes));
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read this file as an Excel workbook: ${err.message}` },
      { status: 400 },
    );
  }

  const result = await runPreviewChecks(wb);

  if (result.fatalError) {
    return NextResponse.json({ ok: false, fatalError: result.fatalError }, { status: 422 });
  }

  let previewId = null;
  if (result.ok) {
    previewId = crypto.randomUUID();
    await BulkImportPreview.create({
      previewId,
      societyPayload: result.societyPayload,
      validMembers: result.validMembers,
      // Plan 02 §17
      optional: result.optional,
      existingMemberEmailMap: result.existingMemberEmailMap,
      multiSocietyAdminUserId: result.multiSocietyAdminUserId,
      warnings: result.warnings,
      // SEC-26: persist the verdict and the per-row detail so the commit route
      // can assert on them instead of inferring them from the token's existence.
      ok: result.ok,
      rowResults: result.rowResults,
    });
  }

  return NextResponse.json({
    ok: result.ok,
    previewId,
    society: {
      name: result.societyPayload?.societyName,
      adminName: result.societyPayload?.fullName,
      adminEmail: result.societyPayload?.email,
      errors: result.societyErrors,
      advisories: result.societyAdvisories,
      activeChargesCount: result.activeChargesCount,
    },
    warnings: result.warnings,
    memberRows: result.rowResults,
    summary: {
      total: result.memberRowsTotal,
      ok: result.memberRowsOk,
      warning: result.memberRowsWarning,
      error: result.memberRowsError,
    },
  });
}
