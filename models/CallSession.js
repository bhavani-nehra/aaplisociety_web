import mongoose from "mongoose";
/**
 * CallSession — Plan 03 §13/§14/§15.
 *
 * Provider-agnostic on purpose: this model, and the route that writes it, ship
 * BEFORE a telephony provider is chosen (see docs/telephony-evaluation.md).
 * `provider`/`providerCallId`/`virtualNumber` stay empty until §11's decision
 * is made and an adapter is wired in lib/v1/calls.js.
 *
 * Hard rule enforced by the service, not by this schema: the client never
 * sends a phone number. The callee is always resolved server-side from the
 * caller's authenticated identity and, where the purpose needs one, a
 * visitor record — see resolveCallee() in lib/v1/calls.js.
 */
const CallSessionSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    callerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    callerRole: { type: String, required: true },
    calleeUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    calleeRole: { type: String, required: true },
    // Only set for purposes that are about a specific visit.
    visitorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Visitor",
      default: null,
      index: true,
    },
    purpose: {
      type: String,
      enum: ["member_to_security", "guard_to_resident", "visitor_verification"],
      required: true,
    },
    // Empty/null until a provider is wired (§11).
    provider: { type: String, default: null },
    // No `default: null` here: a schema default would make every session
    // WITHOUT a provider carry an explicit `providerCallId: null`, and a
    // sparse index only excludes a field that is truly ABSENT — not one
    // present with value null. With a default, the very first two sessions
    // ever created (there is no provider yet, so every session lacks one)
    // would collide on the unique index. Left undefined, the field is
    // genuinely absent and the sparse index skips it.
    providerCallId: { type: String },
    virtualNumber: { type: String, default: null },

    startedAt: { type: Date, default: Date.now },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    durationSec: { type: Number, default: null },

    status: {
      type: String,
      enum: ["initiating", "ringing", "answered", "completed", "failed", "no_answer", "busy"],
      default: "initiating",
      index: true,
    },
    failureReason: { type: String, default: null },

    // §15 — default off. Set only when the provider actually recorded the
    // call AND the society's policy has recording enabled. Never a public
    // URL: access goes through a dedicated route (§15) that mints a
    // short-lived signed URL and audits the read.
    recordingRef: { type: String, default: null },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    ip: { type: String, default: "" },
  },
  { timestamps: true },
);

// One row per attempt, looked up by who's on it and, for the webhook, by the
// provider's own id (idempotency — see applyProviderUpdate in lib/v1/calls.js).
CallSessionSchema.index({ societyId: 1, createdAt: -1 });
CallSessionSchema.index({ providerCallId: 1 }, { sparse: true, unique: true });

export default mongoose.models.CallSession || mongoose.model("CallSession", CallSessionSchema);
