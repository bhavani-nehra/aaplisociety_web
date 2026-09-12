import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import TakeoverGrant from "@/models/TakeoverGrant";
import AuditLog from "@/models/AuditLog";
import User from "@/models/User";
import SupportTicket from "@/models/SupportTicket";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { sendEmail } from "@/lib/brevo-email";
import { otpEmailHtml } from "@/lib/superadmin/takeoverEmail";
import {
  ALLOWED_DURATIONS_MINUTES,
  generateOtp,
  hashOtp,
  OTP_EXPIRY_MS,
  sanitizeGrant,
} from "@/lib/superadmin/takeover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/takeover/:id/approve — society admin approves a pending
// request and picks the actual granted duration. Sends the OTP; does NOT
// activate the session yet — that happens on OTP verification.
// Body: { grantedDurationMinutes }
export async function POST(request, { params }) {
  const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
  if (!auth.valid) return auth;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const grantedDurationMinutes = Number(body?.grantedDurationMinutes);
  if (!ALLOWED_DURATIONS_MINUTES.includes(grantedDurationMinutes)) {
    return NextResponse.json(
      { error: `grantedDurationMinutes must be one of: ${ALLOWED_DURATIONS_MINUTES.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    await connectDB();
    // Atomic claim of the "about to send an OTP" transition: prevents a
    // doubled Approve click (slow network, impatient re-tap) from sending
    // two emails and racing two otpHash writes against each other.
    const grant = await TakeoverGrant.findOneAndUpdate(
      { _id: id, societyId: auth.user.societyId, status: "awaiting_consent" },
      { $set: { status: "pending_otp" } },
      { new: true },
    );
    if (!grant) {
      const existing = await TakeoverGrant.findById(id).lean();
      if (!existing || String(existing.societyId) !== String(auth.user.societyId)) {
        return NextResponse.json({ error: "Grant not found" }, { status: 404 });
      }
      return NextResponse.json(
        { error: `Grant is already ${existing.status}`, code: "GRANT_NOT_AWAITING_CONSENT" },
        { status: 409 },
      );
    }

    const admin = await User.findById(auth.user.userId).select("name email").lean();
    if (!admin?.email) {
      // Roll the claim back — nothing was sent, so this grant shouldn't be
      // stuck in pending_otp with no way to ever receive a code.
      await TakeoverGrant.updateOne({ _id: id }, { $set: { status: "awaiting_consent" } });
      return NextResponse.json({ error: "No email on file to send the confirmation code to" }, { status: 422 });
    }

    const ticket = await SupportTicket.findById(grant.ticketId).select("title").lean();
    const otp = generateOtp();

    try {
      await sendEmail({
        to: admin.email,
        subject: "Confirm support access to your dashboard",
        html: otpEmailHtml({
          otp,
          ticketTitle: ticket?.title || "(ticket)",
          scope: grant.scope,
          minutes: grantedDurationMinutes,
          superadminName: grant.requestedByName,
        }),
      });
    } catch (err) {
      console.error("takeover OTP email failed:", err?.message || err);
      // Roll back to awaiting_consent — the admin can retry Approve
      // cleanly instead of being stuck on a pending_otp grant that never
      // got its code out.
      await TakeoverGrant.updateOne({ _id: id }, { $set: { status: "awaiting_consent" } });
      return NextResponse.json(
        { error: "Could not send the confirmation code — try again.", code: "OTP_SEND_FAILED" },
        { status: 502 },
      );
    }

    grant.grantedDurationMinutes = grantedDurationMinutes;
    grant.consent.adminUserId = admin._id;
    grant.consent.adminName = admin.name;
    grant.consent.otpHash = await hashOtp(otp);
    grant.consent.otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    grant.consent.otpAttempts = 0;
    grant.consent.ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    grant.consent.userAgent = request.headers.get("user-agent") || null;
    await grant.save();

    await AuditLog.create({
      userId: admin._id,
      societyId: grant.societyId,
      action: "TAKEOVER_OTP_SENT",
      newData: { grantId: grant._id, otpChannel: "email" },
    });

    return NextResponse.json({ grant: sanitizeGrant(grant.toObject()) });
  } catch (error) {
    console.error("takeover approve failed:", error);
    return NextResponse.json({ error: error.message || "Could not approve the request. Try again." }, { status: 500 });
  }
}
