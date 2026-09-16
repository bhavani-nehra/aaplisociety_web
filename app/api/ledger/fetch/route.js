import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Transaction from "@/models/Transaction";
// Registers the User schema in this lambda so populate("createdBy") cannot
// throw MissingSchemaError (was returning 500 on ledger/payment fetches).
import User from "@/models/User";
void User;
import Member from "@/models/Member";
import cache from "@/lib/cache";
export async function GET(request) {
  try {
    const gate = await authorize(request, "finance.ledger.view");
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
    const { searchParams } = new URL(request.url);
    // Base query
    const query = { societyId: decoded.societyId };
    // Quick filters
    const memberId = searchParams.get("memberId");
    const category = searchParams.get("category");
    const txnType = searchParams.get("type");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const billPeriod = searchParams.get("billPeriod");
    const filterMonth = searchParams.get("month"); // NEW: 1-12
    const filterYear = searchParams.get("year"); // NEW: 2025, 2024, etc.
    // Advanced filters
    const wing = searchParams.get("wing");
    const roomNoPattern = searchParams.get("roomNo");
    const balanceStatus = searchParams.get("balanceStatus");
    const minAmount = searchParams.get("minAmount");
    const maxAmount = searchParams.get("maxAmount");
    const paymentMode = searchParams.get("paymentMode");
    const financialYear = searchParams.get("financialYear");
    const createdBy = searchParams.get("createdBy");
    const includeReversed = searchParams.get("includeReversed") === "true";
    const onlyReversed = searchParams.get("onlyReversed") === "true";
    // Pagination & grouping
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "500");
    const groupBy = searchParams.get("groupBy"); // member | category | date
    const sortBy = searchParams.get("sortBy") || "date";
    const sortOrder = searchParams.get("sortOrder") === "asc" ? 1 : -1;
    // Apply filters
    // Member filter (single or multiple)
    if (memberId && memberId !== "all") {
      if (memberId.includes(",")) {
        query.memberId = { $in: memberId.split(",") };
      } else {
        query.memberId = memberId;
      }
    }
    if (category && category !== "all") {
      query.category = category;
    }
    if (txnType && txnType !== "all") {
      query.type = txnType;
    }
    // If month/year filters are used, they override startDate/endDate
    if (filterMonth && filterYear) {
      // Both selected: specific month of specific year
      const year = parseInt(filterYear);
      const month = parseInt(filterMonth) - 1; // 0-indexed
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
      query.date = { $gte: monthStart, $lte: monthEnd };
    } else if (filterYear && !filterMonth) {
      // Only year selected: whole year
      const year = parseInt(filterYear);
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
      query.date = { $gte: yearStart, $lte: yearEnd };
    } else if (filterMonth && !filterYear) {
      // Only month selected: that month across ALL years
      // Use $expr to match month from date field
      const month = parseInt(filterMonth);
      query.$expr = {
        $eq: [{ $month: "$date" }, month],
      };
    } else {
      // Use startDate/endDate if no month/year filter
      if (startDate) {
        query.date = { ...query.date, $gte: new Date(startDate) };
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date = { ...query.date, $lte: end };
      }
    }
    if (billPeriod && billPeriod !== "all") {
      query.billPeriodId = billPeriod;
    }
    // Advanced filters
    if (paymentMode && paymentMode !== "all") {
      query.paymentMode = paymentMode;
    }
    if (financialYear && financialYear !== "all") {
      query.financialYear = financialYear;
    }
    if (createdBy && createdBy !== "all") {
      query.createdBy = createdBy;
    }
    if (onlyReversed) {
      query.isReversed = true;
    } else if (!includeReversed) {
      query.isReversed = false;
    }
    if (minAmount || maxAmount) {
      query.amount = {};
      if (minAmount) query.amount.$gte = parseFloat(minAmount);
      if (maxAmount) query.amount.$lte = parseFloat(maxAmount);
    }
    // Wing / Room filters (require member lookup for advanced cases)
    let memberFilter = null;
    if (wing || roomNoPattern) {
      memberFilter = { societyId: decoded.societyId };
      if (wing && wing !== "all") {
        if (wing.includes(",")) {
          memberFilter.wing = { $in: wing.split(",") };
        } else {
          memberFilter.wing = wing;
        }
      }
      if (roomNoPattern) {
        // Member.js has no `roomNo` field — the real path is `flatNo`. This
        // filter (and the populate below) queried/selected a field that
        // doesn't exist on the schema, so it silently matched nothing / came
        // back undefined rather than erroring.
        if (roomNoPattern.includes("-")) {
          // Range: 1310-1350
          const [start, end] = roomNoPattern
            .split("-")
            .map((n) => parseInt(n.trim()));
          memberFilter.flatNo = { $gte: start, $lte: end };
        } else if (roomNoPattern.includes("*")) {
          // Starts with: 13*
          const escaped = roomNoPattern
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\\\*/g, ""); // un-escape the wildcard token itself, then drop it
          memberFilter.flatNo = new RegExp(`^${escaped}`);
        } else {
          memberFilter.flatNo = roomNoPattern;
        }
      }
      const matchingMembers = await Member.find(memberFilter)
        .select("_id")
        .lean();
      const memberIds = matchingMembers.map((m) => m._id);
      if (memberIds.length > 0) {
        query.memberId = { $in: memberIds };
      } else {
        // No matching members, return empty
        return NextResponse.json({
          success: true,
          transactions: [],
          summary: {
            totalTransactions: 0,
            totalDebit: 0,
            totalCredit: 0,
            openingBalance: 0,
            netBalance: 0,
            balanceType: "DR",
            currentPage: page,
            totalPages: 0,
          },
          groupedData: null,
        });
      }
    }
    // Fetch transactions with sorting
    const sortField =
      sortBy === "amount"
        ? "amount"
        : sortBy === "member"
          ? "memberId"
          : "date";
    // Only cache simple single-member full ledger fetches
    const isSimpleFetch =
      memberId &&
      memberId !== "all" &&
      !startDate &&
      !endDate &&
      !filterMonth &&
      page === 1;
    const cacheKey = isSimpleFetch
      ? `ledger:fetch:${decoded.societyId}:${memberId}`
      : null;
    if (cacheKey) {
      const cached = await cache.get(cacheKey);
      if (cached) return NextResponse.json(cached);
    }
    const transactions = await Transaction.find(query)
      .populate("memberId", "flatNo wing ownerName carpetAreaSqft builtUpAreaSqft")
      .populate("createdBy", "name email role")
      .sort({ [sortField]: sortOrder, createdAt: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const totalCount = await Transaction.countDocuments(query);
    // Calculate summary
    const totalDebit = transactions
      .filter((t) => t.type === "Debit")
      .reduce((sum, t) => sum + t.amount, 0);
    const totalCredit = transactions
      .filter((t) => t.type === "Credit")
      .reduce((sum, t) => sum + t.amount, 0);
    // Opening balance + net balance
    let openingBalance = 0;
    let netBalance = 0;
    if (memberId && memberId !== "all" && !memberId.includes(",")) {
      const member = await Member.findById(memberId).lean();
      openingBalance = member?.openingBalance || 0;
      if (transactions.length > 0) {
        netBalance =
          transactions[transactions.length - 1].balanceAfterTransaction;
      } else {
        netBalance = openingBalance;
      }
    } else {
      netBalance = totalDebit - totalCredit;
    }
    // Apply balance status filter (post-query filter)
    let finalTransactions = transactions;
    if (balanceStatus && balanceStatus !== "all") {
      finalTransactions = transactions.filter((t) => {
        const bal = t.balanceAfterTransaction;
        if (balanceStatus === "arrears") return bal > 0;
        if (balanceStatus === "credit") return bal < 0;
        if (balanceStatus === "zero") return bal === 0;
        return true;
      });
    }
    // Grouping logic
    let groupedData = null;
    if (groupBy) {
      groupedData = {};
      finalTransactions.forEach((t) => {
        let key = "Ungrouped";
        if (groupBy === "member") {
          key = t.memberId
            ? `${t.memberId.wing || ""}-${t.memberId.flatNo} ${
                t.memberId.ownerName
              }`
            : "Unknown";
        } else if (groupBy === "category") {
          key = t.category;
        } else if (groupBy === "date") {
          const d = new Date(t.date);
          key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
            2,
            "0",
          )}`;
        }
        if (!groupedData[key]) {
          groupedData[key] = {
            transactions: [],
            totalDebit: 0,
            totalCredit: 0,
          };
        }
        groupedData[key].transactions.push(t);
        if (t.type === "Debit") groupedData[key].totalDebit += t.amount;
        else groupedData[key].totalCredit += t.amount;
      });
    }
    const responseData = {
      success: true,
      transactions: finalTransactions,
      summary: {
        totalTransactions: totalCount,
        totalDebit,
        totalCredit,
        openingBalance,
        netBalance,
        balanceType: netBalance >= 0 ? "DR" : "CR",
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
      },
      groupedData,
      filters: {
        memberId,
        category,
        txnType,
        startDate,
        endDate,
        billPeriod,
        wing,
        paymentMode,
        financialYear,
      },
    };
    if (cacheKey) await cache.set(cacheKey, responseData, 60);
    return NextResponse.json(responseData);
  } catch (error) {
    console.error("Ledger fetch error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch ledger",
      },
      { status: 500 },
    );
  }
}