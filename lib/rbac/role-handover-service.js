/**
 * ============================================================================
 * AapliSociety RBAC — Role handover (Plan 01 §10-§13, Phase 3)
 * ============================================================================
 * Atomic, no-consent replacement of a single-holder role's active assignment.
 * Before this, an admin's only option was manually revoking one assignment
 * and creating another through the RBAC page — no atomicity, no epoch bump
 * on the old holder, no audit linkage, and a window where the role had two
 * active holders or none.
 *
 * Distinct from lib/rbac/assignment-service.js's assignRole()/unassignRole():
 * those are separate, independently-auditable primitives correctly used
 * everywhere a role is granted or revoked on its own. Handover exists
 * because "B replaces A, right now" is a single business event, not two
 * unrelated ones an admin happens to perform back to back — and because
 * MP1 §11 requires A's token to stop being privileged in the SAME request
 * that hands the role to B, not in a background job.
 *
 * Route-level permission check (`rbac.role.handover`) happens in
 * app/api/rbac/roles/[id]/handover/route.js via authorize() — this
 * service assumes that has already passed and focuses on the domain rules a
 * permission leaf can't express: both users really in this society, the
 * role really being single-holder, the target not already holding it.
 * ============================================================================
 */
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import User from "@/models/User";
import { resolveEffectivePermissions, HAT } from "@/lib/rbac/permission-engine";
import { onRbacMutation, bumpSessionEpoch } from "@/lib/rbac/session";
import { logAudit } from "@/lib/audit-logger";
import { sendEmail } from "@/lib/brevo-email";
import Notification from "@/models/Notification";

export class HandoverError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** True for every role a society may only have one active holder of. */
function isSingleHolderRole(roleKey) {
  return roleKey !== "security";
}

/**
 * @param {object} p
 * @param {string} p.societyId
 * @param {string} p.actorId    - the admin performing the handover (already authorized)
 * @param {string} p.roleKey
 * @param {string} p.fromUserId - current holder
 * @param {string} p.toUserId   - incoming holder
 * @param {string} p.reason
 * @returns {Promise<{ oldAssignmentId:string, newAssignmentId:string, roleKey:string }>}
 */
