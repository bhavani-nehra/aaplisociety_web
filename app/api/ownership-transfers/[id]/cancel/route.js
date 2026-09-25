/**
 * POST /api/ownership-transfers/[id]/cancel
 *
 * Withdraw a transfer that has not taken effect. Once EFFECTIVE the service
 * refuses — undoing a completed transfer means raising a new one in the
 * opposite direction, not rewriting history.
 */
import { NextResponse } from "next/server";
import { cancelTransfer } from "@/lib/services/OwnershipTransferService";
import { loadTransferFor, transferErrorResponse } from "@/lib/services/ownershipTransferHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const loaded = await loadTransferFor(request, params, "member.ownershipTransfer.cancel");
  if (!loaded.ok) return loaded.response;
  try {
    const body = await request.json().catch(() => ({}));
    const transfer = await cancelTransfer({
      transfer: loaded.transfer,
      actorUserId: loaded.gate.context.userId,
      reason: body.reason,
    });
    return NextResponse.json({ success: true, transfer });
  } catch (err) {
    return transferErrorResponse(err);
  }
}
