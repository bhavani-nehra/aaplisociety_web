/**
 * POST /api/admin/bulk-import
 *
 * Commit-only. Parsing and validation (including every DB uniqueness check)
 * happen in POST /api/admin/bulk-import/preview, which caches the validated
 * result under a previewId — see lib/import/bulkImportValidate.js and
 * models/BulkImportPreview.js. This route just loads that cache and writes
 * (society → admin user → members, atomically, tagged with an importRunId
 * so a crash/retry can be detected and compensated instead of leaving
 * partial data or double-importing). It never re-parses the file or
 * re-queries "is this email taken" — that was already answered once, and a
 * retry after a mid-import failure reuses the same previewId rather than
 * asking the DB again what it just confirmed.
 *
 * State machine (see BulkImportRun.status):
 *   VALIDATING → IMPORTING → FINALIZING → COMMITTED → EMAIL_QUEUED → COMPLETED
 *   terminal failure states: FAILED / ROLLED_BACK
 *
 * The client sends a stable importRunId (generated once, kept across
 * refresh/retry). Duplicate submits with the same key are rejected while a
 * run is in flight, and a COMPLETED run replays its cached result instead
 * of re-importing.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import User from "@/models/User";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import BulkImportRun from "@/models/BulkImportRun";
import BulkImportPreview from "@/models/BulkImportPreview";
import { compensateImportRun } from "@/lib/onboarding-rollback";
import TenantRequest from "@/models/TenantRequest";
// SEC-20: read back after seeding to assert the society is actually usable,
// rather than trusting that two awaited calls not throwing means they worked.
import Role from "@/models/Role";
import RoleAssignment from "@/models/RoleAssignment";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { generateBill } from "@/lib/billing/generationService";
import { applyPaymentToBill } from "@/lib/billing/allocationService";
import { isCommercialUnit } from "@/lib/commercial/constants";
import { generateSimpleUsername, buildUsernameBloomFilter } from "@/lib/username-generator";
import { generateUniqueSocietyCode } from "@/lib/society-code";
import { generatePassword } from "@/lib/password-generator";
import cache from "@/lib/cache";
import { finalizeBulkImportOnboarding } from "@/lib/onboarding-finalize";
import { ensureAdminAssignment } from "@/lib/rbac/ensure-admin-assignment";
import { seedAllRoleTemplatesForSociety } from "@/lib/rbac/seed-society-roles";
import { getBillHistoryWindow } from "@/lib/billing/historicalWindow";

const STALE_RUN_MS = 3 * 60 * 1000; // an in-flight run with no update in 3 min is presumed crashed

function generateSocietyId(name) {
  const parts = name.trim().split(" ");
  const first = parts[0]?.slice(0, 4).toLowerCase() || "soc";
  const last = parts[parts.length - 1]?.slice(0, 4).toLowerCase() || "ety";
  const year = new Date().getFullYear();
  const rand = String(Math.floor(10 + Math.random() * 90));
  return `${first}_${last}_${year}_${rand}`;
}

// Single rollback path for the whole import, regardless of which phase
// failed — every document created by an import carries importRunId (Bill
// uses the pre-existing importBatchId field for the same purpose), so
// compensation never has to be kept in sync with a second, hand-maintained
// list of "what this phase created".

async function markRun(importRunId, patch) {
  try {
    await BulkImportRun.updateOne({ importRunId }, { $set: patch });
  } catch (err) {
    console.error("[bulk-import] status update failed:", err.message);
  }
}

export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  await connectDB();

  const formData = await request.formData();
  const previewId = String(formData.get("previewId") || "").trim();
  const importRunId =
    String(formData.get("importRunId") || "").trim() ||
    new mongoose.Types.ObjectId().toString();

  if (!previewId) {
    return NextResponse.json(
      {
        error:
          "No previewId given. Upload the file to /api/admin/bulk-import/preview first, review the result, then commit with the previewId it returns.",
      },
      { status: 400 },
    );
  }

  // ── IDEMPOTENCY / DUPLICATE-SUBMIT GUARD ─────────────────────────────
  const existingRun = await BulkImportRun.findOne({ importRunId });
  if (existingRun) {
    if (existingRun.status === "COMPLETED") {
      return NextResponse.json({ ...existingRun.result, replay: true, importRunId });
    }
    if (existingRun.status !== "FAILED" && existingRun.status !== "ROLLED_BACK") {
      const ageMs = Date.now() - new Date(existingRun.updatedAt).getTime();
      if (ageMs < STALE_RUN_MS) {
        return NextResponse.json(
          {
            error:
              "An import with this key is already running — wait for it to finish before retrying.",
            importRunId,
            status: existingRun.status,
          },
          { status: 409 },
        );
      }
      // Presumed-crashed run (no progress for 3+ min).
      if (existingRun.pointOfNoReturn) {
        // Society/members/bills are real and already exposed, and onboarding
        // emails may already be sitting in real inboxes. Deleting them now
        // would orphan those users — never auto-compensate past this point.
        // The stuck run needs a human, not a silent retry.
        return NextResponse.json(
          {
            error:
              "This import already created the society, members, and bills — and may already have emailed onboarding credentials — before an internal error interrupted the final step. Nothing was rolled back and nothing will be auto-deleted. Do NOT re-upload/re-run this file; check the Society list for it, and contact support with this importRunId if anything looks incomplete.",
            importRunId,
            status: existingRun.status,
            pointOfNoReturn: true,
          },
          { status: 409 },
        );
      }
      // Anything it actually wrote is tagged with this importRunId and gets
      // swept here before we let a fresh attempt reuse the key.
      await compensateImportRun(importRunId);
    }
  }
  await BulkImportRun.findOneAndUpdate(
    { importRunId },
    {
      importRunId,
      status: "VALIDATING",
      stage: "Loading the reviewed preview",
      processedCount: 0,
      totalCount: 0,
      warnings: [],
      errorMessages: [],
      result: null,
      startedAt: new Date(),
      finishedAt: null,
    },
    { upsert: true },
  );

  const fail = async (body, status) => {
    await markRun(importRunId, {
      status: "FAILED",
      errorMessages: body.errors || [body.error].filter(Boolean),
      finishedAt: new Date(),
    });
    return NextResponse.json({ ...body, importRunId }, { status });
  };

  // ── Load the already-validated preview — no re-parsing, no re-querying
  //    "is this email taken" a second time. If a prior commit attempt with
  //    THIS importRunId failed mid-way, the preview is untouched (only
  //    marked used on actual success below) — this retry gets the exact
  //    same reviewed data back, not a fresh DB scan.
  const preview = await BulkImportPreview.findOne({ previewId }).lean();
  if (!preview) {
    return fail(
      {
        error:
          "This preview has expired or was already used. Re-upload the file to /preview and review it again before importing.",
        code: "PREVIEW_NOT_FOUND",
      },
      410,
    );
  }
  if (preview.used) {
    return fail(
      {
        error: "This preview was already imported. Re-upload the file to /preview if you need to import again.",
        code: "PREVIEW_ALREADY_USED",
      },
      409,
    );
  }

  // SEC-26: Master Prompt 2 §19 — "if even ONE row is invalid, DO NOT IMPORT
  // ANYTHING". 900 rows with 40 errors must import 0, not 860.
  //
  // That rule already holds: /preview only mints a previewId when
  // `runPreviewChecks()` returns ok, so a failing workbook produces no token.
  // But it held in a DIFFERENT REQUEST from the one that performs the write,
  // and the write side never re-checked — the guarantee was "no valid token
  // exists", not "this token is valid". A previewId lives 30 minutes.
  //
  // `ok === false` is the assert. `ok == null` is a preview written before this
  // field existed: it could only have been created under the old `if
  // (result.ok)` gate, so it is treated as passing rather than locking out an
  // admin mid-import on a deploy boundary.
  if (preview.ok === false) {
    const failedRows = (preview.rowResults || []).filter((r) => r?.status === "error");
    return fail(
      {
        error:
          `This workbook has ${failedRows.length} row${failedRows.length === 1 ? "" : "s"} that failed validation. ` +
          "Nothing was imported. Fix the rows listed below, re-upload, and review the preview again.",
        code: "PREVIEW_HAS_ERRORS",
        errorCount: failedRows.length,
        rows: failedRows.slice(0, 50),
      },
      422,
    );
  }

  const societyPayload = preview.societyPayload;
  const validMembers = preview.validMembers;
  const warnings = preview.warnings || [];
  const existingMemberUsersByEmail = new Map(
    (preview.existingMemberEmailMap || []).map(([email, u]) => [
      email,
      { _id: u._id, username: u.username || null },
    ]),
  );
  const multiSocietyAdminUser = preview.multiSocietyAdminUserId
    ? await User.findById(preview.multiSocietyAdminUserId)
    : null;

  // Accounts created DURING this run, keyed by email. This is the map the
  // Phase 3 loop actually needs: when the same owner holds several flats, the
  // second and third rows must attach a profile to the user the first row
  // created, not create a duplicate account.
  //
  // Pre-seeded with accounts that already existed before this run
  // (existingMemberUsersByEmail, above) — the loop below can't tell those
  // apart from an account it created two rows ago, and doesn't need to.
  const createdUsersByEmail = new Map(existingMemberUsersByEmail); // email -> { _id, username }
  await markRun(importRunId, {
    status: "IMPORTING",
    stage: "Creating society, users, and members",
    totalCount: validMembers.length,
  });
  // ── PHASE 3: CREATE (society + admin + members + member users + billing heads), ATOMIC ──
  let societyId,
    attempts = 0;
  do {
    societyId = generateSocietyId(societyPayload.societyName);
    if (!(await Society.findOne({ societyId }))) break;
  } while (++attempts < 10);
  const societyCode = await generateUniqueSocietyCode();
  const plainPassword = generatePassword();
  const usernameBloom = await buildUsernameBloomFilter();
  const noEmailMembers = validMembers.filter((m) => !m.emailPrimary);
  if (noEmailMembers.length > 0) {
    warnings.push(
      `${noEmailMembers.length} member(s) had no emailPrimary — no login account or onboarding email created for: ${noEmailMembers.map((m) => `${m.wing}-${m.flatNo}`).join(", ")}`,
    );
  }
  // Do the CPU-bound work (bcrypt, username generation) BEFORE opening the
  // transaction, in parallel — this is what was blowing the import out to
  // 2-4 minutes (sequential bcrypt.hash + a findOne round-trip per member,
  // one member at a time, all inside a single request). Mongo transactions
  // also have a bounded lifetime, so keeping only fast DB ops inside
  // session.withTransaction matters, not just speed.
  const [adminHash, memberPrep] = await Promise.all([
    bcrypt.hash(plainPassword, 10),
    Promise.all(
      validMembers.map(async (memberData) => {
        if (!memberData.emailPrimary) return { memberData };
        const memberPwd = generatePassword();
        const memberHash = await bcrypt.hash(memberPwd, 10);
        // Username generation shares one Bloom filter across the batch, so
        // it must stay sequential (each call may add to the filter) even
        // though bcrypt hashing above runs in parallel across members.
        const username = await generateSimpleUsername(societyCode, memberData.flatNo, usernameBloom);
        return { memberData, memberPwd, memberHash, username };
      }),
    ),
  ]);

  let society;
  let societyAdminUser;
  let billingHeads = [];
  const memberCredentials = [];
  const memberCreateErrors = [];
  let membersCreated = 0;
  // Computed here (not down at Phase 5, where this used to live) because
  // Society.onboarding.joinPeriodId needs it at creation time — that field
  // is the single source of truth lib/billing/historicalWindow.js reads to
  // work out whether this society has bill-history months to import before
  // its first live bill (final_audit_fix_plan/bill-history-upgrade.md §40).
  // A society bulk-imported today "joins" this calendar month, by
  // definition — there is no separate join-date input in this flow.
  const now = new Date();
  const billYear = now.getFullYear();
  const billMonth = now.getMonth() + 1; // 1-indexed
  const billPeriod = `${billYear}-${String(billMonth).padStart(2, "0")}`;
  const startDate = new Date(billYear, billMonth - 1, 1);
  const financialYear =
    billMonth >= 4
      ? `${billYear}-${billYear + 1}`
      : `${billYear - 1}-${billYear}`;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [createdSociety] = await Society.create(
        [
          {
            name: societyPayload.societyName,
            societyId,
            societyCode,
            registrationNo: societyPayload.registrationNo || undefined,
            address: societyPayload.address,
            panNo: societyPayload.panNo,
            tanNo: societyPayload.tanNo,
            config: societyPayload.config,
            credentials: {
              adminEmail: societyPayload.email,
              // SEC-19: `plainPassword` is no longer written. The field is
              // deprecated on the schema (select:false) and is being unset by
              // scripts/security/purge-plain-passwords.js. The admin receives a
              // setup link by email — see the onboarding outbox below — and
              // chooses their own password; nobody stores or reads it.
            },
            subscription: { status: "Trial", startDate: new Date() },
            isDeleted: false,
            importRunId,
            importStatus: "importing",
            onboarding: { joinPeriodId: billPeriod },
          },
        ],
        { session },
      );
      society = createdSociety;

      if (multiSocietyAdminUser) {
        // Same person, second society: no second login. Their root
        // User.societyId/role stay pointed at whichever society they
        // registered with first — that's fine, it's only a legacy fallback;
        // the actual per-society admin grant is the RoleAssignment created
        // after this transaction commits (see seedAllRoleTemplatesForSociety
        // + ensureAdminAssignment below).
        societyAdminUser = multiSocietyAdminUser;
      } else {
        [societyAdminUser] = await User.create(
          [
            {
              name: societyPayload.fullName,
              email: societyPayload.email,
              password: adminHash,
              role: "Admin",
              societyId: society._id,
              profiles: [],
              isActive: true,
              importRunId,
              // Without this, the onboarding email's "set up my account" link
              // hits /api/onboarding/verify's mustChangePassword check and
              // says "already set up" the instant the admin clicks it —
              // model default is false, only the member-creation path below
              // ever set this explicitly.
              mustChangePassword: true,
            },
          ],
          { session },
        );
      }

      for (const prep of memberPrep) {
        const memberData = prep.memberData;
        const [member] = await Member.create(
          [{ ...memberData, societyId: society._id, importRunId }],
          { session },
        );
        if (memberData.emailPrimary) {
          const alreadyCreated = createdUsersByEmail.get(memberData.emailPrimary);
          if (alreadyCreated) {
            // Same owner, another flat. One login, one more profile.
            const profileId = new mongoose.Types.ObjectId();
            await User.updateOne(
              { _id: alreadyCreated._id },
              {
                $push: {
                  profiles: {
                    profileId,
                    societyId: society._id,
                    memberId: member._id,
                    flatNo: memberData.flatNo,
                    wing: memberData.wing,
                    societyName: societyPayload.societyName,
                    isPrimary: false,
                    status: "Active",
                    joinedAt: new Date(),
                  },
                },
              },
              { session },
            );
            // No second onboarding email: isNewUser stays false, so the
            // EmailOutbox filter at the end of this route skips it. One token
            // activates every flat under this email.
            memberCredentials.push({
              userId: alreadyCreated._id,
              flatNo: memberData.flatNo,
              wing: memberData.wing,
              ownerName: memberData.ownerName,
              email: memberData.emailPrimary,
              username: alreadyCreated.username,
              password: "(same login as this owner's first flat)",
              isNewUser: false,
              additionalFlatFor: alreadyCreated.username,
            });
          } else {
            const [newUser] = await User.create(
              [
                {
                  name: memberData.ownerName,
                  email: memberData.emailPrimary,
                  username: prep.username,
                  phone: memberData.contactNumber || null,
                  password: prep.memberHash,
                  role: "Member",
                  societyId: society._id,
                  mustChangePassword: true,
                  profiles: [
                    {
                      profileId: new mongoose.Types.ObjectId(),
                      societyId: society._id,
                      memberId: member._id,
                      flatNo: memberData.flatNo,
                      wing: memberData.wing,
                      societyName: societyPayload.societyName,
                      isPrimary: true,
                      status: "Active",
                      joinedAt: new Date(),
                    },
                  ],
                  isActive: true,
                  importRunId,
                },
              ],
              { session },
            );
            // Register before the next iteration. This single line is what
            // turns three rows into one account with three profiles.
            createdUsersByEmail.set(memberData.emailPrimary, {
              _id: newUser._id,
              username: prep.username,
            });

            memberCredentials.push({
              userId: newUser._id,
              flatNo: memberData.flatNo,
              wing: memberData.wing,
              ownerName: memberData.ownerName,
              username: prep.username,
              email: memberData.emailPrimary,
              password: prep.memberPwd,
              isNewUser: true,
            });
          }
        }
        const tenant = memberData.currentTenant;
        if (tenant?.name && tenant?.contactNumber) {
          const tenantEmail = String(tenant.email || '').trim().toLowerCase();
          const tenantPwd = generatePassword();
          const tenantHash = await bcrypt.hash(tenantPwd, 10);
          const tenantUsername = await generateSimpleUsername(
            societyCode, `${memberData.flatNo}t`, usernameBloom);
          const [tenantUser] = await User.create([{
            name: tenant.name,
            email: tenantEmail || undefined,
            username: tenantUsername,
            phone: tenant.contactNumber,
            password: tenantHash,
            role: "Member",
            societyId: society._id,
            mustChangePassword: true,
            profiles: [{
              profileId: new mongoose.Types.ObjectId(),
              societyId: society._id,
              memberId: member._id,
              role: "Member",
              occupancyType: "Tenant",
              flatNo: memberData.flatNo,
              wing: memberData.wing,
              societyName: society.name,
              isPrimary: true,
              status: "Active",
              joinedAt: new Date(),
            }],
            isActive: true,
            importRunId,
          }], { session });
          await TenantRequest.create([{
            societyId: society._id,
            memberId: member._id,
            requestedByUserId: tenantUser._id,
            tenantName: tenant.name,
            tenantPhone: tenant.contactNumber,
            tenantEmail: tenantEmail || undefined,
            leaseStartDate: tenant.startDate,
            leaseEndDate: tenant.endDate,
            rentPerMonth: tenant.rentPerMonth,
            depositAmount: tenant.depositAmount,
            status: "Approved",
            approvedAt: new Date(),
            approvedBy: tenantUser._id,
            importRunId,
          }], { session });
          if (tenantEmail) memberCredentials.push({
            userId: tenantUser._id,
            flatNo: memberData.flatNo,
            wing: memberData.wing,
            ownerName: tenant.name,
            username: tenantUsername,
            email: tenantEmail,
            password: tenantPwd,
            isNewUser: true,
            accountType: "Tenant",
          });
        }
        membersCreated++;
      }

      const headsToCreate = societyPayload.config.charges
        .filter((c) => (c.label || c.name)?.trim() && c.isActive !== false)
        .map((c, i) => ({
          headName: (c.label || c.name || "").trim(),
          calculationType: c.type === "Per Sq Ft" ? "Per Sq Ft" : "Fixed",
          defaultAmount: Number(c.value) || 0,
          isActive: true,
          isDeleted: false,
          order: i + 1,
          societyId: society._id,
          importRunId,
        }));
      if (headsToCreate.length > 0) {
        billingHeads = await BillingHead.create(headsToCreate, { session, ordered: true });
      } else {
        warnings.push(
          "No billing heads created — all charge values were 0 in the Society sheet.",
        );
      }
    });
  } catch (err) {
    session.endSession();
    await compensateImportRun(importRunId);
    return fail(
      {
        validationFailed: true,
        phase: memberCreateErrors.length ? "members" : "society",
        errors: [err.message],
        warnings,
        rollback: true,
      },
      500,
    );
  }
  session.endSession();
  // The login route no longer accepts the bare root role string (see
  // app/api/auth/login/route.js) — without this the society admin account
  // just created could never log in. Deliberately AFTER the transaction
  // commits (Role/RoleAssignment aren't part of it, and reading a Role inside
  // an uncommitted session would race the write).
  // SEC-20: this block used to be two `.catch(console.error)` calls.
  //
  // Running it AFTER the transaction is correct and the comment above explains
  // why. Swallowing its failure was not. If either call threw, the import
  // reported success and the society existed with zero roles and an Admin who
  // could not log in — because the login route no longer accepts a bare root
  // role string, so an account with no RoleAssignment fails at "no active
  // society profiles". The only trace was one line in a server log.
  //
  // Now: the outcome is checked, asserted, and recorded on the run so it can be
  // repaired. Both functions are idempotent, so the repair is a plain re-run.
  let rbacRepair = null;
  if (societyAdminUser) {
    try {
      await seedAllRoleTemplatesForSociety(society._id, { actorId: societyAdminUser._id });
      await ensureAdminAssignment({
        userId: societyAdminUser._id,
        societyId: society._id,
        legacyRole: "Admin",
      });

      // Neither function throwing is not the same as the society being usable.
      // Assert the two facts the admin's next login actually depends on.
      const [roleCount, adminAssignment] = await Promise.all([
        Role.countDocuments({ societyId: society._id }),
        RoleAssignment.findOne({
          societyId: String(society._id),
          userId: societyAdminUser._id,
          status: "active",
        }).lean(),
      ]);
      if (roleCount === 0) {
        rbacRepair = "Role templates were not created for this society.";
      } else if (!adminAssignment) {
        rbacRepair = "The society admin has no active RoleAssignment and cannot sign in.";
      }
    } catch (err) {
      rbacRepair = err?.message || String(err);
    }

    if (rbacRepair) {
      console.error("[bulk-import] RBAC setup incomplete:", rbacRepair);
      await markRun(importRunId, {
        status: "NEEDS_REPAIR",
        stage: "RBAC setup incomplete — admin cannot sign in until repaired",
        repairDetail: { step: "rbac-seeding", reason: rbacRepair, repairedAt: null },
      });
      warnings.push(
        `Role setup did not complete: ${rbacRepair} The society and its members were created, but the admin cannot sign in until this is repaired. Use "Repair role setup" on this import.`,
      );
    }
  }
  await markRun(importRunId, {
    status: "FINALIZING",
    stage: "Generating current-month bills",
    societyId: society._id,
    processedCount: membersCreated,
  });

  // ── PHASE 5: GENERATE CURRENT MONTH BILLS ────────────────────────
  // generateBill/applyPaymentToBill each manage their own internal
  // transaction, so this phase runs after Phase 3 commits rather than nested
  // inside it. Any failure here is compensated the same way as a Phase 3
  // failure: delete everything tagged with this importRunId.
  // (billYear/billMonth/billPeriod/startDate/financialYear are computed
  // above, before Society.create, since onboarding.joinPeriodId needs them.)
  let billsGenerated = 0;
  const billErrors = [];
  // §40 ONBOARDING ORDER: a society with bill-history months to fill (its FY
  // start is before this calendar month) must NOT get its current-month
  // bill generated yet — that bill's opening balances would be wrong until
  // bill-history is committed and rolls each Member's opening forward.
  // Generation is deferred to the Bill History step's Confirm (or its Skip
  // action, which generates off the Member sheet's typed openings instead —
  // see /api/superadmin/bill-history-v2/skip). A society with NO history
  // needed (joined on/before its own FY start) keeps today's immediate
  // behavior unchanged.
  let needsBillHistory = false;
  try {
    needsBillHistory = getBillHistoryWindow(society).periods.length > 0;
  } catch {
    needsBillHistory = false; // no accountingConfig / can't compute — fall back to today's behavior rather than block onboarding
  }
  if (needsBillHistory) {
    warnings.push(
      `Current-month (${billPeriod}) bills were NOT generated yet — this society has bill-history months to import first. Use "Import Bill History" below, or Skip to generate ${billPeriod}'s bills immediately off the opening balances already on the Members sheet.`,
    );
  }
  if (!needsBillHistory && billingHeads.length > 0 && membersCreated > 0) {
    const allMembers = await Member.find({
      societyId: society._id,
      isDeleted: { $ne: true },
    }).lean();
    for (const member of allMembers) {
      if (isCommercialUnit(member)) {
        warnings.push(`${member.wing}-${member.flatNo}: Commercial unit skipped — use the Commercial billing wizard instead`);
        continue;
      }
      try {
        // Ledger V2: the canonical GenerationService owns opening/current/
        // interest math — no independent calculation here. First-ever bill
        // for a member seeds openingPrincipal/openingInterest from the
        // Member doc (set from the import sheet), same as before.
        const bill = await generateBill({
          societyId: society._id,
          memberId: member._id,
          year: billYear,
          month: billMonth,
          performedBy: "System",
        });
        await Bill.updateOne(
          { _id: bill._id },
          { $set: { importBatchId: importRunId, importedFrom: "BulkImport" } },
        );
        if (bill.status !== "Scheduled" && (member.advanceCredit || 0) > 0) {
          const applied = Math.min(
            parseFloat(member.advanceCredit.toFixed(2)),
            bill.totalBillDue,
          );
          if (applied > 0) {
            await applyPaymentToBill({ billId: bill._id, payment: applied, performedBy: "System" });
            await Member.updateOne({ _id: member._id }, { $inc: { advanceCredit: -applied } });
          }
        }
        const transactionId = Transaction.generateTransactionId();
        const newBalance = (member.openingBalance || 0) + bill.currentCharges;
        await Transaction.create({
          transactionId,
          societyId: society._id,
          memberId: member._id,
          createdBy: society._id,
          date: startDate,
          type: "Debit",
          category: "Maintenance",
          description: `Bill for ${billPeriod}`,
          amount: bill.currentCharges,
          balanceAfterTransaction: newBalance,
          paymentMode: "System",
          billPeriodId: billPeriod,
          financialYear,
          importRunId,
        });
        // Do NOT zero Member.openingPrincipal/openingInterest here.
        // They are the member's original seed values — zeroing them means if
        // the generated bill is later deleted, the system loses the opening balance forever.
        billsGenerated++;
      } catch (err) {
        console.error(
          `[bulk-import] bill error for ${member.wing}-${member.flatNo}:`,
          err.message,
          err.stack?.split("\n")[1],
        );
        billErrors.push(`${member.wing}-${member.flatNo}: ${err.message}`);
      }
    }
  } else if (validMembers.length === 0) {
    warnings.push("No bills generated — no members were imported.");
  } else if (billingHeads.length === 0) {
    warnings.push("No bills generated — billing heads could not be created.");
  }
  // ── ROLLBACK if bills failed for any member that was expected ────────
  if (billErrors.length > 0) {
    await compensateImportRun(importRunId);
    await markRun(importRunId, {
      status: "ROLLED_BACK",
      errorMessages: billErrors,
      finishedAt: new Date(),
    });
    return NextResponse.json(
      {
        validationFailed: true,
        phase: "bills",
        errors: billErrors,
        warnings,
        rollback: true,
        importRunId,
      },
      { status: 500 },
    );
  }

  // ── FINALIZE, or DEFER (§40 ONBOARDING ORDER) ─────────────────────────
  // Only now — a mid-transaction failure above must leave the preview
  // reusable so a retry with the same previewId skips straight back to
  // Phase 3 instead of re-uploading and re-validating from scratch.
  await BulkImportPreview.updateOne({ previewId }, { $set: { used: true } }).catch(() => {});
  if (billsGenerated > 0) {
    await cache.delPattern(`v1:bills:${society._id}:member:*`);
    await cache.delPattern(`v1:ledger:${society._id}:member:*`);
  }

  let adminSetCredentialsUrl = null;
  let onboardingEmailErrors = [];

  if (needsBillHistory) {
    // This society still needs a Bill History decision (Confirm or Skip,
    // in the wizard's Step 4) before it's actually done. Society/Members/
    // BillingHeads are real rows (bill-history reconstruction needs real
    // flat records to attach bills and roll balances forward onto), but
    // the society stays importStatus:"importing" (not "active") and NO
    // email goes out yet — and this run is deliberately left WITHOUT
    // pointOfNoReturn, so it is still eligible for compensateImportRun()
    // if the admin abandons or the Bill History step fails outright (see
    // /api/superadmin/bill-history-v2/commit and /cancel).
    await markRun(importRunId, {
      status: "AWAITING_BILL_HISTORY",
      stage: "Waiting for the Bill History step",
      processedCount: billsGenerated,
    });
  } else {
    // Nothing to wait for — finalize immediately, exactly as before.
    await markRun(importRunId, {
      status: "COMMITTED",
      stage: "Queueing onboarding emails",
      processedCount: billsGenerated,
      pointOfNoReturn: true, // real data now — never auto-compensate a stuck retry past here
    });
    // ── Past this point nothing may compensate/delete. Any error below is
    // real, must never crash uncaught (it would leave the run stuck at
    // COMMITTED forever with no FAILED/finishedAt, and a later retry would
    // hit the pointOfNoReturn guard above and dead-end on a run that never
    // actually finished) — so it's caught here, logged, and turned into a
    // clear "data is real, don't retry, contact support" response.
    try {
      const finalized = await finalizeBulkImportOnboarding({
        importRunId,
        societyId: society._id,
        societyPayload,
        memberCredentials,
        societyAdminUser,
        multiSocietyAdminUser,
      });
      adminSetCredentialsUrl = finalized.adminSetCredentialsUrl;
      onboardingEmailErrors = finalized.onboardingEmailErrors;
    } catch (err) {
      console.error(`[bulk-import] post-commit error for run ${importRunId}:`, err.message, err.stack);
      await markRun(importRunId, {
        errorMessages: [err.message],
        finishedAt: new Date(),
      });
      return NextResponse.json(
        {
          error:
            "Society, members, and bills were created successfully, but an internal error interrupted the final onboarding-email step. Nothing was rolled back. Do NOT re-upload/re-run this file — check the Society list, and contact support with this importRunId if anything looks incomplete.",
          importRunId,
        },
        { status: 500 },
      );
    }
  }

  const activeCharges = societyPayload.config.charges.filter((c) => c.value > 0);

  const result = {
    success: true,
    importRunId,
    // SEC-20: true when role seeding did not complete. The society, members and
    // bills are real — but the admin cannot sign in until this is repaired, so
    // the wizard must say so rather than showing an unqualified success.
    rbacRepairNeeded: Boolean(rbacRepair),
    rbacRepairReason: rbacRepair || null,
    society: {
      id: society._id,
      name: society.name,
      societyId: society.societyId,
      societyCode: society.societyCode,
      activeChargesCount: activeCharges.length,
      chargesSummary: activeCharges.map((c) => `${c.label}: ₹${c.value}`),
    },
    admin: {
      // Read back by /api/superadmin/bill-history-v2/commit|skip|cancel to
      // finalize onboarding (or roll it back) later, once this run is
      // AWAITING_BILL_HISTORY — see lib/onboarding-finalize.js.
      userId: societyAdminUser?._id || null,
      name: societyPayload.fullName,
      email: societyPayload.email,
      // SEC-19: the generated password is never returned. It is hashed, and the
      // admin gets a setup link by email like every other new account. The
      // wizard shows the link, not a password.
      setCredentialsUrl: adminSetCredentialsUrl,
      reusedExistingAccount: !!multiSocietyAdminUser,
      note: multiSocietyAdminUser
        ? "This email already had a login. No new password was created — they sign in as before and this society now appears in their profile picker."
        : undefined,
    },
    membersCreated,
    memberCreateErrors,
    memberCredentials,
    onboardingEmailErrors,
    totalMemberRows: validMembers.length,
    billingHeadsCreated: billingHeads.length,
    billsGenerated,
    billPeriod,
    needsBillHistory,
    billErrors,
    warnings,
  };
  await cache.del("import:taken-emails");
  // SEC-20: COMPLETED would overwrite the NEEDS_REPAIR set above and hide the
  // one thing that stops this society being usable. An import whose RBAC setup
  // did not finish is not complete, however many members it created.
  // needsBillHistory: leave the AWAITING_BILL_HISTORY status set above alone —
  // this run genuinely is not done, whatever RBAC's state is.
  if (!needsBillHistory) {
    await markRun(importRunId, {
      status: rbacRepair ? "NEEDS_REPAIR" : "COMPLETED",
      stage: rbacRepair
        ? "RBAC setup incomplete — admin cannot sign in until repaired"
        : "Done",
      processedCount: validMembers.length,
      result,
      finishedAt: new Date(),
    });
  } else {
    await markRun(importRunId, { result });
  }
  return NextResponse.json(result);
}
