import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";
import connectDB from "@/lib/mongodb";
import TakeoverGrant from "@/models/TakeoverGrant";
import { endGrant, sanitizeGrant } from "@/lib/superadmin/takeover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/superadmin/takeover/:id/end — superadmin ends their own active
// session. Clears the impersonation cookie from THIS (the superadmin's)
// browser too — it was never the society admin's cookie to begin with.
export async function POST(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }

  try {
    await connectDB();
    const grant = await TakeoverGrant.findById(id).lean();
    if (!grant) return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    if (grant.status !== "active") {
      // Not an error — someone (the admin, an expiry check) may have
      // already ended it a moment ago. Report the current state so the UI
      // can just reflect it instead of showing a failure.
      return NextResponse.json({ grant: sanitizeGrant(grant), alreadyEnded: true });
    }

    const ended = await endGrant(grant, { endedBy: "superadmin" });
    const res = NextResponse.json({ ok: true, alreadyEnded: !ended });
    res.cookies.set("token", "", { httpOnly: true, maxAge: 0, path: "/" });
    return res;
  } catch (error) {
    console.error("takeover end (superadmin) failed:", error);
    return NextResponse.json({ error: error.message || "Could not end the session. Try again." }, { status: 500 });
  }
}
