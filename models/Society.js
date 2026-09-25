import mongoose from "mongoose";
const SocietySchema = new mongoose.Schema(
  {
    // Basic Information
    name: { type: String, required: true, trim: true },
    registrationNo: { type: String, unique: true, sparse: true, trim: true, minlength: 4 },
    dateOfRegistration: { type: Date },
    address: { type: String, trim: true },
    panNo: { type: String, trim: true },
    tanNo: { type: String, trim: true },
    // Contact Details
    personOfContact: { type: String, trim: true },
    contactEmail: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    // Essential-contacts directory the admin manages and the resident app
    // shows on the "Essential contacts" screen (see
    // app/api/v1/society/contacts/route.js). Up to 3 numbers per contact —
    // e.g. a plumber's own phone plus a WhatsApp/alternate number.
    contacts: [
      {
        _id: false,
        category: {
          type: String,
          enum: [
            "Society Office",
            "Watchman/Security",
            "Plumber",
            "Electrician",
            "Gas Agency",
            "Housekeeping",
            "Pest Control",
            "Lift AMC",
            "Other",
          ],
          required: true,
        },
        // Free-form label when category is "Other" (or just a nicer name,
        // e.g. "Ramesh — Plumber"). Falls back to the category itself in the
        // v1 route when blank.
        name: { type: String, trim: true },
        numbers: {
          type: [{ type: String, trim: true }],
          validate: {
            validator: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 3,
            message: "A contact needs between 1 and 3 numbers.",
          },
        },
        // True for a category the "Seed defaults" button added with no
        // number filled in yet — lets the admin UI show it distinctly from
        // a fully admin-authored row. Never read by the mobile route.
        isDefault: { type: Boolean, default: false },
      },
    ],
    // Carpet Area
    carpetAreaSqft: { type: Number, default: 0 },
    // Bill Template - UPDATED STRUCTURE
    // Separate designer template for payment / advance receipts. Mirrors the
    // bill template design shape so the same designer UI can edit both.
    receiptTemplate: {
      type: {
        type: String,
        enum: ["default", "custom", "uploaded-pdf", "uploaded-image"],
        default: "default",
      },
      // For uploaded PDF (mirrors billTemplate below — receipts use their
      // own field vocabulary, see lib/receipt-pdf-fields.js, but the same
      // { id, name, x, y, width, height, fontSize, fontColor } shape).
      pdfUrl: { type: String },
      hasFormFields: { type: Boolean, default: false },
      detectedFields: [{ type: String }],
      pdfFields: [{ type: mongoose.Schema.Types.Mixed }],
      // For uploaded image
      imageUrl: { type: String },
      imageFields: [{ type: mongoose.Schema.Types.Mixed }],
      design: { type: mongoose.Schema.Types.Mixed, default: null },
      logoUrl: { type: String },
      signatureUrl: { type: String },
      updatedAt: { type: Date },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    billTemplate: {
      type: {
        type: String,
        enum: ["default", "custom", "uploaded-pdf", "uploaded-image"],
        default: "default",
      },
      // For uploaded PDF
      pdfUrl: { type: String },
      hasFormFields: { type: Boolean, default: false },
      detectedFields: [{ type: String }],
      // Custom overlay field positions the admin set in the PDF field editor
      // (only used for PDFs with no fillable form fields). Each entry:
      // { id, name, x, y, width, height, fontSize, fontColor }
      pdfFields: [{ type: mongoose.Schema.Types.Mixed }],
      // For uploaded image
      imageUrl: { type: String },
      // Overlay field positions for the uploaded-image flow — same shape as
      // pdfFields, drawn on top of the image via generateImageOverlay().
      imageFields: [{ type: mongoose.Schema.Types.Mixed }],
      // For custom design
      design: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
        headerBg: String,
        headerColor: String,
        societyNameSize: Number,
        addressSize: Number,
        billTitleSize: Number,
        billTitleAlign: String,
        tableHeaderBg: String,
        tableHeaderColor: String,
        tableRowBg1: String,
        tableRowBg2: String,
        tableBorderColor: String,
        totalBg: String,
        totalColor: String,
        totalSize: Number,
        footerSize: Number,
        footerText: [String],
        showSignature: Boolean,
        signatureLabel: String,
      },
      // Common assets
      logoUrl: { type: String },
      signatureUrl: { type: String },
      uploadedAt: { type: Date },
      uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      // OLD FInode ".\scripts\rbac\_tmp-wipe.js"ELDS - keep for backward compatibility
      fileName: { type: String },
      filePath: { type: String },
    },
    // Configuration
    config: {
      // billing settings (non-charge)
      interestRate: { type: Number, default: 0 },
      // Q3 — which area RESIDENTIAL bills are calculated on, society-wide.
      // Changing it re-prices every future residential bill immediately; bills
      // already generated keep the area frozen on them (Q12).
      // Shops are NOT affected: a shop carries its own area (models/Shop.js).
      areaBasis: {
        type: String,
        enum: ["carpet", "builtup"],
        default: "carpet",
      },
      serviceTaxRate: { type: Number, default: 0 },
      gracePeriodDays: { type: Number, default: 10 },
      billDueDay: { type: Number, min: 1, max: 31, default: 10 },
      billPayFinalDay: { type: Number, min: 1, max: 31, default: 25 }, // ← NEW: last day to accept payment/interest for the month
      // NEW CONFIG FLAGS
      interestRounding: {
        type: String,
        enum: ["TWO_DECIMAL", "ROUND_UP"],
        default: "TWO_DECIMAL",
      },
      interestUseMode: {
        // OLDEST_FIRST: clear oldest bill's interest first
        // TOTAL: treat all interest as one bucket (still oldest-first physically)
        type: String,
        enum: ["OLDEST_FIRST", "TOTAL"],
        default: "OLDEST_FIRST",
      },
      advanceAutoApply: {
        type: Boolean,
        default: false, // admin decided: NO automation per your answer
      },
      adjustmentApplicationMode: {
        type: String,
        enum: ["INTEREST_FIRST", "PRINCIPAL_FIRST"],
        default: "INTEREST_FIRST",
      },
      interestTriggerTiming: {
        type: String,
        enum: ["SAME_DAY", "NEXT_DAY"],
        default: "NEXT_DAY",
      },
      memberPaymentBreakdownVisible: {
        type: Boolean,
        default: true, // transparent by default
      },
      interestBasis: {
        type: String,
        enum: ["MONTHLY"],
        default: "MONTHLY",
      },
      // Scheduled bill generation/push
      // billGenerationDay: day of month admin generates bills (e.g., 1 = 1st of month)
      // billPushDay: day of month bills become visible to members / go Unpaid (e.g., 5 = 5th)
      // If billPushDay > today at generation time → bills stored as 'Scheduled', auto-pushed by cron
      billGenerationDay: { type: Number, min: 1, max: 31, default: 1 },
      paymentUploadDay: { type: Number, min: 1, max: 31, default: 30 },
      billPushDay: { type: Number, min: 1, max: 28, default: 1 },
      // Interest Activation Settings (replaces gracePeriodDays / billDueDay / billPayFinalDay)
      interestAfterDays: { type: Number, min: 0, max: 365, default: 15 },
      interestActivationMode: {
        type: String,
        enum: ["VIEW", "APPLICABLE"],
        default: "VIEW",
      },
      // Bill Generation Mode (replaces billGenerationDay)
      billGenerationMode: {
        type: String,
        enum: ["MANUAL", "AUTOMATIC"],
        default: "MANUAL",
      },
      billAutoGenerateDay: { type: Number, min: 1, max: 5, default: 1 },
      // dynamic charges — single source of truth
      charges: [
        {
          label: { type: String },
          type: {
            type: String,
            enum: ["Fixed", "Per Sq Ft", "Per Vehicle"],
            default: "Fixed",
          },
          value: { type: Number, default: 0 },
          isActive: { type: Boolean, default: true },
          vehicleType: {
            type: String,
            enum: ["Two-Wheeler", "Four-Wheeler", null],
            default: null,
          },
        },
      ],
    },
    // Inside society.config schema:
    parkingRates: {
      Open: {
        "Two-Wheeler": { type: Number, default: 0 },
        "Four-Wheeler": { type: Number, default: 0 },
      },
      Covered: {
        "Two-Wheeler": { type: Number, default: 0 },
        "Four-Wheeler": { type: Number, default: 0 },
      },
      // Stilt has no entry — never billed
    },
    // Subscription
    subscription: {
      planType: {
        type: String,
        enum: ["Free", "Basic", "Premium", "Enterprise"],
        default: "Free",
      },
      startDate: { type: Date, default: Date.now },
      // Chosen once at signup from a fixed set (7/14/21/30) and not adjustable
      // afterwards. The number is data so the options can change without a
      // deploy; trialEndsAt is stamped from it and is what enforcement reads.
      trialDays: { type: Number },
      trialEndsAt: { type: Date },
      lastPaymentDate: { type: Date },
      nextPaymentDate: { type: Date },
      amountPaid: { type: Number, default: 0 },
      status: {
        type: String,
        enum: ["Active", "Suspended", "Trial", "Expired"],
        default: "Trial",
      },
      paymentHistory: [
        {
          date: { type: Date, required: true },
          amount: { type: Number, required: true },
          transactionId: { type: String },
          method: { type: String },
        },
      ],
    },
    societyId: { type: String, unique: true, sparse: true }, // e.g. green_valley_andheri_2018_47
    // 3-digit code assigned at creation (e.g. "482") - combined with a
    // member's flat number, this is all that's needed to build a short,
    // collision-free auto-generated username (see lib/username-generator.js).
    // Members replace this during onboarding, so it only needs to work once.
    societyCode: { type: String, unique: true, sparse: true, trim: true },
    area: { type: String },
    buildDate: { type: Date },
    credentials: {
      adminEmail: { type: String },
      // SEC-19: DEPRECATED — plaintext admin password. Scheduled for removal by
      // scripts/security/purge-plain-passwords.js, which rotates each account
      // onto a setup link before unsetting the field.
      //
      // It was `select: true`, so every `.select("-__v")` query — including
      // GET /api/admin/societies and GET /api/superadmin/society-detail —
      // shipped it to the browser, where the superadmin table rendered it
      // behind a Reveal/Copy pair. Flipping it to `select: false` closes every
      // one of those routes at once rather than patching each `.select()`
      // individually and missing one; `.lean()` honours it too.
      //
      // Nothing reads this field any more. `reset-admin-password` no longer
      // writes it, and the superadmin UI no longer displays it. Do not add a
      // `+credentials.plainPassword` anywhere — the replacement capability is
      // the setup-link reset, not reading a password back out.
      plainPassword: { type: String, select: false },
    },
    // LOOP-05: lifecycle state. Pause blocks login/access without touching
    // data; the delete flow is soft-first (isDeleted + a purge date the admin
    // chose) so a society can be restored right up until the purge actually
    // runs, and only "Delete permanently" bypasses that window.
    lifecycleStatus: { type: String, enum: ["Active", "Paused"], default: "Active", index: true },
    pausedAt: Date,
    pausedUntil: Date, // null = paused indefinitely, until manually resumed
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Set when the admin picks "Delete until <date>": the society is soft
    // deleted immediately, and a purge is due on this date unless restored
    // first. Left null for an immediate/manual purge with no schedule.
    purgeScheduledFor: Date,
    // Provenance for the scheduled purge. The cron will not delete a society
    // on `purgeScheduledFor` alone — it also requires proof that a human
    // took an export and verified it against live state. Without this the
    // date is just a timer, and a mis-set date silently destroys a society.
    offboarding: {
      exportVerifiedAt: Date,
      exportVerifiedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      // Format version of the bundle that was verified — a purge should not
      // be authorised by a check run against a format we no longer emit.
      exportFormatVersion: Number,
      // Counts as at verification, carried into the purge audit record so the
      // trail says how much was destroyed even though the data is gone.
      verifiedCounts: {
        collections: Number,
        documents: Number,
        fields: Number,
      },
      // Phase 3/5. The handover is the society's own copy of its records; the
      // purge will not run until it has actually been collected (see
      // /v1/cron/society-purge gate 6).
      handoverId: { type: mongoose.Schema.Types.ObjectId, ref: "SocietyHandover" },
      // Escape hatch for the case the gate cannot otherwise clear: an
      // abandoned society whose committee has dissolved and whose registered
      // address bounces. Purging then is a judgement call, so it is recorded
      // as one — who made it and on what grounds — rather than made by a flag.
      handoverWaivedAt: Date,
      handoverWaivedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      handoverWaivedReason: String,
      // D5 — a per-society extension to the grace window. Widens the ceiling
      // only; the floor protects the society and nobody can shorten it. Set by
      // a break-glass administrator, with a reason, and capped again at
      // SOCIETY_GRACE_ABSOLUTE_MAX_DAYS.
      graceDaysOverride: Number,
      graceOverrideReason: String,
      graceOverrideByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      graceOverrideAt: Date,
      // Members told once, at soft-delete, that their data is being erased.
      membersNotifiedAt: Date,
      membersNotified: {
        attempted: Number,
        sent: Number,
        failed: Number,
        skipped: Number,
      },
    },
    // Superadmin-set marker for throwaway test societies — enables the quick
    // delete button in the superadmin UI, which skips the export/verify
    // wizard. Never settable to true implicitly; the quick-delete route
    // refuses to run on any society where this is false.
    isTestSociety: { type: Boolean, default: false, index: true },
    // Feature flags. Grouped per module instead of loose booleans. Commercial
    // ships OFF for every existing society, and `enabled: false` overrides
    // every child flag, so one switch disables the whole module instantly.
    features: {
      commercial: {
        enabled: { type: Boolean, default: false },
        directoryEnabled: { type: Boolean, default: false },
        ownerEditingEnabled: { type: Boolean, default: false },
        commercialBillingEnabled: { type: Boolean, default: false },
      },
      // Add-on modules. Same shape as commercial above, which is why that one
      // needed no change — see lib/entitlements/modules.js for what each owns.
      //
      // Default false everywhere: a new society gets base, and a trial grants
      // everything through the resolver rather than by writing flags, so a
      // trial ending needs no cleanup pass.
      //
      // `rbac` sat here until 2026-08-27. Advanced Access Control is base now
      // (docs/subscriptions-module-docs/00-plan.md M13) and gone from
      // lib/entitlements/modules.js, so the flag is dead: normalizeFeatures()
      // iterates MODULES and never looks for it. Existing societies keep a
      // stale features.rbac sub-document, which is harmless and left alone —
      // dropping the path from the schema stops new writes without needing a
      // migration over documents nothing reads.
      security: { enabled: { type: Boolean, default: false } },
      amenities: { enabled: { type: Boolean, default: false } },
      tenancy: { enabled: { type: Boolean, default: false } },
      retention: { enabled: { type: Boolean, default: false } },
    },
    // Bumped on any entitlement change. Forms part of the Redis cache key, so
    // an increment is an instant, cluster-wide invalidation with nothing to
    // delete — the same mechanism as rbacVersion above.
    entitlementVersion: { type: Number, default: 0 },
    // Soft delete support
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    deletionReason: { type: String },
    // Config versioning
    configVersion: { type: Number, default: 1 },
    // RBAC cache-invalidation version (Rev 2). Bumped on any role/assignment/
    // permission change so perms:{user}:{society}:{hat}:{rbacVersion} rotates.
    rbacVersion: { type: Number, default: 0 },
    // Onboarding tracking
    onboarding: {
      billHistoryImported: { type: Boolean, default: false },
      billHistoryImportedAt: { type: Date, default: null },
      billHistoryPeriods: [{ type: String }], // e.g. ["2025-04", "2025-05", ...]
      joinPeriodId: { type: String, default: null }, // YYYY-MM when society joined platform
    },
    // Accounting control center (Phase 2.3 of the accounting-system revamp —
    // see docs/accounting-system-ARD.md §6.11). Additive, optional sub-document.
    // Deliberately does NOT duplicate config.interestRate / config.charges —
    // this only holds HOW billing outcomes post to accounts, never HOW
    // billing is calculated. Reads should go through
    // lib/services/FiscalConfigService.js, which fills in defaults for
    // societies that haven't configured this yet (no backfill needed).
    accountingConfig: {
      enabled: { type: Boolean, default: false },
      financialYearDefaults: {
        startMonth: { type: Number, default: 3, min: 0, max: 11 }, // April = 3 (0-indexed), matches FINANCIAL_YEAR_START_MONTH
        lockAfterDays: { type: Number, default: 0 },
      },
      voucherPrefixes: {
        Receipt: { type: String, default: "RV", uppercase: true, trim: true },
        Payment: { type: String, default: "PV", uppercase: true, trim: true },
        Journal: { type: String, default: "JV", uppercase: true, trim: true },
        Contra: { type: String, default: "CV", uppercase: true, trim: true },
        DebitNote: { type: String, default: "DN", uppercase: true, trim: true },
        CreditNote: { type: String, default: "CN", uppercase: true, trim: true },
      },
      voucherNumberPadding: { type: Number, default: 5, min: 1, max: 10 },
      defaultAccountMappings: {
        maintenanceIncomeAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
        interestIncomeAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
        cashAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
        defaultBankAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
        memberReceivableAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
        roundOffAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
        // Liability credited when a member pays MORE than their outstanding
        // dues. Without this, over-collection was credited to Member
        // Receivable and drove that asset negative on the Balance Sheet.
        memberAdvanceAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
      },
      depreciationPolicy: {
        method: { type: String, enum: ["StraightLine", "WDV"], default: "StraightLine" },
        roundingRule: { type: String, enum: ["nearest", "up", "down"], default: "nearest" },
      },
      interestPolicy: {
        // HOW interest posts, not how it's calculated. Calculation stays
        // owned by utils/interestUtils.js — never duplicate the rate/formula here.
        postingAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "ChartOfAccount" },
      },
      taxConfig: {
        gstEnabled: { type: Boolean, default: false },
        tdsEnabled: { type: Boolean, default: false },
      },
      roundingPolicy: {
        method: { type: String, enum: ["nearest", "up", "down"], default: "nearest" },
        precision: { type: Number, default: 2 },
      },
      currency: {
        code: { type: String, default: "INR" },
        symbol: { type: String, default: "₹" },
      },
      scheduleConfig: {
        format: { type: String, enum: ["default", "custom"], default: "default" },
        customScheduleMap: { type: mongoose.Schema.Types.Mixed, default: null },
      },
      auditorPreferences: {
        defaultReadOnly: { type: Boolean, default: true },
        requireRemarksOnAdjustment: { type: Boolean, default: true },
      },
      financialClosingRules: {
        requireTrialBalanceMatch: { type: Boolean, default: true },
        requireAllDepreciationPosted: { type: Boolean, default: true },
        requireReconciliationComplete: { type: Boolean, default: false },
      },
      documentLockingRules: {
        lockVouchersAfterApproval: { type: Boolean, default: true },
        allowBackdatedEntriesInDraftFY: { type: Boolean, default: true },
      },
      // Phase 2.20 (§6.14) — weights for the Accounting Health Dashboard's
      // single 0-100 composite score. Must sum to 100; AccountingHealthService
      // validates this at read time rather than enforcing it here, so a
      // partially-edited config never hard-fails a save.
      healthScoreWeights: {
        trialBalance: { type: Number, default: 30 },
        openingBalance: { type: Number, default: 15 },
        draftVouchers: { type: Number, default: 10 },
        depreciation: { type: Number, default: 15 },
        bankReconciliation: { type: Number, default: 15 },
        scheduleCoverage: { type: Number, default: 10 },
        otherValidations: { type: Number, default: 5 },
      },
    },
    // Matrix Config
    matrixConfig: {
      L: { type: Number, default: 0 },
      R: { type: Number, default: 0 },
    },
    // Bulk-import provenance — lets a failed/partial import be compensated by
    // deleting every document tagged with the same run, and lets normal
    // queries exclude a society still mid-import if ever needed.
    importRunId: { type: String, default: null, index: true },
    importStatus: {
      type: String,
      enum: ["importing", "active"],
      default: "active",
    },
    // ❌ FIX #2: REMOVED billingHeads[] array
    // Use BillingHead model as SINGLE SOURCE OF TRUTH:
    // Query: BillingHead.find({ societyId })
  },
  {
    timestamps: true,
  },
);
// Pre-save hook
// Clamp a day value to the last valid day of a given month/year
function clampDay(day, month, year) {
  if (!day) return day;
  // Last day of that month: new Date(year, month, 0) = last day of month-1
  const lastDay = new Date(year, month, 0).getDate();
  return Math.min(day, lastDay);
}
SocietySchema.pre("save", function (next) {
  if (
    this.isModified("config") ||
    this.isModified("matrixConfig") ||
    this.isModified("accountingConfig")
  ) {
    this.configVersion += 1;
  }
  // Keep the configured recurring day (e.g. 30) unchanged. At runtime,
  // safeConfigDate clamps it only for short months (30 -> Feb 28/29).
  if (this.config) {
    if (this.config.billPayFinalDay > 31) this.config.billPayFinalDay = 31;
    if (this.config.billPushDay > 28) this.config.billPushDay = 28;
    // Ensure new enum fields have valid defaults if missing
    if (!this.config.interestRounding)
      this.config.interestRounding = "TWO_DECIMAL";
    if (!this.config.interestUseMode)
      this.config.interestUseMode = "OLDEST_FIRST";
  }
  next();
});
// Indexes
SocietySchema.index({ isDeleted: 1 });
SocietySchema.index({ "subscription.status": 1 });
SocietySchema.index({ importStatus: 1 });
export default mongoose.models.Society ||
  mongoose.model("Society", SocietySchema);
