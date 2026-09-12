// The Amenities permission matrix, in one place.
//
// The codebase already has role gates (lib/authz.js for the website,
// lib/v1/auth.js for mobile). What those cannot express is the *capability*
// level the brief specifies — e.g. Security may scan QR and record attendance
// but must not edit an amenity. Encoding capabilities rather than sprinkling
// role-array checks means the matrix in the docs and the matrix in the code are
// the same artefact.
import { ROLES } from "@/lib/v1/constants";

export const CAPABILITY = {
  // Configuration
  MANAGE_CATEGORIES: "MANAGE_CATEGORIES",
  MANAGE_AMENITIES: "MANAGE_AMENITIES",
  MANAGE_RULES: "MANAGE_RULES",
  MANAGE_AVAILABILITY: "MANAGE_AVAILABILITY",
  MANAGE_SLOTS: "MANAGE_SLOTS",
  MANAGE_CAPACITY: "MANAGE_CAPACITY",
  CHANGE_STATUS: "CHANGE_STATUS",
  MANAGE_MAINTENANCE: "MANAGE_MAINTENANCE",
  CONFIGURE_ATTENDANCE: "CONFIGURE_ATTENDANCE",
  CONFIGURE_QR: "CONFIGURE_QR",
  MANAGE_SETTINGS: "MANAGE_SETTINGS",
  // Reading the configured capacity is NOT the same capability as changing it.
  // The Clubhouse Manager needs the number on screen ("Pool 18/40") and must
  // never be able to turn 40 into 50 — capacity is physical infrastructure,
  // changed by an Admin when the amenity itself changes.
  VIEW_CAPACITY: "VIEW_CAPACITY",
  // Operations
  SCAN_QR: "SCAN_QR",
  RECORD_ATTENDANCE: "RECORD_ATTENDANCE",
  OVERRIDE_ATTENDANCE: "OVERRIDE_ATTENDANCE",
  ADJUST_ATTENDANCE: "ADJUST_ATTENDANCE",
  VERIFY_VISITORS: "VERIFY_VISITORS",
  MANAGE_EVENTS: "MANAGE_EVENTS",
  MANAGE_REGISTRATIONS: "MANAGE_REGISTRATIONS",
  MANAGE_NOTICE: "MANAGE_NOTICE",
  // Resident actions
  VIEW_AMENITIES: "VIEW_AMENITIES",
  SELF_CHECK_IN: "SELF_CHECK_IN",
  REGISTER_EVENT: "REGISTER_EVENT",
  JOIN_WAITLIST: "JOIN_WAITLIST",
  VIEW_OWN_ATTENDANCE: "VIEW_OWN_ATTENDANCE",
  SPONSOR_VISITOR: "SPONSOR_VISITOR",
  // Oversight
  VIEW_ANALYTICS: "VIEW_ANALYTICS",
  EXPORT_ANALYTICS: "EXPORT_ANALYTICS",
  VIEW_ALL_ATTENDANCE: "VIEW_ALL_ATTENDANCE",
  REPORT_INCIDENT: "REPORT_INCIDENT",
  VIEW_INCIDENTS: "VIEW_INCIDENTS",
  MANAGE_INCIDENTS: "MANAGE_INCIDENTS",
  VIEW_ACTIVITY_LOG: "VIEW_ACTIVITY_LOG",
};

const C = CAPABILITY;

const ADMIN_CAPS = Object.values(CAPABILITY);

const SECRETARY_CAPS = ADMIN_CAPS;

// Accountant sees the books, not the pool rota. Read-only oversight so paid
// amenities (deferred) already have a reader when billing lands.
const ACCOUNTANT_CAPS = [C.VIEW_AMENITIES, C.VIEW_ANALYTICS, C.EXPORT_ANALYTICS, C.VIEW_INCIDENTS];

const AUDITOR_CAPS = [
  C.VIEW_AMENITIES,
  C.VIEW_ANALYTICS,
  C.EXPORT_ANALYTICS,
  C.VIEW_ALL_ATTENDANCE,
  C.VIEW_INCIDENTS,
  C.VIEW_ACTIVITY_LOG,
];

