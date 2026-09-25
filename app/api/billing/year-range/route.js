import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { authorizeAny } from "@/lib/rbac/authorize";
// Read on every admin dashboard load to seed the FY selector — not just the
// View Bills page, same cross-page-dependency pattern as financial-years.
export async function GET(request) {
  const gate = await authorizeAny(request, [
    "billing.bill.view",
    "dashboard.admin.view",
    "dashboard.stats.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const cacheKey = `billing:year-range:${decoded.societyId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return NextResponse.json(cached);
    await connectDB();
    const [minDoc, maxDoc] = await Promise.all([
      Bill.findOne({ societyId: decoded.societyId })
        .sort({ billYear: 1, billMonth: 1 })
        .select("billYear billMonth")
        .lean(),
      Bill.findOne({ societyId: decoded.societyId })
        .sort({ billYear: -1, billMonth: -1 })
        .select("billYear billMonth")
        .lean(),
    ]);
    const now = new Date();
    const responseData = {
      minYear: minDoc?.billYear || now.getFullYear(),
      minMonth: minDoc ? minDoc.billMonth + 1 : 1, // billMonth is 0-indexed → convert to 1-12
      maxYear: maxDoc?.billYear || now.getFullYear(),
      maxMonth: maxDoc ? maxDoc.billMonth + 1 : now.getMonth() + 1, // latest billed month, 1-12
    };
    await cache.set(cacheKey, responseData, 300);
    return NextResponse.json(responseData);
  } catch (err) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
