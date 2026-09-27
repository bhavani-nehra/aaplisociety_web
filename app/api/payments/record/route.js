import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import {
  recordPayment,
  PaymentServiceError,
} from "@/lib/services/PaymentService";
import { notifyPaymentReceived } from "@/lib/v1/notify";
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";

// A payment always touches this one member's bill, ledger and receipt list
// at once - invalidate all three v1 keys together so the app never shows
// two of the three updated and one stale.
async function invalidateV1MemberCaches(societyId, memberId) {
  await cache.del(
    `v1:bills:${societyId}:member:${memberId}`,
    `v1:ledger:${societyId}:member:${memberId}`,
    `v1:receipts:${societyId}:member:${memberId}`,
  );
}

// Business logic lives in lib/services/PaymentService.js as of Phase 2.1 of
// the accounting-system revamp (docs/accounting-system-ARD.md §9). This route
// only handles auth + request parsing + response mapping.

export async function POST(request) {
  try {
    const gate = await authorize(request, "finance.payment.record");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const {
      memberId,
      amount,
      paymentMode,
      paymentDate,
      chequeNo,
      bankName,
      upiId,
      transactionRef,
      notes,
    } = await request.json();
    if (!memberId || !amount) {
      return NextResponse.json(
        { error: "Member ID and amount are required" },
        { status: 400 },
      );
    }
    if (typeof memberId !== "string" || !/^[a-f\d]{24}$/i.test(memberId)) {
      return NextResponse.json({ error: "Invalid member ID" }, { status: 400 });
    }
    if (!paymentMode) {
      return NextResponse.json(
        { error: "Payment mode is required" },
        { status: 400 },
      );
    }
    if (amount <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than zero" },
        { status: 400 },
      );
    }
    // Everything below used to be duplicated here AND inside
    // PaymentService.recordPayment() — member/society lookup, the
    // billPayFinalDay guard, the opening-balance-only branch, and the actual
    // allocation (this route ran applyPaymentToBill() + a manual
    // Transaction.create() FIRST, then called recordPayment() which redid
    // the exact same allocation from scratch inside its own Mongo session).
    // One payment got applied to the bill twice and produced two ledger
    // entries; if the bill fully paid off on the first pass, PaymentService's
    // own bill lookup then found nothing outstanding and threw, discarding
    // the success response even though the DB had already been mutated.
    // PaymentService is the one session-wrapped, single-source-of-truth
    // implementation (see its own file header) — this route now only
    // authenticates and forwards to it.
    let paymentRecord;
    try {
      paymentRecord = await recordPayment({
        memberId,
        societyId: decoded.societyId,
        amount,
        paymentMode,
        paymentDate,
        chequeNo,
        bankName,
        upiId,
        transactionRef,
        notes,
        actorUserId: decoded.userId,
        actorRole: decoded.role,
      });
    } catch (err) {
      if (err instanceof PaymentServiceError) throw err;
      if (err.code === "NEGATIVE_PAYMENT" || (err.code && /^[BP]\d/.test(err.code))) {
        throw new PaymentServiceError(err.code === "NEGATIVE_PAYMENT" ? 400 : 422, err.message);
      }
      throw err;
    }

    await invalidateV1MemberCaches(decoded.societyId, memberId);

    // Payment recorded, but nobody ever told the member — this route never
    // called notifyPaymentReceived (the other two live payment paths,
    // upload-payments and v1/bills/[id]/pay, always have).
    const t = paymentRecord.transaction;
    if (t) {
      await notifyPaymentReceived({
        transactionId: t.transactionId,
        societyId: decoded.societyId,
        memberId,
        amount: t.amount,
        appliedAmount: (t.breakdown?.interestCleared || 0) + (t.breakdown?.principalCleared || 0) || t.amount,
        advanceCredit: t.advanceCredit || 0,
        remainingBalance: t.billsUpdated?.[0] ? undefined : 0,
      }).catch((e) => console.error("notifyPaymentReceived failed:", e.message));
    }

    return NextResponse.json(paymentRecord, { status: 201 });
  } catch (error) {
    if (error instanceof PaymentServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Record payment error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
      },
      { status: 500 },
    );
  }
}