// Exactly the brief's Security list: scan, attendance, visitor verification,
// today's events, report incidents. Deliberately no configuration capability.
const SECURITY_CAPS = [
  C.VIEW_AMENITIES,
  C.SCAN_QR,
  C.RECORD_ATTENDANCE,
  C.OVERRIDE_ATTENDANCE,
  C.VERIFY_VISITORS,
  C.VIEW_ALL_ATTENDANCE,
  C.REPORT_INCIDENT,
];

// ---------------------------------------------------------------------------
// Clubhouse Manager — an OPERATIONS role, not an administrator.
//
// Everything here is something a person standing at the clubhouse desk does on
// a phone during their shift. Everything deliberately absent is configuration
// that outlives the shift: MANAGE_CAPACITY, MANAGE_AMENITIES,
// MANAGE_CATEGORIES, MANAGE_RULES, CONFIGURE_ATTENDANCE, CONFIGURE_QR,
// MANAGE_SETTINGS, EXPORT_ANALYTICS.
//
// This list is one half of the boundary; the other half is
// CLUBHOUSE_PERMISSION_BY_CAPABILITY below, which is what the mobile routes
// actually enforce against the assigned RBAC role. Both must agree.
export const CLUBHOUSE_MANAGER_CAPS = [
  C.VIEW_AMENITIES,
  C.VIEW_CAPACITY,
  C.SCAN_QR,
  C.RECORD_ATTENDANCE,
  C.VIEW_ALL_ATTENDANCE,
  C.CHANGE_STATUS,
  C.MANAGE_AVAILABILITY,
  C.MANAGE_SLOTS,
  C.MANAGE_MAINTENANCE,
  C.REPORT_INCIDENT,
  C.VIEW_INCIDENTS,
  C.MANAGE_INCIDENTS,
  C.VIEW_ANALYTICS,
  C.MANAGE_NOTICE,
];

const MEMBER_CAPS = [
  C.VIEW_AMENITIES,
  C.SELF_CHECK_IN,
  C.REGISTER_EVENT,
  C.JOIN_WAITLIST,
  C.VIEW_OWN_ATTENDANCE,
  C.SPONSOR_VISITOR,
  C.REPORT_INCIDENT,
];

// Legacy account-role matrix. Untouched semantics: these are the role strings
// that live on User.role and arrive in a token's `role` claim.
const LEGACY_CAPABILITY_MATRIX = {
  [ROLES.SUPER_ADMIN]: ADMIN_CAPS,
  [ROLES.ADMIN]: ADMIN_CAPS,
  [ROLES.SECRETARY]: SECRETARY_CAPS,
  [ROLES.ACCOUNTANT]: ACCOUNTANT_CAPS,
  [ROLES.AUDITOR]: AUDITOR_CAPS,
  [ROLES.SECURITY]: SECURITY_CAPS,
  [ROLES.MEMBER]: MEMBER_CAPS,
};

// Clubhouse Manager is an RBAC custom/system role, NOT a legacy role string on
// User.role, so it is keyed by the RBAC role key rather than added to ROLES in
// lib/v1/constants. That is the whole point of decision "no second account
// system": the person signs in with the account they already have.
export const CLUBHOUSE_MANAGER_ROLE_KEY = "clubhouseManager";

export const CAPABILITY_MATRIX = {
  [CLUBHOUSE_MANAGER_ROLE_KEY]: CLUBHOUSE_MANAGER_CAPS,
  ...LEGACY_CAPABILITY_MATRIX,
};

