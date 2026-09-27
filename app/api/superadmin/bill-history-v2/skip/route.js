// POST /api/superadmin/bill-history-v2/skip
// body: { societyId, importRunId (optional) }
// The "no bill history for this society" path (§40-b): generates the
// current live month's first Bill per active member, using whatever
// opening balances are already on the Member docs (typed on the bulk-import
// Members sheet). Idempotent — generateBill's own P4_DUPLICATE guard means
// calling this twice, or after bills already exist, is safe and a no-op for
// members that already have one.
//
// §40 ONBOARDING ORDER: when importRunId is given (this is the tail end of
// a fresh bulk-import that's AWAITING_BILL_HISTORY), success also finalizes
// that onboarding — society goes active, queued emails go out only now. An
// unexpected failure rolls the whole onboarding back, same as commit/route.js.
// Superadmin only.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import BulkImportRun from "@/models/BulkImportRun";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { generateBillsForMembers } from "@/lib/billing/generationService";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import { isCommercialUnit } from "@/lib/commercial/constants";
import { finalizeBulkImportOnboarding } from "@/lib/onboarding-finalize";
import { compensateImportRun } from "@/lib/onboarding-rollback";

export async function POST(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;

  await connectDB();

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }
  const { societyId, importRunId } = body || {};
  if (!societyId) {
    return NextResponse.json({ error: "societyId is required" }, { status: 400 });
  }

  try {
    const society = await Society.findById(societyId).lean();
    if (!society) {
      return NextResponse.json({ error: "Society not found" }, { status: 404 });
    }
    const joinPeriodId = society.onboarding?.joinPeriodId;
    if (!joinPeriodId) {
      return NextResponse.json({ error: "This society has no onboarding.joinPeriodId set — cannot determine which month to bill" }, { status: 400 });
    }
    const [year, month] = joinPeriodId.split("-").map(Number);

    const members = await Member.find({ societyId, isDeleted: { $ne: true } }).lean();
    const residentialMemberIds = members.filter((m) => !isCommercialUnit(m)).map((m) => m._id);

    const result = await generateBillsForMembers({
      societyId,
      memberIds: residentialMemberIds,
      year,
      month,
      performedBy: authResult.admin?.userId || "System",
    });

    if (importRunId && result.generated.length > 0) {
      await Bill.updateMany(
        { _id: { $in: result.generated.map((g) => g.billId) } },
        { $set: { importBatchId: importRunId, importedFrom: "BulkImport" } },
      );
    }

    // Apply any pre-existing advance credit, same as bulk-import's own Phase
    // 5 always did — a member who prepaid before the system existed
    // shouldn't show as unpaid on their very first bill.
    const memberById = new Map(members.map((m) => [String(m._id), m]));
    let advanceApplied = 0;
    for (const g of result.generated) {
      const member = memberById.get(String(g.memberId));
      if (!member || !(member.advanceCredit > 0)) continue;
      try {
        await applyPaymentToBill({ billId: g.billId, payment: member.advanceCredit, performedBy: authResult.admin?.userId || "System" });
        await Member.updateOne({ _id: member._id }, { $inc: { advanceCredit: -member.advanceCredit } });
        advanceApplied++;
      } catch (e) {
        result.failed.push({ memberId: g.memberId, code: "ADVANCE_APPLY_FAILED", reason: e.message });
      }
    }

    const responseBody = {
      committed: true,
      billPeriodId: joinPeriodId,
      generated: result.generated.length,
      failed: result.failed,
      advanceApplied,
    };

    if (importRunId) {
      const run = await BulkImportRun.findOne({ importRunId }).lean();
      const runResult = run?.result;
      if (runResult) {
        try {
          const finalized = await finalizeBulkImportOnboarding({
            importRunId,
            societyId,
            societyPayload: { societyName: society.name, address: society.address, email: runResult.admin?.email, fullName: runResult.admin?.name },
            memberCredentials: runResult.memberCredentials || [],
            societyAdminUser: runResult.admin?.userId ? { _id: runResult.admin.userId } : null,
            multiSocietyAdminUser: runResult.admin?.reusedExistingAccount,
          });
          await BulkImportRun.updateOne(
            { importRunId },
            { $set: { status: "COMPLETED", stage: "Done", pointOfNoReturn: true, finishedAt: new Date() } },
          );
          responseBody.onboardingFinalized = true;
          responseBody.adminSetCredentialsUrl = finalized.adminSetCredentialsUrl;
          responseBody.onboardingEmailErrors = finalized.onboardingEmailErrors;
        } catch (finalizeErr) {
          console.error("bill-history-v2/skip finalize error", finalizeErr);
          await BulkImportRun.updateOne(
            { importRunId },
            { $set: { errorMessages: [finalizeErr.message], finishedAt: new Date() } },
          );
          responseBody.onboardingFinalized = false;
          responseBody.finalizeError = "Bills generated, but sending onboarding emails failed. Data is real — do not retry. Contact support.";
        }
      }
    }

    return NextResponse.json(responseBody);
  } catch (e) {
    console.error("bill-history-v2/skip error", e);
    if (importRunId) {
      await compensateImportRun(importRunId);
      await BulkImportRun.updateOne(
        { importRunId },
        { $set: { status: "ROLLED_BACK", errorMessages: [e.message], finishedAt: new Date() } },
      );
      return NextResponse.json(
        { error: "Skip failed unexpectedly — the whole onboarding (society, members, bills) was rolled back. Start over.", rolledBack: true },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: "Skip failed unexpectedly" }, { status: 500 });
  }
}
