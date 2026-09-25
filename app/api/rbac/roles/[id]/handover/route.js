/**
 * POST /api/rbac/roles/:roleKey/handover   (Plan 01 §10-§13, Phase 3)
 * ----------------------------------------------------------------------------
 * Atomic, no-consent replacement of a single-holder role's active assignment.
 * Body: { fromUserId, toUserId, reason }
 *
 * Required permission: rbac.role.handover
 * Failure behaviour: 401/403 authorize; 400 missing fields or same-user;
 *                    404 role/current-holder/incoming-user not found;
 *                    409 the incoming user already holds this role
 * ----------------------------------------------------------------------------
 */
import { NextResponse } from "next/server";
import { authorize } from "@/lib/rbac/authorize";
import { handoverRole, HandoverError } from "@/lib/rbac/role-handover-service";

export async function POST(request, { params }) {
  const gate = await authorize(request, "rbac.role.handover");
  if (!gate.ok) return gate.response;

  // Folder is [id], not [roleKey] — Next.js requires every sibling dynamic
  // segment under app/api/rbac/roles/ to share one param name (it already
  // throws a hard boot error otherwise: "different slug names for the same
  // dynamic path"). The 3 sibling routes' [id] is a role's Mongo _id; this
  // route's path segment is semantically a roleKey string
  // (role-handover-service.handoverRole() takes a key like "secretary", not
  // an ObjectId) — renamed on read, not on the wire, so the URL contract
  // (`/api/rbac/roles/:roleKey/handover`, 08.md's own G1) is unchanged.
  const { id: roleKey } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { fromUserId, toUserId, reason } = body || {};
  if (!fromUserId || !toUserId || !reason) {
    return NextResponse.json(
      { error: "fromUserId, toUserId and reason are required" },
      { status: 400 },
    );
  }

  try {
    const result = await handoverRole({
      societyId: gate.context.societyId,
      actorId: gate.context.userId,
      roleKey,
      fromUserId,
      toUserId,
      reason,
    });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    if (err instanceof HandoverError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[rbac] role handover failed:", err?.message);
    return NextResponse.json(
      { error: "Something went wrong on our side. Your data is safe.", code: "INTERNAL" },
      { status: 500 },
    );
  }
}
