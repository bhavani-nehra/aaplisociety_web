import mongoose from "mongoose";

/**
 * A superadmin's request to remotely view/act on one society's live
 * dashboard, and the society admin's consent record for it.
 *
 * See docs/superpowers/specs/2026-09-11-society-takeover-design.md for the
 * full flow and the DPDP Act 2023 / DPDP Rules 2025 reasoning behind this
 * shape. Short version: one grant = one scope (read XOR write) so "what did
 * the admin actually agree to" is never ambiguous, consent is OTP-verified
 * (not just a click), and every field here exists to answer "who accessed
 * what, for how long, with whose permission" if that's ever asked.
 *
 * The OTP itself lives on this document rather than a separate collection —
 * one grant has at most one OTP in flight at a time, so there's nothing a
 * second collection would buy beyond ceremony.
 */
const TakeoverGrantSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportTicket",
      required: true,
      index: true,
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },

    // SuperAdmin is a separate auth collection from User (see
    // lib/admin-models.js) — stored as a plain string id, not a ref.
    requestedBy: { type: String, required: true },
    requestedByName: { type: String, required: true },

    // One grant, one scope. Needing the other later is a fresh request,
    // fresh consent, fresh OTP.
    scope: { type: String, enum: ["read", "write"], required: true },
    requestedDurationMinutes: { type: Number, required: true },
    // Set by the society admin at consent time — not bound by what the
    // superadmin suggested.
    grantedDurationMinutes: { type: Number, default: null },

    status: {
      type: String,
      enum: ["awaiting_consent", "pending_otp", "active", "expired", "revoked", "denied"],
      default: "awaiting_consent",
      index: true,
    },

    consent: {
      adminUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      adminName: { type: String, default: null },
      otpChannel: { type: String, enum: ["email"], default: "email" },
      otpHash: { type: String, default: null, select: false },
      otpExpiresAt: { type: Date, default: null },
      otpAttempts: { type: Number, default: 0 },
      // Separate cap from otpAttempts (wrong-code guesses) — resending is a
      // "the email didn't arrive" escape hatch, capped lower so it can't
      // also be used to fish for delivery timing/spam a mailbox.
      resendCount: { type: Number, default: 0 },
      otpVerifiedAt: { type: Date, default: null },
      ip: { type: String, default: null },
      userAgent: { type: String, default: null },
    },

    // The minted impersonation token's jti — revoking a session writes this
    // to the existing logout denylist (revoked:jti:<jti> in lib/cache),
    // reusing infra that already exists rather than building a second one.
    jti: { type: String, default: null },
    // The raw impersonation JWT, held only between OTP verification and the
    // superadmin's browser claiming it (setting it as their own cookie).
    // Cleared the instant it's claimed — see app/api/superadmin/takeover/
    // [id]/claim/route.js. select:false so it never rides along on an
    // ordinary .find()/.lean() the way the OTP hash doesn't either.
    mintedTokenOnce: { type: String, default: null, select: false },

    activatedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    endedBy: {
      type: String,
      enum: ["society_admin", "superadmin", "system_expiry", null],
      default: null,
    },
  },
  { timestamps: true },
);

TakeoverGrantSchema.index({ societyId: 1, status: 1 });
TakeoverGrantSchema.index({ ticketId: 1, createdAt: -1 });

export default mongoose.models.TakeoverGrant ||
  mongoose.model("TakeoverGrant", TakeoverGrantSchema);
