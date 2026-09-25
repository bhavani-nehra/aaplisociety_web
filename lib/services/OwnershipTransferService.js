/**
 * OwnershipTransferService — Plan 02 §4.
 *
 * Every state change for an ownership transfer goes through here. Routes
 * validate their input and check permissions; they do not write status fields
 * directly. That is deliberate: the approval gate is the whole point of the
 * feature, and a gate that each route re-implements is a gate that one route
 * eventually skips.
 *
 * ## The two rules that shape this file
 *
 * **1. Admin approval is mandatory** (Master Prompt 2 §4). Nothing reaches
 * EFFECTIVE except through `approve()`, and `approve()` is the only function
 * that touches the Member document.
 *
 * **2. Nothing financial is ever reassigned** (Master Prompt 2 §9). No Bill,
 * Receipt, Transaction or JournalLine changes its owning person. Property
 * history stays attached to the flat; person history stays attached to the
 * person. The buyer inherits the flat's *current position* as one explicit
 * carry-forward figure, computed and recorded — not by rewriting old rows.
 */

import mongoose from "mongoose";
import Member from "@/models/Member";
import User from "@/models/User";
import OwnershipTransfer, {
  TRANSFER_TRANSITIONS,
  TRANSFER_OPEN_STATUSES,
} from "@/models/OwnershipTransfer";
import { logAudit } from "@/lib/audit-logger";
import { bumpSessionEpoch } from "@/lib/rbac/session";
import { setOwnerGrace, clearOwnerGrace } from "@/lib/ownership-grace";

/** Thrown for every refusal the caller is expected to surface as a 4xx. */
export class TransferError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || "TRANSFER_ERROR";
  }
}

/** Default lifetime of an unanswered buyer invitation. */
const INVITE_TTL_DAYS = 14;

/**
 * Move a transfer to `next`, refusing anything the state machine does not
 * allow. Every transition is appended to `history` so the document explains
 * its own path.
 */
function transition(transfer, next, { byUserId, note } = {}) {
  if (!transfer.canTransitionTo(next)) {
    throw new TransferError(
      409,
      `Cannot move an ownership transfer from ${transfer.status} to ${next}.`,
      "ILLEGAL_TRANSITION",
    );
  }
  transfer.history.push({
    from: transfer.status,
    to: next,
    byUserId: byUserId || null,
    at: new Date(),
    note: note || undefined,
  });
  transfer.status = next;
}

/** The flat, scoped to the society. Never trusts a bare id. */
async function loadMember(societyId, memberId, session) {
  const member = await Member.findOne({
    _id: memberId,
    societyId,
    isDeleted: { $ne: true },
  }).session(session || null);
  if (!member) throw new TransferError(404, "Flat not found.", "MEMBER_NOT_FOUND");
  return member;
}

/**
 * Start a transfer.
 *
 * The seller snapshot is taken from the Member as it stands right now, because
 * `approve()` is about to overwrite those fields with the buyer's details — a
 * live lookup afterwards would return the wrong person.
 */
