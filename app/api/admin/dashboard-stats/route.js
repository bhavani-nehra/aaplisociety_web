import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Bill from "@/models/Bill";
// Registers the User schema in this lambda so populate("createdBy") cannot
// throw MissingSchemaError (was returning 500 on ledger/payment fetches).
import User from "@/models/User";
void User;
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import mongoose from "mongoose";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { authorize } from "@/lib/rbac/authorize";
import cache from "@/lib/cache";
export async function GET(request) {
  const gate = await authorize(request, "dashboard.stats.view");
  if (!gate.ok) return gate.response;
  try {
    // Role gate BEFORE any DB work (test 02 critical: a Member token used to
    // receive this society's full financials with HTTP 200).
    // Admin + Secretary always; Accountant/Auditor included since they already
    // work with the books — trim if your ARD says otherwise. Member: never.
    const gate = requireRoles(request, [...SOCIETY_ADMIN_ROLES, "Accountant", "Auditor"]);
    if (!gate.valid) return gate; // 401/403, nothing else runs
    const decoded = gate.user;
    await connectDB();
    // Cast societyId string → ObjectId for aggregate pipelines
    const { societyId: societyIdStr } = decoded;
    if (!societyIdStr || !mongoose.Types.ObjectId.isValid(societyIdStr)) {
      return NextResponse.json({ error: "Invalid society context" }, { status: 400 });
    }
    const societyId = new mongoose.Types.ObjectId(societyIdStr);
    const { searchParams } = new URL(request.url);
    const month = parseInt(searchParams.get("month") || "0"); // 1-12, 0 = all
    const year = parseInt(searchParams.get("year") || "0");   // 0 = all
    const fyYear = parseInt(searchParams.get("fyYear") || String(new Date().getFullYear()));
    // FY = Apr fyYear → Mar fyYear+1
    const fyStart = new Date(fyYear, 3, 1);   // Apr 1
    const fyEnd = new Date(fyYear + 1, 2, 31, 23, 59, 59, 999); // Mar 31
    // Month-specific bill filter (billMonth is 0-indexed)
    // societyId is already cast to ObjectId — safe for both find() and aggregate()
    const monthBillFilter = { societyId, isDeleted: { $ne: true } };
    if (month && year) {
      monthBillFilter.billMonth = month - 1;
      monthBillFilter.billYear = year;
    } else if (year) {
      monthBillFilter.billYear = year;
    }
    // Cached in Upstash per society + filters. Fresh for 30s, then served
    // stale-while-revalidate for up to 10 min. Any bill/payment/member change
    // clears it (see invalidateDashboardFor in lib/cache.js).
    const cacheKey = `dash:stats:${societyIdStr}:${month}:${year}:${fyYear}`;
    const compute = async () => {
    // ── Parallel aggregations ────────────────────────────────────────────────
    const [
      totalMembers,
      // All-time outstanding (unpaid bills across all periods)
      outstandingAgg,
      // Month/period stats from bills
      periodBillsAgg,
      // FY collections from transactions
      fyCollectionsAgg,
      // FY billed from bills
      fyBilledAgg,
      // Month collections from transactions
      monthCollectionsAgg,
      // Last 6 months trend (bills generated)
      monthlyTrendAgg,
      // Recent payments
      recentPayments,
      // Payment mode breakdown for selected period
      paymentModeAgg,
    ] = await Promise.all([
      Member.countDocuments({ societyId, isDeleted: { $ne: true } }),
      // ALL outstanding (unpaid/partial/overdue) across all periods
      Bill.aggregate([
        {
          $match: {
            societyId,
            status: { $in: ["Unpaid", "Partial", "Overdue", "Scheduled"] },
            isDeleted: { $ne: true },
            isHistoricalArchive: { $ne: true },
          },
        },
        // Every bill opens on the previous bill's closing, so an older open bill's
        // balance is already inside the newest one. What a unit owes is its
        // NEWEST open bill's balance — summing all of them counted the same
        // rupees once per open month.
        { $sort: { billYear: -1, billMonth: -1 } },
        {
          $group: {
            _id: { $ifNull: ["$shopId", "$memberId"] },
            principal: { $first: "$principalBalance" },
            interest: { $first: "$interestBalance" },
            balance: { $first: "$balanceAmount" },
            openBills: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: null,
            totalPrincipal: { $sum: "$principal" },
            totalInterest: { $sum: "$interest" },
            totalBalance: { $sum: "$balance" },
            count: { $sum: "$openBills" },
          },
        },
      ]),
      // Bills for selected month/period
      Bill.aggregate([
        { $match: monthBillFilter },
        {
          $group: {
            _id: null,
            totalBilled: { $sum: "$totalAmount" },
            totalCollected: { $sum: "$amountPaid" },
            totalBalance: { $sum: "$balanceAmount" },
            totalPrincipalBalance: { $sum: "$principalBalance" },
            totalInterestBalance: { $sum: "$interestBalance" },
            totalInterestCharged: { $sum: "$interestAmount" },
            paidCount: {
              $sum: { $cond: [{ $eq: ["$status", "Paid"] }, 1, 0] },
            },
            unpaidCount: {
              $sum: {
                $cond: [
                  { $in: ["$status", ["Unpaid", "Overdue", "Partial"]] },
                  1,
                  0,
                ],
              },
            },
            totalCount: { $sum: 1 },
          },
        },
      ]),
      // FY collections (Credit transactions)
      Transaction.aggregate([
        {
          $match: {
            societyId,
            type: "Credit",
            category: { $in: ["Payment", "Adjustment"] },
            isReversed: { $ne: true },
            date: { $gte: fyStart, $lte: fyEnd },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
      ]),
      // FY billed
      Bill.aggregate([
        {
          $match: {
            societyId,
            isDeleted: { $ne: true },
            $expr: {
              $and: [
                {
                  $or: [
                    // Apr-Dec of fyYear: billMonth 3-11
                    {
                      $and: [
                        { $eq: ["$billYear", fyYear] },
                        { $gte: ["$billMonth", 3] },
                      ],
                    },
                    // Jan-Mar of fyYear+1: billMonth 0-2
                    {
                      $and: [
                        { $eq: ["$billYear", fyYear + 1] },
                        { $lte: ["$billMonth", 2] },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            totalBilled: { $sum: { $add: [{ $ifNull: ["$currentCharges", 0] }, { $ifNull: ["$currentInterest", 0] }] } },
            totalCollected: { $sum: "$amountPaid" },
            totalBalance: { $sum: "$balanceAmount" },
          },
        },
      ]),
      // Month collections
      (() => {
        const txFilter = {
          societyId,
          type: "Credit",
          category: { $in: ["Payment", "Adjustment"] },
          isReversed: { $ne: true },
        };
        if (month && year) {
          const mStart = new Date(year, month - 1, 1);
          const mEnd = new Date(year, month, 0, 23, 59, 59, 999);
          txFilter.date = { $gte: mStart, $lte: mEnd };
        }
        return Transaction.aggregate([
          { $match: txFilter },
          {
            $group: {
              _id: null,
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
        ]);
      })(),
      // Last 6 months bill trend (bills generated, month by month)
      Bill.aggregate([
        {
          $match: {
            societyId,
            isDeleted: { $ne: true },
          },
        },
        {
          $group: {
            _id: { billYear: "$billYear", billMonth: "$billMonth" },
            totalBilled: { $sum: { $add: [{ $ifNull: ["$currentCharges", 0] }, { $ifNull: ["$currentInterest", 0] }] } },
            totalCollected: { $sum: "$amountPaid" },
            totalBalance: { $sum: "$balanceAmount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.billYear": -1, "_id.billMonth": -1 } },
        { $limit: 6 },
      ]),
      // Recent 10 payments
      Transaction.find({
        societyId,
        type: "Credit",
        category: { $in: ["Payment", "Adjustment"] },
        isReversed: { $ne: true },
      })
        .populate("memberId", "flatNo wing ownerName")
        .populate("createdBy", "name")
        .sort({ date: -1, createdAt: -1 })
        .limit(10)
        .lean(),
      // Payment mode breakdown for period
      (() => {
        const txFilter = {
          societyId,
          type: "Credit",
          category: { $in: ["Payment", "Adjustment"] },
          isReversed: { $ne: true },
        };
        if (month && year) {
          const mStart = new Date(year, month - 1, 1);
          const mEnd = new Date(year, month, 0, 23, 59, 59, 999);
          txFilter.date = { $gte: mStart, $lte: mEnd };
        }
        return Transaction.aggregate([
          { $match: txFilter },
          {
            $group: {
              _id: "$paymentMode",
              total: { $sum: "$amount" },
              count: { $sum: 1 },
            },
          },
          { $sort: { total: -1 } },
        ]);
      })(),
    ]);
    const outstanding = outstandingAgg[0] || {
      totalPrincipal: 0,
      totalInterest: 0,
      totalBalance: 0,
      count: 0,
    };
    const period = periodBillsAgg[0] || {
      totalBilled: 0,
      totalCollected: 0,
      totalBalance: 0,
      totalPrincipalBalance: 0,
      totalInterestBalance: 0,
      totalInterestCharged: 0,
      paidCount: 0,
      unpaidCount: 0,
      totalCount: 0,
    };
    const fyBilled = fyBilledAgg[0] || {
      totalBilled: 0,
      totalCollected: 0,
      totalBalance: 0,
    };
    const fyCollections = fyCollectionsAgg[0] || { total: 0, count: 0 };
    const monthCollections = monthCollectionsAgg[0] || { total: 0, count: 0 };
    const collectionRate =
      period.totalBilled > 0
        ? Math.round((period.totalCollected / period.totalBilled) * 100)
        : 0;
    const fyCollectionRate =
      fyBilled.totalBilled > 0
        ? Math.round((fyBilled.totalCollected / fyBilled.totalBilled) * 100)
        : 0;
    // Sort trend ascending for chart
    const trend = [...monthlyTrendAgg].reverse().map((t) => ({
      billYear: t._id.billYear,
      billMonth: t._id.billMonth,
      label: new Date(t._id.billYear, t._id.billMonth).toLocaleDateString(
        "en-IN",
        { month: "short", year: "2-digit" },
      ),
      totalBilled: t.totalBilled,
      totalCollected: t.totalCollected,
      totalBalance: t.totalBalance,
      count: t.count,
    }));
    return {
      success: true,
      totalMembers,
      outstanding: {
        principal: parseFloat(outstanding.totalPrincipal?.toFixed(2) || 0),
        interest: parseFloat(outstanding.totalInterest?.toFixed(2) || 0),
        total: parseFloat(outstanding.totalBalance?.toFixed(2) || 0),
        unpaidBillCount: outstanding.count,
      },
      period: {
        totalBilled: parseFloat(period.totalBilled?.toFixed(2) || 0),
        totalCollected: parseFloat(period.totalCollected?.toFixed(2) || 0),
        totalBalance: parseFloat(period.totalBalance?.toFixed(2) || 0),
        principalBalance: parseFloat(period.totalPrincipalBalance?.toFixed(2) || 0),
        interestBalance: parseFloat(period.totalInterestBalance?.toFixed(2) || 0),
        interestCharged: parseFloat(period.totalInterestCharged?.toFixed(2) || 0),
        paidCount: period.paidCount,
        unpaidCount: period.unpaidCount,
        totalCount: period.totalCount,
        collectionRate,
      },
      fy: {
        year: fyYear,
        label: `FY ${fyYear}-${String(fyYear + 1).slice(-2)}`,
        totalBilled: parseFloat(fyBilled.totalBilled?.toFixed(2) || 0),
        totalCollected: parseFloat(fyBilled.totalCollected?.toFixed(2) || 0),
        // what is owed now (newest open bill per unit), not a sum of every month's cumulative balance
        totalBalance: parseFloat(outstanding.totalBalance?.toFixed(2) || 0),
        collectionRate: fyCollectionRate,
        collectionsFromTx: parseFloat(fyCollections.total?.toFixed(2) || 0),
      },
      monthCollections: parseFloat(monthCollections.total?.toFixed(2) || 0),
      trend,
      recentPayments: recentPayments.map((p) => ({
        _id: p._id?.toString(),
        date: p.date,
        amount: p.amount,
        paymentMode: p.paymentMode,
        description: p.description,
        billPeriodId: p.billPeriodId,
        memberId: p.memberId
          ? {
              flatNo: p.memberId.flatNo,
              wing: p.memberId.wing,
              ownerName: p.memberId.ownerName,
            }
          : null,
        createdBy: p.createdBy?.name || null,
      })),
      paymentModes: paymentModeAgg.map((m) => ({
        mode: m._id || "Unknown",
        total: m.total,
        count: m.count,
      })),
    };
    };
    const payload = await cache.getOrSetSWR(cacheKey, compute, {
      softTtlSeconds: 30,
      hardTtlSeconds: 600,
    });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Dashboard stats error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}