import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { recordPayment, PaymentServiceError } from "@/lib/services/PaymentService";
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";

function twoDp(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}

// Simulator "real mode" payment. THIN WRAPPER over the member-level allocator
// (lib/services/PaymentService.js#recordPayment), the same one the admin
// Record Payment drawer uses: interest-first across every open bill, any
// overpayment to advanceCredit, the ledger Transaction with its running
// balance and the Journal Entry, all in one Mongo transaction. It used to run
// a single-bill allocation, write the Transaction itself, never credit the
// member's advance, and post the ledger outside any transaction.
export async function POST(request) {
  try {
    const gate = await authorize(request, "finance.payment.record");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role === "Accountant" || decoded.role === "Member")
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

    const { memberId, billPeriodId, amount, paymentDate, paymentMethod, remarks } = await request.json();
    if (!memberId || !billPeriodId || !amount)
      return NextResponse.json({ error: "memberId, billPeriodId, amount required" }, { status: 400 });
    if (amount <= 0) return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });

    const bill = await Bill.findOne({
      memberId,
      societyId: decoded.societyId,
      billPeriodId,
      isDeleted: { $ne: true },
    }).select("_id status");
    if (!bill) return NextResponse.json({ error: `No bill found for ${billPeriodId}` }, { status: 404 });

    let recorded;
    try {
      recorded = await recordPayment({
        memberId: String(memberId),
        societyId: String(decoded.societyId),
        amount: twoDp(amount),
        paymentMode: paymentMethod || "Cash",
        paymentDate,
        notes: `Simulator (real mode) for ${billPeriodId}${remarks ? ` - ${remarks}` : ""}`,
        actorUserId: decoded.userId,
        actorRole: decoded.role,
      });
    } catch (err) {
      if (err instanceof PaymentServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err.code && /^[BP]\d/.test(err.code)) return NextResponse.json({ error: `Invariant ${err.code}: ${err.message}` }, { status: 422 });
      throw err;
    }

    await cache.del(
      `v1:bills:${decoded.societyId}:member:${memberId}`,
      `v1:ledger:${decoded.societyId}:member:${memberId}`,
    );

    const t = recorded.transaction;
    const saved = (await Transaction.findOne({ societyId: decoded.societyId, transactionId: t.transactionId }).select("paymentBreakdown").lean())?.paymentBreakdown || {};
    const fresh = await Bill.findById(bill._id).select("status").lean();
    return NextResponse.json({
      success: true,
      transactionId: t.transactionId,
      billPeriodId,
      amountPaid: twoDp(amount),
      interestCleared: twoDp(saved.interestCleared),
      principalCleared: twoDp(saved.principalCleared),
      advanceCredit: twoDp(saved.advanceCredit),
      primaryBillId: bill._id,
      status: fresh?.status || bill.status,
    });
  } catch (err) {
    console.error("pay-real error:", err);
    if (err.status) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
