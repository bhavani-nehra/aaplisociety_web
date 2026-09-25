import mongoose from "mongoose";
/**
 * Visitor
 * One row per physical visit / entry request.
 *
 * Lifecycle:
 *   Pending → Approved → Entered → Exited
 *   Pending → Rejected
 *   Pending → Expired           (no response within approval window)
 *
 * Entry methods:
 *   Manual  — guard logged at the gate, needs resident approval
 *   Pass    — pre-approved via OTP/QR (auto-Entered)
 *   SOS     — created as part of an SOS/panic event
 */
const EscalationStepSchema = new mongoose.Schema(
  {
    level: { type: Number, required: true }, // 0-based ladder index
    channel: {
      type: String,
      enum: [
        "in_app",
        "push",
        "sms",
        "whatsapp",
        "email",
        "guard_call",
        "admin_alert",
      ],
      required: true,
    },
    target: { type: String, default: "" }, // phone / email / userId (never the secret)
    recipientRole: { type: String, default: "" }, // Owner | Tenant | Guard | Admin
    ok: { type: Boolean, default: false }, // delivery acknowledged by provider
    error: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);
const VisitorSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, maxlength: 20, default: "" },
    photo: { type: String, trim: true, default: "" }, // legacy URL
    // Canonical R2 object key. The upload route already wrote this field, but
    // it was missing from the strict schema and was therefore discarded.
    photoKey: { type: String, trim: true, default: null },
    phoneConfirmation: {
      decision: { type: String, enum: ["Allow", "Deny"] },
      decisionSource: { type: String },
      note: { type: String },
      guardId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      memberId: { type: mongoose.Schema.Types.ObjectId, ref: "Member" },
      decidedAt: { type: Date },
      ip: { type: String },
      device: { type: String },
    },
    vehicleNumber: { type: String, trim: true, uppercase: true, default: "" },
    purpose: {
      type: String,
      enum: ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"],
      required: true,
    },
    purposeNote: { type: String, trim: true, maxlength: 300, default: "" },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Entered", "Exited", "Expired"],
      default: "Pending",
      index: true,
    },
    entryMethod: {
      type: String,
      // SEC-23: "GuardRequest" was missing here while `lib/v1/models.js` — the
      // other schema mapped onto this same `visitors` collection — has always
      // allowed it, and `app/api/v1/visitors/guard-request/route.js:43,56`
      // writes it.
      //
      // Measured against the database: 10 of 14 existing visitor documents
      // carry `entryMethod: "GuardRequest"` and therefore FAILED this schema's
      // validators. The nine web routes that call `.save()` (approve,
      // guard-admit, confirm-entry, remind, extend, log, offline-entry,
      // pass/verify, pass/[id]) all run validators, so a guard-requested
      // visitor could not be actioned from the web dashboard at all.
      //
      // Same root cause as the `enteredBy` fix below: two schemas over one
      // collection, drifting apart. This is the second confirmed instance.
      enum: ["Manual", "Pass", "SOS", "OfflineEntry", "GuardRequest"],
      default: "Manual",
      index: true,
    },
    offlineMeta: {
      wasOffline: { type: Boolean, default: false },
      queuedAt: { type: Date, default: null }, // when the guard captured it on-device
      syncedAt: { type: Date, default: null }, // when it reached the server
      note: { type: String, trim: true, maxlength: 500, default: "" },
      clientRef: { type: String, default: "" }, // de-dupe key from the device
      confirmation: {
        status: {
          type: String,
          enum: ["Pending", "Acknowledged", "Flagged"],
          default: "Pending",
        },
        at: { type: Date, default: null },
        by: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
      },
    },
    // Pre-approved pass linkage (when entryMethod === 'Pass')
    passId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VisitorPass",
      default: null,
    },
    // Optional linkage to a complaint (e.g. vendor visiting for a repair)
    linkedComplaintId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Complaint",
      default: null,
    },
    // Watchlist snapshot at the time of entry (audit-safe even if list changes later)
    isBlacklisted: { type: Boolean, default: false },
    blacklistReason: { type: String, trim: true, default: "" },
    // Timing
    entryTime: { type: Date, default: Date.now, index: true },
    exitTime: { type: Date, default: null },
    // Resident approval window — after this, a Pending visit auto-Expires
    expiresAt: { type: Date, default: null, index: true },
    // Decision audit
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: { type: Date, default: null },
    approverRole: { type: String, default: "" }, // Owner | Tenant | Admin
    // The guard who physically admitted this visitor.
    //
    // SEC-23: `required: true` was wrong, and actively broke a cross-surface
    // flow. Two schemas are mapped onto the `visitors` collection —
    // this one (used by /api/visitor/*, the web guard dashboard) and the one
    // in lib/v1/models.js (used by /v1/visitors/*, the Flutter app) — and only
    // this one marked the field required.
    //
    // A visitor created from the mobile app carries no `enteredBy`: the v1
    // schema does not require it, and correctly so, because a *Pending*
    // visitor has not been admitted by anybody yet. The field describes an
    // event that has not happened.
    //
    // The nine web routes that call `.save()` (approve, guard-admit,
    // confirm-entry, remind, extend, …) run validators, so acting on one of
    // those mobile-created visitors from the web dashboard threw
    // `ValidationError: Path 'enteredBy' is required.` and surfaced as a 500.
    //
    // Set when entry is actually recorded, not before. See
    // final_audit_fix_plan/07-execution-log.md for the wider point: two
    // schemas over one collection is the underlying hazard, and this is one
    // symptom of it.
    enteredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    }, // guard
    gateLabel: { type: String, trim: true, default: "Main Gate" },

    // ── SEC-23: fields the mobile surface persists ──────────────────────────
    //
    // Declared here as part of unifying the two schemas that were mapped onto
    // the `visitors` collection. Both were written by /v1 routes through
    // `.save()` on a hydrated document, and both survived only because the
    // mirror schema in lib/v1/models.js was `strict: false`. Once v1 reads
    // through THIS schema, an undeclared path would be silently discarded —
    // which is exactly the `photoKey` incident noted above, and the reason
    // each of these is declared rather than relying on loose mode.
    //
    // Deliberately NOT declared: flatNo, wing, ownerName, contactNumber,
    // guardName, guardPhone, photoUrl, sosResolved. Those are assigned onto
    // `.lean()` objects in app/api/v1/visitors/route.js purely to shape the
    // API response, are never saved, and would be schema bloat describing
    // data that does not exist on the document.

    // Set by POST /v1/visitors/:id/reassign — moves an open visit to another
    // guard on duty.
    assignedGuardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Set by POST /v1/visitors/:id/sos-ack — who acknowledged an SOS, and when.
    // The v1 route calls `visitor.markModified("sosAck")`, which is only
    // necessary for a path Mongoose does not know about; declaring it here is
    // what makes that unnecessary and makes the subfields cast correctly.
    sosAck: {
      at: { type: Date, default: null },
      byRole: { type: String, default: null },
      byName: { type: String, default: null },
      note: { type: String, default: null },
      // Legacy shape written by older builds; read as a fallback in
      // app/api/v1/visitors/route.js.
      by: { type: String, default: null },
    },

    // Zero-dead-end escalation ladder state
    escalation: {
      level: { type: Number, default: 0 },
      stopped: { type: Boolean, default: false },
      lastNotifiedAt: { type: Date, default: null },
      history: { type: [EscalationStepSchema], default: [] },
    },
  },
  { timestamps: true },
);
VisitorSchema.index({ societyId: 1, createdAt: -1 });
VisitorSchema.index({ societyId: 1, memberId: 1, createdAt: -1 });
VisitorSchema.index({ societyId: 1, status: 1, createdAt: -1 });
// For the escalation sweeper: find Pending visits whose window is closing.
VisitorSchema.index({ status: 1, expiresAt: 1, "escalation.stopped": 1 });
VisitorSchema.index(
  { societyId: 1, "offlineMeta.clientRef": 1 },
  {
    unique: true,
    partialFilterExpression: {
      "offlineMeta.clientRef": { $type: "string", $gt: "" },
    },
  },
);
export default mongoose.models.Visitor ||
  mongoose.model("Visitor", VisitorSchema);