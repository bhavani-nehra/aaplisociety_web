/**
 * GET  /api/ownership-transfers        — list transfers for the society
 * POST /api/ownership-transfers        — start one
 *
 * Plan 02 §4. The state machine and every write live in
 * lib/services/OwnershipTransferService.js — these routes authorise, validate
 * shape, and translate a TransferError into an HTTP status. No route writes a
 * status field itself, because the approval gate only means something if there
 * is exactly one way through it.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import OwnershipTransfer, { TRANSFER_OPEN_STATUSES } from "@/models/OwnershipTransfer";
import {
  initiateTransfer,
  TransferError,
} from "@/lib/services/OwnershipTransferService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fromError(err) {
  if (err instanceof TransferError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[ownership-transfers] unhandled:", err);
  return NextResponse.json(
    { error: "Something went wrong on our side. Your data is safe.", code: "INTERNAL" },
    { status: 500 },
  );
}

export async function GET(request) {
  const gate = await authorize(request, "member.ownershipTransfer.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope"); // "open" | undefined
    const memberId = searchParams.get("memberId");

    const query = { societyId: gate.context.societyId };
    if (scope === "open") query.status = { $in: TRANSFER_OPEN_STATUSES };
    if (memberId) query.memberId = memberId;

    const transfers = await OwnershipTransfer.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate({ path: "memberId", select: "flatNo wing ownerName" })
      .lean();

    return NextResponse.json({
      transfers: transfers.map((t) => ({
        ...t,
        flat: t.memberId?.wing
          ? `${t.memberId.wing}-${t.memberId.flatNo}`
          : t.memberId?.flatNo || null,
      })),
    });
  } catch (err) {
    return fromError(err);
  }
}

export async function POST(request) {
  const gate = await authorize(request, "member.ownershipTransfer.initiate");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "The request did not reach the server. Please try again.", code: "BAD_BODY" },
        { status: 400 },
      );
    }
    if (!body.memberId) {
      return NextResponse.json(
        { error: "Which flat is being transferred?", code: "MEMBER_REQUIRED" },
        { status: 400 },
      );
    }

    const transfer = await initiateTransfer({
      // Tenant scope from the verified context only — never the body.
      societyId: gate.context.societyId,
      memberId: body.memberId,
      buyer: body.buyer || {},
      transferType: body.transferType,
      saleAmount: Number(body.saleAmount),
      registrationNumber: body.registrationNumber,
      transferDate: body.transferDate,
      reason: body.reason,
      actorUserId: gate.context.userId,
    });

    return NextResponse.json({ success: true, transfer }, { status: 201 });
  } catch (err) {
    return fromError(err);
  }
}
