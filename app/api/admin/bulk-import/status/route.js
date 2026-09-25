/**
 * GET /api/admin/bulk-import/status?importRunId=...
 * Server-backed progress for the bulk-import UI — replaces the old fake
 * client-side setTimeout animation. Survives refresh: the UI just needs the
 * importRunId (kept in sessionStorage) to resume polling real state.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import BulkImportRun from "@/models/BulkImportRun";
import { validateAdminRequest } from "@/lib/admin-middleware";

export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  await connectDB();
  const { searchParams } = new URL(request.url);
  const importRunId = searchParams.get("importRunId");
  if (!importRunId)
    return NextResponse.json({ error: "importRunId is required" }, { status: 400 });
  const run = await BulkImportRun.findOne({ importRunId }).lean();
  if (!run)
    return NextResponse.json({ error: "No import found for this key" }, { status: 404 });
  return NextResponse.json({
    importRunId: run.importRunId,
    status: run.status,
    stage: run.stage,
    processedCount: run.processedCount,
    totalCount: run.totalCount,
    warnings: run.warnings,
    errors: run.errorMessages,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    // SEC-20: NEEDS_REPAIR is a terminal state with a real payload — the
    // society, members and bills exist. Withholding `result` would leave the
    // wizard showing a spinner over an import that has already finished.
    result: ["COMPLETED", "FAILED", "ROLLED_BACK", "NEEDS_REPAIR"].includes(run.status)
      ? run.result
      : null,
    repairDetail: run.repairDetail || null,
  });
}
