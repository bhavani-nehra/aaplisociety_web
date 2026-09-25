// Masked calling — Plan 03 §13/§14/§15.
//
// Provider-agnostic on purpose: this ships before a telephony provider is
// chosen (see docs/telephony-evaluation.md, §11/§12.1). What is enforced here
// does not change once a provider is wired in — only placeCall()'s body does.
//
// Hard rule, enforced here and nowhere else: the client never sends a phone
// number. resolveCallee() is the only place a callee is decided, and it is
// decided from the caller's own verified claims and (where the purpose needs
// one) a visitor record scoped to the caller's own society.
import crypto from "node:crypto";
import { ApiError } from "./http";
import { clientIp } from "./auth";
import { enforceRateLimit } from "./ratelimit";
import { ROLES } from "./constants";
import User from "@/models/User";
import Visitor from "@/models/Visitor";
import CallSession from "@/models/CallSession";
import AuditLog from "@/models/AuditLog";

export const CALL_PURPOSES = ["member_to_security", "guard_to_resident", "visitor_verification"];

// A guard dialing every resident in the building in a minute, or a member
// redialing a guard who hasn't picked up yet, are the two abuse shapes this
// closes: a coarse hourly ceiling, and a short per-caller cooldown so one
// finger on the button can't fire ten sessions before the first one rings.
const RATE_LIMIT = { windowMs: 60 * 60 * 1000, limit: 20 };
const COOLDOWN = { windowMs: 15 * 1000, limit: 1 };

export const RECORDING_ACCESS_ROLES = [ROLES.ADMIN, ROLES.SECRETARY];

/**
 * Resolve who the callee is. Never trusts anything from the client except
 * `purpose` and, for the purposes that need one, `visitorId` — both already
 * validated by callInitiateSchema before this runs.
 */
export async function resolveCallee({ societyId, purpose, callerRole, callerUserId, visitorId }) {
  if (purpose === "member_to_security") {
    if (callerRole !== ROLES.MEMBER) {
      throw new ApiError(403, "Only residents can call security this way.");
    }
    // No on-duty rota exists yet — this picks one active guard account for
    // the society. Ringing every guard at once is a provider-level ring-group
    // decision, made once §11's provider is wired, not a schema concern here.
    const guard = await User.findOne({ societyId, role: ROLES.SECURITY, isActive: true })
      .sort({ _id: 1 })
      .select("_id")
      .lean();
    if (!guard) throw new ApiError(404, "No security guard is available right now.");
    return { calleeUserId: guard._id, calleeRole: ROLES.SECURITY };
  }

  if (purpose === "guard_to_resident" || purpose === "visitor_verification") {
    if (callerRole !== ROLES.SECURITY) {
      throw new ApiError(403, "Only security can place this call.");
    }
    if (!visitorId) throw new ApiError(400, "visitorId is required for this call.");

    const visitor = await Visitor.findOne({ _id: visitorId, societyId }).select("memberId").lean();
    if (!visitor) throw new ApiError(404, "Visitor not found.");
    if (!visitor.memberId) throw new ApiError(404, "This visitor has no resident to call.");

    // A flat's user account may carry memberId at the root (legacy) or inside
    // profiles[] (current) — see lib/v1/notify.js's flatUsers for the same
    // shape split.
    // Not re-scoped by societyId here: visitor.memberId already came from a
    // visitor row filtered to this society, and a Member's societyId never
    // changes, so a match on memberId is already a same-society match.
    const resident = await User.findOne({
      $or: [{ memberId: visitor.memberId }, { "profiles.memberId": visitor.memberId }],
    })
      .select("_id")
      .lean();
    if (!resident) throw new ApiError(404, "No resident account found for this flat.");
    return { calleeUserId: resident._id, calleeRole: ROLES.MEMBER };
  }

  throw new ApiError(400, "Unknown call purpose.");
}

/**
 * Runs authorization, rate limiting, callee resolution and persistence for a
 * new call attempt, and audits it either way — a refused attempt is still
 * written, per §14.
 */
export async function initiateCall({ req, claims, societyId, purpose, visitorId }) {
  const callerUserId = claims.userId;
  const callerRole = claims.role;

  try {
    await enforceRateLimit(req, "calls-rate", {
      windowMs: RATE_LIMIT.windowMs,
      limit: RATE_LIMIT.limit,
      key: callerUserId,
      message: "Too many calls. Try again later.",
    });
    await enforceRateLimit(req, "calls-cooldown", {
      windowMs: COOLDOWN.windowMs,
      limit: COOLDOWN.limit,
      key: callerUserId,
      message: "Please wait a moment before calling again.",
    });

    const { calleeUserId, calleeRole } = await resolveCallee({
      societyId,
      purpose,
      callerRole,
      callerUserId,
      visitorId,
    });

    if (String(calleeUserId) === String(callerUserId)) {
      throw new ApiError(400, "Cannot call yourself.");
    }

    const session = await CallSession.create({
      societyId,
      callerUserId,
      callerRole,
      calleeUserId,
      calleeRole,
      visitorId: visitorId || null,
      purpose,
      status: "initiating",
      createdBy: callerUserId,
      ip: clientIp(req),
    });

    await AuditLog.create({
      userId: callerUserId,
      societyId,
      action: "CALL_INITIATED",
      newData: { callSessionId: session._id, purpose, calleeUserId, visitorId: visitorId || null },
    });

    return session;
  } catch (err) {
    // Refused attempts are audited too — misuse of a feature that hides both
    // parties' numbers has to be traceable even when the call never happened.
    await AuditLog.create({
      userId: callerUserId,
      societyId,
      action: "CALL_REFUSED",
      newData: {
        purpose,
        visitorId: visitorId || null,
        reason: err instanceof ApiError ? err.body?.error : "unexpected_error",
        status: err instanceof ApiError ? err.status : 500,
      },
    }).catch((auditErr) => {
      console.error("[v1/calls] could not audit refused call", auditErr?.message);
    });
    throw err;
  }
}

/** Constant-time signature check against the provider's shared secret. */
export function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(String(signature), "utf8");
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

const TERMINAL_STATUSES = ["completed", "failed", "no_answer", "busy"];

/**
 * Applies a provider status callback. Idempotent on providerCallId: once a
 * session reaches a terminal status, a retried or out-of-order webhook for
 * the same call is a no-op rather than overwriting the outcome.
 */
export async function applyProviderStatusUpdate({ providerCallId, status, durationSec, failureReason, recordingRef }) {
  if (!providerCallId) throw new ApiError(400, "providerCallId is required");
  if (!status) throw new ApiError(400, "status is required");

  const session = await CallSession.findOne({ providerCallId });
  if (!session) throw new ApiError(404, "Unknown call");

  if (TERMINAL_STATUSES.includes(session.status)) return session;

  session.status = status;
  if (status === "answered" && !session.answeredAt) session.answeredAt = new Date();
  if (TERMINAL_STATUSES.includes(status)) {
    session.endedAt = new Date();
    if (typeof durationSec === "number") session.durationSec = durationSec;
    if (failureReason) session.failureReason = failureReason;
  }
  if (recordingRef) session.recordingRef = recordingRef;
  await session.save();

  await AuditLog.create({
    societyId: session.societyId,
    action: "CALL_STATUS_UPDATED",
    newData: { callSessionId: session._id, providerCallId, status },
  });

  return session;
}