export async function initiateTransfer({
  societyId,
  memberId,
  buyer,
  transferType,
  saleAmount,
  registrationNumber,
  transferDate,
  reason,
  actorUserId,
}) {
  if (!buyer?.name?.trim()) {
    throw new TransferError(400, "The buyer's name is required.", "BUYER_REQUIRED");
  }
  const member = await loadMember(societyId, memberId);

  // One open transfer per flat. The partial unique index enforces this too;
  // checking here turns a duplicate-key 500 into a readable 409.
  const existing = await OwnershipTransfer.findOne({
    societyId,
    memberId,
    status: { $in: TRANSFER_OPEN_STATUSES },
  }).lean();
  if (existing) {
    throw new TransferError(
      409,
      "This flat already has a transfer in progress. Cancel it before starting another.",
      "TRANSFER_ALREADY_OPEN",
    );
  }

  const transfer = new OwnershipTransfer({
    societyId,
    memberId,
    status: "DRAFT",
    seller: {
      name: member.ownerName,
      contactNumber: member.contactNumber || "",
      emailPrimary: member.emailPrimary || "",
      panCard: member.panCard || "",
      aadhaar: member.aadhaar || "",
      userId: member.userId || null,
    },
    buyer: {
      name: buyer.name.trim(),
      contactNumber: buyer.contactNumber || "",
      emailPrimary: (buyer.emailPrimary || "").trim().toLowerCase(),
      panCard: buyer.panCard || "",
      aadhaar: buyer.aadhaar || "",
      userId: null,
    },
    transferType: transferType || "Purchase",
    saleAmount: Number.isFinite(saleAmount) ? saleAmount : null,
    registrationNumber: registrationNumber || "",
    transferDate: transferDate ? new Date(transferDate) : null,
    reason: reason || "",
    // Snapshot: §11's RETAIN/TERMINATE requirement is evaluated against the
    // state at initiation, so a tenant record changing underneath cannot make
    // the question disappear.
    hadTenantAtInitiation: Boolean(member.currentTenant),
    initiatedByUserId: actorUserId,
    initiatedAt: new Date(),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  });
  transition(transfer, "INITIATED", { byUserId: actorUserId, note: "Transfer raised" });
  await transfer.save();

  await logAudit(actorUserId, societyId, "OWNERSHIP_TRANSFER_INITIATED", null, {
    transferId: String(transfer._id),
    memberId: String(memberId),
    flat: member.wing ? `${member.wing}-${member.flatNo}` : member.flatNo,
    seller: transfer.seller.name,
    buyer: transfer.buyer.name,
  });
  return transfer;
}

/** Record that the buyer has been invited to create/claim their account. */
export async function markBuyerInvited({ transfer, actorUserId, buyerUserId }) {
  transition(transfer, "BUYER_INVITED", {
    byUserId: actorUserId,
    note: "Setup link sent to the buyer",
  });
  transfer.buyerInvitedAt = new Date();
  if (buyerUserId) transfer.buyer.userId = buyerUserId;
  await transfer.save();
  await logAudit(actorUserId, transfer.societyId, "OWNERSHIP_TRANSFER_BUYER_INVITED", null, {
    transferId: String(transfer._id),
    buyer: transfer.buyer.name,
    buyerUserId: buyerUserId ? String(buyerUserId) : null,
  });
  return transfer;
}

/**
 * The buyer accepts. This is consent, not approval — it moves the transfer to
 * PENDING_ADMIN_APPROVAL and no further.
 */
export async function acceptAsBuyer({ transfer, buyerUserId }) {
  if (!transfer.buyer.userId || String(transfer.buyer.userId) !== String(buyerUserId)) {
    throw new TransferError(
      403,
      "Only the invited buyer can accept this transfer.",
      "NOT_THE_BUYER",
    );
  }
  transition(transfer, "BUYER_ACCEPTED", { byUserId: buyerUserId, note: "Buyer accepted" });
  transfer.buyerAcceptedAt = new Date();
  transition(transfer, "PENDING_ADMIN_APPROVAL", {
    byUserId: buyerUserId,
    note: "Awaiting admin approval",
  });
  await transfer.save();
  await logAudit(buyerUserId, transfer.societyId, "OWNERSHIP_TRANSFER_BUYER_ACCEPTED", null, {
    transferId: String(transfer._id),
  });
  return transfer;
}

/**
 * The flat's current financial position, as one number.
 *
 * Master Prompt 2 §9 forbids moving historical transactions to the new owner.
 * So the buyer does not inherit the seller's rows — they inherit the flat's
 * outstanding position at the transfer date, recorded here as a single figure
 * attributable to the transfer itself. Historical activity stays exactly where
 * it is, attributable to the person who incurred it.
 *
 * Read-only: this computes and reports, it does not post anything.
 */