// The RBAC leaf id each clubhouse capability is enforced with on the mobile
// routes. The capability list above documents the role; THIS is the boundary
// the server checks, so a UI that forgets to hide a button still gets a 403.
//
// MANAGE_CAPACITY is intentionally absent: there is no leaf that grants it to
// this role, so no combination of grants can produce a capacity write.
export const CLUBHOUSE_PERMISSION_BY_CAPABILITY = {
  [C.VIEW_AMENITIES]: "amenities.clubhouse.view",
  [C.VIEW_CAPACITY]: "amenities.clubhouse.view",
  [C.VIEW_ALL_ATTENDANCE]: "amenities.clubhouse.view",
  [C.VIEW_ANALYTICS]: "amenities.clubhouse.view",
  [C.SCAN_QR]: "amenities.clubhouse.checkIn",
  [C.RECORD_ATTENDANCE]: "amenities.clubhouse.checkIn",
  [C.CHANGE_STATUS]: "amenities.clubhouse.operate",
  [C.MANAGE_AVAILABILITY]: "amenities.clubhouse.operate",
  [C.MANAGE_SLOTS]: "amenities.clubhouse.operate",
  [C.MANAGE_MAINTENANCE]: "amenities.clubhouse.maintenance",
  [C.REPORT_INCIDENT]: "amenities.clubhouse.incident",
  [C.VIEW_INCIDENTS]: "amenities.clubhouse.view",
  [C.MANAGE_INCIDENTS]: "amenities.clubhouse.incident",
  [C.MANAGE_NOTICE]: "amenities.clubhouse.notice",
};

export function capabilitiesFor(role) {
  return CAPABILITY_MATRIX[role] || [];
}

export function can(role, capability) {
  return capabilitiesFor(role).includes(capability);
}

// Roles that may reach the admin surface at all — used to gate the website
// pages and the /api/amenities/* namespace.
export const AMENITY_ADMIN_ROLES = [ROLES.ADMIN, ROLES.SECRETARY];
export const AMENITY_OPS_ROLES = [ROLES.ADMIN, ROLES.SECRETARY, ROLES.SECURITY];
export const AMENITY_READ_ROLES = [
  ROLES.ADMIN,
  ROLES.SECRETARY,
  ROLES.SECURITY,
  ROLES.ACCOUNTANT,
  ROLES.AUDITOR,
  ROLES.MEMBER,
];

// ---------------------------------------------------------------------------
// Resident eligibility for a specific amenity.
//
// Distinct from role capability: a tenant has SELF_CHECK_IN in general but may
// be barred from the clubhouse, and a 6-year-old may be barred from the gym.
// Returns a reason so the app can explain the refusal instead of greying a
// button out for no visible cause.
// ---------------------------------------------------------------------------
export function checkEligibility({ amenity, occupancyType, role, age }) {
  const access = amenity?.access || {};
  const audience = access.audience || "EVERYONE";
  const isOwner = occupancyType !== "Tenant";

  if (audience === "OWNERS" && !isOwner) {
    return { eligible: false, reason: "This amenity is restricted to flat owners" };
  }
  if (audience === "TENANTS" && isOwner) {
    return { eligible: false, reason: "This amenity is restricted to tenants" };
  }
  if (audience === "STAFF" && role !== ROLES.SECURITY) {
    return { eligible: false, reason: "This amenity is restricted to society staff" };
  }
  if (audience === "COMMITTEE" && ![ROLES.ADMIN, ROLES.SECRETARY].includes(role)) {
    return { eligible: false, reason: "This amenity is restricted to committee members" };
  }
  if (audience === "CUSTOM") {
    const allowed = access.customRoles || [];
    // Custom roles are matched against the account role and the occupancy type,
    // case-insensitively, so "Owner"/"owner"/"Tenant" all resolve.
    const mine = [role, occupancyType].filter(Boolean).map((s) => String(s).toLowerCase());
    if (!allowed.some((r) => mine.includes(String(r).toLowerCase()))) {
      return { eligible: false, reason: "Your resident category cannot use this amenity" };
    }
  }
  if (typeof age === "number") {
    if (access.minAge != null && age < access.minAge) {
      return { eligible: false, reason: `Minimum age for this amenity is ${access.minAge}` };
    }
    if (access.maxAge != null && age > access.maxAge) {
      return { eligible: false, reason: `Maximum age for this amenity is ${access.maxAge}` };
    }
  }
  return { eligible: true, reason: null };
}
