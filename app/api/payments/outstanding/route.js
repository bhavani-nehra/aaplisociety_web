// FILE: app/api/payments/outstanding/route.js
// CHANGE 10 — Full rewrite
// FROM: uses ledger balance as source of truth, calculates interest live
// TO:   uses unpaid bill balances (principalBalance + interestBalance), detects payment block
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import Bill from "@/models/Bill";
import { getBillPayFinalDate } from "../../../../utils/interestUtils";
import { authorize } from "@/lib/rbac/authorize";
export async function GET(request) {
  try {
    const gate = await authorize(request, "finance.payment.view");
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
    const searchParams = new URL(request.url).searchParams;
    const memberId = searchParams.get("memberId");
    if (!memberId) {
      return NextResponse.json(
        { error: "Member ID required" },
        { status: 400 },
      );
    }
    // Fetch member (for advanceCredit)
    const member = await cache.getOrSet(
      `member:single:${memberId}`,
      () =>
        Member.findOne({ _id: memberId, societyId: decoded.societyId }).lean(),
      300,
    );
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }
    // Fetch society config
    const society = await cache.getOrSet(
      `society:config:${decoded.societyId}`,
      () => Society.findById(decoded.societyId).lean(),
      900,
    );
    const config = society?.config || {};
    const billPayFinalDay = config.billPayFinalDay || 0;
    const interestRate = config.interestRate || 0;
    const memberPaymentBreakdownVisible =
      config.memberPaymentBreakdownVisible !== false;
    // ✅ SOURCE OF TRUTH: unpaid bills (not ledger balance)
    const unpaidBills = await Bill.find({
      memberId,
      societyId: decoded.societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue", "Scheduled"] },
      isDeleted: false,
    })
      .sort({ billYear: 1, billMonth: 1 })
      .lean();
    // No outstanding bills — check if member has opening balances not yet billed
    if (unpaidBills.length === 0) {
      const openingPrin = member.openingPrincipal || 0;
      const openingInt = member.openingInterest || 0;
      const openingTotal = parseFloat((openingPrin + openingInt).toFixed(2));
      return NextResponse.json({
        principalOutstanding: openingPrin,
        interestOutstanding: openingInt,
        totalOutstanding: openingTotal,
        principalAmount: openingPrin,
        interestAmount: openingInt,
        isPaymentBlocked: false,
        blockMessage: null,
        unpaidBillCount: 0,
        memberAdvanceCredit: member.advanceCredit || 0,
        interestRate: society?.config?.interestRate || 0,
        openingPrincipal: openingPrin,
        openingInterest: openingInt,
        message:
          openingTotal > 0
            ? `Outstanding: ₹${openingInt.toFixed(2)} interest + ₹${openingPrin.toFixed(2)} principal (opening balance)`
            : "No outstanding balance",
      });
    }
    // ✅ Sum from bill components (set at generation + updated at payment)
    // Every bill opens on the previous bill's closing, so the NEWEST open bill
    // already holds everything owed. Summing all of them showed a member three
    // months behind roughly three times what they really owe.
    const newestOpen = unpaidBills[unpaidBills.length - 1];
    const totalPrincipalOutstanding = newestOpen.principalBalance || 0;
    const totalInterestOutstanding = newestOpen.interestBalance || 0;
    const totalOutstanding = parseFloat(
      (totalPrincipalOutstanding + totalInterestOutstanding).toFixed(2),
    );
    // ✅ Check billPayFinalDate against OLDEST unpaid bill
    let isPaymentBlocked = false;
    let blockMessage = null;
    let billPayFinalDate = null;
    if (billPayFinalDay > 0) {
      const oldest = unpaidBills[0];
      // billMonth is stored 0-indexed (May=4); getBillPayFinalDate expects 1-indexed
      billPayFinalDate = getBillPayFinalDate(
        oldest.billYear,
        oldest.billMonth + 1,
        billPayFinalDay,
      );
      if (billPayFinalDate) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (today > billPayFinalDate) {
          isPaymentBlocked = true;
          blockMessage = `Payment window closed for period ${oldest.billPeriodId}. Interest frozen as of ${billPayFinalDate.toLocaleDateString("en-IN")}. Contact admin.`;
        }
      }
    }
    // ✅ Per-bill breakdown for transparent UI
    const billBreakdown = unpaidBills.map((b) => ({
      billPeriodId: b.billPeriodId,
      billYear: b.billYear,
      billMonth: b.billMonth,
      dueDate: b.dueDate,
      status: b.status,
      totalAmount: b.totalAmount,
      amountPaid: b.amountPaid,
      principalBalance: b.principalBalance || 0,
      interestBalance: b.interestBalance || 0,
      balanceAmount: b.balanceAmount,
      currInt: b.currInt || 0,
      monthInterest: b.monthInterest || 0,
    }));
    return NextResponse.json({
      principalOutstanding: parseFloat(totalPrincipalOutstanding.toFixed(2)),
      interestOutstanding: parseFloat(totalInterestOutstanding.toFixed(2)),
      totalOutstanding,
      openingPrincipal: member.openingPrincipal || 0,
      openingInterest: member.openingInterest || 0,
      unpaidBillCount: unpaidBills.length,
      isPaymentBlocked,
      interestRate: society?.config?.interestRate || 0,
      blockMessage,
      billPayFinalDate,
      unpaidBillCount: unpaidBills.length,
      memberAdvanceCredit: member.advanceCredit || 0,
      // ✅ Per-bill breakdown (only if society allows transparency)
      ...(memberPaymentBreakdownVisible ? { billBreakdown } : {}),
      // Legacy fields — keeps existing UI callers working
      principalAmount: parseFloat(totalPrincipalOutstanding.toFixed(2)),
      interestAmount: parseFloat(totalInterestOutstanding.toFixed(2)),
      daysOverdue: 0, // removed — not meaningful with monthly model
      dueDate: unpaidBills[0]?.dueDate || null,
      graceEndDate: null,
      interestCalculationMethod: "MONTHLY",
      message: isPaymentBlocked
        ? blockMessage
        : totalOutstanding > 0
          ? `Outstanding: ₹${totalInterestOutstanding.toFixed(2)} interest + ₹${totalPrincipalOutstanding.toFixed(2)} principal`
          : "No outstanding balance",
    });
  } catch (error) {
    console.error("Outstanding calculation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
