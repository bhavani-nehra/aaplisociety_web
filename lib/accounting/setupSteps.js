/**
 * AapliSociety Accounting — opening the books, one visible step at a time.
 * ============================================================================
 * SERVER ONLY.
 *
 * ## What this replaces
 *
 * /api/accounting/quick-setup does six things in one call — Financial Year,
 * 57 chart-of-account heads, the fiscal account mappings, posting rules,
 * validation rules, schedules — and returns `{ ready: true }`. The admin sees
 * a two-second spinner and one green tick standing in for six subsystems. If
 * a piece half-fails there is no way to tell which, and nobody learns what any
 * of it was.
 *
 * Same work, same order, same idempotence — but each step runnable on its own
 * and each one reporting what it actually did.
 *
 * ## Why the steps are the shape they are
 *
 * `fiscalConfig` is its own step even though quick-setup buries it inside the
 * accounts block. It is the step that tells the system WHICH account is the
 * cash account — without it a recorded payment has nowhere to post, and the
 * failure surfaces much later as a bill that will not settle. A hidden step
 * that breaks something distant is exactly the kind of thing this page exists
 * to stop hiding.
 *
 * ## The contract every runner keeps
 *
 * Idempotent: running twice must be a no-op the second time, because a person
 * watching a step fail will press it again. So each returns what it created
 * AND what it skipped — "already there" is a result worth showing, not
 * silence.
 * ============================================================================
 */

