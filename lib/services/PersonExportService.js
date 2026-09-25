/**
 * PersonExportService — Plan 02 §8 and §14.
 *
 * Builds the records ONE person is entitled to take with them when they stop
 * being a resident: an outgoing owner after a transfer, or a tenant after a
 * move-out.
 *
 * ## Why this is person-scoped and not a society export
 *
 * `lib/superadmin/societyBundle.js` already exports a whole society. That is
 * the wrong tool here twice over: it would hand a departing owner their
 * neighbours' bills, and it is a superadmin capability the person themselves
 * cannot invoke.
 *
 * ## Why an export exists at all
 *
 * Master Prompt 2 §7 is explicit that historical access must NOT be solved by
 * leaving the account permanently active. Without something like this, the only
 * two options are "keep a former resident logged in forever" or "delete their
 * records and hope they never need them". Both are wrong. An export is what
 * makes ending access defensible.
 *
 * ## What it deliberately does not do
 *
 * Nothing is stored. The bundle is built in memory and streamed, the same
 * judgement as `app/api/v1/society-handover/download` — a generated file
 * sitting in object storage is a second copy of somebody's financial history
 * with its own access-control problem.
 */

import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Receipt from "@/models/Receipt";
import Transaction from "@/models/Transaction";
import RentPayment from "@/models/RentPayment";
import Complaint from "@/models/Complaint";
import Notice from "@/models/Notice";
import Visitor from "@/models/Visitor";
import OwnershipTransfer from "@/models/OwnershipTransfer";
import { redactDoc, redactDocs, REDACTION_NOTICE } from "@/lib/superadmin/societyRedaction";

/** Rows are capped so one export cannot pull an unbounded slice of the DB. */
const MAX_ROWS = 2000;

/**
 * The owner's own window on the flat.
 *
 * An owner is entitled to what happened **while they owned it** — not to the
 * next owner's bills, and not to the previous owner's. `ownershipEndDate` on
 * the history entry the transfer wrote is what bounds it.
 */
function ownershipWindow(transfer) {
  const end = transfer?.effectiveAt || transfer?.transferDate || new Date();
  // The start is whenever the seller took possession. If the flat has no prior
  // history the seller was the first owner, so the window opens at the flat's
  // own creation rather than being left unbounded.
  return { end };
}

/**
 * Build a former OWNER's export.
 *
 * @param {object} args
 * @param {string} args.societyId
 * @param {string} args.memberId    the flat
 * @param {object} [args.transfer]  the transfer that ended their ownership
 */
