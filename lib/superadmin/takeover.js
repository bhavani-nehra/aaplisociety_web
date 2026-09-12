import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { signToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import TakeoverGrant from "@/models/TakeoverGrant";
import AuditLog from "@/models/AuditLog";

// See docs/superpowers/specs/2026-09-11-society-takeover-design.md for the
// full design. This module holds the pieces that don't belong to any one
// route: OTP generation/verification, duration limits, and minting the
// impersonation token itself.

// The only granted/requested durations the UI ever offers — also the
// enforcement boundary every route validates against.
export const ALLOWED_DURATIONS_MINUTES = [15, 30, 60, 120];
export const OTP_EXPIRY_MS = 5 * 60 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
// A grant must be activated (OTP verified) within this long of the admin's
// Approve click, or it lapses — enforced as the OTP's own expiry
// (app/api/v1/takeover/[id]/verify-otp), not a separate window: an
// approved-but-never-activated request is no better than one nobody
// looked at, and OTP_EXPIRY_MS already bounds exactly that.

/** 6-digit numeric OTP, cryptographically random (not Math.random). */
export function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

export async function hashOtp(otp) {
  return bcrypt.hash(String(otp), 10);
}

export async function otpMatches(otp, hash) {
  if (!otp || !hash) return false;
  return bcrypt.compare(String(otp), hash);
}

/**
 * Strip the claims signToken() will re-add (jti) or that conflict with a
 * fresh expiresIn (iat, exp) from a decoded token payload before reusing it
 * as the base for a new one. Also drops any stale `takeover` claim — a
 * takeover session token can never itself be the basis for minting another.
 */
export function sanitizeTokenPayloadForReissue(payload) {
  const { jti, iat, exp, takeover, ...rest } = payload || {};
  return rest;
}

/**
 * Mint the impersonation JWT. Carries the real society admin's own identity
 * — same shape their normal login token has — plus a `takeover` claim.
 * Because the identity is real, every existing route, RBAC check, and
 * per-route AuditLog write works completely unmodified; this is the entire
 * reason the design reuses the real dashboard instead of building a second
 * one. `expiresIn` is tied to the grant's own expiry so there is no second
 * place a session lifetime could drift out of sync with the grant record.
 */
export function mintImpersonationToken({
  adminTokenPayload,
  grantId,
  actorSuperAdminId,
  actorSuperAdminName,
  mode,
  ticketId,
  ticketTitle,
  expiresInSeconds,
}) {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  return signToken(
    {
      ...adminTokenPayload,
      takeover: {
        grantId: String(grantId),
        actorSuperAdminId: String(actorSuperAdminId),
        actorSuperAdminName,
        mode,
        ticketId: String(ticketId),
        ticketTitle: ticketTitle || "",
        // Static copy for the dashboard banner (see /api/auth/me) — no
        // extra round trip to render "expires HH:MM". The grant document's
        // own expiresAt (set from this same value) remains authoritative
        // for enforcement; this is display-only.
        expiresAt,
      },
    },
    { expiresIn: `${expiresInSeconds}s` },
  );
}

/**
 * Push a grant's minted token onto the existing logout denylist
 * (revoked:jti:<jti> — see app/api/auth/logout, app/api/v1/auth/logout,
 * checked by middleware.js's isRevoked) so it stops working on its very
 * next request. Reuses that infra rather than building a second one.
 */
async function denylistGrantToken(grant) {
  if (!grant.jti || !grant.expiresAt) return;
  const ttlSeconds = Math.max(1, Math.floor((new Date(grant.expiresAt).getTime() - Date.now()) / 1000));
  await cache.set(`revoked:jti:${grant.jti}`, 1, ttlSeconds);
}

/**
 * Society-admin or superadmin ending an active session early. Atomic: the
 * status-flip only takes effect if the grant was still "active" the
 * instant this runs, so two concurrent End clicks (a caller retrying after
 * a slow response, both sides clicking at once) produce exactly one
 * denylist write and one audit entry, not two.
 */
export async function endGrant(grant, { endedBy }) {
  const updated = await TakeoverGrant.findOneAndUpdate(
    { _id: grant._id, status: "active" },
    { $set: { status: "revoked", endedAt: new Date(), endedBy }, $unset: { mintedTokenOnce: "" } },
    { new: false },
  );
  if (!updated) return false; // someone else already ended (or it expired) first
  await denylistGrantToken(grant);
  await AuditLog.create({
    societyId: grant.societyId,
    action: "TAKEOVER_REVOKED",
    newData: { grantId: grant._id, endedBy },
  });
  return true;
}

/**
 * Lazily flip a past-expiry active grant to expired. Called wherever a
 * grant is read rather than on a schedule — this app deliberately has no
 * cron for takeover housekeeping (see the design spec: volume is far too
 * low to justify one), and the JWT's own `exp` already makes an expired
 * grant's token unusable regardless of when this catches up — this only
 * keeps the grant document and denylist in sync for the UI/audit trail.
 */
export async function syncExpiry(grant) {
  if (grant.status !== "active" || !grant.expiresAt || new Date(grant.expiresAt) > new Date()) {
    return grant;
  }
  const updated = await TakeoverGrant.findOneAndUpdate(
    { _id: grant._id, status: "active" },
    { $set: { status: "expired", endedAt: new Date(), endedBy: "system_expiry" }, $unset: { mintedTokenOnce: "" } },
    { new: false },
  );
  if (!updated) return { ...grant, status: "expired" }; // someone else (End, or another read) already caught it
  await denylistGrantToken(grant);
  await AuditLog.create({
    societyId: grant.societyId,
    action: "TAKEOVER_EXPIRED",
    newData: { grantId: grant._id },
  });
  return { ...grant, status: "expired", endedAt: new Date(), endedBy: "system_expiry" };
}

/**
 * Trim a grant document for any API response: drop the OTP hash/attempt
 * counters (never leave the server) and the raw impersonation token/jti
 * (bearer-credential-shaped, only ever handled inside the claim endpoint).
 */
export function sanitizeGrant(grant) {
  const { consent, jti, mintedTokenOnce, ...rest } = grant;
  return {
    ...rest,
    consent: consent
      ? {
          adminName: consent.adminName,
          otpChannel: consent.otpChannel,
          otpVerifiedAt: consent.otpVerifiedAt,
        }
      : null,
  };
}
