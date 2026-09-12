import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import TakeoverGrant from "@/models/TakeoverGrant";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { endGrant } from "@/lib/superadmin/takeover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/takeover/:id/end — ends an active session. Reachable with
// either a normal admin token (the real society admin, from their own
// dashboard banner) or the impersonation token itself (the superadmin
// ending their own session from inside the dashboard they're viewing) —
// both carry a valid Admin/Secretary role for this society, which is all
// this route checks. `endedBy` is attributed by which one actually called
// it, not assumed. Immediate: the next request on the impersonation token
// 401s via the existing revocation denylist (isRevoked in middleware.js).
export async function POST(request, { params }) {
  const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
  if (!auth.valid) return auth;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }

  try {
    await connectDB();
    const grant = await TakeoverGrant.findById(id).lean();
    if (!grant || String(grant.societyId) !== String(auth.user.societyId)) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    if (grant.status !== "active") {
      // Already ended (by the other side, or it just expired) — not a
      // failure from the caller's point of view, report it plainly.
      const res = NextResponse.json({ ok: true, alreadyEnded: true, status: grant.status });
      if (auth.user.takeover) res.cookies.set("token", "", { httpOnly: true, maxAge: 0, path: "/" });
      return res;
    }

    const ended = await endGrant(grant, { endedBy: auth.user.takeover ? "superadmin" : "society_admin" });

    const res = NextResponse.json({ ok: true, alreadyEnded: !ended });
    // If this call came from inside the impersonated session itself, clear
    // that browser's cookie too so it can't keep rendering the now-dead
    // dashboard until the next navigation.
    if (auth.user.takeover) {
      res.cookies.set("token", "", { httpOnly: true, maxAge: 0, path: "/" });
    }
    return res;
  } catch (error) {
    console.error("takeover end failed:", error);
    return NextResponse.json({ error: error.message || "Could not end the session. Try again." }, { status: 500 });
  }
}
