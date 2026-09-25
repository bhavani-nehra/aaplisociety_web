// app/api/admin/auth/login/route.js
import { NextResponse } from "next/server";
import { getAdminModels } from "@/lib/admin-models";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { checkRateLimit, clearRateLimit } from "@/lib/admin-middleware";
import { verifyTurnstileToken } from "@/lib/turnstile";
export async function POST(request) {
  try {
    const { email, password, adminKey, turnstileToken } = await request.json();
    // ✅ SECURITY 1: Require admin secret key in request body
    if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
      console.warn("🚨 Admin login attempt without valid admin key");
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const turnstileOk = await verifyTurnstileToken(
      turnstileToken,
      request.headers.get("x-forwarded-for") || undefined,
    );
    if (!turnstileOk) {
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 400 },
      );
    }
    // ✅ SECURITY 2: Rate limiting
    const rateLimit = checkRateLimit(email);
    if (rateLimit.blocked) {
      const remainingTime = Math.ceil((rateLimit.resetAt - Date.now()) / 60000);
      return NextResponse.json(
        {
          error: `Too many attempts. Try again in ${remainingTime} minutes.`,
          blockedUntil: rateLimit.resetAt,
        },
        { status: 429 },
      );
    }
    // ✅ SECURITY 3: Validate credentials
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 },
      );
    }
    const { SuperAdmin, AdminLog } = await getAdminModels();
    // Find admin in ADMIN database
    const admin = await SuperAdmin.findOne({ email, isActive: true });
    if (!admin) {
      console.warn(`🚨 Failed admin login attempt: ${email}`);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    // ✅ SECURITY 4: Verify password
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      console.warn(`🚨 Wrong password for admin: ${email}`);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    // ✅ SECURITY 4b: SuperAdmin role is restricted to one allowed email —
    // a DB record with role SuperAdmin is not enough on its own.
    const allowedSuperAdminEmail = (
      process.env.SUPERADMIN_ALLOWED_EMAIL || "aaplisociety2025@gmail.com"
    ).toLowerCase();
    if (
      admin.role === "SuperAdmin" &&
      admin.email.toLowerCase() !== allowedSuperAdminEmail
    ) {
      console.warn(`🚨 Unauthorized SuperAdmin login attempt: ${email}`);
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    // ✅ SUCCESS: Clear rate limit
    clearRateLimit(email);
    // Update login info
    const ipAddress =
      request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const userAgent = request.headers.get("user-agent") || "unknown";
    admin.lastLogin = new Date();
    admin.loginHistory.push({
      timestamp: new Date(),
      ipAddress,
      userAgent,
    });
    await admin.save();
    // Log login
    await AdminLog.create({
      adminId: admin._id,
      adminName: admin.name,
      action: "LOGIN",
      ipAddress,
      userAgent,
      timestamp: new Date(),
    });
    // ✅ SECURITY 5: Generate token with ADMIN-specific secret
    const token = jwt.sign(
      {
        userId: admin._id,
        email: admin.email,
        role: admin.role, // 🔥 dynamic
        // SEC-22: a unique id so this token can be revoked.
        //
        // Until now the superadmin token — the single highest-privilege
        // credential in the product — carried no jti, which meant there was
        // nothing for the logout denylist to key on and NO way to invalidate
        // one. A leaked superadmin token stayed valid for its full 8 hours and
        // nothing could be done about it. Ordinary user tokens have had a jti
        // since lib/jwt.js:signToken; this is the same mechanism, applied to
        // the account that needs it most.
        jti: crypto.randomUUID(),
      },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: "8h" },
    );
    console.log(`✅ Admin logged in: ${email}`);
    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
    response.cookies.set("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
    return response;
  } catch (error) {
    console.error("❌ Admin login error:", error);
    const isDbUnavailable =
      error?.code === "ECONNREFUSED" ||
      error?.message?.includes("querySrv") ||
      error?.name === "MongooseServerSelectionError" ||
      error?.message?.includes("MongoServerSelectionError");
    return NextResponse.json(
      {
        error: isDbUnavailable
          ? "Admin database is temporarily unavailable. Please try again in a moment."
          : "Internal server error",
      },
      { status: isDbUnavailable ? 503 : 500 },
    );
  }
}