export async function computeCarryForward(member) {
  const opening = Number(member.openingBalance || 0);
  const principal = Number(member.openingPrincipal || 0);
  const interest = Number(member.openingInterest || 0);
  const advance = Number(member.advanceCredit || 0);
  // openingBalance is the legacy combined figure; the split fields supersede it
  // where present (see models/Member.js).
  const outstanding = principal || interest ? principal + interest : opening;
  return Number((outstanding - advance).toFixed(2));
}

/**
 * Approve and apply, in one transaction.
 *
 * This is the only function that writes the Member document, and the only path
 * to EFFECTIVE. Everything that must be true of a completed transfer happens
 * here or not at all.
 */
export async function approveTransfer({
  transfer,
  actorUserId,
  tenantDisposition,
  idempotencyKey,
  effectiveDate,
}) {
  // Replay protection. Approval rewrites the flat, kills a session and records
  // a ledger figure; a double-submitted button must not do that twice.
  if (
    idempotencyKey &&
    transfer.approvalIdempotencyKey &&
    transfer.approvalIdempotencyKey === idempotencyKey &&
    ["EFFECTIVE", "OLD_OWNER_GRACE", "CLOSED"].includes(transfer.status)
  ) {
    return { transfer, replayed: true };
  }

  if (transfer.status !== "PENDING_ADMIN_APPROVAL") {
    throw new TransferError(
      409,
      `This transfer is ${transfer.status} and cannot be approved.`,
      "NOT_PENDING_APPROVAL",
    );
  }

  const member = await loadMember(transfer.societyId, transfer.memberId);

  // Master Prompt 2 §11 — with a sitting tenant the admin MUST say what happens
  // to them. No default: silently retaining or terminating somebody's tenancy
  // is a decision the software must not make on its own.
  const hasTenant = Boolean(member.currentTenant) || transfer.hadTenantAtInitiation;
  if (hasTenant && !["RETAIN", "TERMINATE"].includes(tenantDisposition)) {
    throw new TransferError(
      400,
      "This flat has a sitting tenant. Choose whether the tenancy is retained or terminated before approving.",
      "TENANT_DISPOSITION_REQUIRED",
    );
  }

  const when = effectiveDate ? new Date(effectiveDate) : new Date();
  const carryForward = await computeCarryForward(member);

  const session = await mongoose.startSession();
  let sellerSessionInvalidated = false;
  try {
    await session.withTransaction(async () => {
      const m = await loadMember(transfer.societyId, transfer.memberId, session);

      // ── 1. Previous owner joins the history ──────────────────────────────
      //
      // History holds PAST owners only. Measured against the data (see
      // Plan 02 §1 and SEC-27): every existing entry is `isCurrent: false`, and
      // the current owner lives in the top-level fields. `Member.methods.
      // transferOwnership` would ALSO push the new owner in with
      // `isCurrent: true`, creating exactly the duplicate this shape avoids —
      // which is why that method is not used here.
      const previousOwnerName = m.ownerName;
      const lastEnd = m.ownerHistory?.length
        ? m.ownerHistory[m.ownerHistory.length - 1].ownershipEndDate
        : null;
      m.ownerHistory.push({
        ownerName: m.ownerName,
        panCard: m.panCard,
        aadhaar: m.aadhaar,
        contactNumber: m.contactNumber,
        emailPrimary: m.emailPrimary,
        ownershipStartDate: lastEnd || m.possessionDate || m.createdAt,
        ownershipEndDate: when,
        transferType: transfer.transferType,
        transferDate: when,
        saleAmount: transfer.saleAmount ?? undefined,
        registrationNumber: transfer.registrationNumber || undefined,
        exitReason: transfer.transferType === "Purchase" ? "Sold" : "Transferred",
        isCurrent: false,
        notes: transfer.reason || undefined,
      });
      const historyEntry = m.ownerHistory[m.ownerHistory.length - 1];

      // ── 2. Buyer becomes the current owner ───────────────────────────────
      m.ownerName = transfer.buyer.name;
      m.contactNumber = transfer.buyer.contactNumber || m.contactNumber;
      m.emailPrimary = transfer.buyer.emailPrimary || "";
      m.panCard = transfer.buyer.panCard || "";
      m.aadhaar = transfer.buyer.aadhaar || "";
      m.possessionDate = when;
      if (transfer.buyer.userId) m.userId = transfer.buyer.userId;

      // ── 3. The tenancy ───────────────────────────────────────────────────
      //
      // RETAIN is the no-op by design: the tenant keeps their home, their
      // documents and their request record. Only the landlord behind it
      // changed, and that is `m.userId` above. TERMINATE is NOT done here —
      // it routes through the existing move-out workflow so there is one
      // implementation of ending a tenancy, not two.
      if (hasTenant && tenantDisposition === "TERMINATE" && m.currentTenant) {
        m.currentTenant.endDate = when;
        m.currentTenant.moveOutReason = "Ownership transferred";
        m.currentTenant.isCurrent = false;
        m.tenantHistory.push(m.currentTenant.toObject());
        m.currentTenant = undefined;
        m.ownershipType = "Owner-Occupied";
      }

      m.lastModifiedBy = actorUserId;
      await m.save({ session });

      transfer.approvedByUserId = actorUserId;
      transfer.approvedAt = new Date();
      transfer.transferDate = when;
      transfer.tenantDisposition = hasTenant ? tenantDisposition : null;
      transfer.approvalIdempotencyKey = idempotencyKey || null;
      transition(transfer, "APPROVED", { byUserId: actorUserId, note: "Approved by admin" });
      transition(transfer, "EFFECTIVE", { byUserId: actorUserId, note: "Applied to the flat" });
      transfer.effectiveAt = when;
      transfer.graceEndsAt = new Date(Date.now() + transfer.graceMinutes * 60 * 1000);
      transition(transfer, "OLD_OWNER_GRACE", {
        byUserId: actorUserId,
        note: `Seller has read-only access for ${transfer.graceMinutes} minutes`,
      });
      transfer.effect = {
        previousOwnerName,
        newOwnerName: m.ownerName,
        ownerHistoryEntryId: historyEntry?._id || null,
        buyerUserId: transfer.buyer.userId || null,
        sellerSessionInvalidated: false,
        tenantAction: hasTenant ? tenantDisposition : null,
        carryForwardAmount: carryForward,
      };
      await transfer.save({ session });
    });
  } finally {
    await session.endSession();
  }

  // ── 4. The seller's session stops being a resident session ──────────────
  //
  // Outside the transaction on purpose: it writes to Redis, not Mongo, and a
  // Redis hiccup must not roll back a completed, already-durable transfer. The
  // seller keeps read-only access during the grace window (enforced by the
  // middleware gate, by HTTP method), so the epoch bump is what forces their
  // client to pick up the new, reduced context rather than what removes it.
  if (transfer.seller.userId) {
    try {
      // The read-only window itself. Written before the epoch bump so the
      // seller's very next request — which the bump forces to re-auth — already
      // lands inside the restriction rather than between the two.
      await setOwnerGrace(String(transfer.seller.userId), transfer.graceEndsAt);
      await bumpSessionEpoch(String(transfer.seller.userId));
      sellerSessionInvalidated = true;
      await OwnershipTransfer.updateOne(
        { _id: transfer._id },
        { $set: { "effect.sellerSessionInvalidated": true } },
      );
      transfer.effect.sellerSessionInvalidated = true;
    } catch (err) {
      console.error(
        "[ownership-transfer] seller session epoch bump failed:",
        err?.message,
      );
    }
  }

  await logAudit(actorUserId, transfer.societyId, "OWNERSHIP_TRANSFER_APPROVED", null, {
    transferId: String(transfer._id),
    memberId: String(transfer.memberId),
    previousOwner: transfer.effect.previousOwnerName,
    newOwner: transfer.effect.newOwnerName,
    tenantAction: transfer.effect.tenantAction,
    carryForwardAmount: transfer.effect.carryForwardAmount,
    sellerSessionInvalidated,
    graceEndsAt: transfer.graceEndsAt,
  });
  await logAudit(actorUserId, transfer.societyId, "OWNERSHIP_TRANSFER_EFFECTIVE", null, {
    transferId: String(transfer._id),
    effectiveAt: transfer.effectiveAt,
  });

  return { transfer, replayed: false };
}

