import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import { requireRoles } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import { safeRegex } from "@/lib/query-safety";
export async function GET(request) {
  const gate = await authorize(request, "visitor.visitor.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get("q") || "").trim();
    if (!q) {
      return NextResponse.json({ success: true, flats: [] });
    }
    const rx = safeRegex(q);
    const flats = await Member.find({
      societyId: gate.context.societyId,
      isDeleted: { $ne: true },
      $or: [
        { flatNo: rx },
        { wing: rx },
        { ownerName: rx },
        { tenantName: rx },
      ],
    })
      .select(
        "flatNo wing ownerName tenantName ownershipType currentTenant contactNumber",
      )
      .sort({ wing: 1, flatNo: 1 })
      .limit(20)
      .lean();
    return NextResponse.json({ success: true, flats });
  } catch (err) {
    console.error("Security flat search error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
