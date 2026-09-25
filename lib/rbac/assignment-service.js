/**
 * ============================================================================
 * AapliSociety RBAC — Assignment service (Phase 2)
 * ============================================================================
 * Grants/revokes roles to users within a society, plus account suspend/react.
 *
 * Invariants (frozen Rev 2):
 *   - Tenant-scoped: every op requires societyId; assignments are per-society.
 *   - Anti-escalation: an actor can only assign a role whose permission set is
 *     a subset of the actor's own effective permissions.
 *   - Grants do NOT force logout; revocations/suspensions DO (Q11).
 *   - Idempotent assign (unique {userId, societyId, roleId}); re-assign
 *     reactivates a previously revoked record instead of duplicating.
 *   - Every op audited; every op rotates Society.rbacVersion.
 * ============================================================================
 */

import connectDB from "@/lib/mongodb";
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import User from "@/models/User";
import Member from "@/models/Member";
import { resolveEffectivePermissions, HAT } from "@/lib/rbac/permission-engine";
import { onRbacMutation, bumpSessionEpoch } from "@/lib/rbac/session";
import {
  auditRoleAssigned,
  auditRoleUnassigned,
  auditUserSuspended,
  auditUserReactivated,
} from "@/lib/rbac/rbac-audit";

export async function listAssignments(societyId, { userId, roleId } = {}) {
  await connectDB();
  const q = { societyId };
  if (userId) q.userId = userId;
  if (roleId) q.roleId = roleId;
  return RoleAssignment.find(q).sort({ createdAt: -1 }).lean();
}

/**
 * Active RBAC role keys (e.g. "clubhouse_manager") a user holds in a society,
 * right now. Feeds the /v1 mobile auth flow (issueTokens + /auth/me): the
 * mobile app has no other way to see roles granted through Manage Access,
 * since it only ever read user.profiles[].role / user.role, never
 * RoleAssignment. Deliberately roleKey-only (no permission leaves) — the app
 * shows the role, per-request authorization still resolves permissions
 * server-side via resolveEffectivePermissions.
 */
export async function listActiveStaffRoleKeys(userId, societyId) {
  if (!userId || !societyId) return [];
  await connectDB();
  const now = new Date();
  const assignments = await RoleAssignment.find({
    userId,
    societyId,
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  })
    .select("roleKey")
    .lean();
  return [...new Set(assignments.map((a) => a.roleKey))];
}

/**
 * Same active assignments as listActiveStaffRoleKeys, but with each role's
 * current display name attached (`Role.name` — societies can rename their own
 * copy of a system template, e.g. "Clubhouse Manager" -> "Clubhouse Desk", so
 * the label a client shows has to come from here, not be re-derived from the
 * key). Feeds GET /v1/auth/me's `claims.roles`, which is what lets the mobile
 * app render "open as <role>" entry points without hardcoding any role's name
 * — see lib/v1/staffRoleRoutes.js for the one piece that IS still hardcoded
 * (which mobile screen a key opens).
 */
export async function listActiveStaffRoles(userId, societyId) {
  if (!userId || !societyId) return [];
  await connectDB();
  const now = new Date();
  const assignments = await RoleAssignment.find({
    userId,
    societyId,
    status: "active",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  })
    .select("roleKey roleId")
    .populate({ path: "roleId", select: "name permissions", model: Role })
    .lean();
  const seen = new Set();
  const out = [];
  for (const a of assignments) {
    if (seen.has(a.roleKey)) continue;
    seen.add(a.roleKey);
    // permissions carried through so resolveStaffRoleRoute() (staffRoleRoutes.js)
    // can find a mobile console by capability when the role's key isn't the
    // hardcoded one — e.g. a hand-built or renamed clone of a system template.
    out.push({
      key: a.roleKey,
      label: a.roleId?.name ?? a.roleKey,
      permissions: a.roleId?.permissions ?? [],
    });
  }
  return out;
}

/**
 * Assign a role to a user in a society.
 * @returns { assignment, reactivated }
 */
