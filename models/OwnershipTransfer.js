import mongoose from "mongoose";

/**
 * OwnershipTransfer — Plan 02 §4.
 *
 * One row per attempt to move a flat from one owner to another.
 *
 * ## Why this is its own collection
 *
 * `Member.transferOwnership()` has existed as a method since the model was
 * written and has **never been called** — no state machine, no approval, no
 * buyer account, no audit. In practice an admin edited `Member.ownerName` by
 * hand, which overwrote the previous owner's record, left `ownerHistory`
 * untouched, and left the previous owner's login with full resident access
 * indefinitely.
 *
 * A transfer is not an edit. It is a multi-party, multi-day process with an
 * approval gate and money attached, so it needs its own record: who started it,
 * who the buyer is, who approved it, when it took effect, and what happened to
 * a sitting tenant.
 *
 * ## States
 *
 *   DRAFT ──> INITIATED ──> BUYER_INVITED ──> BUYER_ACCEPTED
 *                                                   │
 *                                                   ▼
 *                                        PENDING_ADMIN_APPROVAL
 *                                                   │
 *                                    ┌──────────────┴──────────────┐
 *                                 APPROVED                      REJECTED
 *                                    │
 *                                    ▼
 *                                EFFECTIVE ──> OLD_OWNER_GRACE ──> CLOSED
 *
 * Terminal branches from any open state: REJECTED, CANCELLED, EXPIRED.
 *
 * **Admin approval is mandatory** (Master Prompt 2 §4) — no path reaches
 * EFFECTIVE without passing PENDING_ADMIN_APPROVAL, and only an admin may move
 * it. The buyer accepting is not approval; it is consent to be invited.
 */

const OPEN_STATUSES = [
  "DRAFT",
  "INITIATED",
  "BUYER_INVITED",
  "BUYER_ACCEPTED",
  "PENDING_ADMIN_APPROVAL",
  "APPROVED",
  "EFFECTIVE",
  "OLD_OWNER_GRACE",
];

const TERMINAL_STATUSES = ["CLOSED", "REJECTED", "CANCELLED", "EXPIRED"];

export const TRANSFER_STATUSES = [...OPEN_STATUSES, ...TERMINAL_STATUSES];
export const TRANSFER_OPEN_STATUSES = OPEN_STATUSES;

/**
 * Legal transitions. Anything not listed here is refused by the service, so a
 * new route cannot invent a shortcut past the approval gate by writing a
 * status directly.
 */
export const TRANSFER_TRANSITIONS = Object.freeze({
  DRAFT: ["INITIATED", "CANCELLED"],
  INITIATED: ["BUYER_INVITED", "CANCELLED", "EXPIRED"],
  BUYER_INVITED: ["BUYER_ACCEPTED", "CANCELLED", "EXPIRED"],
  BUYER_ACCEPTED: ["PENDING_ADMIN_APPROVAL", "CANCELLED", "EXPIRED"],
  PENDING_ADMIN_APPROVAL: ["APPROVED", "REJECTED", "CANCELLED"],
  // APPROVED → EFFECTIVE is done inside one transaction by the service; it is
  // never a separate request, so nothing can observe a flat that is approved
  // but not yet transferred.
  APPROVED: ["EFFECTIVE", "CANCELLED"],
  EFFECTIVE: ["OLD_OWNER_GRACE", "CLOSED"],
  OLD_OWNER_GRACE: ["CLOSED"],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
});

/** A snapshot of one party, taken at the time it was recorded. */
const PartySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    contactNumber: { type: String, trim: true, default: "" },
    emailPrimary: { type: String, trim: true, lowercase: true, default: "" },
    panCard: { type: String, trim: true, uppercase: true, default: "" },
    aadhaar: { type: String, trim: true, default: "" },
    // The login this party uses, once one exists. Null for a seller who never
    // had an account, or a buyer who has not been invited yet.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false },
);

const OwnershipTransferSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    // The flat. `Member` IS the flat in this schema — there is no separate Flat
    // model (see Plan 02 §1).
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: TRANSFER_STATUSES,
      default: "DRAFT",
      index: true,
    },

    // Snapshot of the seller as they were when the transfer started. Snapshot,
    // not a reference: the Member document is about to be overwritten with the
    // buyer's details, so a live lookup would return the wrong person.
    seller: { type: PartySchema, required: true },
    buyer: { type: PartySchema, required: true },

    // Commercial detail — Master Prompt 2 §3.
    transferType: {
      type: String,
      enum: ["Purchase", "Inheritance", "Gift", "Court Order", "Other"],
      default: "Purchase",
    },
    saleAmount: { type: Number, default: null },
    registrationNumber: { type: String, trim: true, default: "" },
    // When ownership actually changes hands. Defaults to the approval moment.
    transferDate: { type: Date, default: null },
    reason: { type: String, trim: true, default: "" },

    // ── Sitting tenant ──────────────────────────────────────────────────────
    //
    // Master Prompt 2 §11: when the flat has an active tenant the workflow must
    // explicitly offer RETAIN or TERMINATE. There is deliberately no default —
    // silently choosing either one is a decision about somebody's home, and the
    // service refuses to approve without it.
    tenantDisposition: {
      type: String,
      enum: ["RETAIN", "TERMINATE", null],
      default: null,
    },
    // Snapshot of whether a tenant was present when the transfer was raised, so
    // the requirement above can still be evaluated if the tenant record changes
    // underneath.
    hadTenantAtInitiation: { type: Boolean, default: false },

    // ── Old-owner grace (Master Prompt 2 §7) ────────────────────────────────
    //
    // After the transfer takes effect the previous owner keeps READ-ONLY access
    // for a short window so they can collect their own records, then loses the
    // flat entirely. One hour by default; stored per-transfer so it can be
    // extended for a specific case without changing the default for everyone.
    graceMinutes: { type: Number, default: 60 },
    graceEndsAt: { type: Date, default: null, index: true },

    // ── Actors and timestamps ───────────────────────────────────────────────
    initiatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    initiatedAt: { type: Date, default: null },
    buyerInvitedAt: { type: Date, default: null },
    buyerAcceptedAt: { type: Date, default: null },
    // Admin approval is the mandatory gate — recorded separately from the
    // initiator, because the two must be able to differ for the audit to mean
    // anything.
    approvedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    rejectedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: "" },
    cancelledByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    effectiveAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    // Invitations expire; an abandoned transfer must not sit open forever
    // holding the flat's only open-transfer slot.
    expiresAt: { type: Date, default: null, index: true },

    // ── Idempotency ─────────────────────────────────────────────────────────
    //
    // Approval is the irreversible step: it rewrites the Member, invalidates
    // the seller's session and posts a ledger entry. A double-submitted approve
    // must not do that twice. Same mechanism BulkImportRun uses.
    approvalIdempotencyKey: { type: String, default: null },

    // What the approval actually did, captured for the audit trail and for
    // showing the admin a result they can check.
    effect: {
      previousOwnerName: { type: String, default: null },
      newOwnerName: { type: String, default: null },
      ownerHistoryEntryId: { type: mongoose.Schema.Types.ObjectId, default: null },
      buyerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      sellerSessionInvalidated: { type: Boolean, default: false },
      tenantAction: { type: String, default: null },
      carryForwardAmount: { type: Number, default: null },
    },

    // Append-only trail of every state change, so "how did it get here" is
    // answerable from the document itself.
    history: [
      new mongoose.Schema(
        {
          from: String,
          to: String,
          byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          at: { type: Date, default: Date.now },
          note: String,
        },
        { _id: false },
      ),
    ],
  },
  { timestamps: true },
);

// A flat may have at most ONE transfer in flight. Partial index so closed and
// rejected attempts do not block a later, legitimate one — Master Prompt 2 §4's
// "duplicate prevention".
OwnershipTransferSchema.index(
  { societyId: 1, memberId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: OPEN_STATUSES } },
    name: "one_open_transfer_per_flat",
  },
);
OwnershipTransferSchema.index({ societyId: 1, status: 1, createdAt: -1 });
// The grace-window sweeper looks for transfers whose window has closed.
OwnershipTransferSchema.index({ status: 1, graceEndsAt: 1 });

/** True while this transfer still occupies the flat's open-transfer slot. */
OwnershipTransferSchema.methods.isOpen = function () {
  return OPEN_STATUSES.includes(this.status);
};

/** Is `next` a legal move from the current status? */
OwnershipTransferSchema.methods.canTransitionTo = function (next) {
  return (TRANSFER_TRANSITIONS[this.status] || []).includes(next);
};

export default mongoose.models.OwnershipTransfer ||
  mongoose.model("OwnershipTransfer", OwnershipTransferSchema);
