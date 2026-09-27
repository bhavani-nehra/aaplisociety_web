import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import RoleAssignment from "@/models/RoleAssignment";
import { signToken, decodeTokenUnsafe } from "@/lib/jwt";
import { rotateRefreshToken, setRefreshCookie, clearRefreshCookie, clearAccessCookie } from "@/lib/refresh-token";
import { loginBlockFor } from "@/lib/auth/login-block";
import { legacyRoleForKey } from "@/lib/rbac/legacy-role-bridge";

// The refresh cookie deliberately carries no role/context (lib/refresh-token.js
// — issueRefreshToken only ever signs {userId, jti, sessionStartedAt}), so
// this route had no way to know a staff hat was active and always fell
// through to the resident-profile/legacy-fallback shape below — silently
// dropping `activeContext`/`hat`/the legacy role string every ~15 minutes
// for every staff session (Admin/Secretary/Accountant/Security/etc), which
// is a scoping regression, not merely a stale-epoch one.
//
// Fix: the OLD (about-to-be-superseded) access-token cookie is still present
// in this same request. Its claims are read WITHOUT verifying signature or
// expiry (decodeTokenUnsafe) — a pure hint, never trusted for authorization
// — and used only to look up which society's assignment to re-verify live
// against RoleAssignment. If that assignment is no longer active (revoked,
// expired, handed over since the last real login), this returns null and
// the caller falls through to the resident/legacy shape exactly as before.
async function resolveStaffClaims(request, user) {
  const hint = decodeTokenUnsafe(request.cookies.get("token")?.value);
  if (hint?.activeContext?.hat !== "staff" || !hint.activeContext.societyId) return null;
  const now = new Date();
  const assignments = await RoleAssignment.find({
    userId: user._id,
    societyId: hint.activeContext.societyId,
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).lean();
  if (!assignments.length) return null;
  // A user can hold more than one assignment in the same society (rare) —
  // prefer whichever one maps back to the legacy role string the expiring
  // token was using; otherwise take the first active one, no worse than the
  // single-assignment common case this mirrors.
  const match = assignments.find((a) => legacyRoleForKey(a.roleKey) === hint.role) || assignments[0];
  return {
    userId: user._id,
    activeContext: { societyId: match.societyId, hat: "staff" },
    societyId: match.societyId,
    role: legacyRoleForKey(match.roleKey),
    sessionEpoch: user.sessionEpoch || 0,
  };
}
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
      // No refresh cookie doesn't mean no access cookie — an access token
      // that outlives its refresh token (cleared by an earlier failure, or
      // never issued) must not keep being sent on every request until it
      // separately expires on its own.
      const res = NextResponse.json({ error: "No refresh token", code: "SESSION_REVOKED" }, { status: 401 });
      clearAccessCookie(res);
      return res;
    }
    const rotated = await rotateRefreshToken(refreshCookie);
    if (!rotated.ok) {
      const res = NextResponse.json(
        { error: REFRESH_FAILURE_MESSAGES[rotated.reason] || "Invalid or expired refresh token", code: rotated.reason },
        { status: 401 },
      );
      clearRefreshCookie(res);
      clearAccessCookie(res);
      return res;
    }
    const user = await User.findById(rotated.userId);
    const block = loginBlockFor(user);
    if (block) {
      // Clearing the cookie matters here: without it the browser keeps
      // retrying a refresh that can never succeed.
      const res = NextResponse.json({ error: block.message, code: block.code }, { status: 401 });
      clearRefreshCookie(res);
      clearAccessCookie(res);
      return res;
    }
    const staffClaims = await resolveStaffClaims(request, user);
    const activeProfile = (user.profiles ?? []).find(
      (p) => String(p.profileId) === String(user.activeProfileId) && p.status === "Active",
    );
    // sessionEpoch MUST be carried into every refreshed token — this route
    // fires for every logged-in user roughly every 15 minutes (the access
    // token's lifetime). Omitting it silently re-signs the token at epoch 0,
    // and the moment ANY user's real epoch is ever bumped above 0 (a routine
    // event — password reset, role edit, ownership transfer), the very next
    // silent refresh permanently fails authorize()/middleware's freshness
    // check. A fresh login "fixes" it only until the next refresh cycle,
    // which reproduces exactly as a sign-in loop. See lib/rbac/authorize.js's
    // `tokenEpoch < currentEpoch` check and middleware.js's mirror of it.
    const claims = staffClaims || (activeProfile
      ? {
          userId: user._id,
          activeProfileId: activeProfile.profileId,
          memberId: activeProfile.memberId,
          societyId: activeProfile.societyId,
          role: activeProfile.role,
          sessionEpoch: user.sessionEpoch || 0,
        }
      : {
          userId: user._id,
          email: user.email,
          role: user.role,
          societyId: user.societyId,
          societyCode: user.societyCode,
          sessionEpoch: user.sessionEpoch || 0,
        });
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