export async function handoverRole({ societyId, actorId, roleKey, fromUserId, toUserId, reason }) {
  await connectDB();

  if (!isSingleHolderRole(roleKey)) {
    throw new HandoverError(
      `"${roleKey}" is held by many people at once — hand over one specific assignment instead of the whole role.`,
      "NOT_SINGLE_HOLDER",
    );
  }
  if (String(fromUserId) === String(toUserId)) {
    throw new HandoverError("The incoming holder is the same as the current one.", "SAME_USER");
  }
  if (!reason || !String(reason).trim()) {
    throw new HandoverError("A reason is required.", "REASON_REQUIRED");
  }

  const role = await Role.findOne({ societyId, key: roleKey }).lean();
  if (!role) throw new HandoverError("Role not found in this society.", "ROLE_NOT_FOUND", 404);

  const current = await RoleAssignment.findOne({
    societyId,
    roleId: role._id,
    userId: fromUserId,
    status: "active",
  });
  if (!current) {
    throw new HandoverError("The named current holder does not actively hold this role.", "NOT_CURRENT_HOLDER", 404);
  }

  const [fromUser, toUser] = await Promise.all([
    User.findById(fromUserId).select("_id name email societyId profiles").lean(),
    User.findById(toUserId).select("_id name email societyId profiles").lean(),
  ]);
  if (!toUser) throw new HandoverError("Incoming user not found.", "USER_NOT_FOUND", 404);

  // Both users must actually belong to this society (root societyId for
  // staff, or a profile for a member-shaped account) — a handover cannot be
  // used to pull someone from another society into this one's roles.
  const belongsToSociety = (u) =>
    String(u.societyId) === String(societyId) ||
    (u.profiles || []).some((p) => String(p.societyId) === String(societyId));
  if (!fromUser || !belongsToSociety(fromUser) || !belongsToSociety(toUser)) {
    throw new HandoverError("Both users must belong to this society.", "USER_NOT_IN_SOCIETY");
  }

  // The target cannot already actively hold this same single-holder role
  // under a different assignment record (defensive — the partial unique
  // index in models/RoleAssignment.js makes this state unreachable via
  // assignRole(), but a handover writes RoleAssignment directly).
  const targetConflict = await RoleAssignment.findOne({
    societyId,
    roleKey,
    status: "active",
    userId: toUserId,
  }).lean();
  if (targetConflict) {
    throw new HandoverError("The incoming user already holds this role.", "TARGET_ALREADY_HOLDS");
  }

  // PREPARE — resolve both users' effective permission sets before the
  // change, so the audit row can show what actually moved, not just that
  // something did.
  const [beforeFromPerms, beforeToPerms] = await Promise.all([
    resolveEffectivePermissions({ userId: fromUserId, societyId, hat: HAT.STAFF }),
    resolveEffectivePermissions({ userId: toUserId, societyId, hat: HAT.STAFF }),
  ]);

  const session = await mongoose.startSession();
  let newAssignment;
  try {
    await session.withTransaction(async () => {
      current.status = "revoked";
      current.revokedBy = actorId;
      current.revokedAt = new Date();
      await current.save({ session });

      const singleHolderKey = roleKey === "security" ? undefined : roleKey;
      const created = await RoleAssignment.create(
        [
          {
            userId: toUserId,
            societyId,
            roleId: role._id,
            roleKey,
            singleHolderKey,
            status: "active",
            assignedBy: actorId,
          },
        ],
        { session },
      );
      newAssignment = created[0];
    });
  } finally {
    await session.endSession();
  }

  // REVOKE + ACTIVATE — both epoch bumps happen in this same request, not a
  // background job: MP1 §11 requires the old token to stop being privileged
  // immediately, and the new holder's next token must carry the new role
  // right away.
  await Promise.all([bumpSessionEpoch(String(fromUserId)), bumpSessionEpoch(String(toUserId))]);
  await onRbacMutation({ societyId });

  const [afterFromPerms, afterToPerms] = await Promise.all([
    resolveEffectivePermissions({ userId: fromUserId, societyId, hat: HAT.STAFF }),
    resolveEffectivePermissions({ userId: toUserId, societyId, hat: HAT.STAFF }),
  ]);

  await logAudit(actorId, societyId, "ROLE_HANDOVER", null, {
    roleKey,
    roleName: role.name,
    oldHolderId: String(fromUserId),
    newHolderId: String(toUserId),
    oldAssignmentId: String(current._id),
    newAssignmentId: String(newAssignment._id),
    reason: String(reason).trim(),
    sessionInvalidated: true,
    effectiveAccessDiff: {
      oldHolderLost: [...beforeFromPerms].filter((p) => !afterFromPerms.has(p)),
      newHolderGained: [...afterToPerms].filter((p) => !beforeToPerms.has(p)),
    },
    result: "SUCCESS",
  });

  await notifyHandover({ societyId, actorId, role, fromUser, toUser, reason }).catch((err) => {
    // Notification is best-effort: the handover itself already committed and
    // is the thing that must never fail here.
    console.error("[role-handover] notify failed:", err?.message);
  });

  return {
    oldAssignmentId: String(current._id),
    newAssignmentId: String(newAssignment._id),
    roleKey,
  };
}

/** Email both; in-app notice to the OLD holder only — B doesn't need telling they're new via a banner, they'll see the new routes immediately. */
async function notifyHandover({ societyId, actorId, role, fromUser, toUser, reason }) {
  const roleName = role.name || role.key;

  await Notification.create({
    societyId,
    createdBy: actorId,
    createdByName: "System",
    type: "ADMIN_MESSAGE",
    title: `Your ${roleName} role has been handed over`,
    message: `Your ${roleName} role was handed over to ${toUser.name || "another user"}. Reason: ${reason}. If this is unexpected, contact your society admin.`,
    priority: "high",
    recipientType: "user",
    recipientIds: [String(fromUser._id)],
    audience: "all",
  });

  const subject = `${roleName} role handover`;
  await Promise.all([
    fromUser.email
      ? sendEmail({
          to: fromUser.email,
          subject,
          html: `<p>Your <strong>${roleName}</strong> role has been handed over to ${toUser.name || "another user"}.</p><p>Reason: ${reason}</p><p>If this is unexpected, contact your society admin immediately.</p>`,
        })
      : Promise.resolve(),
    toUser.email
      ? sendEmail({
          to: toUser.email,
          subject,
          html: `<p>You have been granted the <strong>${roleName}</strong> role, effective immediately.</p><p>Reason given: ${reason}</p><p>Sign in again to see the new access on your account.</p>`,
        })
      : Promise.resolve(),
  ]);
}
