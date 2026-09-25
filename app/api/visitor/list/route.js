// app/api/visitor/list/route.js
// GET — Shared by Security (society-wide) and Member (own flat).
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import Visitor from "@/models/Visitor";
import { requireAuth } from "@/lib/authz";
import { VISITOR_STATUSES } from "@/lib/visitor-config";
import { authorize } from "@/lib/rbac/authorize";
import { safeRegex } from "@/lib/query-safety";
export async function GET(request) {
  const gate = await authorize(request, "visitor.visitor.view");
  if (!gate.ok) return gate.response;
  const auth = requireAuth(request);
  if (!auth.valid) return auth;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope") || "today"; // today | all | active | pending
    const status = searchParams.get("status");
    const memberIdParam = searchParams.get("memberId");
    const q = String(searchParams.get("q") || "").trim();
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, parseInt(searchParams.get("limit") || "20", 10));
    const query = { societyId: auth.user.societyId };
    // Members are restricted to their own flat.
    if (auth.user.role === "Member") {
      if (!auth.user.memberId)
        return NextResponse.json({ error: "Member profile required" }, { status: 400 });
      query.memberId = auth.user.memberId;
    } else if (memberIdParam) {
      if (!mongoose.Types.ObjectId.isValid(memberIdParam))
        return NextResponse.json({ error: "Invalid memberId" }, { status: 400 });
      query.memberId = memberIdParam;
    }
    if (status && VISITOR_STATUSES.includes(status)) query.status = status;
    if (scope === "today") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      query.createdAt = { $gte: start };
    } else if (scope === "active") {
      query.status = "Entered";
    } else if (scope === "pending") {
      query.status = "Pending";
    }
    if (q) {
      const rx = safeRegex(q);
      query.$or = [
        { name: rx },
        { phone: rx },
        { vehicleNumber: rx },
      ];
    }
    const [visitors, total] = await Promise.all([
      Visitor.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("memberId", "flatNo wing ownerName contactNumber")
        .populate("enteredBy", "name gateLabel phone")
        .lean(),
      Visitor.countDocuments(query),
    ]);
    return NextResponse.json({
      success: true,
      visitors,
      total,
      page,
      limit,
      hasMore: page * limit < total,
    });
  } catch (err) {
    console.error("Visitor list error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
