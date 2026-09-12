import mongoose from "mongoose";

/**
 * Session-level access trail for a TakeoverGrant — one row per request made
 * under an impersonation token. Route/method level, not field level: the
 * field-by-field diff for an actual write already lands in the normal
 * AuditLog entry that route produces on its own (the impersonation token
 * carries the real society admin's identity, so every existing per-route
 * audit write fires exactly as it would for that admin's own session).
 *
 * This collection exists to answer "what did the superadmin look at" for a
 * read-only session, and to correlate with AuditLog for a write session —
 * not to duplicate it. See docs/superpowers/specs/2026-09-11-society-
 * takeover-design.md.
 *
 * Written from lib/authz.js#requireAuth, fire-and-forget (not awaited) —
 * safe here because this app runs as a long-lived Node process on
 * Coolify/Docker, not short-lived serverless functions, so an unawaited
 * promise still completes after the response is sent.
 */
const TakeoverAccessLogSchema = new mongoose.Schema({
  grantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TakeoverGrant",
    required: true,
    index: true,
  },
  method: { type: String, required: true },
  path: { type: String, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
});

export default mongoose.models.TakeoverAccessLog ||
  mongoose.model("TakeoverAccessLog", TakeoverAccessLogSchema);