/** Admin refuses the transfer. Nothing about the flat changes. */
export async function rejectTransfer({ transfer, actorUserId, reason }) {
  if (!reason?.trim()) {
    throw new TransferError(
      400,
      "A reason is required when rejecting a transfer — the parties are told what it says.",
      "REASON_REQUIRED",
    );
  }
  transition(transfer, "REJECTED", { byUserId: actorUserId, note: reason.trim() });
  transfer.rejectedByUserId = actorUserId;
  transfer.rejectedAt = new Date();
  transfer.rejectionReason = reason.trim();
  await transfer.save();
  await logAudit(actorUserId, transfer.societyId, "OWNERSHIP_TRANSFER_REJECTED", null, {
    transferId: String(transfer._id),
    reason: transfer.rejectionReason,
  });
  return transfer;
}

/** Withdraw a transfer that has not yet taken effect. */
export async function cancelTransfer({ transfer, actorUserId, reason }) {
  if (["EFFECTIVE", "OLD_OWNER_GRACE", "CLOSED"].includes(transfer.status)) {
    throw new TransferError(
      409,
      "This transfer has already taken effect and cannot be cancelled. Raise a new transfer to move the flat back.",
      "ALREADY_EFFECTIVE",
    );
  }
  transition(transfer, "CANCELLED", { byUserId: actorUserId, note: reason || "Cancelled" });
  transfer.cancelledByUserId = actorUserId;
  transfer.cancelledAt = new Date();
  await transfer.save();
  await logAudit(actorUserId, transfer.societyId, "OWNERSHIP_TRANSFER_CANCELLED", null, {
    transferId: String(transfer._id),
    reason: reason || null,
  });
  return transfer;
}