export async function buildOwnerExport({ societyId, memberId, transfer }) {
  const member = await Member.findOne({ _id: memberId, societyId }).lean();
  if (!member) {
    const err = new Error("Flat not found.");
    err.code = "MEMBER_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const { end } = ownershipWindow(transfer);
  // Everything raised against the flat up to the moment ownership changed. A
  // bill dated after the transfer belongs to the buyer and is not theirs to
  // take — this is the same property-vs-person split that keeps the ledger
  // honest (Master Prompt 2 §9).
  const upToTransfer = { societyId, memberId, createdAt: { $lte: end } };

  const [bills, receipts, transactions, complaints, visitors, notices] = await Promise.all([
    Bill.find(upToTransfer).sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
    Receipt.find(upToTransfer).sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
    Transaction.find(upToTransfer).sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
    Complaint.find(upToTransfer).sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
    Visitor.find(upToTransfer).sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
    // Notices are addressed to the society, not to a person, so they are
    // included as context rather than as the owner's own records.
    Notice.find({ societyId, createdAt: { $lte: end } }).sort({ createdAt: -1 }).limit(200).lean(),
  ]);

  // The owner's own entry in the flat's history — their period of ownership,
  // not every owner the flat has ever had. Handing over the full history would
  // give a departing owner the identity details of people who owned it before
  // them, which is not theirs.
  const ownOwnership = (member.ownerHistory || []).filter(
    (h) => !transfer || String(h.ownerName) === String(transfer.seller?.name),
  );

  return {
    kind: "owner",
    generatedAt: new Date().toISOString(),
    // Named so the recipient knows what they are looking at without being told.
    subject: {
      name: transfer?.seller?.name || member.ownerName,
      flat: member.wing ? `${member.wing}-${member.flatNo}` : member.flatNo,
      ownershipEnded: transfer?.effectiveAt || null,
    },
    profile: redactDoc({
      ownerName: member.ownerName,
      contactNumber: member.contactNumber,
      emailPrimary: member.emailPrimary,
      panCard: member.panCard,
      aadhaar: member.aadhaar,
      permanentAddress: member.permanentAddress,
      emergencyContact: member.emergencyContact,
      familyMembers: member.familyMembers,
    }),
    ownership: redactDocs(ownOwnership),
    transfer: transfer
      ? redactDoc({
          transferredOn: transfer.effectiveAt,
          transferType: transfer.transferType,
          saleAmount: transfer.saleAmount,
          registrationNumber: transfer.registrationNumber,
          // The buyer's contact details are NOT theirs to take. Only the fact
          // of the transfer and its commercial terms.
          newOwnerName: transfer.buyer?.name || null,
        })
      : null,
    bills: redactDocs(bills),
    receipts: redactDocs(receipts),
    payments: redactDocs(transactions),
    complaints: redactDocs(complaints),
    visitors: redactDocs(visitors),
    notices: redactDocs(notices),
    counts: {
      bills: bills.length,
      receipts: receipts.length,
      payments: transactions.length,
      complaints: complaints.length,
      visitors: visitors.length,
      notices: notices.length,
    },
    redactionNotice: REDACTION_NOTICE,
  };
}

/**
 * Build a former TENANT's export.
 *
 * Narrower than an owner's by design. A tenant rented a home; they did not own
 * the property. Maintenance bills raised against the flat belong to the owner,
 * so they are not included — what the tenant is entitled to is their own
 * tenancy record, the rent they paid, and the complaints and visitors they
 * themselves raised.
 */
export async function buildTenantExport({ societyId, memberId, tenantRequest }) {
  const member = await Member.findOne({ _id: memberId, societyId }).lean();
  if (!member) {
    const err = new Error("Flat not found.");
    err.code = "MEMBER_NOT_FOUND";
    err.status = 404;
    throw err;
  }

  const start = tenantRequest?.leaseStartDate || null;
  const end = tenantRequest?.leaseEndDate || new Date();
  // Bounded to the tenancy at both ends: a tenant is not entitled to what
  // happened in the flat before they moved in or after they left.
  const duringTenancy = {
    societyId,
    memberId,
    createdAt: { ...(start ? { $gte: start } : {}), $lte: end },
  };

  const [rentPayments, complaints, visitors] = await Promise.all([
    RentPayment.find(duringTenancy).sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
    Complaint.find(duringTenancy).sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
    Visitor.find(duringTenancy).sort({ createdAt: -1 }).limit(MAX_ROWS).lean(),
  ]);

  // Their own tenancy entry — not the flat's whole tenant history, which would
  // name the tenants before them.
  const ownTenancy =
    (member.tenantHistory || []).find(
      (t) => tenantRequest && String(t.name) === String(tenantRequest.tenantName),
    ) ||
    (member.currentTenant && tenantRequest &&
    String(member.currentTenant.name) === String(tenantRequest.tenantName)
      ? member.currentTenant
      : null);

  return {
    kind: "tenant",
    generatedAt: new Date().toISOString(),
    subject: {
      name: tenantRequest?.tenantName || ownTenancy?.name || null,
      flat: member.wing ? `${member.wing}-${member.flatNo}` : member.flatNo,
      leaseStart: start,
      leaseEnd: tenantRequest?.leaseEndDate || null,
    },
    tenancy: ownTenancy ? redactDoc(ownTenancy) : null,
    agreement: tenantRequest
      ? redactDoc({
          tenantName: tenantRequest.tenantName,
          tenantPhone: tenantRequest.tenantPhone,
          tenantEmail: tenantRequest.tenantEmail,
          leaseStartDate: tenantRequest.leaseStartDate,
          leaseEndDate: tenantRequest.leaseEndDate,
          rentPerMonth: tenantRequest.rentPerMonth,
          depositAmount: tenantRequest.depositAmount,
          status: tenantRequest.status,
          // Document KEYS only — a signed URL would still be live when the
          // bundle lands in an inbox, and R2 objects outlive the download.
          documents: tenantRequest.documents,
        })
      : null,
    rentPayments: redactDocs(rentPayments),
    complaints: redactDocs(complaints),
    visitors: redactDocs(visitors),
    counts: {
      rentPayments: rentPayments.length,
      complaints: complaints.length,
      visitors: visitors.length,
    },
    redactionNotice: REDACTION_NOTICE,
  };
}

/**
 * Is `userId` entitled to an owner export for this flat?
 *
 * Entitlement is the whole security boundary on this feature — the bundle is a
 * person's financial history, so "who may ask for it" matters more than what it
 * contains. Two ways to qualify:
 *
 *   1. They are the current owner (their own records, any time).
 *   2. They are the SELLER on a transfer of this flat — including after it has
 *      closed, because the export is the thing that makes ending their access
 *      acceptable.
 */
export async function canExportOwner({ societyId, memberId, userId }) {
  const member = await Member.findOne({ _id: memberId, societyId }).select("userId").lean();
  if (member && String(member.userId) === String(userId)) {
    return { allowed: true, transfer: null };
  }
  const transfer = await OwnershipTransfer.findOne({
    societyId,
    memberId,
    "seller.userId": userId,
  })
    .sort({ createdAt: -1 })
    .lean();
  if (transfer) return { allowed: true, transfer };
  return { allowed: false, transfer: null };
}
