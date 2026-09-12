import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import TakeoverGrant from "@/models/TakeoverGrant";
import SupportTicket from "@/models/SupportTicket";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { sanitizeGrant, syncExpiry } from "@/lib/superadmin/takeover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/takeover/pending — polled by the society admin's dashboard.
// Covers both banners it needs to render: `grant` is a request awaiting
// this admin's consent (show the Approve/Deny/OTP modal); `activeGrant` is
// a currently-active session on this society, however it was approved —
// including from a different tab/device than the one that clicked Approve
// — so the "End session" control is always reachable. Never returns a
// grant for any society but the admin's own.
export async function GET(request) {
  const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
  if (!auth.valid) return auth;

  try {
    await connectDB();
    const [grant, activeGrantRaw] = await Promise.all([
      TakeoverGrant.findOne({
        societyId: auth.user.societyId,
        status: { $in: ["awaiting_consent", "pending_otp"] },
      })
        .sort({ createdAt: -1 })
        .lean(),
      TakeoverGrant.findOne({ societyId: auth.user.societyId, status: "active" }).lean(),
    ]);
    const activeGrant = activeGrantRaw ? await syncExpiry(activeGrantRaw) : null;

    const ticketIds = [grant?.ticketId, activeGrant?.ticketId].filter(Boolean);
    const tickets = ticketIds.length
      ? await SupportTicket.find({ _id: { $in: ticketIds } }).select("title category status").lean()
      : [];
    const ticketFor = (tid) => tickets.find((t) => String(t._id) === String(tid)) || null;

    return NextResponse.json({
      grant: grant ? sanitizeGrant(grant) : null,
      ticket: grant ? ticketFor(grant.ticketId) : null,
      activeGrant: activeGrant?.status === "active" ? sanitizeGrant(activeGrant) : null,
      activeGrantTicket: activeGrant?.status === "active" ? ticketFor(activeGrant.ticketId) : null,
    });
  } catch (error) {
    console.error("takeover pending check failed:", error);
    // A polled endpoint failing must never surface as a hard error banner —
    // the panel just quietly retries on its next 5s tick. See
    // TakeoverSessionPanel's query (retry stays default-on for GETs).
    return NextResponse.json({ error: error.message || "Could not check for a pending request." }, { status: 500 });
  }
}
