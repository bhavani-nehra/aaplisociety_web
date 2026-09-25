import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorizeAny } from "@/lib/rbac/authorize";
import { safeRegex } from "@/lib/query-safety";
/**
 * GET /api/billing-simulator/members
 * Returns members for the society with billing-relevant fields only.
 * Supports ?search=<query> for name/flat filtering.
 */
export async function GET(request) {
  try {
    // Also read by the System Tests / Accounting Lab page, not just the real
    // Billing Simulator — same cross-page-dependency pattern as financial-years.
    const gate = await authorizeAny(request, [
      "billing.bill.view",
      "billing.simulator.view",
      "society.systemTests.view",
    ]);
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const { societyId } = decoded;
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim();
    const query = { societyId };
    if (search) {
      const rx = safeRegex(search);
      query.$or = [{ ownerName: rx }, { flatNo: rx }, { wing: rx }];
    }
    const members = await Member.find(query)
      .select(
        "_id flatNo wing ownerName flatType openingBalance openingPrincipal openingInterest advanceCredit carpetAreaSqft parkingSlots contactNumber",
      )
      .sort({ wing: 1, flatNo: 1 })
      .lean();
    const formatted = members.map((m) => ({
      id: m._id.toString(),
      flat: m.wing ? `${m.wing}-${m.flatNo}` : m.flatNo,
      flatNo: m.flatNo,
      wing: m.wing,
      name: m.ownerName,
      flatType: m.flatType || null,
      openingBalance: m.openingBalance || 0,
      openingPrincipal: m.openingPrincipal || 0,
      openingInterest: m.openingInterest || 0,
      advanceCredit: m.advanceCredit || 0,
      carpetAreaSqft: m.carpetAreaSqft || 0,
      parkingSlots: m.parkingSlots || 0,
      contactNumber: m.contactNumber,
    }));
    return NextResponse.json({ success: true, members: formatted });
  } catch (error) {
    console.error("billing-simulator/members error:", error);
    return NextResponse.json(
      { error: "Failed to fetch members", details: error.message },
      { status: 500 },
    );
  }
}
