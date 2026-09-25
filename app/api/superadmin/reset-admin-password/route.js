import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import Society from "@/models/Society";
import { validateAdminRequest } from "@/lib/admin-middleware";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { signToken } from "@/lib/jwt";
import { sendEmail, onboardingEmailHtml } from "@/lib/brevo-email";
import { bumpSessionEpoch } from "@/lib/rbac/session";

// POST /api/superadmin/reset-admin-password
// Body: { societyId }
//
// SEC-19 — this route no longer hands anybody a password.
//
// ## What it used to do
//
// It generated (or accepted) a plaintext password, hashed it into User, and
// returned `newPassword` in the response body, which the superadmin UI printed
// on screen. Its own header comment also claimed it wrote
// `Society.credentials.plainPassword` — the write had already been removed, but
// the field still exists and is still rendered elsewhere, so "reset the
// password and read it out" was the documented support procedure.
//
// That procedure is the reason plaintext admin passwords exist in this product
// at all. Removing the storage without removing the procedure would just have
// broken support, so the procedure is replaced here first.
//
// ## What it does now
//
//   1. Rotates the password to a random value that is never returned, never
//      logged, and never stored in plaintext. Nobody — including the superadmin
//      performing the reset — learns it. It exists only so the account is not
//      left usable with the old credential.
//   2. Forces `mustChangePassword`, so even a leaked old password is useless.
//   3. Bumps the session epoch, which invalidates every outstanding token for
//      that admin (lib/rbac/session.js + the middleware staleness check). A
//      reset that leaves the compromised session logged in is not a reset.
//   4. Mints the same 7-day single-purpose onboarding token the bulk importer
//      uses and emails the admin a setup link, so they choose their own
//      password.
//   5. Returns the link as well as sending it. This is deliberate: if Brevo is
//      down, support otherwise has no path at all, and an expiring
//      single-purpose link handed to an authenticated superadmin is a far
//      smaller exposure than a permanent password. It is not stored anywhere.
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  try {
    await connectDB();
    const { societyId } = await request.json();
    if (!societyId) {
      return NextResponse.json({ error: "societyId required" }, { status: 400 });
    }

    const society = await Society.findById(societyId)
      .select("name address credentials")
      .lean();
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }

    const adminEmail = society.credentials?.adminEmail;
    if (!adminEmail) {
      return NextResponse.json(
        { error: "No admin email on record for this society" },
        { status: 404 },
      );
    }

    // Rotated, not chosen. 32 bytes of entropy that no human ever sees — the
    // account is unusable until the setup link is used, which is the point.
    const throwaway = randomBytes(32).toString("base64url");
    const hash = await bcrypt.hash(throwaway, 10);

    const user = await User.findOneAndUpdate(
      { email: adminEmail, role: "Admin" },
      { $set: { password: hash, isActive: true, mustChangePassword: true } },
      { new: true },
    );
    if (!user) {
      return NextResponse.json(
        { error: `No Admin user found with email ${adminEmail}` },
        { status: 404 },
      );
    }

    // Every outstanding token for this admin stops working now, not whenever it
    // happened to expire. Never fatal: a failure here must not leave the caller
    // believing the reset did not happen — the password IS already rotated.
    let sessionsInvalidated = true;
    try {
      await bumpSessionEpoch(String(user._id));
    } catch (err) {
      sessionsInvalidated = false;
      console.error("[reset-admin-password] bumpSessionEpoch failed:", err?.message);
    }

    const onboardingToken = signToken(
      { userId: String(user._id), purpose: "onboarding" },
      { expiresIn: "7d" },
    );
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const setCredentialsUrl = `${appUrl}/onboarding/set-credentials?token=${onboardingToken}`;

    let emailSent = false;
    let emailError = null;
    try {
      await sendEmail({
        to: adminEmail,
        subject: `Set up your admin account — ${society.name}`,
        html: onboardingEmailHtml({
          memberName: user.name || "Admin",
          societyName: society.name,
          societyAddress: society.address || "",
          unitKind: "",
          unitLabel: "",
          setCredentialsUrl,
        }),
      });
      emailSent = true;
    } catch (err) {
      emailError = err?.message || String(err);
      console.error("[reset-admin-password] setup-link email failed:", emailError);
    }

    return NextResponse.json({
      success: true,
      societyName: society.name,
      adminEmail,
      sessionsInvalidated,
      emailSent,
      emailError,
      // Fallback delivery path only — see the header comment. Expires in 7 days
      // and can only be used to set credentials.
      setCredentialsUrl,
      expiresInDays: 7,
    });
  } catch (err) {
    console.error("reset-admin-password error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
