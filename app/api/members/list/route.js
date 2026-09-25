//app/api/members/list/route.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { authorizeAny } from "@/lib/rbac/authorize";
import { safeRegex } from "@/lib/query-safety";
// Read by several finance/billing/commercial pages to resolve member names
// against transactions, not just the dedicated View Members page — same
// cross-page-dependency pattern as financial-years.
const MEMBER_VIEW_IDS = [
  "member.member.view",
  "finance.receipts.view",
  "finance.payments.view",
  "finance.payment.view",
  "finance.ledger.view",
  "billing.config.view",
  "billing.template.view",
  "billing.dashboard.view",
  "commercial.admin.view",
];
export async function GET(request) {
  try {
    const gate = await authorizeAny(request, MEMBER_VIEW_IDS);
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
    const searchParams = new URL(request.url).searchParams;
    const page = parseInt(searchParams.get("page")) || 1;
    const limit = parseInt(searchParams.get("limit")) || 1000;
    const search = searchParams.get("search");
    if (decoded.role === "Member") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const societyId = decoded.societyId;
    // ✅ UNIQUE CACHE KEY (VERY IMPORTANT)
    const cacheKey = `members:list:${societyId}:p${page}:l${limit}:s${search || "all"}`;
    const cached = await cache.get(cacheKey);
    if (cached) return NextResponse.json(cached);
    const query = { societyId };
    if (search) {
      // FIXED: searched and sorted on `roomNo`, which is not a field on
      // models/Member.js (it is `flatNo`), so searching by flat number never
      // matched anything and the list came back in insertion order.
      const rx = safeRegex(search);
      query.$or = [
        { flatNo: rx },
        { ownerName: rx },
        { wing: rx },
        { contactNumber: rx },
      ];
    }
    const skip = (page - 1) * limit;
    const [members, total] = await Promise.all([
      Member.find(query)
        .sort({ wing: 1, flatNo: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Member.countDocuments(query),
    ]);
    const responseData = {
      members,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
    await cache.set(cacheKey, responseData, 180);
    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Fetch members error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
