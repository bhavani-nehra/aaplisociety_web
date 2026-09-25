// FILE: app/api/payments/late-list/route.js
// COMPANION to Change 15 — provides data for Late Payments admin page
// Returns all members whose oldest unpaid bill is past billPayFinalDate
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { getBillPayFinalDate } from "../../../../utils/interestUtils";
import { authorizeAny } from "@/lib/rbac/authorize";
export async function GET(request) {
  try {
    // The Late Payments page's own permission is finance.latePayment.view —
    // the Payments page's finance.payment.view also works since it's the
    // same underlying data, viewed from a different page.
    const gate = await authorizeAny(request, [
      "finance.latePayment.view",
      "finance.payment.view",
    ]);
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    // Legacy "Admin or Secretary" check removed: authorize() above
    // (finance.payment.view) is the real gate now.
    const societyId = gate.context.societyId || decoded.societyId;
    const society = await Society.findById(societyId)
      .select("config")
      .lean();
    const billPayFinalDay = society?.config?.billPayFinalDay || 0;
    if (billPayFinalDay === 0) {
      // No final day configured — no late payments concept
      return NextResponse.json({
        members: [],
        message: "billPayFinalDay not configured",
      });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // All unpaid bills sorted oldest-first per member
    const unpaidBills = await Bill.find({
      societyId,
      status: { $in: ["Unpaid", "Partial", "Overdue"] },
      isDeleted: false,
    })
      .sort({ memberId: 1, billYear: 1, billMonth: 1 })
      .lean();
    // Group by member
    const byMember = {};
    for (const bill of unpaidBills) {
      const mid = bill.memberId.toString();
      if (!byMember[mid]) byMember[mid] = [];
      byMember[mid].push(bill);
    }
    // Filter members where oldest bill is past billPayFinalDate
    const lateMembers = [];
    for (const [memberId, bills] of Object.entries(byMember)) {
      const oldest = bills[0]; // already sorted oldest-first
      const billMonth1based = oldest.billMonth + 1; // billMonth is 0-based
      const finalDate = getBillPayFinalDate(
        oldest.billYear,
        billMonth1based,
        billPayFinalDay,
      );
      if (!finalDate || today <= finalDate) continue; // not late
      // Every bill opens on the previous bill's closing, so the NEWEST open
      // bill already carries the older months. Summing all open bills counted
      // the same rupees once per open month and pre-filled "Record payment"
      // with an inflated amount (same fault as /api/payments/outstanding).
      const newest = bills[bills.length - 1];
      const principalOutstanding = newest.principalBalance || 0;
      const interestOutstanding = newest.interestBalance || 0;
      const totalOutstanding = parseFloat(
        (principalOutstanding + interestOutstanding).toFixed(2),
      );
      lateMembers.push({
        memberId,
        // Member info fetched below
        oldestPeriod: oldest.billPeriodId,
        deadline: finalDate,
        principalOutstanding: parseFloat(principalOutstanding.toFixed(2)),
        interestOutstanding: parseFloat(interestOutstanding.toFixed(2)),
        totalOutstanding,
        unpaidBillCount: bills.length,
        bills: bills.map((b) => ({
          billPeriodId: b.billPeriodId,
          principalBalance: b.principalBalance || 0,
          interestBalance: b.interestBalance || 0,
          balanceAmount: b.balanceAmount,
          status: b.status,
          dueDate: b.dueDate,
        })),
      });
    }
    // Enrich with member details
    if (lateMembers.length > 0) {
      const memberIds = lateMembers.map((m) => m.memberId);
      const members = await Member.find({ _id: { $in: memberIds } })
        .select(
          "_id wing flatNo ownerName contactNumber emailPrimary advanceCredit",
        )
        .lean();
      const memberMap = {};
      members.forEach((m) => {
        memberMap[m._id.toString()] = m;
      });
      for (const lm of lateMembers) {
        const m = memberMap[lm.memberId] || {};
        lm.wing = m.wing || "";
        lm.flatNo = m.flatNo || "";
        lm.ownerName = m.ownerName || "";
        lm.contactNumber = m.contactNumber || "";
        lm.email = m.emailPrimary || "";
        lm.advanceCredit = m.advanceCredit || 0;
      }
    }
    // Sort by total outstanding desc (worst offenders first)
    lateMembers.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    return NextResponse.json({
      members: lateMembers,
      totalMembers: lateMembers.length,
      totalInterestDue: parseFloat(
        lateMembers.reduce((s, m) => s + m.interestOutstanding, 0).toFixed(2),
      ),
      totalPrincipalDue: parseFloat(
        lateMembers.reduce((s, m) => s + m.principalOutstanding, 0).toFixed(2),
      ),
      totalDue: parseFloat(
        lateMembers.reduce((s, m) => s + m.totalOutstanding, 0).toFixed(2),
      ),
    });
  } catch (error) {
    console.error("Late payments list error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
