import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import TermsAcceptance from "@/models/TermsAcceptance";
import AuditLog from "@/models/AuditLog";
import User from "@/models/User";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { BUNDLE_VERSION } from "@/lib/legal/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/legal/accept — records this Society's acceptance of the
// current document bundle (Terms of Service, Privacy Policy, Refund &
// Cancellation Policy — accepted together, see lib/legal/documents.js).
export async function POST(request) {
  const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
  if (!auth.valid) return auth;

  try {
    await connectDB();
    const admin = await User.findById(auth.user.userId).select("name").lean();

    // Upsert: a duplicate click (double-submit, a second admin accepting
    // after the first already did) just confirms the same record rather
    // than erroring or creating a second row for the same version.
    const record = await TermsAcceptance.findOneAndUpdate(
      { societyId: auth.user.societyId, bundleVersion: BUNDLE_VERSION },
      {
        $setOnInsert: {
          acceptedByUserId: auth.user.userId,
          acceptedByName: admin?.name || "Unknown",
          acceptedAt: new Date(),
          ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
          userAgent: request.headers.get("user-agent") || null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await AuditLog.create({
      userId: auth.user.userId,
      societyId: auth.user.societyId,
      action: "TERMS_ACCEPTED",
      newData: { bundleVersion: BUNDLE_VERSION, acceptedByName: record.acceptedByName },
    });

    return NextResponse.json({ ok: true, bundleVersion: BUNDLE_VERSION, acceptedAt: record.acceptedAt });
  } catch (error) {
    console.error("legal accept failed:", error);
    return NextResponse.json({ error: error.message || "Could not record acceptance. Try again." }, { status: 500 });
  }
}
