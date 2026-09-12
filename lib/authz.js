import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { getTokenFromRequest, verifyToken } from "./jwt";
import { logTakeoverAccess } from "./superadmin/takeoverAccessLog";
export const SOCIETY_ADMIN_ROLES = ["Admin", "Secretary"];
export const BILLING_WRITE_ROLES = ["Admin", "Secretary"];
// Accounting-module routes (Phase 2 of the accounting-system revamp — see
// docs/accounting-system-ARD.md §7). "Accountant" is a role that already
// existed as an unused constant in lib/v1/constants.js; this is the first
// place it's actually wired into an access-control check.
export const ACCOUNTING_ROLES = ["Admin", "Secretary", "Accountant"];
// Financial Year state transitions and other higher-stakes accounting
// actions (locking, approval) are Admin/Secretary only — Accountant can
// operate day-to-day accounting but not close/lock a period.
export const ACCOUNTING_CLOSE_ROLES = ["Admin", "Secretary"];
// Auditor Mode (Phase 2.19, §5.1/§7). Admin/Secretary can also operate it
// (they can already see the books), plus the dedicated Auditor role. The
// write variant is the same role gate — the mandatory-reason requirement is
// enforced by AuditorService, matching how VoucherService already enforces
// mandatory reasons on reject/cancel (checked in the service, not the guard).
export const AUDITOR_ROLES = ["Admin", "Secretary", "Auditor"];
function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}
function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}
export function requireAuth(request) {
  const token = getTokenFromRequest(request);
  if (!token) return unauthorized();
  const decoded = verifyToken(token);
  if (!decoded) return unauthorized("Invalid token");
  // Session-level access trail for a takeover session — see
  // docs/superpowers/specs/2026-09-11-society-takeover-design.md. Not
  // awaited: this function is called synchronously by ~every protected
  // route, and logging one page view must never add latency to a real
  // request. requireAuth itself stays sync for every existing caller.
  if (decoded.takeover) {
    logTakeoverAccess({
      grantId: decoded.takeover.grantId,
      method: request.method,
      path: request.nextUrl?.pathname || new URL(request.url).pathname,
    }).catch(() => {});
  }
  return { valid: true, user: decoded };
}
export function requireRoles(request, roles) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (!roles.includes(auth.user.role)) {
    return forbidden("Insufficient permissions");
  }
  if (!auth.user.societyId) {
    return forbidden("Society context required");
  }
  return auth;
}
export function requireSuperAdmin(request) {
  const token = request.cookies.get("admin_token")?.value;
  if (!token) return unauthorized();
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    console.error("ADMINJWTSECRET is not configured");
    return unauthorized("Admin auth is not configured");
  }
  try {
    const decoded = jwt.verify(token, secret);
    if (decoded.role !== "SuperAdmin") {
      return forbidden("Not authorized");
    }
    return { valid: true, admin: decoded };
  } catch {
    return unauthorized("Invalid token");
  }
}
// --- Visitor Management helpers ---
/**
 * Allows: Admin, Secretary, Security
 * Used in: /api/visitor/* routes
 */
export function requireVisitorAccess(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  const allowed = ["Admin", "Secretary", "Security"];
  if (!allowed.includes(auth.user.role) && !isRbacStaffToken(auth.user))
    return forbidden("Insufficient permissions");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}
/**
 * Security-role only gate.
 * Used for routes that only guards should call (log entry, scan pass).
 * Paired with a real authorize()/authorizeAny() call for RBAC-only staff
 * tokens — see isRbacStaffToken.
 */
export function requireSecurity(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (auth.user.role !== "Security" && !isRbacStaffToken(auth.user))
    return forbidden("Security role required");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}
// True for the new RBAC-only staff token shape (activeContext.hat === "staff"
// — e.g. a custom "Auditor" role built through the wizard, not the legacy
// literal role string). These routes ALWAYS pair this gate with a real
// authorize()/authorizeAny() call right after — that's the actual security
// boundary for this shape of token. Without this bypass, every one of these
// legacy gates 403's an RBAC-only staff role before the RBAC check ever
// runs, no matter what that role was actually granted.
function isRbacStaffToken(user) {
  return user?.activeContext?.hat === "staff";
}
/**
 * Accounting-module gate (Admin / Secretary / Accountant).
 * Used for routes under app/api/accounting/*.
 */
export function requireAccounting(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (!ACCOUNTING_ROLES.includes(auth.user.role) && !isRbacStaffToken(auth.user))
    return forbidden("Insufficient permissions");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}
/**
 * Accounting-close gate (Admin / Secretary only) — Financial Year state
 * transitions, locking, approval. Narrower than requireAccounting: an
 * Accountant can record day-to-day entries but not close/lock a period.
 */
export function requireAccountingClose(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (!ACCOUNTING_CLOSE_ROLES.includes(auth.user.role) && !isRbacStaffToken(auth.user))
    return forbidden("Insufficient permissions");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}
/** Auditor Mode read gate (Admin / Secretary / Auditor). */
export function requireAuditor(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (!AUDITOR_ROLES.includes(auth.user.role) && !isRbacStaffToken(auth.user))
    return forbidden("Insufficient permissions");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}
/** Auditor Mode write gate — same roles as requireAuditor; AuditorService enforces the mandatory reason. */
export function requireAuditorWrite(request) {
  return requireAuditor(request);
}

/* ------------------------------------------------------------------ amenities */

/** Roles that may configure amenities (categories, rules, hours, slots, QR). */
export const AMENITY_ADMIN_ROLES = ["Admin", "Secretary"];

/** Roles that may operate amenities day to day — adds Security for scanning,
 *  recording attendance and verifying visitors. Security deliberately cannot
 *  configure amenities or retroactively adjust attendance. */
export const AMENITY_OPS_ROLES = ["Admin", "Secretary", "Security"];

/** Amenity configuration gate (Admin / Secretary). */
export function requireAmenityAdmin(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (!AMENITY_ADMIN_ROLES.includes(auth.user.role) && !isRbacStaffToken(auth.user))
    return forbidden("Insufficient permissions");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}

/** Amenity operations gate (Admin / Secretary / Security). Fine-grained
 *  capability checks are then applied per route by lib/amenities/permissions.js. */
export function requireAmenityAccess(request) {
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  if (!AMENITY_OPS_ROLES.includes(auth.user.role) && !isRbacStaffToken(auth.user))
    return forbidden("Insufficient permissions");
  if (!auth.user.societyId) return forbidden("Society context required");
  return auth;
}