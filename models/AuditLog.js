import mongoose from "mongoose";
/**
 * Immutable audit trail.
 *
 * Note: userId/societyId are intentionally NOT required so that
 * pre-auth events (e.g. LOGIN_FAILURE for an unknown user) can still be
 * recorded without throwing.
 */
const AuditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: false,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        // ── existing ──
        "UPDATE_SOCIETY_CONFIG",
        "UPDATE_MATRIX_CONFIG",
        "GENERATE_BILLS",
        "RECORD_PAYMENT",
        "REVERSE_PAYMENT",
        "IMPORT_MEMBERS",
        "IMPORT_MEMBERS_ENHANCED",
        "UPDATE_MEMBER",
        "DELETE_MEMBER",
        "FINANCIAL_YEAR_CLOSE",
        "SECURITY_GUARD_CREATED",
        // ── auth ──
        "LOGIN_SUCCESS",
        "LOGIN_FAILURE",
        "LOGOUT",
        // ── security guard management ──
        "SECURITY_GUARD_UPDATED",
        "SECURITY_GUARD_DELETED",
        "SECURITY_GUARD_PASSWORD_RESET",
        // ── visitor management ──
        "VISITOR_CREATED",
        "VISITOR_APPROVED",
        "VISITOR_REJECTED",
        "VISITOR_ENTERED",
        "VISITOR_EXITED",
        "VISITOR_EXPIRED",
        "VISITOR_ESCALATED",
        "VISITOR_SOS",
        // ── offline visitor flow ──
        "VISITOR_OFFLINE_ENTRY",
        "VISITOR_ENTRY_CONFIRMED",
        "VISITOR_ENTRY_FLAGGED",
        // ── visitor passes ──
        "VISITOR_PASS_CREATED",
        "VISITOR_PASS_VERIFIED",
        "VISITOR_PASS_REVOKED",
        // ── watchlist ──
        "BLACKLIST_ADDED",
        "BLACKLIST_REMOVED",
        // ── contactability ──
        "MEMBER_CONTACT_FLAGGED",
        "MEMBER_CONTACT_CLEARED",
        // Soft delete / restore (Plan 02 §2). A flat is never hard-deleted:
        // its bills, receipts and ledger rows reference it, and removing the
        // row would orphan a society's financial history.
        "MEMBER_ARCHIVED",
        "MEMBER_RESTORED",
        // A copy of one person's records leaving the system (Plan 02 §8/§14).
        "MEMBER_EXPORTED",
        // commercial module (additive; existing actions untouched)
        "BUSINESS_PROFILE_CREATED",
        "BUSINESS_PROFILE_UPDATED",
        "BUSINESS_PROFILE_PUBLISHED",
        "BUSINESS_PROFILE_SUSPENDED",
        "BUSINESS_PROFILE_REACTIVATED",
        "COMMERCIAL_CATEGORY_CREATED",
        "COMMERCIAL_CATEGORY_UPDATED",
        "COMMERCIAL_UNIT_CLASSIFIED",
        "COMMERCIAL_FEATURE_ENABLED",
        "COMMERCIAL_FEATURE_DISABLED",
        "COMMERCIAL_BILLING_HEAD_CREATED",
        "COMMERCIAL_BILLING_HEAD_UPDATED",
        // ── RBAC (lib/rbac/rbac-audit.js RBAC_EVENTS) — never added, every
        // one of these has been silently failing to log since the RBAC
        // lockdown work started ──
        "ROLE_CREATED",
        "ROLE_UPDATED",
        "ROLE_DELETED",
        "ROLE_CLONED",
        "ROLE_DEFAULTS_RESTORED",
        "ROLE_ASSIGNED",
        "ROLE_UNASSIGNED",
        "PERMISSION_GRANTED",
        "PERMISSION_REVOKED",
        "USER_SUSPENDED",
        "USER_REACTIVATED",
        "AUTHZ_DENIED",
        "COMMERCIAL_BILLING_HEAD_DELETED",
        "COMMERCIAL_BILLING_HEAD_REORDERED",
        "COMMERCIAL_BILLING_HEAD_SEEDED",
        "COMMERCIAL_SETTINGS_UPDATED",
        "COMMERCIAL_SHOP_CREATED",
        "COMMERCIAL_SHOP_UPDATED",
        "COMMERCIAL_SHOP_DELETED",
        "SHOP_OWNER_INVITED",
        "SHOP_OWNER_LINKED",
        "SHOP_STOREFRONT_UPDATED",
        "SHOP_STOREFRONT_PUBLISHED",
        "SHOP_STOREFRONT_UNPUBLISHED",
        "SHOP_PRODUCT_CREATED",
        "SHOP_PRODUCT_UPDATED",
        "SHOP_PRODUCT_DELETED",
        "SHOP_ORDER_PLACED",
        "SHOP_ORDER_TRANSITIONED",
        // ── society lifecycle (lib/superadmin/societyAudit.js). Written with
        // societyId: null on purpose so the trail outlives the purge — see
        // that file for why. ──
        "SOCIETY_PAUSED",
        "SOCIETY_RESUMED",
        "SOCIETY_EXPORT_DOWNLOADED",
        "SOCIETY_EXPORT_VERIFIED",
        "SOCIETY_SOFT_DELETED",
        "SOCIETY_RESTORED",
        "SOCIETY_PURGED",
        "SOCIETY_QUICK_DELETED",
        "SOCIETY_HANDOVER_SENT",
        "SOCIETY_HANDOVER_DOWNLOADED",
        "SOCIETY_HANDOVER_CONFIRMED",
        "SOCIETY_HANDOVER_REMINDED",
        // ── platform subscriptions (superadmin) ──
        // Money and access changes made from the platform console. Kept as
        // distinct actions rather than folded into UPDATE_SOCIETY_CONFIG so
        // "who changed this society's plan, and when" is one query.
        "SUBSCRIPTION_PLAN_CHANGED",
        "SUBSCRIPTION_STATUS_CHANGED",
        "SUBSCRIPTION_PAYMENT_RECORDED",
        "SUBSCRIPTION_TRIAL_EXTENDED",
        "SUBSCRIPTION_DUE_DATE_CHANGED",
        "SUBSCRIPTION_MODULES_CHANGED",
        // Waiving gate 6 of society-purge — erasing a society that never
        // collected its own records. A judgement call, recorded as one.
        "SOCIETY_HANDOVER_WAIVED",
        "SOCIETY_HANDOVER_WAIVER_REMOVED",
        // ── society takeover (support-assisted remote access) — see
        // docs/superpowers/specs/2026-09-11-society-takeover-design.md.
        // Grant lifecycle events only; actual data writes made during an
        // active session produce their own normal AuditLog entry via the
        // route that made them (the impersonation token carries the real
        // admin's identity) — not duplicated here. ──
        "TAKEOVER_REQUESTED",
        "TAKEOVER_OTP_SENT",
        "TAKEOVER_GRANTED",
        "TAKEOVER_DENIED",
        "TAKEOVER_ACTIVATED",
        "TAKEOVER_REVOKED",
        "TAKEOVER_EXPIRED",
        // ── legal document acceptance (legal/*.md, lib/legal/documents.js) ──
        "TERMS_ACCEPTED",
        // ── ownership transfer (models/OwnershipTransfer.js, Plan 02 §4) ──
        // A flat changing hands is the highest-consequence non-financial event
        // in the product: it moves a home, a login, a ledger position and a
        // sitting tenant. Every step is recorded, not just the outcome.
        "OWNERSHIP_TRANSFER_INITIATED",
        "OWNERSHIP_TRANSFER_BUYER_INVITED",
        "OWNERSHIP_TRANSFER_BUYER_ACCEPTED",
        "OWNERSHIP_TRANSFER_APPROVED",
        "OWNERSHIP_TRANSFER_REJECTED",
        "OWNERSHIP_TRANSFER_CANCELLED",
        "OWNERSHIP_TRANSFER_EFFECTIVE",
        "OWNERSHIP_TRANSFER_CLOSED",
        // ── role handover (Plan 01 §10-§13) — atomic, no-consent replacement
        // of a single-holder role's active assignment. Distinct from
        // ROLE_ASSIGNED/ROLE_UNASSIGNED: those log two separate, unlinked
        // events for what is really one transaction; this is the one row
        // that names old holder, new holder, actor and the resulting access
        // diff together. ──
        "ROLE_HANDOVER",
        // ── masked calling (models/CallSession.js, Plan 03 §13/§14/§15) ──
        // One row per attempt, refused ones included, so misuse of the calling
        // feature is auditable even though neither party ever sees a number.
        "CALL_INITIATED",
        "CALL_REFUSED",
        "CALL_STATUS_UPDATED",
        "CALL_RECORDING_ACCESSED",
      ],
    },
    oldData: { type: mongoose.Schema.Types.Mixed },
    newData: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);
export default mongoose.models.AuditLog ||
  mongoose.model("AuditLog", AuditLogSchema);