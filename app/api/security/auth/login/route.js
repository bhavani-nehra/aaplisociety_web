// app/api/security/auth/login/route.js
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { signToken } from "@/lib/jwt";
import bcrypt from "bcryptjs";
import cache from "@/lib/cache";
import { issueRefreshToken, setRefreshCookie } from "@/lib/refresh-token";
import { verifyTurnstileToken } from "@/lib/turnstile";
export async function POST(request) {
  try {
    await connectDB();
    const body = await request.json();
    const username = String(body.username || "")
      .trim()
      .toLowerCase();
    const password = String(body.password || "");
    if (!username || !password)
      return NextResponse.json(
        { error: "Username and password required" },
        { status: 400 },
      );
    const turnstileOk = await verifyTurnstileToken(
      body.turnstileToken,
      request.headers.get("x-forwarded-for") || undefined,
    );
    if (!turnstileOk) {
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 400 },
      );
    }
    // Rate limit: 5 failed attempts per username per 15 min
    const rlKey = `guard_login_fail:${username}`;
    const fails = await cache.get(rlKey);
    if (fails && parseInt(fails) >= 5)
      return NextResponse.json(
        { error: "Account locked. Try again in 15 minutes." },
        { status: 429 },
      );
    const guard = await User.findOne({
      username,
      role: "Security",
      isActive: true,
    }).lean();
    if (!guard)
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    const isMatch = await bcrypt.compare(password, guard.password);
    if (!isMatch) {
      const currentFails = parseInt((await cache.get(rlKey)) || "0", 10) || 0;
      await cache.set(rlKey, String(currentFails + 1), 15 * 60);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    // On success: clear lockout
    await cache.del(rlKey);
    // Deliberately NOT the shared 15m default (Plan 05 Part A): this route's
    // own cookie below is a 12-hour shift, not an office session, and an
    // access token that silently expired at 15m while the cookie claimed 12h
    // would have been a worse mismatch than the pre-existing 8h/12h one this
    // replaces. The 2h-idle/24h-cap refresh-token rule still applies via the
    // shared issueRefreshToken/rotateRefreshToken below — see
    // 07-execution-log.md's Run 18 note on the tradeoff that creates for a
    // guard silent for 2h+ mid-shift.
    const token = signToken(
      {
        userId: guard._id.toString(),
        name: guard.name,
        role: "Security",
        societyId: guard.societyId.toString(),
        gateLabel: guard.gateLabel || "Main Gate",
      },
      { expiresIn: "12h" },
    );
    const response = NextResponse.json({
      success: true,
      user: {
        id: guard._id,
        name: guard.name,
        role: "Security",
        gateLabel: guard.gateLabel,
      },
    });
    response.cookies.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 12, // 12-hour shift
    });
    setRefreshCookie(response, await issueRefreshToken(guard._id));
    return response;
  } catch (err) {
    console.error("Security login error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
