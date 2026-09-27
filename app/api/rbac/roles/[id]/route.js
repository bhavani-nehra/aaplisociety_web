/**
 * /api/rbac/roles/[id]  (Phase 2)
 * ----------------------------------------------------------------------------
 * GET    view role     Required permission: rbac.role.view
 * PATCH  edit role     Required permission: rbac.role.update
 * DELETE delete role   Required permission: rbac.role.delete
 * Tenant validation   : societyId from token; service re-scopes every query by it
 * Audit behaviour      : PATCH -> ROLE_UPDATED (+PERMISSION_GRANTED/REVOKED);
 *                        DELETE -> ROLE_DELETED (service). Reductions force re-auth.
 * Failure behaviour    : 401/403 authorize; 404 not found; 409 system-role/conflict
 */

import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { getRole, updateRole, deleteRole } from "@/lib/rbac/role-service";
import { expandPageAccess } from "@/lib/rbac/page-access-map";

export async function GET(request, { params }) {
  const gate = await authorize(request, "rbac.role.view");
  if (!gate.ok) return gate.response;
  if (!/^[a-f\d]{24}$/i.test(String(params.id))) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }
  const role = await getRole(gate.context.societyId, params.id);
  if (!role)
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  return NextResponse.json({ role });
}

export async function PATCH(request, { params }) {
  const gate = await authorize(request, "rbac.role.update");
  if (!gate.ok) return gate.response;
  if (!/^[a-f\d]{24}$/i.test(String(params.id))) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { pageAccess, ...rest } = body || {};
  const patch = Array.isArray(pageAccess)
    ? { ...rest, permissions: expandPageAccess(pageAccess) }
    : rest;

  try {
    const result = await updateRole({
      societyId: gate.context.societyId,
      actorId: gate.context.userId,
      roleId: params.id,
      ...patch,
    });
    return NextResponse.json(result);
  } catch (err) {
    return mapServiceError(err);
  }
}

export async function DELETE(request, { params }) {
  const gate = await authorize(request, "rbac.role.delete");
  if (!gate.ok) return gate.response;
  if (!/^[a-f\d]{24}$/i.test(String(params.id))) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 });
  }
  try {
    const result = await deleteRole({
      societyId: gate.context.societyId,
      actorId: gate.context.userId,
      roleId: params.id,
    });
    return NextResponse.json(result);
  } catch (err) {
    return mapServiceError(err);
  }
}

function mapServiceError(err) {
  const code = err?.code;
  const map = {
    ROLE_NOT_FOUND: 404,
    SYSTEM_ROLE_UNDELETABLE: 409,
    SYSTEM_ROLE_LOCKED: 409,
    ROLE_PERMISSIONS_LOCKED: 409,
    CONCURRENCY_CONFLICT: 409,
    UNKNOWN_PERMISSIONS: 400,
  };
  const status = map[code] || 500;
  if (status === 500) console.error("[rbac] roles/[id] failed:", err?.message);
  return NextResponse.json(
    { error: err?.message || "Internal error", code, unknown: err?.unknown },
    { status },
  );
}
