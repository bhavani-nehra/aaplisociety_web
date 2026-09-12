import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";
import connectDB from "@/lib/mongodb";
import TakeoverGrant from "@/models/TakeoverGrant";
import SupportTicket from "@/models/SupportTicket";
import AuditLog from "@/models/AuditLog";
import { getAdminModels } from "@/lib/admin-models";
import { ALLOWED_DURATIONS_MINUTES, sanitizeGrant } from "@/lib/superadmin/takeover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/superadmin/takeover?ticketId=... — grant history for one ticket
// (the superadmin ticket-detail modal shows this), or the single grant by
// ?grantId= for polling. Also supports ?all=1 for the cross-society
// sessions overview page (app/superadmin/takeover/page.js).
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const ticketId = searchParams.get("ticketId");
    const grantId = searchParams.get("grantId");
    const all = searchParams.get("all");

    if (grantId) {
      if (!mongoose.isValidObjectId(grantId)) {
        return NextResponse.json({ error: "Grant not found" }, { status: 404 });
      }
      const grant = await TakeoverGrant.findById(grantId).lean();
      if (!grant) return NextResponse.json({ error: "Grant not found" }, { status: 404 });
      return NextResponse.json({ grant: sanitizeGrant(grant) });
    }

    if (all) {
      // Overview page: every grant, newest first, capped — this is an
      // audit/monitoring list, not something that needs infinite scroll at
      // this app's volume.
      const status = searchParams.get("status");
      const query = status && status !== "all" ? { status } : {};
      const grants = await TakeoverGrant.find(query).sort({ createdAt: -1 }).limit(200).lean();
      const ticketIds = [...new Set(grants.map((g) => String(g.ticketId)))];
      const tickets = ticketIds.length
        ? await SupportTicket.find({ _id: { $in: ticketIds } }).select("title societyName").lean()
        : [];
      const ticketById = Object.fromEntries(tickets.map((t) => [String(t._id), t]));
      return NextResponse.json({
        grants: grants.map((g) => ({
          ...sanitizeGrant(g),
          ticketTitle: ticketById[String(g.ticketId)]?.title || null,
          societyName: ticketById[String(g.ticketId)]?.societyName || null,
        })),
      });
    }

    if (!ticketId || !mongoose.isValidObjectId(ticketId)) {
      return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
    }
    const grants = await TakeoverGrant.find({ ticketId }).sort({ createdAt: -1 }).lean();
    return NextResponse.json({ grants: grants.map(sanitizeGrant) });
  } catch (error) {
    console.error("takeover status failed:", error);
    return NextResponse.json({ error: error.message || "Something went wrong. Try again." }, { status: 500 });
  }
}

// POST /api/superadmin/takeover — request a takeover for one ticket.
// Body: { ticketId, scope: "read"|"write", requestedDurationMinutes }
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { ticketId, scope, requestedDurationMinutes } = body || {};
  if (!ticketId || !mongoose.isValidObjectId(ticketId)) {
    return NextResponse.json({ error: "ticketId is required" }, { status: 400 });
  }
  if (!["read", "write"].includes(scope)) {
    return NextResponse.json({ error: "scope must be 'read' or 'write'" }, { status: 400 });
  }
  if (!ALLOWED_DURATIONS_MINUTES.includes(Number(requestedDurationMinutes))) {
    return NextResponse.json(
      { error: `requestedDurationMinutes must be one of: ${ALLOWED_DURATIONS_MINUTES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    await connectDB();
    const ticket = await SupportTicket.findById(ticketId).lean();
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Only one non-terminal grant per ticket at a time — a second request
    // while one is already in flight (or active) would just confuse the
    // consent screen about which request the admin is looking at. Not a
    // hard DB-level lock (this app's realistic concurrency is one or two
    // superadmins, not a race worth a unique index for) — a genuine
    // simultaneous double-click just produces two 409s or two grants in
    // the rare worst case, neither of which corrupts anything.
    const existing = await TakeoverGrant.findOne({
      ticketId,
      status: { $in: ["awaiting_consent", "pending_otp", "active"] },
    }).lean();
    if (existing) {
      return NextResponse.json(
        { error: `A takeover grant is already ${existing.status} for this ticket.`, code: "GRANT_IN_FLIGHT" },
        { status: 409 },
      );
    }

    const { SuperAdmin } = await getAdminModels();
    const requester = await SuperAdmin.findById(validation.admin.userId).select("name").lean();

    const grant = await TakeoverGrant.create({
      ticketId,
      societyId: ticket.societyId,
      requestedBy: String(validation.admin.userId),
      requestedByName: requester?.name || validation.admin.email,
      scope,
      requestedDurationMinutes: Number(requestedDurationMinutes),
    });

    await AuditLog.create({
      societyId: ticket.societyId,
      action: "TAKEOVER_REQUESTED",
      newData: {
        grantId: grant._id,
        ticketId,
        scope,
        requestedDurationMinutes: Number(requestedDurationMinutes),
        requestedBy: grant.requestedByName,
      },
    });

    return NextResponse.json({ grant: sanitizeGrant(grant.toObject()) }, { status: 201 });
  } catch (error) {
    console.error("takeover request failed:", error);
    return NextResponse.json({ error: error.message || "Could not send the request. Try again." }, { status: 500 });
  }
}
