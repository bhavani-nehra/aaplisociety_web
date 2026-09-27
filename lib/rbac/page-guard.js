/**
 * ============================================================================
 * AapliSociety RBAC — Server-side PAGE guard (Phase 2)
 * ============================================================================
 * WHY THIS EXISTS (conflict resolution — see HANDOVER-PHASE-2.md § Conflict #1):
 * Next.js middleware runs on the EDGE runtime and cannot open a Mongo/Redis
 * connection, so it cannot resolve DB-backed effective permissions or check the
 * live sessionEpoch. The frozen blueprint requires page-level permission gating
 * AND a sessionEpoch check. Rather than redesign, we SPLIT enforcement:
 *   - middleware.js  = coarse, fail-closed gate (valid token? hat allowed on
 *                       this path prefix?) with NO DB access.
 *   - page-guard.js  = fine-grained, DB-backed gate called at the top of each
 *                       protected Server Component / layout. This is where the
 *                       page permission + sessionEpoch are enforced and where a
 *                       denial redirects to "/my-access" (Rule 8).
 *
 * Usage (Phase 3 wires this into pages):
 *   import { requirePagePermission } from "@/lib/rbac/page-guard";
 *   export default async function BillingPage() {
 *     const ctx = await requirePagePermission("billing.dashboard.view");
 *     ... // ctx = { userId, societyId, hat }
 *   }
 * ============================================================================
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { verifyToken, isMemberToken } from "@/lib/jwt";
import {
  resolveEffectivePermissions,
  can,
  HAT,
} from "@/lib/rbac/permission-engine";

const ACCESS_COOKIE = process.env.ACCESS_TOKEN_COOKIE || "token";

function contextFromDecoded(decoded) {
  // verifyToken() returns null (it does not throw) for an expired or bad
  // token. An access token that lapsed while the refresh cookie is still good
  // must go through the resume page, not crash on decoded.userId.
  if (!decoded) redirect("/auth/resume");
  const userId = decoded.userId || decoded.sub || decoded.id;
  const societyId =
    decoded.activeContext?.societyId || decoded.societyId || null;
  const hat =
    decoded.activeContext?.hat === HAT.MEMBER ||
    isMemberToken?.(decoded) ||
    decoded.role === "Member"
      ? HAT.MEMBER
      : HAT.STAFF;
  return { userId, societyId, hat, sessionEpoch: decoded.sessionEpoch || 0 };
}

/**
 * Enforce a page permission in a Server Component. Redirects (never returns) on
 * any failure — deny-by-default and fail-closed.
 * @param {string} permissionId page-access permission, e.g. "billing.dashboard.view"
 * @returns {Promise<{userId,societyId,hat}>}
 */
export async function requirePagePermission(permissionId) {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/auth/login");

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    redirect("/auth/login");
  }
  const ctx = contextFromDecoded(decoded);
  if (!ctx.userId || !ctx.societyId) redirect("/auth/login");

  try {
    await connectDB();
    const user = await User.findById(ctx.userId)
      .select("sessionEpoch status")
      .lean();
    if (!user || user.status === "suspended") redirect("/auth/login");
    if ((decoded.sessionEpoch || 0) < (user.sessionEpoch || 0))
      redirect("/auth/login"); // stale token

    const perms = await resolveEffectivePermissions({
      userId: ctx.userId,
      societyId: ctx.societyId,
      hat: ctx.hat,
    });
    if (!can(perms, permissionId)) {
      // Rule 8: every page authorization failure routes through My Access.
      redirect(`/my-access?denied=${encodeURIComponent(permissionId)}`);
    }
  } catch (err) {
    // redirect() throws internally; re-throw so Next can handle the navigation.
    if (err?.digest?.startsWith?.("NEXT_REDIRECT")) throw err;
    console.error("[rbac] page-guard failed (fail-closed):", err?.message);
    redirect("/my-access");
  }
  return { userId: ctx.userId, societyId: ctx.societyId, hat: ctx.hat };
}

/**
 * Same as requirePagePermission, but passes if the user has ANY of the
 * given permissions — for a merged page like /admin/accounting/books
 * (vouchers + journal-entries + audit-trail, design doc §12 Phase 4) where a
 * role might legitimately have only one of the three underlying perms and
 * still needs to reach the page to use that one tab.
 * @param {string[]} permissionIds
 */
export async function requirePagePermissionAny(permissionIds) {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token) redirect("/auth/login");

  let decoded;
  try {
    decoded = verifyToken(token);
  } catch {
    redirect("/auth/login");
  }
  const ctx = contextFromDecoded(decoded);
  if (!ctx.userId || !ctx.societyId) redirect("/auth/login");

  try {
    await connectDB();
    const user = await User.findById(ctx.userId).select("sessionEpoch status").lean();
    if (!user || user.status === "suspended") redirect("/auth/login");
    if ((decoded.sessionEpoch || 0) < (user.sessionEpoch || 0)) redirect("/auth/login");

    const perms = await resolveEffectivePermissions({
      userId: ctx.userId,
      societyId: ctx.societyId,
      hat: ctx.hat,
    });
    if (!permissionIds.some((id) => can(perms, id))) {
      redirect(`/my-access?denied=${encodeURIComponent(permissionIds[0])}`);
    }
  } catch (err) {
    if (err?.digest?.startsWith?.("NEXT_REDIRECT")) throw err;
    console.error("[rbac] page-guard (any) failed (fail-closed):", err?.message);
    redirect("/my-access");
  }
  return { userId: ctx.userId, societyId: ctx.societyId, hat: ctx.hat };
}

export default requirePagePermission;
