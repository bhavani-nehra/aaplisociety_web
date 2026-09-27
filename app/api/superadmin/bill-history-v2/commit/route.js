// POST /api/superadmin/bill-history-v2/commit
// multipart/form-data: file (xlsx), societyId, importRunId (optional)
// Re-parses and re-reconstructs from the raw uploaded bytes (never trusts
// the browser's earlier /preview result — §20 SERVER IS THE AUTHORITY), then
// calls commitBillHistory() for the real, atomic, all-or-nothing write.
//
// §40 ONBOARDING ORDER: when importRunId is given (this commit is the tail
// end of a fresh bulk-import that's AWAITING_BILL_HISTORY), a successful
// commit also FINALIZES that onboarding — society goes "active", queued
// onboarding emails go out only now, not before. A recoverable failure
// (bad file, unmapped flat, etc.) is just returned — the file can be fixed
// and re-uploaded; society/members from bulk-import stay untouched, nothing
// is wasted. Only a genuinely unexpected internal error rolls the WHOLE
// onboarding (society + members + bills) back — that state is unrecoverable
// either way, so there is nothing worth keeping.
// Superadmin only.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import BulkImportRun from "@/models/BulkImportRun";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { getBillHistoryWindow } from "@/lib/billing/historicalWindow";
import { parseHistoryTemplate } from "@/lib/billing/historicalTemplate";
import { commitBillHistory, CommitError } from "@/lib/billing/historyCommit";
import { finalizeBulkImportOnboarding } from "@/lib/onboarding-finalize";
import { compensateImportRun } from "@/lib/onboarding-rollback";

export async function POST(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;

  await connectDB();

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed upload" }, { status: 400 });
  }

  const file = formData.get("file");
  const societyId = formData.get("societyId");
  const importRunId = formData.get("importRunId") || null;
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!societyId) {
    return NextResponse.json({ error: "societyId is required" }, { status: 400 });
  }

  const society = await Society.findById(societyId).lean();
  if (!society) {
    return NextResponse.json({ error: "Society not found" }, { status: 404 });
  }

  let window;
  try {
    window = getBillHistoryWindow(society);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let parsedTemplate;
  try {
    parsedTemplate = await parseHistoryTemplate(bytes);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  let result;
  try {
    result = await commitBillHistory({
      societyId,
      window,
      parsedTemplate,
      performedBy: authResult.admin?.userId || "System",
      fileName: file.name,
      importBatchId: importRunId || undefined, // ties history + live bills to the onboarding run, for rollback
    });
  } catch (e) {
    if (e instanceof CommitError) {
      // Recoverable — nothing new was written (every CommitError check runs
      // before any DB write), so the file can be fixed and re-uploaded.
      // Society/members from bulk-import (if any) are untouched.
      return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status: 409 });
    }
    // Unexpected — genuinely broken state. If this commit is the tail of a
    // fresh onboarding, undo the whole thing rather than leave a half-done
    // society for someone to find and manually clean up later.
    console.error("bill-history-v2/commit error", e);
    if (importRunId) {
      await compensateImportRun(importRunId);
      await BulkImportRun.updateOne(
        { importRunId },
        { $set: { status: "ROLLED_BACK", errorMessages: [e.message], finishedAt: new Date() } },
      );
      return NextResponse.json(
        { error: "Commit failed unexpectedly — the whole onboarding (society, members, bills) was rolled back. Start over.", rolledBack: true },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: "Commit failed unexpectedly" }, { status: 500 });
  }

  // ── Success. If this is a fresh-onboarding commit, finalize it now:
  // society goes active, queued emails go out — for the first time. ──
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
        result.onboardingFinalized = true;
        result.adminSetCredentialsUrl = finalized.adminSetCredentialsUrl;
        result.onboardingEmailErrors = finalized.onboardingEmailErrors;
      } catch (finalizeErr) {
        // History/live bills are already committed and real at this point —
        // never roll those back over an email-sending failure. Surface it
        // plainly instead (matches bulk-import's own post-commit-error shape).
        console.error("bill-history-v2/commit finalize error", finalizeErr);
        await BulkImportRun.updateOne(
          { importRunId },
          { $set: { errorMessages: [finalizeErr.message], finishedAt: new Date() } },
        );
        result.onboardingFinalized = false;
        result.finalizeError = "Bill history committed, but sending onboarding emails failed. Data is real — do not retry. Contact support.";
      }
    }
  }

  return NextResponse.json(result);
}
