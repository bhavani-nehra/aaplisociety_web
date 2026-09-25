/**
 * GET /v1/cron/ownership-grace-sweep
 *
 * Closes ownership transfers whose old-owner grace window has passed.
 *
 * The Redis flag that makes the window read-only is TTL'd, so it expires by
 * itself and a missed run can never leave somebody permanently restricted.
 * What this sweep does is the durable half: mark the transfer CLOSED, detach
 * the seller's profile for that flat, and write the audit row. Without it a
 * completed transfer would sit in OLD_OWNER_GRACE forever and the seller would
 * keep a profile for a flat they no longer own.
 */
import { json } from "@/lib/v1/http";
import connectDB from "@/lib/mongodb";
import { cronAuthorized } from "@/lib/v1/config";
import OwnershipTransfer from "@/models/OwnershipTransfer";
import { closeTransfer } from "@/lib/services/OwnershipTransferService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  if (!cronAuthorized(req)) return json({ error: "Unauthorized" }, { status: 401 });
  await connectDB();

  const due = await OwnershipTransfer.find({
    status: "OLD_OWNER_GRACE",
    graceEndsAt: { $lte: new Date() },
  }).limit(200);

  let closed = 0;
  const failures = [];
  for (const transfer of due) {
    try {
      // actorUserId null: nobody pressed anything, the window simply ended.
      await closeTransfer({ transfer, actorUserId: null });
      closed += 1;
    } catch (err) {
      // One bad transfer must not stop the rest of the sweep.
      failures.push({ transferId: String(transfer._id), error: err?.message });
      console.error("[ownership-grace-sweep] close failed:", transfer._id, err?.message);
    }
  }

  return json({ ok: true, due: due.length, closed, failures });
}
