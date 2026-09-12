import { NextResponse } from "next/server";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import connectDB from "@/lib/mongodb";
import TakeoverGrant from "@/models/TakeoverGrant";
import SupportTicket from "@/models/SupportTicket";
import AuditLog from "@/models/AuditLog";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import {
  MAX_OTP_ATTEMPTS,
  mintImpersonationToken,
  otpMatches,
  sanitizeGrant,
  sanitizeTokenPayloadForReissue,
} from "@/lib/superadmin/takeover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/v1/takeover/:id/verify-otp — society admin enters the emailed
// code. On success this is the actual activation moment: mints the
// impersonation token from the admin's OWN current session (so every claim
// — activeContext, role, sessionEpoch — is byte-identical to what a real
// login would produce) and stores it for the superadmin's browser to claim.
// Body: { otp }
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
  const otp = String(body?.otp || "").trim();
  if (!otp) {
    return NextResponse.json({ error: "otp is required" }, { status: 400 });
  }

  try {
    await connectDB();
    const grant = await TakeoverGrant.findById(id).select("+consent.otpHash");
    if (!grant || String(grant.societyId) !== String(auth.user.societyId)) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    if (grant.status !== "pending_otp") {
      return NextResponse.json({ error: `Grant is ${grant.status}, not awaiting an OTP`, code: "GRANT_NOT_PENDING_OTP" }, { status: 409 });
    }
    if (!grant.consent.otpExpiresAt || grant.consent.otpExpiresAt < new Date()) {
      grant.status = "denied";
      grant.endedAt = new Date();
      grant.endedBy = "system_expiry";
      await grant.save();
      await AuditLog.create({
        societyId: grant.societyId,
        action: "TAKEOVER_DENIED",
        newData: { grantId: grant._id, reason: "otp_expired" },
      });
      return NextResponse.json({ error: "Code expired. Ask for a new request.", code: "OTP_EXPIRED" }, { status: 410 });
    }

    const ok = await otpMatches(otp, grant.consent.otpHash);
    if (!ok) {
      grant.consent.otpAttempts += 1;
      if (grant.consent.otpAttempts >= MAX_OTP_ATTEMPTS) {
        grant.status = "denied";
        grant.endedAt = new Date();
        grant.endedBy = "system_expiry";
        await grant.save();
        await AuditLog.create({
          societyId: grant.societyId,
          action: "TAKEOVER_DENIED",
          newData: { grantId: grant._id, reason: "otp_attempts_exhausted" },
        });
        return NextResponse.json({ error: "Too many wrong codes. Request denied.", code: "OTP_ATTEMPTS_EXHAUSTED" }, { status: 410 });
      }
      await grant.save();
      return NextResponse.json(
        {
          error: `Wrong code. ${MAX_OTP_ATTEMPTS - grant.consent.otpAttempts} attempt(s) left.`,
          code: "OTP_WRONG",
          attemptsLeft: MAX_OTP_ATTEMPTS - grant.consent.otpAttempts,
        },
        { status: 401 },
      );
    }

    const ticket = await SupportTicket.findById(grant.ticketId).select("title").lean();
    const durationMinutes = grant.grantedDurationMinutes;
    const expiresInSeconds = durationMinutes * 60;
    const token = mintImpersonationToken({
      adminTokenPayload: sanitizeTokenPayloadForReissue(auth.user),
      grantId: grant._id,
      actorSuperAdminId: grant.requestedBy,
      actorSuperAdminName: grant.requestedByName,
      mode: grant.scope,
      ticketId: grant.ticketId,
      ticketTitle: ticket?.title || "",
      expiresInSeconds,
    });
    const decoded = jwt.decode(token);

    grant.status = "active";
    grant.consent.otpVerifiedAt = new Date();
    grant.activatedAt = new Date();
    grant.expiresAt = new Date(decoded.exp * 1000);
    grant.jti = decoded.jti;
    grant.mintedTokenOnce = token;
    await grant.save();

    await AuditLog.create({
      userId: auth.user.userId,
      societyId: grant.societyId,
      action: "TAKEOVER_GRANTED",
      newData: {
        grantId: grant._id,
        scope: grant.scope,
        grantedDurationMinutes: durationMinutes,
        expiresAt: grant.expiresAt,
      },
    });

    return NextResponse.json({ grant: sanitizeGrant(grant.toObject()) });
  } catch (error) {
    console.error("takeover verify-otp failed:", error);
    return NextResponse.json({ error: error.message || "Could not confirm the code. Try again." }, { status: 500 });
  }
}
