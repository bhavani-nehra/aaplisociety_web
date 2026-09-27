// The Confirm/commit step (final_audit_fix_plan/bill-history-upgrade.md
// §19 ATOMIC COMMIT, §38 SAFE SAVE RULES, §40 ONBOARDING ORDER).
//
// Everything up to this point (upload, mapping, reconciliation, exception
// resolution) is draft-only — nothing real exists until this function runs,
// and this function either writes everything or writes nothing.
//
// Two-phase, by necessity, not by choice:
//   Phase 1 (one Mongo transaction): re-validate from scratch, write history
//     Bills (isHistoricalArchive), write their audit events, roll each
//     flat's Member opening balances forward to the last history month's
//     closing. All-or-nothing.
//   Phase 2 (after phase 1 commits): generate the current live month's first
//     Bill per member, by calling the EXISTING production generator
//     (generationService.js::generateBillsForMembers) — never a second
//     billing engine. That generator manages its own transaction internally
//     and does not accept an external session, so it cannot be folded into
//     phase 1's transaction without duplicating its logic, which the spec
//     explicitly forbids. Each call is independently atomic (one bill is
//     either fully created or not at all) and idempotent (P4_DUPLICATE), so
//     a phase-2 failure can never corrupt phase 1's already-committed
//     history — it just means that one flat's live bill needs a retry,
//     which the existing generate-bill UI already supports.
import mongoose from "mongoose";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import AuditEvent from "@/models/AuditEvent";
import { reconstructHistory } from "./historicalReconstruction.js";
import { validateBillInvariants } from "./invariants.js";
import { generateBillsForMembers } from "./generationService.js";

const ENGINE_VERSION = "HistoricalBillReconstructionService v1";
const twoDp = (n) => parseFloat((Number(n) || 0).toFixed(2));

export class CommitError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function financialYearLabel(fyStartPeriodId) {
  const startYear = Number(fyStartPeriodId.slice(0, 4));
  return `${startYear}-${startYear + 1}`;
}

/**
 * @param {object} params
 * @param {string} params.societyId
 * @param {{periods:string[], fyStartPeriodId:string, lastHistoryPeriodId:string, firstLivePeriodId:string}} params.window
 * @param {{flats:object[], paid:object[], rateTable:object[], exceptions:object[]}} params.parsedTemplate
 * @param {string} params.performedBy - userId, or "System"/"Cron"/"Script"
 * @param {string} [params.fileName]
 * @param {string} [params.importBatchId] - caller-supplied idempotency key; a new one is minted if omitted
 * @returns {Promise<{committed:true, historyBillCount:number, liveBillResults:{generated:Array,failed:Array}, warnings:Array, importBatchId:string}>}
 * @throws {CommitError}
 */
