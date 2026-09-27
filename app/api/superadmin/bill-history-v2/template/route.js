// GET /api/superadmin/bill-history-v2/template?societyId=...
// Downloads the server-prefilled 4-sheet Bill History template for one
// society, per final_audit_fix_plan/bill-history-upgrade.md §39. Superadmin
// only. Read-only — no writes.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { getBillHistoryWindow } from "@/lib/billing/historicalWindow";
import { buildHistoryTemplate } from "@/lib/billing/historicalTemplate";

export async function GET(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;

  const { searchParams } = new URL(request.url);
  const societyId = searchParams.get("societyId");
  if (!societyId) {
    return NextResponse.json({ error: "societyId is required" }, { status: 400 });
  }

  await connectDB();

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
  if (!window.periods.length) {
    return NextResponse.json(
      { error: "This society has no history to import — it onboarded on or before its own financial year start" },
      { status: 400 },
    );
  }

  const members = await Member.find({ societyId, isDeleted: { $ne: true } })
    .select("flatNo wing ownerName openingPrincipal openingInterest advanceCredit")
    .sort({ wing: 1, flatNo: 1 })
    .lean();
  if (!members.length) {
    return NextResponse.json({ error: "No active members found for this society — import members first" }, { status: 400 });
  }

  const buf = await buildHistoryTemplate({ society, members, window });

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="BillHistory_${(society.name || "Society").replace(/[^a-z0-9]+/gi, "_")}.xlsx"`,
    },
  });
}
