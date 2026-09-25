/**
 * POST /api/ownership-transfers/[id]/reject
 * Body: { reason }  — required; the parties are told what it says.
 */
import { NextResponse } from "next/server";
import { rejectTransfer } from "@/lib/services/OwnershipTransferService";
import { loadTransferFor, transferErrorResponse } from "@/lib/services/ownershipTransferHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const loaded = await loadTransferFor(request, params, "member.ownershipTransfer.reject");
  if (!loaded.ok) return loaded.response;
  try {
    const body = await request.json().catch(() => ({}));
    const transfer = await rejectTransfer({
      transfer: loaded.transfer,
      actorUserId: loaded.gate.context.userId,
      reason: body.reason,
    });
    return NextResponse.json({ success: true, transfer });
  } catch (err) {
    return transferErrorResponse(err);
  }
}
