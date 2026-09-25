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
import EmailOutbox from "@/models/EmailOutbox";
import TenantRequest from "@/models/TenantRequest";
// Plan 02 §17 - the optional commercial and amenity sheets.
import CommercialCategory from "@/models/CommercialCategory";
import Shop from "@/models/Shop";
import BusinessProfile from "@/models/BusinessProfile";
import { Amenity, AmenityCategory } from "@/models/amenities";
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
import { sendEmail, onboardingEmailHtml } from "@/lib/brevo-email";
import { signToken } from "@/lib/jwt";
import { ensureAdminAssignment } from "@/lib/rbac/ensure-admin-assignment";
import { seedAllRoleTemplatesForSociety } from "@/lib/rbac/seed-society-roles";

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
async function compensateImportRun(importRunId) {
  if (!importRunId) return;
  try {
    await Promise.all([
      Bill.deleteMany({ importBatchId: importRunId }),
      Transaction.deleteMany({ importRunId }),
      BillingHead.deleteMany({ importRunId }),
      Member.deleteMany({ importRunId }),
      User.deleteMany({ importRunId }),
      Society.deleteMany({ importRunId }),
      EmailOutbox.deleteMany({ importRunId }),
    ]);
  } catch (cleanupErr) {
    console.error(
      `[bulk-import] compensation cleanup failed for run ${importRunId}:`,
      cleanupErr.message,
    );
  }
}

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
  // Plan 02 §17. Defaulted, so a preview taken before these sheets existed
  // (the 30-minute TTL means one can still be in flight) commits as it always
  // did rather than throwing on a missing field.
  const optional = {
    commercialCategories: [],
    shops: [],
    businesses: [],
    amenities: [],
    ...(preview.optional || {}),
  };
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
  // Plan 02 §17 - what the optional sheets produced, reported alongside
  // membersCreated so the final report covers everything the import wrote.
  const counts = {
    commercialCategories: 0,
    shops: 0,
    businesses: 0,
    amenities: 0,
    amenityCategories: 0,
  };
  // flatNo -> Member._id, so a shop can name the flat whose owner owns it.
  const memberIdByFlat = new Map();
  // shopNo -> Shop._id, so a business can name the unit it trades from.
  const shopIdByNo = new Map();
  // shopNo -> the Member._id of the flat whose owner owns that shop, which a
  // BusinessProfile requires.
  const shopOwnerMemberByNo = new Map();
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
        memberIdByFlat.set(String(memberData.flatNo).trim(), member._id);
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

      // ── Plan 02 §17: the optional commercial and amenity sheets ──────────
      //
      // Inside the same transaction as everything above. A society that
      // imported its flats but silently lost its shops would look successful
      // and be wrong, and the admin would not find out until somebody went
      // looking for a shop.
      //
      // Order matters: categories first, because shops and businesses
      // reference them by name.
      const categoryIdByName = new Map();
      if (optional.commercialCategories.length > 0) {
        const created = await CommercialCategory.create(
          optional.commercialCategories.map((c, i) => ({
            scope: "SOCIETY",
            societyId: society._id,
            name: c.name,
            slug: c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
            sortOrder: c.sortOrder ?? (i + 1) * 10,
            isActive: c.isActive,
            createdBy: societyAdminUser?._id,
          })),
          { session, ordered: true },
        );
        created.forEach((c) => categoryIdByName.set(c.name.toLowerCase(), c._id));
        counts.commercialCategories = created.length;
      }

      if (optional.shops.length > 0) {
        const created = await Shop.create(
          optional.shops.map((sh) => ({
            societyId: society._id,
            shopNo: sh.shopNo,
            wing: sh.wing || null,
            floor: sh.floor ?? 0,
            unitKind: sh.unitKind || "Shop",
            ownerName: sh.ownerName,
            ownerPhone: sh.ownerPhone || null,
            ownerEmail: sh.ownerEmail || null,
            // A flat link is a REFERENCE, not a reclassification: models/Shop.js
            // is explicit that setting ownerMemberId writes nothing back to
            // that Member. A resident who also owns a shop keeps one flat
            // record and one shop record, correctly separate.
            ownerMemberId: sh.ownerFlatNo
              ? memberIdByFlat.get(String(sh.ownerFlatNo).trim()) || null
              : null,
            areaSqft: sh.areaSqft ?? null,
            occupancyType: sh.occupancyType || "Owner-Occupied",
            tenantName: sh.tenantName || null,
            tenantPhone: sh.tenantPhone || null,
            leaseStartDate: sh.leaseStartDate,
            leaseEndDate: sh.leaseEndDate,
            tradeName: sh.tradeName || null,
            categoryId: sh.categoryName
              ? categoryIdByName.get(sh.categoryName.toLowerCase()) || null
              : null,
            gstin: sh.gstin || null,
            importRunId,
          })),
          { session, ordered: true },
        );
        created.forEach((sh) => shopIdByNo.set(sh.shopNo, sh._id));
        // BusinessProfile.memberId is required - a business belongs to the
        // person who runs it, not only to the unit it trades from - so the
        // owning flat is carried forward from the shop that names it.
        created.forEach((sh) => {
          if (sh.ownerMemberId) shopOwnerMemberByNo.set(sh.shopNo, sh.ownerMemberId);
        });
        counts.shops = created.length;
      }

      if (optional.businesses.length > 0) {
        // models/BusinessProfile.js carries NO shopId and is indexed
        // { societyId, memberId } UNIQUE - it is one profile per member, not
        // per unit. So a member who owns two shops gets one business profile,
        // and a second row for them would abort this whole transaction on a
        // duplicate key. Deduped here, with the dropped row reported.
        const claimedByMember = new Set();
        const rows = optional.businesses
          .map((b) => {
            const shopId = shopIdByNo.get(b.shopNo);
            // The sheet's fk rule already refused an unknown shop at preview,
            // so this only skips a row that somehow reached here without one
            // rather than throwing away the whole import.
            if (!shopId) return null;
            // A BusinessProfile requires the member who runs it. A shop owned
            // by an outside party has no flat to name, so the business record
            // cannot be created - said out loud in the report rather than
            // dropped silently, because the admin filled that row in and will
            // otherwise assume it landed.
            const memberId = shopOwnerMemberByNo.get(b.shopNo);
            if (!memberId) {
              warnings.push(
                `Business "${b.tradeName}" was not created: shop ${b.shopNo} is not linked to a flat, and a business record has to name the member who runs it. Set "Owner's Flat No" on the Shops sheet and add it in the app.`,
              );
              return null;
            }
            const key = String(memberId);
            if (claimedByMember.has(key)) {
              warnings.push(
                `Business "${b.tradeName}" (shop ${b.shopNo}) was not created: this flat already has a business profile, and the system keeps one per member. Add the second business in the app.`,
              );
              return null;
            }
            claimedByMember.add(key);
            return {
              societyId: society._id,
              memberId,
              tradeName: b.tradeName,
              legalName: b.legalName || undefined,
              categoryId: b.categoryName
                ? categoryIdByName.get(b.categoryName.toLowerCase()) || null
                : null,
              description: b.description || undefined,
              phone: b.phone || undefined,
              whatsapp: b.whatsapp || undefined,
              email: b.email || undefined,
              gstin: b.gstin || undefined,
              licenseNumber: b.licenseNumber || undefined,
              hours: b.hours,
              importRunId,
            };
          })
          .filter(Boolean);
        if (rows.length > 0) {
          const created = await BusinessProfile.create(rows, { session, ordered: true });
          counts.businesses = created.length;
        }
      }

      if (optional.amenities.length > 0) {
        // Amenity.categoryId is required, so each distinct category name on the
        // sheet becomes a category. Creating them here rather than asking the
        // admin to pre-declare them keeps the amenities sheet usable on its own.
        const amenityCatIdByName = new Map();
        const distinct = [...new Set(optional.amenities.map((a) => a.categoryName))];
        const createdCats = await AmenityCategory.create(
          distinct.map((name, i) => ({
            societyId: society._id,
            name,
            displayOrder: (i + 1) * 10,
            createdBy: societyAdminUser?._id,
          })),
          { session, ordered: true },
        );
        createdCats.forEach((c) => amenityCatIdByName.set(c.name.toLowerCase(), c._id));

        const created = await Amenity.create(
          optional.amenities.map((a, i) => ({
            societyId: society._id,
            categoryId: amenityCatIdByName.get(a.categoryName.toLowerCase()),
            name: a.name,
            description: a.description || undefined,
            location: a.location || undefined,
            status: a.status || "OPEN",
            openingTime: a.openingTime || "06:00",
            closingTime: a.closingTime || "22:00",
            displayOrder: (i + 1) * 10,
            attendanceMode: a.attendanceMode || "NONE",
            access: a.audience ? { audience: a.audience } : undefined,
            // Blank max occupancy means unlimited, which is the model default;
            // a number switches it off.
            capacity:
              a.maxOccupancy == null
                ? undefined
                : { unlimited: false, maxOccupancy: a.maxOccupancy },
            contactPerson:
              a.contactName || a.contactPhone
                ? { name: a.contactName || undefined, phone: a.contactPhone || undefined }
                : undefined,
            importRunId,
          })),
          { session, ordered: true },
        );
        counts.amenities = created.length;
        counts.amenityCategories = createdCats.length;
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
  const now = new Date();
  const billYear = now.getFullYear();
  const billMonth = now.getMonth() + 1; // 1-indexed
  const billPeriod = `${billYear}-${String(billMonth).padStart(2, "0")}`;
  const startDate = new Date(billYear, billMonth - 1, 1);
  const financialYear =
    billMonth >= 4
      ? `${billYear}-${billYear + 1}`
      : `${billYear - 1}-${billYear}`;
  let billsGenerated = 0;
  const billErrors = [];
  if (billingHeads.length > 0 && membersCreated > 0) {
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

  // ── COMMIT: society is now safe to expose to normal queries ──────────
  await Society.updateOne({ _id: society._id }, { $set: { importStatus: "active" } });
  // Only now — a mid-transaction failure above must leave the preview
  // reusable so a retry with the same previewId skips straight back to
  // Phase 3 instead of re-uploading and re-validating from scratch.
  await BulkImportPreview.updateOne({ previewId }, { $set: { used: true } }).catch(() => {});
  if (billsGenerated > 0) {
    await cache.delPattern(`v1:bills:${society._id}:member:*`);
    await cache.delPattern(`v1:ledger:${society._id}:member:*`);
  }
  await markRun(importRunId, {
    status: "COMMITTED",
    stage: "Queueing onboarding emails",
    processedCount: billsGenerated,
    pointOfNoReturn: true, // real data now — never auto-compensate a stuck retry past here
  });

  // ── Past this point nothing may compensate/delete. Any error below is
  // real, must never crash uncaught (it would leave the run stuck at
  // COMMITTED/EMAIL_QUEUED forever with no FAILED/finishedAt, and a later
  // retry would hit the pointOfNoReturn guard above and dead-end on a run
  // that never actually finished) — so it's caught here, logged, and turned
  // into a clear "data is real, don't retry, contact support" response.
  try {
  // ── EMAIL OUTBOX — created only now, after every rollback checkpoint has
  // passed. Durable + idempotent: a retry of this same importRunId can never
  // queue a duplicate email (unique importRunId+userId+type index), and a
  // send failure here cannot undo the DB writes above.
  const outboxDocs = memberCredentials
    .filter((c) => c.isNewUser && c.email)
    .map((cred) => {
      const onboardingToken = signToken({ userId: cred.userId, purpose: "onboarding" }, { expiresIn: "7d" });
      const setCredentialsUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/onboarding/set-credentials?token=${onboardingToken}`;
      cred.setCredentialsUrl = setCredentialsUrl;
      return {
        importRunId,
        userId: cred.userId,
        type: "onboarding",
        to: cred.email,
        subject: `Set up your account — ${societyPayload.societyName}`,
        html: onboardingEmailHtml({
          memberName: cred.ownerName,
          societyName: societyPayload.societyName,
          societyAddress: societyPayload.address || "",
          unitKind: cred.accountType === "Tenant" ? "Flat (as tenant of)" : "Flat",
          unitLabel: cred.wing ? `${cred.wing}-${cred.flatNo}` : cred.flatNo,
          setCredentialsUrl,
        }),
      };
    });
  // Reused accounts (member or admin) got no new password, so they were
  // excluded above — but silence isn't right either: they still need to
  // know a new flat/society just appeared under their existing login. Same
  // outbox, a much shorter email, no setup link since they already have one.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  // Set below when a brand-new society admin account was created, so the
  // response can hand the wizard a link to show instead of a password.
  let adminSetCredentialsUrl = null;
  const notifyDocs = [];
  for (const cred of memberCredentials) {
    if (cred.isNewUser || !cred.email || !cred.userId) continue;
    notifyDocs.push({
      importRunId,
      userId: cred.userId,
      type: "profile-added",
      to: cred.email,
      subject: `${societyPayload.societyName} added to your account`,
      html: `<p>Hi ${cred.ownerName || ""},</p><p><strong>${cred.wing ? `${cred.wing}-${cred.flatNo}` : cred.flatNo}</strong> at <strong>${societyPayload.societyName}</strong> has been added to your existing account. Sign in as usual and pick it from your profile list.</p><p><a href="${appUrl}/auth/login">${appUrl}/auth/login</a></p>`,
    });
  }
  if (multiSocietyAdminUser && societyPayload.email) {
    notifyDocs.push({
      importRunId,
      userId: societyAdminUser._id,
      type: "profile-added",
      to: societyPayload.email,
      subject: `${societyPayload.societyName} added to your account`,
      html: `<p>Hi ${societyPayload.fullName || ""},</p><p>You've been made Admin of <strong>${societyPayload.societyName}</strong> using your existing login. Sign in as usual and pick it from your profile list.</p><p><a href="${appUrl}/auth/login">${appUrl}/auth/login</a></p>`,
    });
  }

  // SEC-19: a BRAND-NEW society admin previously received no email at all —
  // their password was generated here and printed in the import wizard, and
  // that display was the entire delivery mechanism. Now that the password is
  // never returned, the admin needs the same setup link every new member
  // already gets, or the import would create a society nobody can log into.
  if (!multiSocietyAdminUser && societyPayload.email && societyAdminUser?._id) {
    const adminToken = signToken(
      { userId: String(societyAdminUser._id), purpose: "onboarding" },
      { expiresIn: "7d" },
    );
    adminSetCredentialsUrl = `${appUrl}/onboarding/set-credentials?token=${adminToken}`;
    outboxDocs.push({
      importRunId,
      userId: societyAdminUser._id,
      type: "onboarding",
      to: societyPayload.email,
      subject: `Set up your admin account — ${societyPayload.societyName}`,
      html: onboardingEmailHtml({
        memberName: societyPayload.fullName || "Admin",
        societyName: societyPayload.societyName,
        societyAddress: societyPayload.address || "",
        unitKind: "",
        unitLabel: "",
        setCredentialsUrl: adminSetCredentialsUrl,
      }),
    });
  }
  outboxDocs.push(...notifyDocs);
  if (outboxDocs.length > 0) {
    try {
      await EmailOutbox.insertMany(outboxDocs, { ordered: false });
    } catch (err) {
      // Duplicate-key errors here just mean a prior crashed attempt already
      // queued these rows — safe to ignore; anything else is logged.
      if (err.code !== 11000) {
        console.error("[bulk-import] outbox insert error:", err.message);
      }
    }
  }
  await markRun(importRunId, { status: "EMAIL_QUEUED", stage: "Sending onboarding emails" });

  // ── SEND — best-effort, never re-runs a row already marked sent ──────
  const onboardingEmailErrors = [];
  const pending = await EmailOutbox.find({ importRunId, status: "pending" });
  for (const row of pending) {
    try {
      await sendEmail({ to: row.to, subject: row.subject, html: row.html });
      row.status = "sent";
      row.sentAt = new Date();
      await row.save();
    } catch (err) {
      row.attempts += 1;
      row.lastError = err.message;
      row.status = "failed";
      await row.save();
      console.error(`Onboarding email failed for ${row.to}:`, err.message);
      onboardingEmailErrors.push(row.to);
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
    // Plan 02 §17
    commercialCategoriesCreated: counts.commercialCategories,
    shopsCreated: counts.shops,
    businessesCreated: counts.businesses,
    amenitiesCreated: counts.amenities,
    amenityCategoriesCreated: counts.amenityCategories,
    billingHeadsCreated: billingHeads.length,
    billsGenerated,
    billPeriod,
    billErrors,
    warnings,
  };
  await cache.del("import:taken-emails");
  // SEC-20: COMPLETED would overwrite the NEEDS_REPAIR set above and hide the
  // one thing that stops this society being usable. An import whose RBAC setup
  // did not finish is not complete, however many members it created.
  await markRun(importRunId, {
    status: rbacRepair ? "NEEDS_REPAIR" : "COMPLETED",
    stage: rbacRepair
      ? "RBAC setup incomplete — admin cannot sign in until repaired"
      : "Done",
    processedCount: validMembers.length,
    result,
    finishedAt: new Date(),
  });
  return NextResponse.json(result);
  } catch (err) {
    console.error(`[bulk-import] post-commit error for run ${importRunId}:`, err.message, err.stack);
    await markRun(importRunId, {
      errorMessages: [err.message],
      finishedAt: new Date(),
      // status intentionally left as-is (COMMITTED/EMAIL_QUEUED) — the data
      // is real, this was not a validation/rollback failure.
    });
    return NextResponse.json(
      {
        error:
          "Society, members, and bills were created successfully, and onboarding emails may already be sent, but an internal error interrupted the final step. Nothing was rolled back. Do NOT re-upload/re-run this file — check the Society list, and contact support with this importRunId if anything looks incomplete.",
        detail: err.message,
        importRunId,
        pointOfNoReturn: true,
      },
      { status: 500 },
    );
  }
}
