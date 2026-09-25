/**
 * Shared plumbing for the /api/ownership-transfers/[id]/* routes.
 *
 * Each of those routes does the same three things before it can act: authorise
 * on its own permission leaf, load the transfer scoped to the caller's society,
 * and turn a TransferError into the right status. Repeating that five times is
 * five chances to scope one of them wrong.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import OwnershipTransfer from "@/models/OwnershipTransfer";
import { TransferError } from "@/lib/services/OwnershipTransferService";

/** TransferError → its status; anything else → a generic 500 with no internals. */
export function transferErrorResponse(err) {
  if (err instanceof TransferError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[ownership-transfers] unhandled:", err);
  return NextResponse.json(
    { error: "Something went wrong on our side. Your data is safe.", code: "INTERNAL" },
    { status: 500 },
  );
}

/**
 * Authorise, then load the transfer **scoped to the caller's society**.
 *
 * The society filter is not decoration: transfer ids are ObjectIds and
 * therefore guessable, and without it one society's admin could approve
 * another society's flat changing hands.
 *
 * @returns {{ ok: true, transfer, gate } | { ok: false, response }}
 */
export async function loadTransferFor(request, params, permission) {
  const gate = await authorize(request, permission);
  if (!gate.ok) return { ok: false, response: gate.response };

  await connectDB();
  const { id } = await params;
  const transfer = await OwnershipTransfer.findOne({
    _id: id,
    societyId: gate.context.societyId,
  });
  if (!transfer) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Transfer not found.", code: "TRANSFER_NOT_FOUND" },
        { status: 404 },
      ),
    };
  }
  return { ok: true, transfer, gate };
}
