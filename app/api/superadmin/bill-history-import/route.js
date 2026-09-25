/**
 * POST /api/superadmin/bill-history-import
 * Receives pre-validated bill history data (client has already verified calculations).
 * Saves all bills to DB as historical records for audit.
 *
 * Body: { societyId, bills: [{ periodId, memberId, wing, flatNo, ...billFields }] }
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import cache from "@/lib/cache";
import Bill from "@/models/Bill";
import Society from "@/models/Society";
import AuditReport from "@/models/AuditReport";
import mongoose from "mongoose";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { validateBillInvariants } from "@/lib/billing/invariants";
import { buildHistoricalBillFields } from "@/lib/billing/historicalBill";
export async function POST(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;
  const body = await request.json();
  const { societyId, bills, joinPeriodId } = body;
  if (!societyId || !Array.isArray(bills) || !bills.length) {
    return NextResponse.json({ error: "societyId and bills[] required" }, { status: 400 });
  }
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(societyId)) {
    return NextResponse.json({ error: "Invalid societyId" }, { status: 400 });
  }
  const sid = new mongoose.Types.ObjectId(societyId);
  const society = await Society.findById(sid).lean();
  if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });
  // Build member lookup: wingFlat → member
  const members = await Member.find({ societyId: sid, isDeleted: { $ne: true } })
    .select("_id flatNo wing")
    .lean();
  const memberMap = {};
  for (const m of members) {
    const key = `${(m.wing || "").toLowerCase()}-${m.flatNo.toLowerCase()}`;
    memberMap[key] = m;
    // Also support no-wing key
    memberMap[m.flatNo.toLowerCase()] = m;
  }
  // Check for existing bills in these periods (prevent double import)
  const periodIds = [...new Set(bills.map((b) => b.periodId))];
  const existing = await Bill.countDocuments({
    societyId: sid,
    billPeriodId: { $in: periodIds },
    importedFrom: "BulkImport",
    isDeleted: { $ne: true },
  });
  if (existing > 0) {
    return NextResponse.json({
      error: `Historical bills already imported for periods: ${periodIds.join(", ")}. Delete them first.`,
    }, { status: 409 });
  }
  const batchId = new mongoose.Types.ObjectId().toHexString();
  const created = [];
  const errors = [];
  for (const b of bills) {
    const wingFlat = b.wingFlat || `${b.wing || ""}-${b.flatNo}`;
    const lookupKey = wingFlat.toLowerCase();
    const member = memberMap[lookupKey] || memberMap[lookupKey.split("-").slice(1).join("-")];
    if (!member) {
      errors.push({ periodId: b.periodId, wingFlat, error: "Member not found" });
      continue;
    }
    const [billYear, billMonthStr] = b.periodId.split("-").map(Number);
    const billMonth = billMonthStr - 1; // 0-indexed
    // Indian FY: Apr(4)–Mar(3); month >= 4 → FY starts this year, else previous year
    const fyStart = billMonthStr >= 4 ? billYear : billYear - 1;
    const importedFinancialYear = `${fyStart}-${fyStart + 1}`;
    const dueDate = new Date(billYear, billMonth + 1, 0); // last day of month
    const charges = new Map();
    const CHARGE_COLS = [
      "Maintenance Charges", "Sinking Fund", "Repair Fund",
      "Water Charges", "Security Charges", "Electricity Charges",
      "Open Parking - Two Wheeler", "Open Parking - Four Wheeler",
      "Covered Parking - Two Wheeler", "Covered Parking - Four Wheeler",
    ];
    for (const col of CHARGE_COLS) {
      const val = parseFloat(b[col] || 0);
      if (val > 0) charges.set(col, val);
    }
    const currentCharges = parseFloat(b.CurrentCharges || 0);
    const openingPrincipal = parseFloat(b.OpeningPrincipal || 0);
    const openingInterest = parseFloat(b.OpeningInterest || 0);
    const currentInterest = parseFloat(b.CurrentInterest || 0);
    const billPrincipal = parseFloat(b.BillPrincipal || 0);
    const billInterest = parseFloat(b.BillInterest || 0);
    const totalBillDue = parseFloat(b.TotalBillDue || 0);
    const amountPaid = parseFloat(b.AmountPaid || 0);
    const advanceCredit = parseFloat(b.AdvanceCredit || 0);
    const remainingDue = parseFloat(b.RemainingDue || 0);
    const alreadyPaid = parseFloat(b.AlreadyPaid || 0);
    // Historical bills are ALWAYS marked Paid with zero live balances.
    // Actual unpaid debt at system entry is captured in Member.openingPrincipal / openingInterest.
    // Keeping these as Unpaid/Partial would cause bill generation to double-count the debt.
    const status = "Paid";
    const closingPrincipal = 0;
    const closingInterest = 0;
    try {
      // Ledger V2 §6: even a pre-validated client import must satisfy the same
      // financial invariants as an engine-generated bill before it's trusted
      // enough to persist. This is NOT routed through generateBill() — these
      // are historical paper records with no BillingHeads/engine context, not
      // a live generation — but the numbers still must reconcile.
      const chargesObj = Object.fromEntries(charges);
      validateBillInvariants({
        openingPrincipal,
        openingInterest,
        currentCharges,
        currentInterest,
        totalBillDue,
        closingPrincipal,
        closingInterest,
        balanceAmount: 0,
        charges: chargesObj,
      });
      const bill = new Bill(
        buildHistoricalBillFields({
          societyId: sid,
          memberId: member._id,
          periodId: b.periodId,
          billMonth,
          billYear,
          importedFinancialYear,
          dueDate,
          charges,
          openingPrincipal,
          openingInterest,
          currentCharges,
          currentInterest,
          billPrincipal,
          billInterest,
          totalBillDue,
          advanceCredit,
          batchId,
          remarks: b.Remarks || "",
        }),
      );
      await bill.save();
      created.push({ periodId: b.periodId, wingFlat, billId: bill._id });
    } catch (err) {
      errors.push({ periodId: b.periodId, wingFlat, error: err.message });
    }
  }
  // Mark society onboarding complete
  await Society.findByIdAndUpdate(sid, {
    "onboarding.billHistoryImported": true,
    "onboarding.billHistoryImportedAt": new Date(),
    "onboarding.billHistoryPeriods": periodIds,
    ...(joinPeriodId ? { "onboarding.joinPeriodId": joinPeriodId } : {}),
  });
  // Create AuditReport record for superadmin audit-reports page
  try {
    const [joinYear, joinMonthStr] = (joinPeriodId || periodIds[periodIds.length - 1]).split("-").map(Number);
    const auditFrom = periodIds[0].split("-").map(Number);
    const auditTo = periodIds[periodIds.length - 1].split("-").map(Number);
    const memberCount = [...new Set(bills.map((b) => b.wingFlat || `${b.wing}-${b.flatNo}`))].length;
    await AuditReport.findOneAndUpdate(
      { societyId: sid },
      {
        societyId: sid,
        societyName: society.name,
        submittedBy: sid, // no user context in superadmin route; use societyId as placeholder
        submittedAt: new Date(),
        joinMonth: joinMonthStr,
        joinYear,
        auditFromMonth: auditFrom[1],
        auditFromYear: auditFrom[0],
        auditToMonth: auditTo[1],
        auditToYear: auditTo[0],
        totalMonthsRequired: periodIds.length,
        validation: {
          totalMembersExpected: memberCount,
          totalMembersFound: memberCount,
          totalRowsExpected: bills.length,
          totalRowsFound: created.length,
          passed: errors.length === 0,
          errors: errors.map((e) => `${e.periodId} ${e.wingFlat}: ${e.error}`),
          warnings: [],
        },
        status: "Approved",
        batchId,
      },
      { upsert: true, new: true },
    );
  } catch (auditErr) {
    console.error("[bill-history-import] AuditReport create failed:", auditErr.message);
  }
  if (created.length > 0) {
    await cache.delPattern(`v1:bills:${sid}:member:*`);
    await cache.delPattern(`v1:ledger:${sid}:member:*`);
  }
  return NextResponse.json({
    success: true,
    created: created.length,
    errors: errors.length,
    errorDetails: errors,
    batchId,
    periods: periodIds,
  });
}
// GET — auto-detect joinPeriodId from earliest bill for this society
export async function GET(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;
  const { searchParams } = new URL(request.url);
  const societyId = searchParams.get("societyId");
  if (!societyId) return NextResponse.json({ error: "societyId required" }, { status: 400 });
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(societyId)) {
    return NextResponse.json({ error: "Invalid societyId" }, { status: 400 });
  }
  const sid = new mongoose.Types.ObjectId(societyId);
  // First bill = earliest billYear+billMonth
  const firstBill = await Bill.findOne({ societyId: sid, isDeleted: { $ne: true } })
    .sort({ billYear: 1, billMonth: 1 })
    .select("billPeriodId billYear billMonth")
    .lean();
  if (!firstBill) {
    return NextResponse.json({ joinPeriodId: null, source: "no_bills" });
  }
  const joinPeriodId = firstBill.billPeriodId;
  // Persist it so we don't re-detect next time
  await Society.findByIdAndUpdate(sid, { "onboarding.joinPeriodId": joinPeriodId });
  return NextResponse.json({ joinPeriodId, source: "first_bill" });
}
// PATCH — manually set joinPeriodId
export async function PATCH(request) {
  const authResult = validateAdminRequest(request);
  if (!authResult?.valid) return authResult;
  const { societyId, joinPeriodId } = await request.json();
  if (!societyId || !joinPeriodId) {
    return NextResponse.json({ error: "societyId and joinPeriodId required" }, { status: 400 });
  }
  await connectDB();
  if (!mongoose.Types.ObjectId.isValid(societyId)) {
    return NextResponse.json({ error: "Invalid societyId" }, { status: 400 });
  }
  const sid = new mongoose.Types.ObjectId(societyId);
  await Society.findByIdAndUpdate(sid, { "onboarding.joinPeriodId": joinPeriodId });
  return NextResponse.json({ success: true });
}
