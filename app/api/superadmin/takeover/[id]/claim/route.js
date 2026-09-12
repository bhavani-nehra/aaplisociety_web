import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";
import connectDB from "@/lib/mongodb";
import TakeoverGrant from "@/models/TakeoverGrant";
import AuditLog from "@/models/AuditLog";
import { syncExpiry, sanitizeGrant } from "@/lib/superadmin/takeover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/superadmin/takeover/:id/claim — the superadmin's browser polls
// this once a grant shows status "active". First caller to arrive gets the
// impersonation token set as their own `token` cookie and the grant's
// one-time token field cleared; every call after that just confirms the
// session is live (no token — it's already been claimed).
export async function POST(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }

  try {
    await connectDB();
    let grant = await TakeoverGrant.findById(id).lean();
    // Only the SuperAdmin who requested this grant may claim it — the
    // society admin consented to that specific requester (shown by name
    // in the OTP email and consent modal), not to "any SuperAdmin". 404,
    // not 403: a non-owner gets the same response as a nonexistent grant,
    // so this endpoint can't be used to probe which grant ids exist.
    if (!grant || String(grant.requestedBy) !== String(validation.admin.userId)) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    grant = await syncExpiry(grant);

    if (grant.status !== "active") {
      return NextResponse.json({ grant: sanitizeGrant(grant) });
    }

    // Atomic fetch-and-clear: if two claim polls land at once (double tab,
    // a retry racing the original), only one of them gets back a non-null
    // mintedTokenOnce and only that one sets the cookie / writes the
    // ACTIVATED entry. The other sees it already gone and just confirms
    // the session is live.
    const claimed = await TakeoverGrant.findOneAndUpdate(
      { _id: id, mintedTokenOnce: { $ne: null } },
      { $unset: { mintedTokenOnce: "" } },
      { new: false, projection: { mintedTokenOnce: 1 } },
    );

    const res = NextResponse.json({ grant: sanitizeGrant(grant) });

    if (claimed?.mintedTokenOnce) {
      res.cookies.set("token", claimed.mintedTokenOnce, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        expires: new Date(grant.expiresAt),
      });
      await AuditLog.create({
        societyId: grant.societyId,
        action: "TAKEOVER_ACTIVATED",
        newData: { grantId: grant._id, claimedBy: validation.admin.userId },
      });
    }

    return res;
  } catch (error) {
    console.error("takeover claim failed:", error);
    return NextResponse.json({ error: error.message || "Could not open the session. Try again." }, { status: 500 });
  }
}
