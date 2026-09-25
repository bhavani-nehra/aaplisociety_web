// POST /v1/calls — Plan 03 §13. Replaces `launchUrl('tel:$phone')` across the
// Flutter client with a call the server mediates: the client sends only why
// it's calling (and, where the purpose needs one, which visit), never a
// phone number. See lib/v1/calls.js for who the callee is resolved to.
import { withRoute, zodError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { callInitiateSchema } from "@/lib/v1/schemas";
import { initiateCall } from "@/lib/v1/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);

  const body = await req.json().catch(() => ({}));
  const parsed = callInitiateSchema.safeParse(body);
  if (!parsed.success) throw zodError(parsed);

  const session = await initiateCall({
    req,
    claims,
    societyId,
    purpose: parsed.data.purpose,
    visitorId: parsed.data.visitorId,
  });

  return json(
    {
      ok: true,
      callSessionId: session._id,
      status: session.status,
      purpose: session.purpose,
      startedAt: session.startedAt,
    },
    { status: 201 },
  );
});
