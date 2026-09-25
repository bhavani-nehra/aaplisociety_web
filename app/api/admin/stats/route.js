import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import { getAdminModels } from "@/lib/admin-models";
import { validateAdminRequest } from "@/lib/admin-middleware";
import cache from "@/lib/cache";

// GET /api/admin/stats — platform-wide counts for the superadmin dashboard.
//
// SEC-21: converged off a hand-rolled copy of the superadmin check onto the
// shared `validateAdminRequest`, which every other superadmin route uses.
//
// Deliberately NOT converged onto authorize(): this route is cross-society by
// design (it counts every society, member and bill on the platform), while
// authorize() is the society-scoped RBAC gate and refuses a token with no
// society context. Sharing the superadmin helper is the right convergence for
// this family; forcing it into RBAC would be the wrong one.
//
// The inline version also read ADMIN_JWT_SECRET directly, which meant it could
// not benefit from any hardening added to requireSuperAdmin — it had to be
// remembered separately, and was not.
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { Export } = await getAdminModels();
    const cacheKey = `admin:stats:global`;
    const cached = await cache.get(cacheKey);
    if (cached) return NextResponse.json(cached);
    const [societyCount, memberCount, billCount, exportCount] =
      await Promise.all([
        Society.countDocuments({ isDeleted: false }),
        Member.countDocuments({}),
        Bill.countDocuments({}),
        Export.countDocuments({ isRestored: false }),
      ]);
    const responseData = {
      success: true,
      societies: societyCount,
      members: memberCount,
      bills: billCount,
      exports: exportCount,
    };
    await cache.set(cacheKey, responseData, 30);
    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 },
    );
  }
}
