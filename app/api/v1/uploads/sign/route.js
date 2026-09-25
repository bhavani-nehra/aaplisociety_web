import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import { buildKey, presignUpload } from "@/lib/v1/storage";
import { resolveTarget, assertAcceptedType } from "@/lib/v1/uploadPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /v1/uploads/sign
//
// Body: { target: "visitor-photo" | "tenant-contract" | ..., contentType, size }
// Returns: { key, uploadUrl, expiresIn, maxBytes }
//
// ## What this replaces
//
// Every upload used to stream the entire file through a Vercel function:
//
//   device --(5MB)--> vercel function --(5MB)--> R2
//
// which billed 5MB of inbound Fast Origin Transfer plus 5MB outbound, held a
// 2GB-provisioned function open for the whole transfer, and hit the platform's
// hard 4.5MB request-body ceiling before the route handler ever executed.
//
// Now:
//
//   device --(300 bytes)--> vercel function   (auth + policy, ~20ms)
//   device --(5MB)--------> R2 directly       (never touches Vercel)
//
// Authorisation still happens here — the key is built from the caller's own
// societyId claim, so a signed URL can only ever write inside that society's
// prefix. The client cannot choose its own key.
export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw new ApiError(400, "JSON body required");

  const { target, contentType, size } = body;
  const spec = resolveTarget(target);
  const ext = assertAcceptedType(spec, contentType);

  // Advisory pre-check so the client fails instantly on a 20MB file instead of
  // uploading it and being rejected at attach time. The authoritative check is
  // still the headObject() in the attach step — this value comes from the
  // client and cannot be trusted on its own.
  if (typeof size === "number" && size > spec.maxBytes) {
    throw new ApiError(
      413,
      `File too large (max ${Math.round(spec.maxBytes / 1024 / 1024)}MB)`,
    );
  }

  const key = buildKey(societyId, spec.folder, ext);
  // Plan 03 §8. Where a target declares a policy size below its hard cap, the
  // client is told so it can compress to it. Advisory: the hard cap is what
  // the attach step enforces, because tightening the enforced limit ahead of
  // the shipped Flutter builds would break upload for guards mid-shift.
  const uploadUrl = await presignUpload(key, contentType);

  return json({
    ok: true,
    key,
    uploadUrl,
    // The client must send exactly this header on the PUT or R2 rejects the
    // signature. Baking it in is what stops a client claiming image/jpeg and
    // then uploading something else.
    headers: { "Content-Type": contentType },
    expiresIn: 300,
    maxBytes: spec.maxBytes,
    targetBytes: spec.targetBytes ?? spec.maxBytes,
    // The client must call this after the PUT completes. Until it does, the
    // object is unverified: nothing has checked its real size or its bytes.
    attachRequired: true,
  });
});