export async function commitBillHistory({
  societyId,
  window,
  parsedTemplate,
  performedBy,
  fileName = "BillHistory",
  importBatchId,
}) {
  if (!societyId) throw new CommitError("MISSING_SOCIETY_ID", "societyId is required");
  if (!window?.periods?.length) throw new CommitError("EMPTY_WINDOW", "History window has no periods — nothing to commit");
  if (!window.firstLivePeriodId) throw new CommitError("MISSING_FIRST_LIVE_PERIOD", "window.firstLivePeriodId is required to generate the current live bill");

  // ── Load fresh, authoritative data — never trust anything the caller
  // computed earlier; re-derive from the current DB state (§19 step 1/2). ──
  const society = await Society.findById(societyId).lean();
  if (!society) throw new CommitError("SOCIETY_NOT_FOUND", "Society not found");

  const members = await Member.find({ societyId, isDeleted: { $ne: true } })
    .select("flatNo wing ownerName openingPrincipal openingInterest advanceCredit")
    .lean();
  const memberByFlat = new Map(members.map((m) => [`${m.wing}-${m.flatNo}`, m]));

  // ── Re-run reconstruction from scratch server-side (§19 step 2/3) —
  // never trust a precomputed/staged result, even one this same process
  // computed moments ago for a preview screen. ──
  const result = reconstructHistory({ window, parsedTemplate, society });
  const blocking = result.errors.filter((e) => e.severity !== "WARNING");
  if (blocking.length > 0) {
    throw new CommitError(
      "RECONSTRUCTION_FAILED",
      "Reconstruction has blocking errors — nothing was written",
      { errors: result.errors, warnings: result.warnings },
    );
  }

  const flatsWithBills = Object.entries(result.billsByFlat).filter(([, bills]) => bills.length > 0);
  if (flatsWithBills.length === 0) {
    throw new CommitError("NOTHING_TO_COMMIT", "Reconstruction produced zero bills — nothing to commit");
  }

  // ── Every flat in the reconstruction must map to a real, current Member
  // (§24 "unknown/unresolvable flat"). Fail closed, before any write. ──
  const unmapped = flatsWithBills.map(([flat]) => flat).filter((flat) => !memberByFlat.has(flat));
  if (unmapped.length > 0) {
    throw new CommitError("UNMAPPED_FLATS", `Flats not found in current Members: ${unmapped.join(", ")}`, { unmapped });
  }

  // ── Already-committed guard (§18/§24 "duplicate import"/"already
  // committed staging") — refuse if ANY of these periods already has a
  // history bill for this society. ──
  const existingHistoryBill = await Bill.findOne({
    societyId,
    isHistoricalArchive: true,
    billPeriodId: { $in: window.periods },
  }).select("_id billPeriodId").lean();
  if (existingHistoryBill) {
    throw new CommitError(
      "ALREADY_COMMITTED",
      `This society already has a committed history bill for ${existingHistoryBill.billPeriodId} — reverse the existing batch before re-importing`,
      { existingPeriod: existingHistoryBill.billPeriodId },
    );
  }

  // ── Per-society lock (§38-D): one commit in flight at a time. Atomic
  // claim — the filter only matches an unlocked document, so a second
  // concurrent caller's findOneAndUpdate simply matches nothing. ──
  const lockClaim = await Society.findOneAndUpdate(
    { _id: societyId, "billHistoryCommitLock.lockedAt": null },
    { $set: { billHistoryCommitLock: { lockedAt: new Date(), lockedBy: performedBy || "System" } } },
  );
  if (!lockClaim) {
    throw new CommitError("IMPORT_IN_PROGRESS", "Another bill-history commit is already in progress for this society");
  }

  const batchId = importBatchId || new mongoose.Types.ObjectId().toString();
  let historyBillCount = 0;

  try {
    // ── Phase 1: ONE atomic transaction — history Bills + their audit
    // events + Member opening-balance rollforward. ──
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const [flat, bills] of flatsWithBills) {
          const member = memberByFlat.get(flat);

          for (const b of bills) {
            // Defense-in-depth re-check right before persistence (§19 step
            // 3) — reconstructHistory already validated this bill, but
            // nothing gets written on trust alone.
            validateBillInvariants(b);

            const [year, month] = b.billPeriodId.split("-").map(Number);
            const dueDate = new Date(year, month, 0); // last day of the bill's own month — a historical fact has no live due-day meaning

            const billDoc = {
              societyId,
              memberId: member._id,
              billPeriodId: b.billPeriodId,
              billMonth: month - 1,
              billYear: year,
              openingPrincipal: b.openingPrincipal,
              openingInterest: b.openingInterest,
              currentCharges: b.currentCharges,
              currentInterest: b.currentInterest,
              billPrincipalBalance: twoDp(b.openingPrincipal + b.currentCharges),
              billInterestBalance: twoDp(b.openingInterest + b.currentInterest),
              totalBillDue: b.totalBillDue,
              totalAmount: b.totalBillDue,
              closingPrincipal: b.closingPrincipal,
              closingInterest: b.closingInterest,
              closingTotal: twoDp(b.closingPrincipal + b.closingInterest),
              amountPaid: b.amountPaid,
              balanceAmount: b.balanceAmount,
              advanceApplied: b.advanceCredit || 0,
              charges: new Map(Object.entries(b.charges)),
              status: b.status,
              dueDate,
              importedFrom: "BulkImport",
              importBatchId: batchId,
              importMetadata: {
                fileName,
                uploadedAt: new Date(),
                rowNumber: 0,
                validationStatus: "Valid",
              },
              isHistoricalArchive: true,
              importedFinancialYear: financialYearLabel(window.fyStartPeriodId),
              calculationVersion: 0,
              engineVersion: ENGINE_VERSION,
              isDeleted: false,
            };

            const [created] = await Bill.create([billDoc], { session });
            historyBillCount++;

            await AuditEvent.create(
              [
                {
                  societyId,
                  memberId: member._id,
                  billId: created._id,
                  eventType: "BILL_GENERATED",
                  performedBy: performedBy || "System",
                  calculationVersion: 0,
                  engineVersion: ENGINE_VERSION,
                  openingPrincipal: b.openingPrincipal,
                  openingInterest: b.openingInterest,
                  currentCharges: b.currentCharges,
                  currentInterest: b.currentInterest,
                  totalBillDue: b.totalBillDue,
                },
              ],
              { session },
            );
          }

          const last = bills[bills.length - 1];
          await Member.updateOne(
            { _id: member._id },
            {
              $set: {
                openingPrincipal: last.closingPrincipal,
                openingInterest: last.closingInterest,
                advanceCredit: last.advanceCredit,
              },
            },
            { session },
          );
        }

        await Society.updateOne(
          { _id: societyId },
          {
            $set: {
              "onboarding.billHistoryImported": true,
              "onboarding.billHistoryImportedAt": new Date(),
              "onboarding.billHistoryPeriods": window.periods,
              "onboarding.joinPeriodId": window.firstLivePeriodId,
            },
          },
          { session },
        );
      });
    } finally {
      session.endSession();
    }

    // ── Phase 2: generate the current live month's first Bill per member,
    // via the existing production generator. Not part of phase 1's
    // transaction (see file header) — failures here are per-member and
    // retriable, and never undo phase 1's already-committed history. ──
    const [liveYear, liveMonth] = window.firstLivePeriodId.split("-").map(Number);
    const memberIds = flatsWithBills.map(([flat]) => memberByFlat.get(flat)._id);
    const liveBillResults = await generateBillsForMembers({
      societyId,
      memberIds,
      year: liveYear,
      month: liveMonth,
      performedBy: performedBy || "System",
    });

    // Tag the live bill(s) with the same batch id as the history bills, so a
    // single rollback (lib/onboarding-rollback.js::compensateImportRun, keyed
    // on this same id when it's the bulk-import run's importRunId) deletes
    // BOTH the history and the live bill together — not just the history
    // ones. generateBillsForMembers doesn't accept an import tag itself
    // (§0 — it's the shared production generator, not specific to imports),
    // so it's applied here as a follow-up, same pattern bulk-import's own
    // Phase 5 already uses for its own immediately-generated bills.
    if (liveBillResults.generated.length > 0) {
      await Bill.updateMany(
        { _id: { $in: liveBillResults.generated.map((g) => g.billId) } },
        { $set: { importBatchId: batchId, importedFrom: "BulkImport" } },
      );
    }

    return {
      committed: true,
      historyBillCount,
      liveBillResults,
      warnings: result.warnings,
      importBatchId: batchId,
    };
  } finally {
    // Lock is always released, whichever way phase 1/2 ended.
    await Society.updateOne(
      { _id: societyId },
      { $set: { "billHistoryCommitLock.lockedAt": null, "billHistoryCommitLock.lockedBy": null } },
    );
  }
}
