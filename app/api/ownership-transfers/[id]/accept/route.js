/**
 * POST /api/ownership-transfers/[id]/accept — the buyer consents.
 *
 * Deliberately NOT gated on an ownership-transfer permission: the buyer is not
 * society staff and holds no such grant. Authorisation here is identity —
 * the service refuses unless the caller IS the invited buyer.
 *
 * Accepting is consent, not approval. It moves the transfer to
 * PENDING_ADMIN_APPROVAL and no further; only an admin can complete it.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import OwnershipTransfer from "@/models/OwnershipTransfer";
import { acceptAsBuyer } from "@/lib/services/OwnershipTransferService";
import { transferErrorResponse } from "@/lib/services/ownershipTransferHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  // Any authenticated member of the society; `rbac.myAccess.view` is in
  // MEMBER_CAPABILITIES, so this proves "a signed-in resident" without
  // requiring a staff permission the buyer will never hold.
  const gate = await authorize(request, "rbac.myAccess.view");
  if (!gate.ok) return gate.response;

  try {
    await connectDB();
    const { id } = await params;
    const transfer = await OwnershipTransfer.findOne({
      _id: id,
      societyId: gate.context.societyId,
    });
    if (!transfer) {
      return NextResponse.json(
        { error: "Transfer not found.", code: "TRANSFER_NOT_FOUND" },
        { status: 404 },
      );
    }

    const updated = await acceptAsBuyer({
      transfer,
      buyerUserId: gate.context.userId,
    });
    return NextResponse.json({ success: true, transfer: updated });
  } catch (err) {
    return transferErrorResponse(err);
  }
}
