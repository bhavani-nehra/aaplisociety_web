/**
 * /api/rbac/assignments  (Phase 2)
 * ----------------------------------------------------------------------------
 * GET  list assignments   Required permission: rbac.assignment.view
 * POST assign a role      Required permission: rbac.assignment.assign
 * Tenant validation   : societyId from token; every query scoped by it
 * Audit behaviour      : POST writes ROLE_ASSIGNED (service). Grant => no logout.
 * Failure behaviour    : 401/403 authorize; 400 missing fields;
 *                        403 PRIVILEGE_ESCALATION; 404 role/user not found
 */

import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { listAssignments, assignRole } from "@/lib/rbac/assignment-service";

export async function GET(request) {
  const gate = await authorize(request, "rbac.assignment.view");
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const assignments = await listAssignments(gate.context.societyId, {
    userId: url.searchParams.get("userId") || undefined,
    roleId: url.searchParams.get("roleId") || undefined,
  });
  return NextResponse.json({ assignments });
}

export async function POST(request) {
  const gate = await authorize(request, "rbac.assignment.assign");
  if (!gate.ok) return gate.response;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { userId, roleId, expiresAt, memberId } = body || {};
  if (!userId || !roleId) {
    return NextResponse.json(
      { error: "userId and roleId are required" },
      { status: 400 },
    );
  }
  try {
    const result = await assignRole({
      societyId: gate.context.societyId,
      actorId: gate.context.userId,
      userId,
      roleId,
      expiresAt: expiresAt || null,
      // Optional: links this grant to the grantee's own flat, so an admin,
      // guard or auditor who also resides in the society shows up as both in
      // the login picker. See models/RoleAssignment.js.
      memberId: memberId || null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const code = err?.code;
    if (code === "PRIVILEGE_ESCALATION")
      return NextResponse.json(
        { error: err.message, code, escalating: err.escalating },
        { status: 403 },
      );
    const map = { ROLE_NOT_FOUND: 404, USER_NOT_FOUND: 404, MEMBER_NOT_FOUND: 404, ROLE_ALREADY_HELD: 409 };
    const status = map[code] || 500;
    if (status === 500)
      console.error("[rbac] assignments POST failed:", err?.message);
    return NextResponse.json(
      { error: err?.message || "Internal error", code },
      { status },
    );
  }
}
