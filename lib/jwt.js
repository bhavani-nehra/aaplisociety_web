import jwt from "jsonwebtoken";
import crypto from "node:crypto";
function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return process.env.JWT_SECRET;
}
export function signToken(payload, options = {}) {
  // jti gives every token a unique id so logout can revoke it (denylist in
  // lib/cache — see app/api/v1/auth/logout/route.js).
  //
  // Plan 05 Part A: dropped from 8h to 15m. An access token this short only
  // works as a security boundary AND stays invisible to the user at the same
  // time — it needs the whole app to survive a 401 via silent refresh
  // (lib/api-fetch-interceptor.js / lib/api-client.js), which shipped first.
  // A caller with a genuinely different session shape (the security guard
  // web console's 12-hour-shift cookie, for one) passes an explicit
  // `expiresIn` override rather than relying on this default.
  return jwt.sign(
    { ...payload, jti: crypto.randomUUID() },
    getJwtSecret(),
    { expiresIn: "15m", ...options },
  );
}
// Helper to check if decoded token has memberId
export function isMemberToken(decoded) {
  return decoded && decoded.memberId;
}
export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    console.error("JWT verification failed:", error.message);
    return null;
  }
}
/**
 * SECURE: Extract token from HttpOnly cookie (preferred) or Authorization header (for API clients)
 */
export function getTokenFromRequest(request) {
  // Priority 1: HttpOnly cookie (browser/web clients)
  const cookieToken = request.cookies.get("token")?.value;
  if (cookieToken) return cookieToken;
  // Priority 2: Authorization header (mobile apps, Postman)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }
  return null;
}