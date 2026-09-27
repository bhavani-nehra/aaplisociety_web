// The module catalogue, as data.
//
// Everything that gates a module reads this file: the API guard, the page
// guard, the sidebar, the mobile app's /v1/me payload, the coverage script and
// the grandfather migration. One definition, six consumers.
//
// ## Why a registry and not a check per route
//
// The likeliest way module gating fails is drift — a route added in month six
// that nobody remembers to gate, quietly serving a feature the society never
// bought. Scattering `if (society.features.amenities)` through two hundred
// handlers guarantees that outcome. A registry makes "which routes belong to
// Amenities" a fact one file can answer, which is what lets
// scripts/check-entitlement-coverage.mjs fail the build on an ungated route.
//
// ## Prefix matching is deliberate, and deliberately narrow
//
// A module claims path *prefixes*, not patterns. `/api/v1/amenities` covers
// every route beneath it forever, including ones not written yet — which is
// the point. But it also means a prefix must never be broader than the module:
// claiming `/api/v1` for anything would swallow the whole platform.
//
// ## RBAC is deliberately absent, and must stay absent
//
// "Advanced Access Control" used to be module 5 here, claiming /api/rbac/roles,
// /api/rbac/permissions, /api/rbac/assignments and /admin/rbac. It has been
// removed permanently. Two reasons, in order of weight:
//
//   1. Auditor and Treasurer are statutory offices under the MCS Act and the
//      model bye-laws. Every registered society must have them. Gating the
//      roles was gating compliance, which is not ours to sell.
//   2. There is no cost to recover. A Role doc is ~2 KB and a RoleAssignment
//      ~0.5 KB; the difference between a society running 7 roles and one
//      running 12 is ~20 KB. Across the whole platform that is single-digit
//      megabytes. Metering it would have been a price with no cost behind it.
//
// Role *scoping* (a role valid only for one wing, gate or financial year) is
// the one access-control feature worth money. It does not exist yet, and when
// it does it belongs to a size-based plan tier — not to a module gate here.
// Do not re-add an `rbac` entry. Re-gating a feature already given away costs
// more trust than never having given it.
//
// See docs/subscriptions-module-docs/00-plan.md for the reasoning behind which
// modules exist and why Accounting is not one of them.

export const BASE_MODULE = "base";

/**
 * @property key          stored under Society.features[key].enabled
 * @property label        shown to superadmins and in denial alerts
 * @property apiPrefixes  every API path this module owns
 * @property pagePaths    every page path this module owns
 * @property navGroups    ADMIN_NAVIGATION group titles to hide
 * @property dependsOn    modules that must also be enabled
 * @property models       what data survives while the module is off
 */
export const MODULES = [
  {
    key: "security",
    label: "Security & Visitors",
    description:
      "Guard app, visitor entry and exit, pre-approved passes, QR verification, watchlist, offline audit reconciliation.",
    apiPrefixes: [
      "/api/v1/visitors",
      "/api/v1/security",
      "/api/visitor",
      "/api/security",
      "/api/admin/visitors",
      "/api/admin/security-guards",
      "/api/admin/blacklist",
    ],
    pagePaths: ["/admin/visitors", "/admin/security-overview", "/admin/security-guards", "/admin/blacklist", "/security"],
    navGroups: ["Security"],
    dependsOn: [],
    models: ["Visitor", "VisitorPass", "Blacklist"],
  },
  {
    key: "amenities",
    label: "Amenities & Bookings",
    description:
      "Facility catalogue, bookings, attendance, QR check-in, events, incidents, maintenance schedules, usage analytics.",
    apiPrefixes: ["/api/v1/amenities", "/api/v1/clubhouse", "/api/amenities"],
    pagePaths: ["/admin/amenities"],
    navGroups: ["Amenities"],
    dependsOn: [],
    models: [
      "Amenity",
      "AmenityBooking",
      "AmenityAttendance",
      "AmenityEvent",
      "AmenityIncident",
      "AmenityQrToken",
    ],
  },
  {
    key: "commercial",
    label: "Commercial & Shops",
    description:
      "Shops and offices as billable units, business directory, per-shop rate card, commercial bill series.",
    apiPrefixes: ["/api/v1/shops", "/api/v1/shop", "/api/commercial"],
    pagePaths: ["/admin/commercial"],
    navGroups: ["Commercial"],
    // Commercial bills are bills. Without billing there is nothing to attach
    // a rate card to.
    dependsOn: [],
    models: ["Shop", "BusinessProfile", "CommercialBillingHead"],
  },
  {
    key: "tenancy",
    label: "Tenants & Rentals",
    description:
      "Tenant onboarding requests, lease lifecycle, move-out, rent collection, tenant login, tenant history.",
    apiPrefixes: [
      "/api/v1/tenant-requests",
      "/api/v1/tenant-history",
      "/api/v1/rent-payments",
      "/api/admin/tenant-requests",
      "/api/admin/tenants",
    ],
    pagePaths: ["/admin/tenant-requests"],
    navGroups: [],
    dependsOn: [],
    models: ["TenantRequest", "RentPayment"],
  },
  {
    key: "retention",
    label: "Retention Download & Purge",
    description:
      "Admin-downloadable archives of aged records and the automated purge that follows a download.",
    // Archival itself is base — it reduces what we hold. Only the download and
    // purge workflow is sold.
    apiPrefixes: ["/api/v1/retention"],
    pagePaths: ["/admin/data-archive"],
    navGroups: [],
    dependsOn: [],
    models: ["RetentionArchive"],
  },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);
const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

export function getModule(key) {
  return BY_KEY.get(key) || null;
}

/**
 * Paths that must NEVER be gated, whatever a society has or has not bought.
 *
 * The handover path is the important one: a society locked out for
 * non-payment must still be able to collect its own records. Holding data
 * hostage over an invoice turns a billing dispute into a regulatory
 * complaint. middleware.js already carves this out of the pause gate; this
 * keeps the two lists in agreement.
 */
export const NEVER_GATED = [
  "/api/v1/society-handover",
  "/admin/data-handover",
  "/api/rbac/my-access",
  "/api/auth",
  "/api/v1/auth",
  "/api/health",
];

export function isNeverGated(pathname) {
  if (!pathname) return false;
  return NEVER_GATED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Which module owns this path, or null if it is base.
 *
 * Longest prefix wins, so a specific claim beats a general one if the two ever
 * overlap. Returns the module object, not just the key, because every caller
 * needs the label for the message it is about to write.
 */
export function moduleForPath(pathname) {
  if (!pathname || isNeverGated(pathname)) return null;
  let best = null;
  let bestLength = 0;
  for (const mod of MODULES) {
    for (const prefix of [...mod.apiPrefixes, ...mod.pagePaths]) {
      const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
      if (matches && prefix.length > bestLength) {
        best = mod;
        bestLength = prefix.length;
      }
    }
  }
  return best;
}

/** Nav group titles hidden when the given entitlement set is in force. */
export function hiddenNavGroups(entitlements) {
  const hidden = new Set();
  for (const mod of MODULES) {
    if (!entitlements?.[mod.key]) mod.navGroups.forEach((g) => hidden.add(g));
  }
  return hidden;
}
