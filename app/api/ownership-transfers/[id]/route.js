/**
 * GET /api/ownership-transfers/[id] — one transfer, with its flat.
 *
 * Readable by anyone who can view transfers in this society. The parties
 * themselves see their own via the member surface; this is the admin view.
 */
import { NextResponse } from "next/server";
import Member from "@/models/Member";
import { loadTransferFor, transferErrorResponse } from "@/lib/services/ownershipTransferHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const loaded = await loadTransferFor(request, params, "member.ownershipTransfer.view");
  if (!loaded.ok) return loaded.response;
  try {
    const { transfer } = loaded;
    const member = await Member.findById(transfer.memberId)
      .select("flatNo wing ownerName currentTenant")
      .lean();
    return NextResponse.json({
      transfer,
      flat: member
        ? {
            id: String(member._id),
            label: member.wing ? `${member.wing}-${member.flatNo}` : member.flatNo,
            currentOwner: member.ownerName,
            // The UI needs this to know whether to REQUIRE a tenant decision
            // before offering the approve button.
            hasTenant: Boolean(member.currentTenant),
          }
        : null,
    });
  } catch (err) {
    return transferErrorResponse(err);
  }
}
