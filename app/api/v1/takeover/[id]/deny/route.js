import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import TakeoverGrant from "@/models/TakeoverGrant";
import AuditLog from "@/models/AuditLog";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { sanitizeGrant } from "@/lib/superadmin/takeover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/takeover/:id/deny — society admin declines the request
// outright (works from either the initial review or the OTP step — the
// "Cancel" button on the OTP screen calls this same route).
export async function POST(request, { params }) {
  const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
  if (!auth.valid) return auth;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }

  try {
    await connectDB();
    const grant = await TakeoverGrant.findOneAndUpdate(
      {
        _id: id,
        societyId: auth.user.societyId,
        status: { $in: ["awaiting_consent", "pending_otp"] },
      },
      { $set: { status: "denied", endedAt: new Date(), endedBy: "society_admin" }, $unset: { mintedTokenOnce: "" } },
      { new: true },
    );
    if (!grant) {
      const existing = await TakeoverGrant.findById(id).lean();
      if (!existing || String(existing.societyId) !== String(auth.user.societyId)) {
        return NextResponse.json({ error: "Grant not found" }, { status: 404 });
      }
      return NextResponse.json({ error: `Grant is already ${existing.status}` }, { status: 409 });
    }

    await AuditLog.create({
      userId: auth.user.userId,
      societyId: grant.societyId,
      action: "TAKEOVER_DENIED",
      newData: { grantId: grant._id },
    });

    return NextResponse.json({ grant: sanitizeGrant(grant.toObject()) });
  } catch (error) {
    console.error("takeover deny failed:", error);
    return NextResponse.json({ error: error.message || "Could not deny the request. Try again." }, { status: 500 });
  }
}
