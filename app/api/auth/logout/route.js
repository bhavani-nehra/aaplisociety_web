// app/api/auth/logout/route.js
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { revokeRefreshToken, clearRefreshCookie } from "@/lib/refresh-token";
import { verifyToken } from "@/lib/jwt";
import jwt from "jsonwebtoken";
import cache from "@/lib/cache";
export async function POST(request) {
  const refreshCookie = request.cookies.get("refreshToken")?.value;
  if (refreshCookie) {
    try {
      await connectDB();
      await revokeRefreshToken(refreshCookie);
    } catch (err) {
      // Best-effort: a DB hiccup here must not block the user from logging
      // out client-side — the access token cookie is cleared below
      // regardless, and an unrevoked refresh token still expires on its own.
      console.error("Refresh token revocation failed during logout:", err);
    }
  }
  // Denylist the access token's jti until its natural expiry, same as
  // app/api/v1/auth/logout — middleware.js checks this key on every /api/*
  // and protected-page request so a "logged out" token stops working
  // immediately instead of staying valid for up to 7 days.
  const accessToken = request.cookies.get("token")?.value;
  const decoded = accessToken && verifyToken(accessToken);
  if (decoded?.jti) {
    const ttlSeconds = Math.max(1, (decoded.exp || 0) - Math.floor(Date.now() / 1000));
    await cache.set(`revoked:jti:${decoded.jti}`, 1, ttlSeconds);
  }

  // SEC-22: the same treatment for the superadmin token.
  //
  // This route already cleared the admin_token COOKIE below, which logs a
  // superadmin out of their browser — but a copy of that token kept working
  // for its full 8 hours, because nothing denylisted it. It is the highest
  // privilege credential in the product and it was the only one that could not
  // be revoked.
  //
  // Verified with ADMIN_JWT_SECRET, not JWT_SECRET: they are different
  // secrets, and verifying with the wrong one would silently never match.
  const adminToken = request.cookies.get("admin_token")?.value;
  if (adminToken && process.env.ADMIN_JWT_SECRET) {
    try {
      const adminDecoded = jwt.verify(adminToken, process.env.ADMIN_JWT_SECRET);
      if (adminDecoded?.jti) {
        const ttlSeconds = Math.max(
          1,
          (adminDecoded.exp || 0) - Math.floor(Date.now() / 1000),
        );
        await cache.set(`revoked:jti:${adminDecoded.jti}`, 1, ttlSeconds);
      }
    } catch {
      // Already expired or malformed — nothing to revoke, and a failure here
      // must never stop the cookies below from being cleared.
    }
  }
  const res = NextResponse.json({ success: true });
  res.cookies.set("token", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  res.cookies.set("admin_token", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
  clearRefreshCookie(res);
  return res;
}
