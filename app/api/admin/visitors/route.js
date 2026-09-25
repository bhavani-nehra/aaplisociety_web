// app/api/admin/visitors/route.js
// GET — Society-wide visitor management for Admin/Secretary (filters + summary).
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
// Register the User model in this serverless bundle. The .populate("enteredBy")
// below references the "User" model; if it isn't imported, Mongoose throws
// MissingSchemaError and the route returns 500.
import User from "@/models/User";
import { requireRoles } from "@/lib/authz";
import { VISITOR_STATUSES, VISITOR_PURPOSES } from "@/lib/visitor-config";
import { authorize } from "@/lib/rbac/authorize";
import { safeRegex } from "@/lib/query-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) {
  const gate = await authorize(request, "visitor.visitor.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const purpose = searchParams.get("purpose");
    const offline = searchParams.get("offline"); // "1" => offline entries only
    const confirm = searchParams.get("confirm"); // Pending | Acknowledged | Flagged
    const q = String(searchParams.get("q") || "").trim();
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(
      100,
      parseInt(searchParams.get("limit") || "25", 10),
    );
    const query = { societyId: gate.context.societyId };
    if (status && VISITOR_STATUSES.includes(status)) query.status = status;
    if (purpose && VISITOR_PURPOSES.includes(purpose)) query.purpose = purpose;
    if (offline === "1") query.entryMethod = "OfflineEntry";
    if (["Pending", "Acknowledged", "Flagged"].includes(confirm))
      query["offlineMeta.confirmation.status"] = confirm;
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }
    if (q) {
      const rx = safeRegex(q);
      query.$or = [{ name: rx }, { phone: rx }, { vehicleNumber: rx }];
    }
    const [visitors, total, summary] = await Promise.all([
      Visitor.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("enteredBy", "name gateLabel phone")
        .lean(),
      Visitor.countDocuments(query),
      Visitor.aggregate([
        {
          $match: {
            societyId: new mongoose.Types.ObjectId(String(gate.context.societyId)),
          },
        },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Visitor.countDocuments({
        societyId: gate.context.societyId,
        entryMethod: "OfflineEntry",
      }),
      Visitor.countDocuments({
        societyId: gate.context.societyId,
        entryMethod: "OfflineEntry",
        "offlineMeta.confirmation.status": "Flagged",
      }),
    ]);
    return NextResponse.json({
      success: true,
      visitors,
      total,
      page,
      limit,
      hasMore: page * limit < total,
      summary: summary.reduce((a, r) => ((a[r._id] = r.count), a), {}),
    });
  } catch (err) {
    console.error("Admin visitors error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}