import { randomUUID } from "crypto";
import ChartOfAccount from "@/models/ChartOfAccount";
import PostingRule from "@/models/PostingRule";
import ValidationRule from "@/models/ValidationRule";
import Schedule from "@/models/Schedule";
import { STANDARD_ACCOUNTS } from "@/lib/accounting/standardAccounts";
import { createAccount } from "@/lib/services/ChartOfAccountService";
import {
  createFinancialYear,
  getCurrentFinancialYear,
} from "@/lib/services/FinancialYearService";
import { updateFiscalConfig, getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { seedDefaultPostingRules } from "@/lib/services/PostingRuleService";
import { seedDefaultValidationRules } from "@/lib/services/ValidationRuleService";
import { seedDefaultSchedules, DEFAULT_SCHEDULES } from "@/lib/services/ScheduleService";
import { getFinancialYear } from "@/lib/date-utils";
import { DEFAULT_POSTING_RULES } from "@/lib/accounting/postingRules/defaultRules.js";
import { DEFAULT_VALIDATION_RULES } from "@/lib/accounting/validation/defaultValidationRules.js";
import { getOrCreateChartProfile, getTemplateDiff } from "@/lib/accounting/chartProfile";
import { backfillAllFinancialYears } from "@/lib/accounting/backfillLedger";

/**
 * The three seeded registries live at societyId: null (shared default tier)
 * plus whatever a society added of its own — so "done" for these steps means
 * "at least one active, non-deleted row this society can see exists", not
 * "this society owns a private copy". Matches the count used by
 * AccountingSetupStateService so the Hub and this wizard never disagree.
 */
async function countSeededRegistry(Model, societyId) {
  return Model.countDocuments({
    isDeleted: { $ne: true },
    isActive: { $ne: false },
    $or: [{ societyId }, { societyId: null }],
  });
}

/**
 * Ordered. `needs` is the step that must have run first — the UI uses it to
 * keep a later button disabled rather than letting someone press it and read
 * an error about an account id that could not be found.
 */
export const SETUP_STEPS = [
  {
    key: "financialYear",
    title: "Start the year",
    what: "Creates the account book for the current year, 1 April to 31 March. Everything else is recorded inside it.",
    willDo: "Create one Financial Year, if the society does not already have one covering today.",
    needs: null,
  },
  {
    key: "chartOfAccounts",
    title: "Create the account heads",
    what: "The named pockets money moves between — Cash in Hand, Cash at Bank, Dues from Members, Repairs, Property Tax and so on.",
    willDo: `Create the ${STANDARD_ACCOUNTS.length} standard heads a Maharashtra housing society's statement prints. Existing heads are left alone.`,
    needs: null,
  },
  {
    key: "fiscalConfig",
    title: "Point the system at the right heads",
    what: "Tells the system which head is the cash account, which is the bank, which one members' dues sit in. Without this a recorded payment has nowhere to go.",
    willDo: "Set seven account mappings and switch accounting on.",
    needs: "chartOfAccounts",
  },
  {
    key: "postingRules",
    title: "Turn on automatic entries",
    what: "How raising a bill or recording a payment writes itself into the books, both sides, without anyone entering them by hand.",
    willDo: "Install the standard set of posting rules.",
    needs: "fiscalConfig",
  },
  {
    key: "validationRules",
    title: "Turn on the book checks",
    what: "The checks that run before any statement prints — that both sides match, that nothing is left half-recorded.",
    willDo: "Install the standard set of checks.",
    needs: null,
  },
  {
    key: "schedules",
    title: "Set the statement layout",
    what: "Which head prints under which heading on the final Balance Sheet — Schedule A, B, C and so on.",
    willDo: "Install the standard statutory layout.",
    needs: null,
  },
];

export const SETUP_STEP_KEYS = SETUP_STEPS.map((s) => s.key);

/**
 * Run one step. Never throws for "already done" — that is a normal outcome.
 *
 * @returns {Promise<{created:string[], skipped:string[], message:string}>}
 */
export async function runSetupStep(step, { societyId, userId }) {
  switch (step) {
    case "financialYear": {
      const existing = await getCurrentFinancialYear(societyId);
      if (existing) {
        return {
          created: [],
          skipped: [existing.label],
          message: `Financial Year ${existing.label} already exists — nothing to create.`,
        };
      }
      const fy = await createFinancialYear({ societyId, createdBy: userId });
      return {
        created: [fy.label],
        skipped: [],
        message: `Created Financial Year ${fy.label}.`,
      };
    }

    case "chartOfAccounts": {
      const existing = await ChartOfAccount.find({ societyId, isDeleted: { $ne: true } }).lean();
      const byCode = new Map(existing.map((a) => [a.code, a]));
      // A code the society deliberately deleted is never recreated by a
      // re-run of this step — see lib/accounting/chartProfile.js and design
      // doc §12 Phase 3's "delete Inverter, it never comes back" acceptance.
      const { removedCodes } = await getOrCreateChartProfile(societyId);
      const removed = new Set(removedCodes);
      const created = [];
      const skipped = [];
      for (const spec of STANDARD_ACCOUNTS) {
        if (removed.has(spec.code)) continue;
        if (byCode.has(spec.code)) {
          skipped.push(spec.name);
          continue;
        }
        await createAccount({
          societyId,
          code: spec.code,
          name: spec.name,
          type: spec.type,
          subType: spec.subType,
          scheduleCode: spec.scheduleCode,
          createdBy: userId,
        });
        created.push(spec.name);
      }
      return {
        created,
        skipped,
        message: created.length
          ? `Created ${created.length} account head(s).${skipped.length ? ` ${skipped.length} already existed.` : ""}`
          : "All standard heads already exist — nothing to create.",
      };
    }

    case "fiscalConfig": {
      const accounts = await ChartOfAccount.find({ societyId, isDeleted: { $ne: true } }).lean();
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      const need = {
        cashAccountId: "1001",
        defaultBankAccountId: "1002",
        memberReceivableAccountId: "1003",
        maintenanceIncomeAccountId: "4001",
        interestIncomeAccountId: "4002",
        roundOffAccountId: "4001",
        memberAdvanceAccountId: "2001",
      };
      const missing = [...new Set(Object.values(need))].filter((code) => !byCode.has(code));
      if (missing.length) {
        // Named, not "an error occurred". The person can see which head is
        // absent and go back one step rather than guessing.
        const names = missing
          .map((code) => STANDARD_ACCOUNTS.find((a) => a.code === code)?.name || code)
          .join(", ");
        throw Object.assign(
          new Error(`These account heads have to exist first: ${names}. Run "Create the account heads" above.`),
          { code: "MISSING_ACCOUNTS" },
        );
      }
      // String(), never a raw ObjectId — accounts here come from .lean() and
      // under Next.js per-route bundling their ObjectId can originate from a
      // different bson instance than the one validating Society's schema, so
      // a raw instance can fail to cast. Every other service stores account
      // ids as strings for the same reason.
      const defaultAccountMappings = Object.fromEntries(
        Object.entries(need).map(([field, code]) => [field, String(byCode.get(code)._id)]),
      );
      await updateFiscalConfig(societyId, { enabled: true, defaultAccountMappings });

      // Accounting was OFF while this society could already be billing
      // (bill-history commit generates the first live bill before an admin
      // ever reaches this step) — postBillToLedger/postPaymentToLedger no-op
      // silently while config.enabled is false, and nothing retried them.
      // The instant it flips true is the one place that gap can never be
      // missed again: catch up every bill/payment in EVERY Financial Year
      // the society has (not just "current" — setup can happen well after
      // more than one FY's worth already exists) that has no Voucher yet.
      //
      // Deliberately un-capped and best-effort: backfillAllFinancialYears
      // isolates each bill/payment (one bad row can't stop the rest — see
      // its own file) and this call is wrapped so that even a total failure
      // here (a DB hiccup fetching Financial Years, say) can never undo or
      // block the enable that already committed above. A society with a
      // very large backlog can always finish the rest later from the
      // fy-runner repair-tool page — this is a catch-up, not the only path.
      let backfillMessage = "";
      try {
        const backfill = await backfillAllFinancialYears({ societyId, actorUserId: userId, apply: true });
        const { bills, payments } = backfill.posted;
        if (bills || payments) {
          backfillMessage = ` Caught up ${bills} bill(s) and ${payments} payment(s) that were recorded before accounting was on.`;
        }
        if (backfill.failed.length) {
          backfillMessage += ` ${backfill.failed.length} could not be posted automatically (see fy-runner → Backfill to retry and see why).`;
        }
      } catch (backfillErr) {
        console.error("fiscalConfig enable: ledger backfill sweep failed", backfillErr);
        backfillMessage = " Accounting is on, but the automatic catch-up of older bills/payments hit an error — run it manually from fy-runner → Backfill.";
      }

      return {
        created: Object.keys(need),
        skipped: [],
        message: `Accounting switched on and all seven mappings set.${backfillMessage}`,
      };
    }

    case "postingRules": {
      // Every seeder returns { seeded: n }, never a bare number — reading the
      // object straight into a template printed "[object Object] rule(s)".
      const { seeded: n } = await seedDefaultPostingRules();
      return {
        created: n ? [`${n} rule(s)`] : [],
        skipped: [],
        message: n ? `Installed ${n} posting rule(s).` : "Posting rules were already installed.",
      };
    }

    case "validationRules": {
      const { seeded: n } = await seedDefaultValidationRules();
      return {
        created: n ? [`${n} check(s)`] : [],
        skipped: [],
        message: n ? `Installed ${n} check(s).` : "Checks were already installed.",
      };
    }

    case "schedules": {
      const { seeded: n } = await seedDefaultSchedules();
      return {
        created: n ? [`${n} schedule(s)`] : [],
        skipped: [],
        message: n ? `Installed ${n} schedule(s).` : "The layout was already installed.",
      };
    }

    default:
      throw Object.assign(new Error(`Unknown setup step "${step}"`), { code: "UNKNOWN_STEP" });
  }
}

/**
 * PLAN phase of Plan → Stream → Receipt (design doc §6). Same lookups as
 * runSetupStep, zero writes — every branch here mirrors the read side of its
 * runSetupStep case so the plan can never promise something the run doesn't
 * actually do.
 *
 * @returns {Promise<{willCreate:string[], willSkip:string[], willUpdate:string[]}>}
 */
export async function planSetupStep(step, { societyId }) {
  switch (step) {
    case "financialYear": {
      const existing = await getCurrentFinancialYear(societyId);
      if (existing) return { willCreate: [], willSkip: [existing.label], willUpdate: [] };
      return { willCreate: [getFinancialYear()], willSkip: [], willUpdate: [] };
    }

    case "chartOfAccounts": {
      const { missing, existingCodes } = await getTemplateDiff(societyId);
      const willCreate = missing.map((a) => a.name);
      const willSkip = STANDARD_ACCOUNTS.filter((a) => existingCodes.has(a.code)).map((a) => a.name);
      return { willCreate, willSkip, willUpdate: [] };
    }

    case "fiscalConfig": {
      const accounts = await ChartOfAccount.find({ societyId, isDeleted: { $ne: true } }).lean();
      const byCode = new Map(accounts.map((a) => [a.code, a]));
      const need = {
        cashAccountId: "1001", defaultBankAccountId: "1002", memberReceivableAccountId: "1003",
        maintenanceIncomeAccountId: "4001", interestIncomeAccountId: "4002",
        roundOffAccountId: "4001", memberAdvanceAccountId: "2001",
      };
      const missing = [...new Set(Object.values(need))].filter((code) => !byCode.has(code));
      if (missing.length) {
        const names = missing.map((code) => STANDARD_ACCOUNTS.find((a) => a.code === code)?.name || code).join(", ");
        throw Object.assign(
          new Error(`These account heads have to exist first: ${names}. Run "Create the account heads" above.`),
          { code: "MISSING_ACCOUNTS" },
        );
      }
      const config = await getFiscalConfig(societyId).catch(() => null);
      const already = config?.enabled === true;
      const labels = Object.keys(need);
      return already
        ? { willCreate: [], willSkip: [], willUpdate: labels }
        : { willCreate: labels, willSkip: [], willUpdate: [] };
    }

    case "postingRules":
      return planSeededRegistry(DEFAULT_POSTING_RULES, PostingRule, societyId, (r) => r.systemKey.replace(/^default:/, ""));

    case "validationRules":
      return planSeededRegistry(DEFAULT_VALIDATION_RULES, ValidationRule, societyId, (r) => r.description);

    case "schedules":
      return planSeededRegistry(DEFAULT_SCHEDULES, Schedule, societyId, (r) => `${r.code} — ${r.label}`);

    default:
      throw Object.assign(new Error(`Unknown setup step "${step}"`), { code: "UNKNOWN_STEP" });
  }
}

/**
 * Shared plan logic for the three seeded-registry steps: every default row is
 * upserted by systemKey, so "willUpdate" (exists, gets refreshed) vs
 * "willCreate" (doesn't exist yet) is a straight systemKey membership check
 * against what's already in the collection — global rows (societyId: null)
 * included, matching countSeededRegistry's own visibility rule.
 */
async function planSeededRegistry(defaults, Model, societyId, labelFor) {
  const existing = await Model.find({
    isDeleted: { $ne: true },
    $or: [{ societyId }, { societyId: null }],
  }).select("systemKey").lean();
  const known = new Set(existing.map((r) => r.systemKey));
  const willCreate = [];
  const willUpdate = [];
  for (const def of defaults) {
    (known.has(def.systemKey) ? willUpdate : willCreate).push(labelFor(def));
  }
  return { willCreate, willSkip: [], willUpdate };
}

/**
 * STREAM phase of Plan → Stream → Receipt. Runs the real step (same code
 * path as runSetupStep — no parallel business logic to drift out of sync),
 * then replays its result as a paced item-by-item log. The write already
 * happened atomically inside runSetupStep by the time streaming starts; what
 * streams is the true list of what changed, paced at ~30ms/item (capped
 * ~2.5s total) purely so a human eye can register "created" as 57 discrete
 * events instead of one flash — see design doc §6 "Deliberate pacing".
 *
 * @yields {object} SetupEvent — see design doc §6 event contract.
 */
export async function* runSetupStepStream(step, { societyId, userId }) {
  const runId = randomUUID();
  let result;
  try {
    result = await runSetupStep(step, { societyId, userId });
  } catch (error) {
    yield {
      t: "error", step, code: error?.code || "STEP_FAILED",
      message: error?.message || "That step could not be completed.",
      remedy: error?.code === "MISSING_ACCOUNTS" ? "Run \"Create the account heads\" first." : "Try again, or check the server log.",
    };
    return;
  }

  const items = [
    ...result.created.map((label) => ({ label, action: "created" })),
    ...result.skipped.map((label) => ({ label, action: "skipped" })),
  ];
  yield { t: "start", step, runId, total: items.length };

  const PACE_MS = items.length > 60 ? 15 : 30; // stay under the ~2.5s cap even for the 57-head step
  let i = 0;
  for (const item of items) {
    i += 1;
    yield { t: "item", step, i, ref: String(i), label: item.label, action: item.action };
    if (PACE_MS > 0) await sleep(PACE_MS);
  }

  yield { t: "verify", step, check: "step completed", ok: true, detail: result.message };
  yield {
    t: "done", step, runId,
    created: result.created.length, skipped: result.skipped.length, updated: 0,
    ms: items.length * PACE_MS,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Current per-step state, so the page opens by saying where things stand. */
export async function getSetupStepStates(societyId) {
  const [fy, accounts, templateDiff, config, postingRuleCount, validationRuleCount, scheduleCount] = await Promise.all([
    getCurrentFinancialYear(societyId).catch(() => null),
    ChartOfAccount.find({ societyId, isDeleted: { $ne: true } }).select("code").lean(),
    // §12 Phase 3: compares against the profile, not raw STANDARD_ACCOUNTS —
    // a deliberately deleted head (e.g. "5023 Inverter") never comes back as
    // "missing" here. See lib/accounting/chartProfile.js.
    getTemplateDiff(societyId).catch(() => ({ missing: [] })),
    getFiscalConfig(societyId).catch(() => null),
    countSeededRegistry(PostingRule, societyId).catch(() => 0),
    countSeededRegistry(ValidationRule, societyId).catch(() => 0),
    countSeededRegistry(Schedule, societyId).catch(() => 0),
  ]);
  const missingAccounts = templateDiff.missing;
  const mappings = config?.defaultAccountMappings || {};

  return {
    financialYear: {
      done: !!fy,
      detail: fy ? `${fy.label} exists.` : "No Financial Year yet.",
    },
    chartOfAccounts: {
      done: accounts.length > 0 && missingAccounts.length === 0,
      detail: accounts.length
        ? missingAccounts.length
          ? `${accounts.length} head(s) exist, ${missingAccounts.length} missing.`
          : `All ${accounts.length} heads in place.`
        : "No account heads yet.",
      missing: missingAccounts.map((a) => a.name),
    },
    fiscalConfig: {
      done: config?.enabled === true && !!mappings.cashAccountId,
      detail:
        config?.enabled === true && mappings.cashAccountId
          ? "Accounting is on and the mappings are set."
          : "Not set — payments would have nowhere to post.",
    },
    // The three seeded registries are shared across societies (societyId:
    // null), so "done" here means "at least one active row this society can
    // see exists" — never null. Running again is still always safe (existing
    // rows are updated in place, not duplicated).
    postingRules: {
      done: postingRuleCount > 0,
      detail: postingRuleCount > 0
        ? `${postingRuleCount} rule(s) active. Safe to run again — existing rules are updated in place.`
        : "No rules yet.",
    },
    validationRules: {
      done: validationRuleCount > 0,
      detail: validationRuleCount > 0
        ? `${validationRuleCount} check(s) active. Safe to run again — existing checks are updated in place.`
        : "No checks yet.",
    },
    schedules: {
      done: scheduleCount > 0,
      detail: scheduleCount > 0
        ? `${scheduleCount} schedule(s) active. Safe to run again — an existing layout is updated in place.`
        : "No layout yet.",
    },
  };
}

export default SETUP_STEPS;