export async function assignRole({
  societyId,
  actorId,
  userId,
  roleId,
  expiresAt = null,
  isSuperGrantor = false,
  // Optional: names the grantee's own flat in this society (see
  // models/RoleAssignment.js). Validated against Member so a typo'd id can
  // never silently attach the wrong flat to someone's admin access.
  memberId = null,
}) {
  await connectDB();

  const role = await Role.findOne({ _id: roleId, societyId }).lean();
  if (!role)
    throw Object.assign(new Error("Role not found"), {
      code: "ROLE_NOT_FOUND",
    });

  const target = await User.findById(userId).select("_id status").lean();
  if (!target)
    throw Object.assign(new Error("User not found"), {
      code: "USER_NOT_FOUND",
    });

  let flatLink = null;
  if (memberId) {
    const member = await Member.findOne({ _id: memberId, societyId, isDeleted: { $ne: true } })
      .select("_id flatNo wing")
      .lean();
    if (!member)
      throw Object.assign(new Error("That flat could not be found in this society"), {
        code: "MEMBER_NOT_FOUND",
      });
    flatLink = member;
  }

  // Cardinality (Plan 01 §9): every role except `security` is single-holder
  // per society — a society has one active Secretary, not two, so a handover
  // is a real handover rather than a duplicate that silently splits authority.
  // `security` is exempt because a society legitimately runs many guards at
  // once. Checked here for a readable 409 before the write ever reaches the
  // partial unique index in models/RoleAssignment.js, which exists as the
  // backstop against a race between two concurrent requests, not as the
  // primary error path.
  if (role.key !== "security") {
    const conflict = await RoleAssignment.findOne({
      societyId,
      roleKey: role.key,
      status: "active",
      userId: { $ne: userId },
    }).select("userId").lean();
    if (conflict) {
      throw Object.assign(
        new Error(`${role.name || role.key} is already held by another user in this society`),
        { code: "ROLE_ALREADY_HELD", status: 409, currentHolderId: String(conflict.userId) },
      );
    }
  }

  // Anti-escalation: role.permissions must be subset of actor's effective perms.
  if (!isSuperGrantor) {
    const actorPerms = await resolveEffectivePermissions({
      userId: actorId,
      societyId,
      hat: HAT.STAFF,
    });
    const escalating = (role.permissions || []).filter(
      (p) => !actorPerms.has(p),
    );
    if (escalating.length) {
      throw Object.assign(
        new Error("Cannot assign a role granting permissions you don't hold"),
        {
          code: "PRIVILEGE_ESCALATION",
          escalating,
        },
      );
    }
  }

  // Plan 01 §9's cardinality field — see models/RoleAssignment.js. `undefined`
  // (not null) so Mongoose omits the key entirely for a security assignment,
  // which is what the partial index's $exists check needs.
  const singleHolderKey = role.key === "security" ? undefined : role.key;

  // Idempotent upsert: reactivate a revoked record instead of duplicating.
  const existing = await RoleAssignment.findOne({ userId, societyId, roleId });
  let assignment;
  let reactivated = false;
  if (existing) {
    reactivated = existing.status !== "active";
    existing.status = "active";
    existing.roleKey = role.key;
    existing.singleHolderKey = singleHolderKey;
    existing.expiresAt = expiresAt;
    existing.assignedBy = actorId;
    existing.revokedBy = null;
    existing.revokedAt = null;
    // A later assignment naming a flat updates the link; one that omits
    // memberId leaves whatever was there (edits use unassign+reassign to
    // deliberately clear it, not a silent null-out).
    if (memberId) {
      existing.memberId = flatLink._id;
      existing.flatNo = flatLink.flatNo;
      existing.wing = flatLink.wing;
    }
    assignment = await existing.save();
  } else {
    assignment = await RoleAssignment.create({
      userId,
      societyId,
      roleId,
      roleKey: role.key,
      singleHolderKey,
      status: "active",
      expiresAt,
      assignedBy: actorId,
      memberId: flatLink?._id ?? null,
      flatNo: flatLink?.flatNo ?? null,
      wing: flatLink?.wing ?? null,
    });
  }

  await auditRoleAssigned({ actorId, societyId, userId, role });
  // Grant => rotate cache so new perms take effect immediately; NO forced logout.
  await onRbacMutation({ societyId });
  return { assignment: assignment.toObject(), reactivated };
}

/** Revoke a role from a user. Reduction => force re-auth (Q11). */
export async function unassignRole({ societyId, actorId, assignmentId }) {
  await connectDB();
  const assignment = await RoleAssignment.findOne({
    _id: assignmentId,
    societyId,
  });
  if (!assignment)
    throw Object.assign(new Error("Assignment not found"), {
      code: "ASSIGNMENT_NOT_FOUND",
    });
  if (assignment.status !== "active") return { alreadyRevoked: true };

  assignment.status = "revoked";
  assignment.revokedBy = actorId;
  assignment.revokedAt = new Date();
  await assignment.save();

  const role = await Role.findById(assignment.roleId).lean();
  await auditRoleUnassigned({
    actorId,
    societyId,
    userId: String(assignment.userId),
    role,
  });

  await bumpSessionEpoch(String(assignment.userId)); // reduction => re-auth
  await onRbacMutation({ societyId });
  return { revoked: true };
}

/**
 * Suspend an account: blocks all authorization + forces logout everywhere.
 *
 * FIXED: this used to write `{ status: "suspended" }` — a field that does not
 * exist on models/User.js and that no login path reads. Suspending bumped the
 * session epoch (so the person was logged out once) and then let them log
 * straight back in. It now writes `isActive: false`, which is the field every
 * login, refresh and profile-switch path actually checks
 * (see lib/auth/login-block.js).
 *
 * `pausedUntil` (optional ISO date / Date) makes it a TEMPORARY hold that
 * clears itself instead of an indefinite switch-off.
 */
export async function suspendUser({
  societyId,
  actorId,
  userId,
  reason = null,
  pausedUntil = null,
}) {
  await connectDB();
  const until = pausedUntil ? new Date(pausedUntil) : null;
  const validPause = until && !Number.isNaN(until.getTime()) && until.getTime() > Date.now();
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: validPause
        ? { loginPausedUntil: until, loginBlockedReason: reason || null }
        : { isActive: false, loginPausedUntil: null, loginBlockedReason: reason || null },
    },
    { new: true },
  );
  if (!user)
    throw Object.assign(new Error("User not found"), {
      code: "USER_NOT_FOUND",
    });
  await auditUserSuspended({ actorId, societyId, userId, reason });
  await bumpSessionEpoch(userId); // immediate lockout
  await onRbacMutation({ societyId });
  return { suspended: true };
}

/**
 * Reactivate a suspended account. Grant-like => no forced logout needed.
 * Clears BOTH the indefinite switch-off and any timed pause, so one button
 * genuinely restores the login whichever way it was blocked.
 */
export async function reactivateUser({ societyId, actorId, userId }) {
  await connectDB();
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { isActive: true, loginPausedUntil: null, loginBlockedReason: null } },
    { new: true },
  );
  if (!user)
    throw Object.assign(new Error("User not found"), {
      code: "USER_NOT_FOUND",
    });
  await auditUserReactivated({ actorId, societyId, userId });
  await onRbacMutation({ societyId });
  return { reactivated: true };
}

export default {
  listAssignments,
  listActiveStaffRoleKeys,
  listActiveStaffRoles,
  assignRole,
  unassignRole,
  suspendUser,
  reactivateUser,
};
