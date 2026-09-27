// POST /api/admin/societies/:id/offboarding — the actions on the offboarding
// checklist that had no UI at all.
//
// Only one so far, and it is the one that matters: waiving the handover gate.
//
// Gate 6 of society-purge refuses to erase a society that has not collected
// its own copy. That is right almost always, and unsatisfiable in one real
// case — a dissolved committee whose registered address bounces. The schema
// has carried `handoverWaivedAt` for exactly that since the gate was written,
// and nothing in the product could set it, so the only escape from the
// deadlock was editing Mongo by hand.
//
// It is deliberately not a flag. Purging a society that never received its
// records is a judgement call, so it is recorded as one: who decided, when,
// and on what grounds. The reason is mandatory and stored.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import SocietyHandover from "@/models/SocietyHandover";
import AuditLog from "@/models/AuditLog";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { offboardingChecklist } from "@/lib/superadmin/offboardingGates";

export const dynamic = "force-dynamic";

const MIN_REASON = 20;

export async function POST(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  const admin = validation.admin;

  try {
    await connectDB();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");

    const society = await Society.findById(id);
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    let summary;
    let auditAction;

    switch (action) {
      case "waive-handover": {
        const reason = String(body.reason || "").trim();
        // A one-word reason is not a record of a judgement. This is the only
        // thing standing between "we could not reach them" and "somebody
        // clicked a button", so it has to be written down properly.
        if (reason.length < MIN_REASON) {
          return NextResponse.json(
            { error: `Give a reason of at least ${MIN_REASON} characters — this is recorded against the erasure.` },
            { status: 400 },
          );
        }
        if (society.offboarding?.handoverWaivedAt) {
          return NextResponse.json({ error: "The handover is already waived for this society." }, { status: 400 });
        }
        society.offboarding = society.offboarding || {};
        society.offboarding.handoverWaivedAt = new Date();
        society.offboarding.handoverWaivedByUserId = admin.userId || null;
        society.offboarding.handoverWaivedReason = reason;
        summary = "Handover requirement waived";
        auditAction = "SOCIETY_HANDOVER_WAIVED";
        break;
      }

      case "unwaive-handover": {
        if (!society.offboarding?.handoverWaivedAt) {
          return NextResponse.json({ error: "No waiver to remove." }, { status: 400 });
        }
        society.offboarding.handoverWaivedAt = undefined;
        society.offboarding.handoverWaivedByUserId = undefined;
        society.offboarding.handoverWaivedReason = undefined;
        summary = "Handover waiver removed";
        auditAction = "SOCIETY_HANDOVER_WAIVER_REMOVED";
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 });
    }

    await society.save();

    await AuditLog.create({
      userId: admin.userId,
      societyId: society._id,
      action: auditAction,
      newData: {
        summary,
        by: admin.email,
        reason: society.offboarding?.handoverWaivedReason || null,
      },
      timestamp: new Date(),
    });

    const handover = await SocietyHandover.findOne({ societyId: society._id })
      .sort({ createdAt: -1 })
      .select("status notifiedAt downloadedAt confirmedAt reminderCount recipients driftMismatchCount")
      .lean();

    return NextResponse.json({
      success: true,
      summary,
      offboarding: offboardingChecklist(society.toObject(), handover),
    });
  } catch (error) {
    console.error("[admin/offboarding]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
