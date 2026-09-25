/**
 * GET /api/members/[id]/export?kind=owner|tenant&tenantRequestId=...
 *
 * Plan 02 §8 / §14 — the records one person takes with them when they stop
 * being a resident.
 *
 * ## Authorisation is the whole point here
 *
 * This returns a person's financial history, so "who may ask" matters more than
 * what it contains. Two routes in:
 *
 *   - **the person themselves** — the current owner, or the seller on a
 *     transfer of this flat, even after it closed. That is the case Master
 *     Prompt 2 §7 exists for: ending someone's access is only defensible if
 *     they could take their records first.
 *   - **an admin** holding `member.member.export`, so support can produce it on
 *     request.
 *
 * Anyone else gets 403, including another resident of the same society.
 *
 * ## Nothing is stored
 *
 * Built in memory and streamed, the same judgement as
 * app/api/v1/society-handover/download. A generated file sitting in object
 * storage is a second copy of somebody's financial history with its own
 * access-control problem, and no expiry anybody remembers to set.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import mongoose from "mongoose";
import TenantRequest from "@/models/TenantRequest";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";
import {
  buildOwnerExport,
  buildTenantExport,
  canExportOwner,
} from "@/lib/services/PersonExportService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request, { params }) {
  // Any signed-in resident may REACH this route; entitlement is decided below
  // per flat. `rbac.myAccess.view` is in MEMBER_CAPABILITIES, so a departing
  // owner — who holds no staff permission — is not locked out of their own
  // records by the gate itself.
  const gate = await authorize(request, "rbac.myAccess.view");
  if (!gate.ok) return gate.response;

  try {
    await connectDB();
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid flat id.", code: "BAD_ID" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") === "tenant" ? "tenant" : "owner";
    const societyId = gate.context.societyId;

    // An admin with the export permission can produce this for a resident who
    // asks support rather than using the app themselves.
    const isStaffExporter =
      gate.context.hat === "staff" && gate.context.permissions?.has?.("member.member.export");

    let bundle;
    let subjectDescription;

    if (kind === "owner") {
      const { allowed, transfer } = await canExportOwner({
        societyId,
        memberId: id,
        userId: gate.context.userId,
      });
      if (!allowed && !isStaffExporter) {
        return NextResponse.json(
          {
            error: "These records belong to someone else.",
            code: "NOT_ENTITLED",
          },
          { status: 403 },
        );
      }
      bundle = await buildOwnerExport({ societyId, memberId: id, transfer });
      subjectDescription = bundle.subject.name;
    } else {
      const tenantRequestId = searchParams.get("tenantRequestId");
      const tenantRequest = tenantRequestId
        ? await TenantRequest.findOne({ _id: tenantRequestId, societyId, memberId: id }).lean()
        : null;
      if (!tenantRequest) {
        return NextResponse.json(
          {
            error: "Which tenancy? Pass the tenantRequestId of the lease being exported.",
            code: "TENANCY_REQUIRED",
          },
          { status: 400 },
        );
      }
      // The tenant themselves, or an admin. A tenancy record names its own
      // requester, which is who is entitled to it.
      const isTheTenant =
        String(tenantRequest.requestedByUserId) === String(gate.context.userId);
      if (!isTheTenant && !isStaffExporter) {
        return NextResponse.json(
          { error: "These records belong to someone else.", code: "NOT_ENTITLED" },
          { status: 403 },
        );
      }
      bundle = await buildTenantExport({ societyId, memberId: id, tenantRequest });
      subjectDescription = bundle.subject.name;
    }

    // Exports are worth an audit row: this is the moment a copy of somebody's
    // records leaves the system, and "who downloaded what, when" is the
    // question asked afterwards.
    await logAudit(gate.context.userId, societyId, "MEMBER_EXPORTED", null, {
      memberId: id,
      kind,
      subject: subjectDescription,
      counts: bundle.counts,
      byStaff: Boolean(isStaffExporter),
    });

    const filename = `${kind}-records-${bundle.subject.flat || "flat"}-${
      new Date().toISOString().slice(0, 10)
    }.json`;

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Never cached: it is personal data, and an intermediary holding a copy
        // is the thing this route is careful not to create.
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err) {
    if (err?.status) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[members/export] failed:", err);
    return NextResponse.json(
      { error: "Something went wrong on our side. Your data is safe.", code: "INTERNAL" },
      { status: 500 },
    );
  }
}
