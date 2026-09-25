/**
 * POST /api/ownership-transfers/[id]/approve
 *
 * The mandatory gate (Master Prompt 2 §4) and the only path that changes who
 * owns a flat. Everything irreversible happens inside one transaction in
 * OwnershipTransferService.approveTransfer.
 *
 * Body: { tenantDisposition?: "RETAIN"|"TERMINATE", effectiveDate?, idempotencyKey? }
 *
 * `tenantDisposition` is REQUIRED when the flat has a sitting tenant. The
 * service refuses without it rather than defaulting, because silently retaining
 * or terminating a tenancy decides where somebody lives.
 */
import { NextResponse } from "next/server";
import { approveTransfer } from "@/lib/services/OwnershipTransferService";
import { loadTransferFor, transferErrorResponse } from "@/lib/services/ownershipTransferHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const loaded = await loadTransferFor(request, params, "member.ownershipTransfer.approve");
  if (!loaded.ok) return loaded.response;
  try {
    const body = await request.json().catch(() => ({}));
    const { transfer, replayed } = await approveTransfer({
      transfer: loaded.transfer,
      actorUserId: loaded.gate.context.userId,
      tenantDisposition: body.tenantDisposition,
      effectiveDate: body.effectiveDate,
      idempotencyKey: body.idempotencyKey,
    });
    return NextResponse.json({
      success: true,
      replayed,
      transfer,
      // Said plainly so the admin can check it rather than trust it.
      summary: {
        previousOwner: transfer.effect.previousOwnerName,
        newOwner: transfer.effect.newOwnerName,
        tenantAction: transfer.effect.tenantAction,
        carryForwardAmount: transfer.effect.carryForwardAmount,
        sellerSessionInvalidated: transfer.effect.sellerSessionInvalidated,
        sellerReadOnlyUntil: transfer.graceEndsAt,
      },
    });
  } catch (err) {
    return transferErrorResponse(err);
  }
}
