import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { restoreSocietyFromBundle } from "@/lib/superadmin/societyBundle";
import { logSocietyLifecycle, SOCIETY_LIFECYCLE_ACTIONS } from "@/lib/superadmin/societyAudit";

// POST /api/superadmin/societies/restore
// Body: the exported JSON bundle, re-uploaded as-is.
// The other half of LOOP-05's "future proof" export: if a deleted society
// needs to come back, this recreates it and every collection in the bundle
// with their original _ids rather than a from-scratch re-onboarding.
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const bundle = await request.json().catch(() => null);
    if (!bundle) return NextResponse.json({ error: "Invalid or unreadable export file" }, { status: 400 });
    const result = await restoreSocietyFromBundle(bundle);
    await logSocietyLifecycle({
      action: SOCIETY_LIFECYCLE_ACTIONS.RESTORED,
      societyId: bundle.societyId,
      societyName: bundle.society?.name,
      actorUserId: validation.admin?.userId,
      details: { formatVersion: bundle.formatVersion, counts: result.counts || null },
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("society restore error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
