import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorizeAny } from "@/lib/rbac/authorize";
import Bill from "@/models/Bill";
import FinancialYear from "@/models/FinancialYear";
import Society from "@/models/Society";
import { twoDp } from "@/lib/billing/paymentApplication";

// Read-only snapshot the Year Runner opens with: which Financial Year covers
// the run, and what is REALLY in the Bill collection for each of its twelve
// months. The page never keeps its own copy of "which month is done" — a
// month is done when its bills exist, whoever generated or imported them.

// Mid-year probe date, so the lookup does not depend on whether the FY's
// startDate was saved as local or UTC midnight (a 1 April 00:00 IST start is
// 31 March 18:30 UTC, and the other way round a UTC start misses 1 April IST).
function probeDate(startYear) {
  return new Date(Date.UTC(startYear, 8, 15, 12));
}

export async function GET(request) {
  try {
    const gate = await authorizeAny(request, ["billing.fyRunner.view", "billing.bill.view"]);
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const { societyId } = decoded;

    const { searchParams } = new URL(request.url);
    const startYear = Number(searchParams.get("startYear")) || 2026;
    const billSeries = searchParams.get("billSeries") === "COMMERCIAL" ? "COMMERCIAL" : "RESIDENTIAL";

    const periodIds = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(startYear, 3 + i, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    });

    const probe = probeDate(startYear);
    const [financialYears, society, rows] = await Promise.all([
      FinancialYear.find({ societyId, isDeleted: false })
        .select("label startDate endDate status")
        .sort({ startDate: 1 })
        .lean(),
      Society.findById(societyId).select("name onboarding").lean(),
      Bill.aggregate([
        {
          $match: {
            societyId: new mongoose.Types.ObjectId(String(societyId)),
            billSeries,
            billPeriodId: { $in: periodIds },
            isDeleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: "$billPeriodId",
            count: { $sum: 1 },
            charges: { $sum: { $ifNull: ["$currentBillTotal", { $add: [{ $ifNull: ["$currentCharges", 0] }, { $ifNull: ["$currentInterest", 0] }] }] } },
            due: { $sum: { $ifNull: ["$totalAmount", 0] } },
            paid: { $sum: { $ifNull: ["$amountPaid", 0] } },
            open: { $sum: { $cond: [{ $in: ["$status", ["Unpaid", "Partial", "Overdue"]] }, 1, 0] } },
            imported: {
              $sum: {
                $cond: [
                  { $or: [{ $eq: ["$isHistoricalArchive", true] }, { $eq: ["$importedFrom", "BulkImport"] }, { $eq: ["$isLocked", true] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const fy =
      financialYears.find((f) => new Date(f.startDate) <= probe && new Date(f.endDate) >= probe) || null;

    const byPeriod = new Map(rows.map((r) => [r._id, r]));
    const months = periodIds.map((periodId) => {
      const r = byPeriod.get(periodId);
      return {
        periodId,
        count: r?.count || 0,
        charges: twoDp(r?.charges || 0),
        due: twoDp(r?.due || 0),
        paid: twoDp(r?.paid || 0),
        open: r?.open || 0,
        imported: r?.imported || 0,
      };
    });

    return NextResponse.json({
      success: true,
      societyName: society?.name || "",
      joinPeriodId: society?.onboarding?.joinPeriodId || null,
      billHistoryPeriods: society?.onboarding?.billHistoryPeriods || [],
      financialYear: fy,
      financialYears,
      months,
    });
  } catch (error) {
    console.error("fy-runner/status error:", error);
    return NextResponse.json({ error: "Internal server error", details: error.message }, { status: 500 });
  }
}
