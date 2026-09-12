import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import TakeoverGrant from "@/models/TakeoverGrant";
import AuditLog from "@/models/AuditLog";
import SupportTicket from "@/models/SupportTicket";
import User from "@/models/User";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { sendEmail } from "@/lib/brevo-email";
import { otpEmailHtml } from "@/lib/superadmin/takeoverEmail";
import { generateOtp, hashOtp, OTP_EXPIRY_MS, sanitizeGrant } from "@/lib/superadmin/takeover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A wrong-code streak (MAX_OTP_ATTEMPTS) auto-denies the grant — that limit
// is the real abuse guard. Resending is capped separately, lower, since
// "email didn't arrive, try again" and "someone is fishing for the code"
// look the same from here otherwise.
const MAX_RESENDS = 3;

// POST /api/v1/takeover/:id/resend-otp — the email didn't arrive, or the
// admin let the 5-minute code expire before reading it. Mints a fresh code
// and a fresh 5-minute window without needing to re-approve from scratch —
// the request/duration/scope stay exactly as originally approved.
export async function POST(request, { params }) {
  const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
  if (!auth.valid) return auth;
  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Grant not found" }, { status: 404 });
  }

  try {
    await connectDB();
    const grant = await TakeoverGrant.findById(id).select("+consent.otpHash");
    if (!grant || String(grant.societyId) !== String(auth.user.societyId)) {
      return NextResponse.json({ error: "Grant not found" }, { status: 404 });
    }
    if (grant.status !== "pending_otp") {
      return NextResponse.json({ error: `Grant is ${grant.status}, not awaiting an OTP` }, { status: 409 });
    }
    if ((grant.consent.resendCount || 0) >= MAX_RESENDS) {
      return NextResponse.json(
        { error: "Too many resend attempts. Deny this request and ask for a fresh one.", code: "RESEND_LIMIT" },
        { status: 429 },
      );
    }
    if (!grant.consent.adminUserId) {
      return NextResponse.json({ error: "No email on file to resend to" }, { status: 422 });
    }

    const admin = await User.findById(grant.consent.adminUserId).select("name email").lean();
    if (!admin?.email) {
      return NextResponse.json({ error: "No email on file to resend to" }, { status: 422 });
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
          minutes: grant.grantedDurationMinutes,
          superadminName: grant.requestedByName,
        }),
      });
    } catch (err) {
      console.error("takeover OTP resend failed:", err?.message || err);
      return NextResponse.json(
        { error: "Could not resend the code — try again.", code: "OTP_SEND_FAILED" },
        { status: 502 },
      );
    }

    grant.consent.otpHash = await hashOtp(otp);
    grant.consent.otpExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    grant.consent.otpAttempts = 0;
    grant.consent.resendCount = (grant.consent.resendCount || 0) + 1;
    await grant.save();

    await AuditLog.create({
      userId: grant.consent.adminUserId,
      societyId: grant.societyId,
      action: "TAKEOVER_OTP_SENT",
      newData: { grantId: grant._id, otpChannel: "email", resend: true },
    });

    return NextResponse.json({
      grant: sanitizeGrant(grant.toObject()),
      resendsLeft: MAX_RESENDS - grant.consent.resendCount,
    });
  } catch (error) {
    console.error("takeover resend-otp failed:", error);
    return NextResponse.json({ error: error.message || "Could not resend the code. Try again." }, { status: 500 });
  }
}
