import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { getFinancialYear } from "@/lib/date-utils";
import { generateSimulatedBill } from "@/lib/billing/generationService";
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";

// Ledger V2: THIN WRAPPER over the shared GenerationService. Contains no billing
// math of its own. This is the SIMULATOR endpoint, so it is the only caller
// allowed to seed opening balances — it uses generateSimulatedBill(), which
// accepts an explicit opening seed. Production generation (generateBill) has no
// such parameter and can never inject balances.
export async function POST(request) {
  try {
    const gate = await authorize(request, "billing.bill.generate");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role === "Accountant" || decoded.role === "Member")
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

    const { year, month, memberId, openingPrincipal, openingInterest } = await request.json();
    if (!year || !month || !memberId)
      return NextResponse.json({ error: "year, month, memberId required" }, { status: 400 });

    let bill;
    try {
      bill = await generateSimulatedBill({
        societyId: decoded.societyId,
        memberId,
        year: Number(year),
        month: Number(month),
        performedBy: decoded.userId,
        // Simulator-only opening seed. When omitted, the simulator derives from
        // the previous bill (same as production) but without carry-forward guards.
        openingPrincipal: openingPrincipal != null ? openingPrincipal : undefined,
        openingInterest: openingInterest != null ? openingInterest : undefined,
      });
    } catch (err) {
      if (err.code === "P4_DUPLICATE") return NextResponse.json({ error: err.message }, { status: 400 });
      if (err.code === "MEMBER_NOT_FOUND") return NextResponse.json({ error: "Member not found" }, { status: 404 });
      if (err.code && /^[BP]\d/.test(err.code)) return NextResponse.json({ error: `Invariant ${err.code}: ${err.message}` }, { status: 422 });
      throw err;
    }

    const txDate = new Date();
    await Transaction.create({
      transactionId: Transaction.generateTransactionId(),
      societyId: decoded.societyId,
      memberId,
      date: txDate,
      type: "Debit",
      category: "Maintenance",
      description: `Bill generated for ${bill.billPeriodId} (simulator real-mode)`,
      amount: parseFloat(((bill.currentCharges || 0) + (bill.currentInterest || 0)).toFixed(2)),
      balanceAfterTransaction: bill.totalBillDue, // opening dues + this bill's charge = what is owed after it
      paymentMode: "System",
      createdBy: decoded.userId,
      billPeriodId: bill.billPeriodId,
      financialYear: getFinancialYear(txDate),
    });

    // "real-mode" writes an actual production Bill/Transaction for this
    // member (despite living behind the simulator UI) - must not leave the
    // mobile app showing last period's bill.
    await cache.del(
      `v1:bills:${decoded.societyId}:member:${memberId}`,
      `v1:ledger:${decoded.societyId}:member:${memberId}`,
    );

    return NextResponse.json({
      success: true,
      billId: bill._id,
      billPeriodId: bill.billPeriodId,
      openingPrincipal: bill.openingPrincipal,
      openingInterest: bill.openingInterest,
      currentCharges: bill.currentCharges,
      currentInterest: bill.currentInterest,
      billPrincipalBalance: bill.billPrincipalBalance,
      billInterestBalance: bill.billInterestBalance,
      totalBillDue: bill.totalBillDue,
      status: bill.status,
    });
  } catch (err) {
    console.error("generate-real error:", err);
    return NextResponse.json({ error: "Internal server error", details: err.message }, { status: 500 });
  }
}
