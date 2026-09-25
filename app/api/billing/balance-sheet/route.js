import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
import Expense from "@/models/Expense";
import mongoose from "mongoose";
import { authorize } from "@/lib/rbac/authorize";
// billMonth is 0-indexed: 0=Jan, 3=Apr, 11=Dec
// FY Apr(3)→Mar(2): months 3..11 of fyStart year, then 0..2 of fyStart+1 year
function fyMonths(fy) {
  // Returns array of { year, month0, label, periodId } in FY order
  const months = [];
  for (let m = 3; m <= 11; m++) {
    months.push({ year: fy, month0: m, label: monthLabel(m, fy), periodId: periodId(fy, m) });
  }
  for (let m = 0; m <= 2; m++) {
    months.push({ year: fy + 1, month0: m, label: monthLabel(m, fy + 1), periodId: periodId(fy + 1, m) });
  }
  return months;
}
function periodId(year, month0) {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(month0, year) {
  return `${MONTH_NAMES[month0]} ${year}`;
}
export async function GET(request) {
  const gate = await authorize(request, "billing.balanceSheet.view");
  if (!gate.ok) return gate.response;
  // Society scope comes from authorize()'s already-verified context, not a
  // second manual token decode — that's what previously hardcoded
  // ["Admin","SuperAdmin"] as the only allowed *legacy* role, silently
  // overriding whatever RBAC had just granted (e.g. Auditor: view).
  const { searchParams } = new URL(request.url);
  // SEC-21: the `|| searchParams.get("societyId")` fallback is gone.
  //
  // It was only reachable when the token carried no society context — which
  // authorize() already refuses with "No active society context" — so it was
  // almost certainly dead. But "almost certainly dead" is not a property you
  // want on the line that decides which society's balance sheet a caller
  // reads, and a client-supplied tenant scope is exactly the pattern Master
  // Prompt 1 §5 says must never exist next to a trusted one.
  const societyId = gate.context.societyId;
  const fy = parseInt(searchParams.get("fy") || (() => {
    const now = new Date();
    return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  })());
  await connectDB();
  if (!societyId || !mongoose.Types.ObjectId.isValid(societyId)) {
    return NextResponse.json({ error: "Invalid society context" }, { status: 400 });
  }
  const sid = new mongoose.Types.ObjectId(societyId);
  // All bills for this FY
  const bills = await Bill.find({
    societyId: sid,
    isDeleted: { $ne: true },
    $or: [
      { billYear: fy, billMonth: { $gte: 3 } },
      { billYear: fy + 1, billMonth: { $lte: 2 } },
    ],
  }).lean();
  // Bills before this FY with outstanding balance
  const priorBills = await Bill.find({
    societyId: sid,
    isDeleted: { $ne: true },
    status: { $in: ["Unpaid", "Partial", "Overdue"] },
    $or: [
      { billYear: { $lt: fy } },
      { billYear: fy, billMonth: { $lt: 3 } },
    ],
  }).lean();
  // Society expenditure for this FY, bucketed by "YYYY-MM" period.
  const fyStart = new Date(Date.UTC(fy, 3, 1, 0, 0, 0));
  const fyEnd = new Date(Date.UTC(fy + 1, 3, 1, 0, 0, 0));
  const expenses = await Expense.find({
    societyId: sid,
    isDeleted: { $ne: true },
    date: { $gte: fyStart, $lt: fyEnd },
  }).lean();
  const expenseByPeriod = {};
  const expenseByCategory = {};
  for (const e of expenses) {
    expenseByPeriod[e.periodId] = (expenseByPeriod[e.periodId] || 0) + (e.amount || 0);
    expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + (e.amount || 0);
  }
  // Group current FY bills by periodId
  const byPeriod = {};
  for (const b of bills) {
    const pid = b.billPeriodId;
    if (!byPeriod[pid]) byPeriod[pid] = [];
    byPeriod[pid].push(b);
  }
  // Build monthly timeline
  const timeline = fyMonths(fy).map(({ year, month0, label, periodId: pid }) => {
    const periodBills = byPeriod[pid] || [];
    const generated = periodBills.length > 0;
    const totalBilled = periodBills.reduce((s, b) => s + (b.totalBillDue || b.totalAmount || 0), 0);
    const totalPaid = periodBills.reduce((s, b) => s + (b.amountPaid || 0), 0);
    const totalAdvance = periodBills.reduce((s, b) => s + (b.advanceApplied || 0), 0);
    const totalPending = periodBills.reduce((s, b) => s + (b.balanceAmount || 0), 0);
    const totalInterest = periodBills.reduce((s, b) => s + (b.currentInterest || b.interestAmount || 0), 0);
    const totalSinking = periodBills.reduce((s, b) => {
      const c = b.charges instanceof Map ? Object.fromEntries(b.charges) : (b.charges || {});
      return s + parseFloat(c.sinkingFund || c["Sinking Fund"] || 0);
    }, 0);
    const totalRepair = periodBills.reduce((s, b) => {
      const c = b.charges instanceof Map ? Object.fromEntries(b.charges) : (b.charges || {});
      return s + parseFloat(c.repairFund || c["Repair Fund"] || c["Repair & Maintenance"] || 0);
    }, 0);
    const allPaid = generated && periodBills.every((b) => b.status === "Paid");
    const allUnpaid = generated && periodBills.every((b) => ["Unpaid", "Overdue"].includes(b.status));
    const partial = generated && !allPaid && !allUnpaid;
    const paidCount = periodBills.filter((b) => b.status === "Paid").length;
    const unpaidCount = periodBills.filter((b) => ["Unpaid", "Overdue", "Partial"].includes(b.status)).length;
    // Opening balance = sum of openingPrincipal + openingInterest seeded into this period's bills
    const openingPrincipal = periodBills.reduce((s, b) => s + (b.openingPrincipal || 0), 0);
    const openingInterest = periodBills.reduce((s, b) => s + (b.openingInterest || 0), 0);
    const openingTotal = openingPrincipal + openingInterest;
    const totalExpenditure = +(expenseByPeriod[pid] || 0).toFixed(2);
    return {
      year, month0, label, periodId: pid,
      generated, billCount: periodBills.length,
      totalBilled: +totalBilled.toFixed(2),
      totalPaid: +totalPaid.toFixed(2),
      totalAdvance: +totalAdvance.toFixed(2),
      totalPending: +totalPending.toFixed(2),
      totalInterest: +totalInterest.toFixed(2),
      totalSinking: +totalSinking.toFixed(2),
      totalRepair: +totalRepair.toFixed(2),
      openingPrincipal: +openingPrincipal.toFixed(2),
      openingInterest: +openingInterest.toFixed(2),
      openingTotal: +openingTotal.toFixed(2),
      allPaid, partial, allUnpaid,
      paidCount, unpaidCount,
      totalExpenditure,
      netCollected: +(totalPaid - totalExpenditure).toFixed(2),
      isMarch: month0 === 2,
    };
  });
  // FY-wide aggregates
  let totalBilled = 0, totalCollected = 0, totalPending = 0, totalInterest = 0, totalSinking = 0, totalRepair = 0, totalExpenditure = 0;
  for (const row of timeline) {
    totalBilled += row.totalBilled;
    totalCollected += row.totalPaid;
    totalPending += row.totalPending;
    totalInterest += row.totalInterest;
    totalSinking += row.totalSinking;
    totalRepair += row.totalRepair;
    totalExpenditure += row.totalExpenditure;
  }
  const priorPending = priorBills.reduce((s, b) => s + (b.balanceAmount || 0), 0);
  // Interest still outstanding = unpaid interest on bills not yet fully cleared
  const interestOutstanding = bills
    .filter(b => b.status !== "Paid")
    .reduce((s, b) => s + (b.billInterestBalance ?? b.interestBalance ?? 0), 0);
  // ── Closing scenario analysis ──────────────────────────────────────────
  // Find last generated month, last fully-paid month
  const generatedMonths = timeline.filter((m) => m.generated);
  const lastGenerated = generatedMonths[generatedMonths.length - 1] || null;
  const paidMonths = timeline.filter((m) => m.generated && m.allPaid);
  const lastFullyPaid = paidMonths[paidMonths.length - 1] || null;
  const marchRow = timeline.find((m) => m.isMarch);
  const firstGenerated = generatedMonths[0] || null;
  // What scenario are we in?
  let closingScenario;
  if (!generatedMonths.length) {
    closingScenario = "NO_BILLS";
  } else if (marchRow?.generated && marchRow?.allPaid) {
    closingScenario = "MARCH_PAID";           // FY closed cleanly
  } else if (marchRow?.generated && !marchRow?.allPaid) {
    closingScenario = "MARCH_GENERATED_UNPAID"; // March bill exists, not fully paid
  } else {
    closingScenario = "MID_YEAR";             // Haven't reached March yet
  }
  // Mark months before the first generated bill as "opening balance" months (not real billing gaps)
  const firstGenIdx = firstGenerated ? timeline.findIndex((m) => m.periodId === firstGenerated.periodId) : -1;
  for (let i = 0; i < timeline.length; i++) {
    timeline[i].isOpeningMonth = firstGenIdx > 0 && i < firstGenIdx;
  }
  // Next to generate = first ungenerated month AFTER the last generated one (not before)
  const lastGenIdx = lastGenerated ? timeline.findIndex((m) => m.periodId === lastGenerated.periodId) : -1;
  const nextToGenerate = lastGenIdx >= 0
    ? timeline.slice(lastGenIdx + 1).find((m) => !m.generated) || null
    : null;
  // Available FY years for picker
  const yearGroups = await Bill.aggregate([
    { $match: { societyId: sid } },
    { $group: { _id: "$billYear" } },
    { $sort: { _id: -1 } },
    { $limit: 10 },
  ]);
  const billYears = yearGroups.map((g) => g._id).filter(Boolean);
  // Convert billYears to FY start years
  const availableFYs = [...new Set(billYears.map((y) => {
    // If bills exist for month >= 3 (Apr+) in year y, that's FY y
    // If bills exist for month <= 2 (Jan-Mar) in year y, that's FY y-1
    return [y, y - 1];
  }).flat())].sort((a, b) => b - a).slice(0, 8);
  return NextResponse.json({
    success: true,
    fy,
    fyLabel: `Apr ${fy} – Mar ${fy + 1}`,
    summary: {
      totalBilled: +totalBilled.toFixed(2),
      totalCollected: +totalCollected.toFixed(2),
      totalPending: +totalPending.toFixed(2),
      priorPending: +priorPending.toFixed(2),
      totalInterest: +totalInterest.toFixed(2),
      interestOutstanding: +interestOutstanding.toFixed(2),
      totalSinking: +totalSinking.toFixed(2),
      totalRepair: +totalRepair.toFixed(2),
      totalExpenditure: +totalExpenditure.toFixed(2),
      netPosition: +(totalCollected - totalExpenditure).toFixed(2),
      expenseCount: expenses.length,
      expenseByCategory,
      billCount: bills.length,
    },
    timeline,
    closing: {
      scenario: closingScenario,
      firstGenerated: firstGenerated ? { label: firstGenerated.label, periodId: firstGenerated.periodId } : null,
      lastGenerated: lastGenerated ? { label: lastGenerated.label, periodId: lastGenerated.periodId, allPaid: lastGenerated.allPaid, totalPending: lastGenerated.totalPending } : null,
      lastFullyPaid: lastFullyPaid ? { label: lastFullyPaid.label, periodId: lastFullyPaid.periodId } : null,
      nextToGenerate: nextToGenerate ? { label: nextToGenerate.label, periodId: nextToGenerate.periodId } : null,
      marchStatus: marchRow ? {
        generated: marchRow.generated,
        allPaid: marchRow.allPaid,
        partial: marchRow.partial,
        totalPending: marchRow.totalPending,
        totalPaid: marchRow.totalPaid,
        totalBilled: marchRow.totalBilled,
        paidCount: marchRow.paidCount,
        unpaidCount: marchRow.unpaidCount,
        billCount: marchRow.billCount,
      } : null,
    },
    availableFYs,
  });
}