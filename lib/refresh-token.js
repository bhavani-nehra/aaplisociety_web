import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import RefreshToken from "@/models/RefreshToken";
function getRefreshSecret() {
  // Falls back to JWT_SECRET if a dedicated REFRESH_JWT_SECRET isn't set, so
  // this works without a new required env var — but configuring a distinct
  // secret is recommended (matches mobile-backend's convention) since it
  // lets refresh tokens be invalidated independently of access tokens.
  const secret = process.env.REFRESH_JWT_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not configured");
  return secret;
}
// Plan 05 Part A — three timers, each with one job: a 15m access token
// (lib/jwt.js) bounds a stolen token's blast radius; this 2h refresh window
// is the IDLE timer (it only re-issues when a request actually happens, so
// an idle tab's window simply lapses on its own — see A3); ABSOLUTE_SESSION_MS
// below is the once-a-day cap, independent of activity. Any one of these
// alone fails at least one of the four stated requirements (see 05's §A1).
const REFRESH_TTL = "2h";
const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 2;
const ABSOLUTE_SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} userId
 * @param {{ sessionStartedAt?: number }} [opts] - unix SECONDS this
 *   continuous session began. Omit only for a genuinely new login; every
 *   rotation and every profile switch mid-session must pass the value
 *   forward unchanged, or the 24h cap silently becomes a sliding window
 *   again (exactly the defect this replaces).
 */
export async function issueRefreshToken(userId, { sessionStartedAt } = {}) {
  const jti = crypto.randomUUID();
  const startedAt = sessionStartedAt ?? Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { userId: String(userId), jti, sessionStartedAt: startedAt },
    getRefreshSecret(),
    { expiresIn: REFRESH_TTL },
  );
  const { exp } = jwt.decode(token);
  await RefreshToken.create({ userId, jti, expiresAt: new Date(exp * 1000) });
  return token;
}

/**
 * Validates the presented refresh token against the stored, revocable
 * record (not just the JWT signature — a signature-valid but revoked or
 * already-rotated token must be rejected), checks the 24h absolute cap and
 * the account's own status, then rotates: the old jti is revoked and a new
 * refresh token is issued carrying `sessionStartedAt` forward unchanged.
 *
 * @returns {Promise<{ok:true, userId:string, refreshToken:string} | {ok:false, reason:string}>}
 *   `reason` is one of SESSION_IDLE_EXPIRED | SESSION_MAX_AGE | SESSION_REVOKED |
 *   ACCOUNT_BLOCKED — see app/api/auth/refresh/route.js for the HTTP/copy mapping.
 */
export async function rotateRefreshToken(oldToken) {
  let decoded;
  try {
    decoded = jwt.verify(oldToken, getRefreshSecret());
  } catch (err) {
    // A token whose own 2h `exp` has passed is exactly the idle-timeout this
    // design relies on (see the module comment) — distinct from a token that
    // fails to verify for any other reason (tampered, wrong secret, garbage),
    // which is treated as revoked rather than merely idle.
    return { ok: false, reason: err?.name === "TokenExpiredError" ? "SESSION_IDLE_EXPIRED" : "SESSION_REVOKED" };
  }

  const stored = await RefreshToken.findOne({ jti: decoded.jti, userId: decoded.userId });
  if (!stored || stored.revoked) return { ok: false, reason: "SESSION_REVOKED" };
  if (stored.expiresAt < new Date()) return { ok: false, reason: "SESSION_IDLE_EXPIRED" };

  const sessionStartedAt = decoded.sessionStartedAt;
  if (sessionStartedAt && Date.now() - sessionStartedAt * 1000 > ABSOLUTE_SESSION_MS) {
    // Revoke rather than merely refuse: the 24h cap must not be beatable by
    // repeatedly retrying rotation with the same not-yet-revoked token.
    stored.revoked = true;
    await stored.save();
    return { ok: false, reason: "SESSION_MAX_AGE" };
  }

  // Account-blocked (isActive:false / loginPausedUntil) is deliberately NOT
  // checked here — app/api/auth/refresh/route.js already calls
  // lib/auth/login-block.js's loginBlockFor() right after rotation, which is
  // the one place in the app that answers "may this account sign in right
  // now?" and already runs on every refresh. Duplicating it here with
  // different field names would be a second, divergent copy of that answer.

  // Revoke (not delete) — a revoked jti presented again later is a reuse
  // signal worth alerting on once this app has a monitoring layer.
  stored.revoked = true;
  await stored.save();
  const newToken = await issueRefreshToken(decoded.userId, { sessionStartedAt });
  return { ok: true, userId: decoded.userId, refreshToken: newToken };
}
/**
 * Best-effort read of `sessionStartedAt` from an existing refresh-token
 * cookie, WITHOUT re-verifying signature/DB state — for callers (switch-
 * profile) that need to carry the value forward but aren't themselves doing
 * a rotation. A forged or unreadable cookie just falls back to `undefined`
 * (issueRefreshToken then treats it as a new session) — never a security
 * decision, since the real rotation path always re-verifies from scratch.
 *
 * @param {string|undefined} token
 * @returns {number|undefined}
 */
export function peekSessionStartedAt(token) {
  if (!token) return undefined;
  try {
    const decoded = jwt.decode(token);
    return typeof decoded?.sessionStartedAt === "number" ? decoded.sessionStartedAt : undefined;
  } catch {
    return undefined;
  }
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  try {
    const decoded = jwt.verify(token, getRefreshSecret());
    await RefreshToken.updateOne({ jti: decoded.jti }, { revoked: true });
  } catch {
    // already invalid/expired/unparseable — nothing to revoke
  }
}
export function setRefreshCookie(response, token) {
  response.cookies.set("refreshToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}
export function clearRefreshCookie(response) {
  response.cookies.set("refreshToken", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}
