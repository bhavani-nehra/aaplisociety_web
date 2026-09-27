// POST /api/superadmin/bill-history-v2/preview
// multipart/form-data: file (xlsx), societyId
// Parses + reconstructs, returns the full result. DRY RUN — writes nothing,
// ever. Superadmin only. This is what the admin reviews before Confirm.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { getBillHistoryWindow } from "@/lib/billing/historicalWindow";
import { parseHistoryTemplate } from "@/lib/billing/historicalTemplate";
import { reconstructHistory } from "@/lib/billing/historicalReconstruction";

export async function POST(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;

  await connectDB();

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed upload" }, { status: 400 });
  }

  const file = formData.get("file");
  const societyId = formData.get("societyId");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!societyId) {
    return NextResponse.json({ error: "societyId is required" }, { status: 400 });
  }

  const society = await Society.findById(societyId).lean();
  if (!society) {
    return NextResponse.json({ error: "Society not found" }, { status: 404 });
  }

  let window;
  try {
    window = getBillHistoryWindow(society);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let parsedTemplate;
  try {
    parsedTemplate = await parseHistoryTemplate(bytes);
  } catch (e) {
    // §17 file-security rejections and missing-sheet errors land here —
    // never a raw 500, always a message the admin can act on.
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const result = reconstructHistory({ window, parsedTemplate, society });
  const blocking = result.errors.filter((e) => e.severity !== "WARNING");

  const billCount = Object.values(result.billsByFlat).reduce((a, bills) => a + bills.length, 0);
  const flatCount = Object.keys(result.billsByFlat).length;

  return NextResponse.json({
    window,
    flatCount,
    billCount,
    canCommit: blocking.length === 0 && billCount > 0,
    errors: result.errors,
    warnings: result.warnings,
    billsByFlat: result.billsByFlat,
  });
}
