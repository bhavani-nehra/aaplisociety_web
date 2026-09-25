// GET /api/admin/payments/received - every payment credited to the society,
// with filters, pagination and totals. This backs the admin "Payments
// Received" dashboard.
//
// Payments live in the Transaction collection as category "Payment" (type
// Credit). Reversed rows are hidden unless includeReversed=1.
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
// Transaction.createdBy is ref:"User" - the schema must be registered before
// populate() runs or Mongoose throws MissingSchemaError on cold starts.
import User from "@/models/User";
void User;
import { authorizeAny } from "@/lib/rbac/authorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  // This route was missed in the original RBAC migration pass. It's now
  // fully RBAC-gated below — the old requireRoles(["Admin","Secretary",
  // "Treasurer"]) call used to run first and block every RBAC-only staff
  // role outright, before this check ever ran. Backs the "Payments
  // Received" section folded into the unified /admin/payments page.
  const gate = await authorizeAny(request, [
    "finance.payments.view",
    "finance.paymentsReceived.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
    const memberId = searchParams.get("memberId");
    const mode = searchParams.get("paymentMode");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const includeReversed = searchParams.get("includeReversed") === "1";

    // Canonical shape is category:"Payment" (type:"Credit"), written by
    // PaymentService and (as of 2026-08-22) the collection-sheet commit
    // route. Older collection-sheet rows predate that fix and only have
    // type:"PAYMENT" with no category at all — matched here too, or this
    // "one source of truth" list silently drops every payment recorded
    // through that path before today.
    const query = { societyId: gate.context.societyId };
    const and = [
      { $or: [{ category: "Payment" }, { type: { $in: ["PAYMENT", "Payment", "payment"] } }] },
    ];
    if (memberId) query.memberId = memberId;
    if (mode) and.push({ $or: [{ paymentMode: mode }, { mode }] });
    if (!includeReversed) query.isReversed = { $ne: true };
    query.$and = and;
    if (from || to) {
      query.date = {};
      if (from) query.date.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.date.$lte = end;
      }
    }

    const [rows, total, totals] = await Promise.all([
      Transaction.find(query)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("memberId", "flatNo roomNo wing ownerName")
        .populate("createdBy", "name username")
        .lean(),
      Transaction.countDocuments(query),
      // aggregate() does not cast strings to ObjectIds the way find() does, so a
      // string societyId matched nothing and every total read ₹0.00.
      Transaction.aggregate([
        {
          $match: {
            ...query,
            societyId: new mongoose.Types.ObjectId(String(query.societyId)),
            ...(query.memberId ? { memberId: new mongoose.Types.ObjectId(String(query.memberId)) } : {}),
          },
        },
        {
          $group: {
            _id: null,
            amount: { $sum: "$amount" },
            interest: { $sum: "$paymentBreakdown.interestCleared" },
            principal: { $sum: "$paymentBreakdown.principalCleared" },
            advance: { $sum: "$paymentBreakdown.advanceCredit" },
          },
        },
      ]),
    ]);

    const t = totals[0] || {};
    return NextResponse.json({
      success: true,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit) || 1,
      summary: {
        count: total,
        amount: t.amount || 0,
        interest: t.interest || 0,
        principal: t.principal || 0,
        advance: t.advance || 0,
      },
      payments: rows.map((r) => ({
        _id: String(r._id),
        transactionId: r.transactionId,
        date: r.date,
        amount: r.amount,
        description: r.description,
        // Legacy collection-sheet rows only had `mode`, not `paymentMode`.
        paymentMode: r.paymentMode || r.mode,
        chequeNo: r.chequeNo,
        bankName: r.bankName,
        upiId: r.upiId,
        transactionRef: r.transactionRef,
        // Legacy collection-sheet rows wrote `remarks`, not `notes`.
        notes: r.notes || r.remarks,
        billPeriodId: r.billPeriodId,
        isReversed: Boolean(r.isReversed),
        reversalTransactionId: r.reversalTransactionId || null,
        breakdown: r.paymentBreakdown || {},
        balanceAfterTransaction: r.balanceAfterTransaction,
        member: r.memberId
          ? {
              _id: String(r.memberId._id),
              flatNo: r.memberId.flatNo || r.memberId.roomNo || "",
              wing: r.memberId.wing || "",
              ownerName: r.memberId.ownerName || "",
            }
          : null,
        createdBy: r.createdBy ? r.createdBy.name || r.createdBy.username || "" : "",
      })),
    });
  } catch (err) {
    console.error("Payments received list error", err);
    return NextResponse.json({ error: "Failed to load payments" }, { status: 500 });
  }
}
