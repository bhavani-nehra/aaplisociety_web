import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { signToken } from "@/lib/jwt";
import { rotateRefreshToken, setRefreshCookie, clearRefreshCookie } from "@/lib/refresh-token";
import { loginBlockFor } from "@/lib/auth/login-block";
// Real rotating refresh: reads the httpOnly refreshToken cookie (never a
// client-supplied token in the body — the previous version accepted any
// signature-valid token from anyone, not necessarily the session's own),
// validates it against the stored/revocable RefreshToken record, rotates
// it, and re-derives claims from the user's *current* profile state (so a
// role/profile change since last login takes effect on refresh, not only on
// next full login).
// Plan 05 Part A, step 4 — the four reasons a refresh can fail, each reading
// as a different situation rather than one generic "session expired"
// string. SESSION_REVOKED is deliberately also what Plan 01 §10-11 (role
// handover) and Plan 02 §7 (old-owner sunset) produce, via the session-epoch
// path elsewhere — one message covers all three causes.
const REFRESH_FAILURE_MESSAGES = {
  SESSION_IDLE_EXPIRED: "Signed out after 2 hours of inactivity.",
  SESSION_MAX_AGE: "Daily sign-in required.",
  SESSION_REVOKED: "Your access changed. Please sign in again.",
};

export async function POST(request) {
  try {
    await connectDB();
    const refreshCookie = request.cookies.get("refreshToken")?.value;
    if (!refreshCookie) {
      return NextResponse.json({ error: "No refresh token", code: "SESSION_REVOKED" }, { status: 401 });
    }
    const rotated = await rotateRefreshToken(refreshCookie);
    if (!rotated.ok) {
      const res = NextResponse.json(
        { error: REFRESH_FAILURE_MESSAGES[rotated.reason] || "Invalid or expired refresh token", code: rotated.reason },
        { status: 401 },
      );
      clearRefreshCookie(res);
      return res;
    }
    const user = await User.findById(rotated.userId);
    const block = loginBlockFor(user);
    if (block) {
      // Clearing the cookie matters here: without it the browser keeps
      // retrying a refresh that can never succeed.
      const res = NextResponse.json({ error: block.message, code: block.code }, { status: 401 });
      clearRefreshCookie(res);
      return res;
    }
    const activeProfile = (user.profiles ?? []).find(
      (p) => String(p.profileId) === String(user.activeProfileId) && p.status === "Active",
    );
    const claims = activeProfile
      ? {
          userId: user._id,
          activeProfileId: activeProfile.profileId,
          memberId: activeProfile.memberId,
          societyId: activeProfile.societyId,
          role: activeProfile.role,
        }
      : {
          userId: user._id,
          email: user.email,
          role: user.role,
          societyId: user.societyId,
          societyCode: user.societyCode,
        };
    const newAccessToken = signToken(claims);
    const response = NextResponse.json({ success: true });
    response.cookies.set("token", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 15, // Plan 05 Part A — matches lib/jwt.js's 15m access-token default
    });
    setRefreshCookie(response, rotated.refreshToken);
    return response;
  } catch (error) {
    console.error("Token refresh error:", error);
    return NextResponse.json({ error: "Token refresh failed" }, { status: 500 });
  }
}
