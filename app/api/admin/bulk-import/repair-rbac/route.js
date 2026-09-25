/**
 * POST /api/admin/bulk-import/repair-rbac
 * Body: { importRunId }
 *
 * SEC-20 — the repair half of the NEEDS_REPAIR state.
 *
 * Bulk import seeds the society's RBAC role templates and the admin's
 * RoleAssignment AFTER its transaction commits, for a good reason documented in
 * route.js: Role/RoleAssignment are not part of that transaction, and reading a
 * Role inside an uncommitted session would race the write.
 *
 * What was wrong was not the placement — it was that a failure there was
 * swallowed by `.catch(console.error)`. The import reported success while the
 * society sat with zero roles and an admin who could not sign in, because the
 * login route no longer accepts a bare root role string: an account with no
 * RoleAssignment fails at "no active society profiles".
 *
 * That failure is now recorded as `status: "NEEDS_REPAIR"` with a
 * `repairDetail`, and this route is how it gets fixed. Both underlying
 * functions are idempotent, so this is a plain re-run: safe on a society that
 * is already fine, safe to call twice, safe after a partial first attempt.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import BulkImportRun from "@/models/BulkImportRun";
import Society from "@/models/Society";
import User from "@/models/User";
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import { seedAllRoleTemplatesForSociety } from "@/lib/rbac/seed-society-roles";
import { ensureAdminAssignment } from "@/lib/rbac/ensure-admin-assignment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    await connectDB();
    const { importRunId } = await request.json();
    if (!importRunId) {
      return NextResponse.json({ error: "importRunId is required" }, { status: 400 });
    }

    const run = await BulkImportRun.findOne({ importRunId }).lean();
    if (!run) {
      return NextResponse.json({ error: "No import found for this key" }, { status: 404 });
    }
    if (!run.societyId) {
      return NextResponse.json(
        { error: "This import never created a society — there is nothing to repair." },
        { status: 409 },
      );
    }

    const society = await Society.findById(run.societyId).select("name credentials.adminEmail").lean();
    if (!society) {
      return NextResponse.json(
        { error: "The society this import created no longer exists." },
        { status: 409 },
      );
    }

    const adminEmail = society.credentials?.adminEmail;
    // Scoped by societyId as well as email: the same person can be admin of
    // several societies, and repairing THIS society must not pick up their
    // account row for another one.
    const adminUser = adminEmail
      ? await User.findOne({ email: adminEmail, societyId: String(run.societyId) })
        || await User.findOne({ email: adminEmail, role: "Admin" })
      : null;

    if (!adminUser) {
      return NextResponse.json(
        {
          error: `No admin account found for ${adminEmail || "this society"}. This needs a human — the account may have been renamed or deleted.`,
        },
        { status: 409 },
      );
    }

    await seedAllRoleTemplatesForSociety(run.societyId, { actorId: adminUser._id });
    await ensureAdminAssignment({
      userId: adminUser._id,
      societyId: run.societyId,
      legacyRole: "Admin",
    });

    // Same assertion the import makes: the two facts the admin's next login
    // actually depends on. Not throwing is not the same as being usable.
    const [roleCount, adminAssignment] = await Promise.all([
      Role.countDocuments({ societyId: run.societyId }),
      RoleAssignment.findOne({
        societyId: String(run.societyId),
        userId: adminUser._id,
        status: "active",
      }).lean(),
    ]);

    if (roleCount === 0 || !adminAssignment) {
      const reason =
        roleCount === 0
          ? "Role templates still could not be created."
          : "The admin still has no active RoleAssignment.";
      await BulkImportRun.updateOne(
        { importRunId },
        { $set: { "repairDetail.reason": reason, "repairDetail.repairedAt": null } },
      );
      return NextResponse.json({ error: `Repair did not succeed. ${reason}` }, { status: 500 });
    }

    await BulkImportRun.updateOne(
      { importRunId },
      {
        $set: {
          status: "COMPLETED",
          stage: "Done (role setup repaired)",
          "repairDetail.repairedAt": new Date(),
        },
      },
    );

    return NextResponse.json({
      success: true,
      societyName: society.name,
      adminEmail,
      roleCount,
      message: "Role setup repaired. The admin can sign in now.",
    });
  } catch (err) {
    console.error("[bulk-import/repair-rbac] failed:", err);
    return NextResponse.json(
      { error: err?.message || "Repair failed" },
      { status: 500 },
    );
  }
}
