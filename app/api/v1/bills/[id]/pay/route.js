import { withRoute, ApiError, json, zodError } from "@/lib/v1/http";
import { getClaims, requireRoles, requireTenant } from "@/lib/v1/auth";
import { paymentSchema } from "@/lib/v1/schemas";
import { Bill, Member, Payment, Transaction, Receipt } from "@/lib/v1/models";
import { BILLING_WRITE_ROLES } from "@/lib/v1/constants";
import { recordPayment, PaymentServiceError } from "@/lib/services/PaymentService";
import { normalizeBill } from "@/lib/v1/billUtils";
import { issueReceiptNo } from "@/lib/billing/receiptIssuance";
import { notifyPaymentReceived } from "@/lib/v1/notify";
import cache from "@/lib/cache";

/** Same convention app/api/billing/upload-payments/route.js and
 * app/api/bills/collection-sheet/commit/route.js already use for
 * Receipt.filename. Kept in three places pending a shared util — same bug
 * class as this route's own missing-filename fix: three independent
 * payment-recording paths, three independent chances to omit a required
 * field. */
function receiptFilename(member, billPeriodId) {
  const nameParts = (member?.ownerName || "member").trim().split(/\s+/);
  const nameSlug = nameParts.length > 1 ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}` : nameParts[0];
  const flatSlug = `${member?.wing || ""}-${member?.flatNo || ""}`;
  return `${nameSlug}_${flatSlug}_${billPeriodId}_receipt`.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/bills/:id/pay — admin/secretary records a payment against a bill
// from the mobile app. Allocation, ledger row and Journal Entry go through the
// member-level allocator (recordPayment); interest is cleared before
// principal and any overpayment becomes member advanceCredit.
export const POST = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, BILLING_WRITE_ROLES);

  const body = await req.json().catch(() => ({}));
  const parsed = paymentSchema.partial({ billId: true }).safeParse({ ...body, billId: body.billId ?? id });
  if (!parsed.success) throw zodError(parsed);
  const { amount, paymentMode } = parsed.data;

  const bill = await Bill.findOne({ _id: id, societyId });
  if (!bill) throw new ApiError(404, "Bill not found");
  if (bill.status === "Paid") throw new ApiError(409, "Bill already paid");

  // Ledger V2 (§14): at most one bill carries the outstanding balance at a
  // time — every generation absorbs the previous bill's full closing state
  // into its own opening. Paying an OLDER bill after a newer one already
  // exists would change that older bill's closingPrincipal/closingInterest
  // without updating the newer bill's already-frozen opening — an instant
  // P1 carry-forward break. Only the member's latest bill is payable.
  const newerBillExists = await Bill.exists({
    societyId,
    memberId: bill.memberId,
    billPeriodId: { $gt: bill.billPeriodId ?? bill.period },
  });
  if (newerBillExists) {
    throw new ApiError(
      409,
      "This bill has been superseded by a newer one — only the current bill can be paid. Any remaining balance already carried forward.",
    );
  }

  // Member-level allocator (lib/services/PaymentService.js#recordPayment) —
  // the same one the admin Record Payment drawer uses. It allocates across
  // every open bill interest-first, moves any overpayment to advanceCredit,
  // writes the ledger Transaction (category "Payment", with the running
  // balance) and posts the Journal Entry, all in one Mongo transaction. This
  // route used to do its own single-bill allocation, wrote the Transaction as
  // category "Maintenance" with no running balance, and posted the ledger
  // outside any transaction.
  let recorded;
  try {
    recorded = await recordPayment({
      memberId: String(bill.memberId),
      societyId: String(societyId),
      amount,
      paymentMode,
      notes: `Bill ${bill.billPeriodId ?? bill.period}`,
      actorUserId: claims.userId,
      actorRole: claims.role,
    });
  } catch (err) {
    if (err instanceof PaymentServiceError) throw new ApiError(err.status, err.message);
    if (err.code && /^[BP]\d/.test(err.code)) throw new ApiError(422, `Invariant ${err.code}: ${err.message}`);
    throw err;
  }

  const transactionId = recorded.transaction.transactionId;
  const transaction = await Transaction.findOne({ societyId, transactionId }).select("_id paymentBreakdown").lean();
  const saved = transaction?.paymentBreakdown || {};
  const advanceCredit = saved.advanceCredit || 0;
  const breakdown = { interestCleared: saved.interestCleared || 0, principalCleared: saved.principalCleared || 0 };
  const freshBill = await Bill.findById(bill._id);

  const receiptNo = await issueReceiptNo(bill);
  // Required on the Receipt model (unique + required, no default).
  const payerMember = await Member.findById(bill.memberId).select("ownerName wing flatNo").lean();
  const filename = receiptFilename(payerMember, bill.billPeriodId ?? bill.period);

  // The payment itself is committed above. Payment (the v1 mirror) and the
  // Receipt are secondary: a failure here is reported, not thrown, so the
  // admin never sees "failed" for a payment that went through. A missing
  // receipt is found and backfilled by app/api/admin/receipts/gaps.
  let payment = null;
  try {
    payment = await Payment.create({ societyId, billId: bill._id, memberId: bill.memberId, amount, paymentMode });
  } catch (err) {
    console.error(`v1/bills/${bill._id}/pay: Payment mirror failed, payment already recorded:`, err.message);
  }

  let receipt = null;
  let receiptFailed = false;
  try {
    receipt = await Receipt.create({
      receiptNo,
      filename,
      billId: bill._id,
      billPeriodId: bill.billPeriodId ?? bill.period,
      memberId: bill.memberId,
      societyId,
      unitClass: bill.unitClass,
      billSeries: bill.billSeries,
      amount,
      paymentMode,
      paidAt: new Date(),
      transactionId,
      status: "Generated",
    });
  } catch (err) {
    receiptFailed = true;
    console.error(`v1/bills/${bill._id}/pay: Receipt.create failed, payment already recorded:`, err.message);
  }
  await notifyPaymentReceived({ transactionId: transaction?._id, societyId, memberId: bill.memberId, amount });

  await cache.del(
    `v1:bills:${societyId}:member:${bill.memberId}`,
    `v1:ledger:${societyId}:member:${bill.memberId}`,
    `v1:receipts:${societyId}:member:${bill.memberId}`,
  );

  const member = await Member.findById(bill.memberId).lean();
  return json({
    bill: normalizeBill(freshBill, member),
    payment: payment ? { _id: String(payment._id), amount, paymentMode } : null,
    receipt: receipt ? { _id: String(receipt._id), receiptNo } : null,
    advanceCredit,
    breakdown,
    ...(receiptFailed ? { warning: "Payment recorded, but the receipt could not be generated (fix on the Receipts page)." } : {}),
  });
});
