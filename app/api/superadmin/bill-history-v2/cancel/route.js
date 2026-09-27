// POST /api/superadmin/bill-history-v2/cancel
// body: { importRunId }
// Explicit "abandon this onboarding" action — deletes the society, members,
// billing heads, and any bills already tagged with this importRunId. Only
// works before the run reaches pointOfNoReturn (i.e. before emails have
// gone out) — final_audit_fix_plan/bill-history-upgrade.md §40. Superadmin
// only.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import BulkImportRun from "@/models/BulkImportRun";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { compensateImportRun } from "@/lib/onboarding-rollback";

export async function POST(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;

  await connectDB();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }
  const { importRunId } = body || {};
  if (!importRunId) {
    return NextResponse.json({ error: "importRunId is required" }, { status: 400 });
  }

  const run = await BulkImportRun.findOne({ importRunId }).lean();
  if (!run) {
    return NextResponse.json({ error: "No import run found for that id" }, { status: 404 });
  }
  if (run.pointOfNoReturn) {
    return NextResponse.json(
      { error: "This onboarding already finished — emails may already be sent. It cannot be cancelled/deleted from here." },
      { status: 409 },
    );
  }

  await compensateImportRun(importRunId);
  await BulkImportRun.updateOne(
    { importRunId },
    { $set: { status: "ROLLED_BACK", stage: "Cancelled by superadmin", finishedAt: new Date() } },
  );

  return NextResponse.json({ cancelled: true });
}
