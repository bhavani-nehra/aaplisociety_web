// GET /v1/calls/:id/recording — Plan 03 §15. Recording stays off by default;
// this only ever has something to return once a society's policy has turned
// it on AND the provider actually recorded the call. Never a public URL —
// minted per request, short-lived, and every access is audited.
import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant, requireRoles } from "@/lib/v1/auth";
import { RECORDING_ACCESS_ROLES } from "@/lib/v1/calls";
import CallSession from "@/models/CallSession";
import AuditLog from "@/models/AuditLog";
import { presignDownload } from "@/lib/v1/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECORDING_URL_TTL_SEC = 300;

export const GET = withRoute(async (req, ctx) => {
  const { id } = await ctx.params;
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  requireRoles(claims, RECORDING_ACCESS_ROLES);

  if (!id || !/^[a-f\d]{24}$/i.test(String(id))) {
    throw new ApiError(400, "Invalid call id");
  }

  const session = await CallSession.findOne({ _id: id, societyId });
  if (!session) throw new ApiError(404, "Call not found");
  if (!session.recordingRef) throw new ApiError(404, "No recording for this call");

  const url = await presignDownload(session.recordingRef, { expiresIn: RECORDING_URL_TTL_SEC });

  await AuditLog.create({
    userId: claims.userId,
    societyId,
    action: "CALL_RECORDING_ACCESSED",
    newData: { callSessionId: session._id },
  });

  return json({ ok: true, url, expiresInSec: RECORDING_URL_TTL_SEC });
});