/**
 * End the grace window: the seller stops being a resident of this flat.
 *
 * Called by the sweeper once `graceEndsAt` passes, and by an admin who wants to
 * close it early. Deliberately does NOT delete the seller's account — they may
 * own another flat, and Master Prompt 2 §7 is explicit that historical access
 * must not be solved by leaving an account permanently active either.
 */
export async function closeTransfer({ transfer, actorUserId }) {
  if (transfer.status === "CLOSED") return transfer;
  transition(transfer, "CLOSED", { byUserId: actorUserId || null, note: "Grace window ended" });
  transfer.closedAt = new Date();
  await transfer.save();

  // Detach the seller's profile for THIS flat only. A seller who owns another
  // flat in the same society keeps that one.
  if (transfer.seller.userId) {
    try {
      // Window over: the flag goes, the profile goes, and the epoch bump makes
      // their client pick both up immediately.
      await clearOwnerGrace(String(transfer.seller.userId));
      await User.updateOne(
        { _id: transfer.seller.userId },
        { $set: { "profiles.$[p].status": "Inactive" } },
        {
          arrayFilters: [
            { "p.memberId": transfer.memberId, "p.societyId": String(transfer.societyId) },
          ],
        },
      );
      await bumpSessionEpoch(String(transfer.seller.userId));
    } catch (err) {
      console.error("[ownership-transfer] seller profile detach failed:", err?.message);
    }
  }

  await logAudit(actorUserId, transfer.societyId, "OWNERSHIP_TRANSFER_CLOSED", null, {
    transferId: String(transfer._id),
    closedAt: transfer.closedAt,
  });
  return transfer;
}

/**
 * Is this user the seller of a transfer currently inside its grace window?
 *
 * Used by the read-only gate. Returns the transfer so the caller can tell the
 * user when their access ends.
 */
export async function findActiveGraceForUser(userId) {
  if (!userId) return null;
  return OwnershipTransfer.findOne({
    "seller.userId": userId,
    status: "OLD_OWNER_GRACE",
    graceEndsAt: { $gt: new Date() },
  }).lean();
}
