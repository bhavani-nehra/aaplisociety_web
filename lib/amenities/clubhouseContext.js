import { getClaims } from "@/lib/v1/auth";
import { ApiError } from "@/lib/v1/http";
import { resolveEffectivePermissions, HAT } from "@/lib/rbac/permission-engine";
import { CAPABILITY, CLUBHOUSE_PERMISSION_BY_CAPABILITY } from "./permissions";
import { clientIp } from "@/lib/v1/auth";

// Authorisation for the /api/v1/clubhouse/* routes.
//
// This is the mobile counterpart of lib/amenities/apiHelpers.gate(): gate()
// authenticates a website cookie session, this authenticates a mobile Bearer
// token, and both end at the same RBAC leaves. It exists because the two auth
// surfaces genuinely differ — not to introduce a second permission system.
//
// Deny-by-default, twice over:
//   1. resolveEffectivePermissions() returns an EMPTY set on any failure, so an
//      RBAC lookup that errors refuses the request instead of waving it through.
//   2. Every route names the capability it needs, and a capability with no leaf
//      in CLUBHOUSE_PERMISSION_BY_CAPABILITY can never be satisfied here. That
//      is the mechanism, not a convention: MANAGE_CAPACITY has no entry, so no
//      clubhouse route can ever be written that changes a capacity.
//
// Hiding a button in Flutter is not authorisation. This is.

export async function clubhouseContext(request, capability) {
  const claims = await getClaims(request);

  // The mobile app resolves which environment to show from /auth/my-profiles;
  // the server does not trust that choice. Permissions are resolved for the
  // staff hat of the society in the token, so a Member+Manager user calling a
  // clubhouse route with their member context selected is refused.
  const permissions = await resolveEffectivePermissions({
    userId: claims.sub || claims.userId,
    societyId: claims.societyId,
    hat: HAT.STAFF,
  });

  const ctx = {
    societyId: claims.societyId,
    userId: claims.sub || claims.userId,
    name: claims.name || "",
    role: claims.role || "",
    permissions,
    actor: {
      userId: claims.sub || claims.userId,
      name: claims.name || "",
      // Recorded as the clubhouse role rather than the legacy account role
      // string, so "who did this" reads correctly in the activity log for a
      // staff member whose User.role is empty.
      role: "Clubhouse Manager",
      ip: clientIp(request),
      userAgent: request.headers.get("user-agent") || "",
    },
    has(cap) {
      const leaf = CLUBHOUSE_PERMISSION_BY_CAPABILITY[cap];
      return !!leaf && permissions.has(leaf);
    },
  };

  if (capability && !ctx.has(capability)) {
    // Same shape the website's authorize() returns, so the Flutter error
    // handling has one contract to read.
    throw new ApiError(403, {
      error: "You do not have permission to do that.",
      code: "FORBIDDEN",
      requiredPermission: CLUBHOUSE_PERMISSION_BY_CAPABILITY[capability] || null,
    });
  }

  return ctx;
}

// What the app is allowed to render, sent once with the dashboard so each tab
// does not have to probe endpoints to discover whether its buttons should
// exist. Purely cosmetic — every route re-checks its own capability.
export function clubhouseCapabilities(ctx) {
  return {
    checkIn: ctx.has(CAPABILITY.RECORD_ATTENDANCE),
    scan: ctx.has(CAPABILITY.SCAN_QR),
    changeStatus: ctx.has(CAPABILITY.CHANGE_STATUS),
    manageTimings: ctx.has(CAPABILITY.MANAGE_AVAILABILITY),
    manageSlots: ctx.has(CAPABILITY.MANAGE_SLOTS),
    manageMaintenance: ctx.has(CAPABILITY.MANAGE_MAINTENANCE),
    manageIncidents: ctx.has(CAPABILITY.MANAGE_INCIDENTS),
    publishNotice: ctx.has(CAPABILITY.MANAGE_NOTICE),
    // Always false, and stated explicitly rather than omitted so the app has a
    // positive signal to render capacity read-only instead of inferring it.
    manageCapacity: false,
  };
}
