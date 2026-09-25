// PATCH /api/admin/payments/received/:id - edit the NON-FINANCIAL metadata of
// a recorded payment (mode, reference, cheque/bank/UPI, notes, value date).
//
// POST  /api/admin/payments/received/:id - reverse a payment. This never
// silently rewrites history: the original row is flagged isReversed and a
// mirror Debit transaction is written so the ledger nets to zero and both
// rows stay visible in the audit trail.
//
// The amount of an existing payment is deliberately NOT editable - changing it
// in place would desynchronise bill allocation, receipts and balances. Reverse
// the payment and record a correct one instead.
import { reversePayment, PaymentReversalError } from "@/lib/services/PaymentReversalService";
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import User from "@/models/User";
void User;
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = ["paymentMode", "chequeNo", "bankName", "upiId", "transactionRef", "notes"];

async function load(id, societyId) {
  // Same shape-tolerance as /api/admin/payments/received: old collection-sheet
  // rows only have type:"PAYMENT", no category — matching category:"Payment"
  // alone 404'd Edit/Reverse for any payment recorded before 2026-08-22.
  const txn = await Transaction.findOne({
    _id: id,
    societyId,
    $or: [{ category: "Payment" }, { type: { $in: ["PAYMENT", "Payment", "payment"] } }],
  });
  return txn;
}

export async function PATCH(request, ctx) {
  const gate = await authorize(request, "finance.payment.record");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const txn = await load(id, gate.context.societyId);
    if (!txn) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    if (txn.isReversed)
      return NextResponse.json({ error: "This payment is reversed and can no longer be edited" }, { status: 409 });

    const body = await request.json();
    const updates = {};
    for (const key of EDITABLE) {
      if (typeof body[key] === "string") updates[key] = body[key].trim();
    }
    if (body.date) {
      const d = new Date(body.date);
      if (Number.isNaN(d.getTime()))
        return NextResponse.json({ error: "Invalid date" }, { status: 400 });
      updates.date = d;
    }
    if (body.amount !== undefined)
      return NextResponse.json(
        { error: "Amount cannot be edited. Reverse this payment and record a corrected one." },
        { status: 400 },
      );
    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });

    Object.assign(txn, updates);
    await txn.save();
    await cache.del(`v1:ledger:${txn.societyId}:member:${txn.memberId}`);
    return NextResponse.json({ success: true, payment: { _id: String(txn._id), ...updates } });
  } catch (err) {
    console.error("Payment edit error", err);
    return NextResponse.json({ error: "Failed to update payment" }, { status: 500 });
  }
}

export async function POST(request, ctx) {
  const gate = await authorize(request, "finance.payment.record");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    if (body.action !== "reverse")
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });

    // Reverses the payment in the books, on the bills, on the member's advance
    // and on the ledger together — see PaymentReversalService.
    const result = await reversePayment({
      societyId: gate.context.societyId,
      transactionId: id,
      reason: body.reason,
      actorUserId: gate.context.userId,
      actorRole: gate.context.hat,
    });
    return NextResponse.json({
      success: true,
      reversalTransactionId: result.reversalTransactionId,
      booksReversed: result.booksReversed,
    });
  } catch (err) {
    if (err instanceof PaymentReversalError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Payment reversal error", err);
    return NextResponse.json({ error: "Failed to reverse payment" }, { status: 500 });
  }
}
