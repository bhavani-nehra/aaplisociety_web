// Single source of truth for what may be uploaded where.
//
// Previously each upload route hard-coded its own MAX_BYTES and its own list
// of accepted types, and both routes chose a limit ABOVE Vercel's 4.5MB body
// cap — so the advertised limit was a lie and the real failure happened in the
// platform, before any of this code ran.
//
// With direct-to-R2 uploads the platform cap no longer applies, so these
// limits are now the real, enforced limits.
import { ApiError } from "@/lib/v1/http";

export const UPLOAD_TARGETS = {
  "visitor-photo": {
    folder: "visitor-photos",
    // Plan 03 §8. The POLICY target is 512 KiB. The hard cap stays at 5 MiB
    // for now, deliberately.
    //
    // Guards run shipped Flutter builds that compress at a fixed
    // `quality: 70, maxDimension: 1280` with no size target. Dropping the
    // server cap to 512 KiB on deploy day would silently break visitor photo
    // upload for every guard still on an old build — and a guard cannot
    // upgrade their app at the gate, mid-shift, with somebody waiting.
    //
    // Sequence: ship client-side compressToTarget(512 KiB), let adoption run,
    // then lower maxBytes to targetBytes. The app-store release train sets
    // that pace, not this file.
    targetBytes: 512 * 1024,
    maxBytes: 5 * 1024 * 1024,
    accept: { "image/jpeg": "jpg", "image/png": "png" },
  },
  // Plan 03 §9. Hard cap 1 MiB, policy target 512 KiB.
  //
  // Looser than the visitor-photo cap on purpose: an avatar is chosen once
  // from a gallery on a member's own phone, not captured by a guard at a gate
  // on a slow connection with somebody waiting.
  "member-avatar": {
    folder: "member-avatars",
    targetBytes: 512 * 1024,
    maxBytes: 1024 * 1024,
    accept: { "image/jpeg": "jpg", "image/png": "png" },
  },
  "tenant-contract": {
    folder: "tenant-requests/contract",
    maxBytes: 10 * 1024 * 1024,
    accept: { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" },
  },
  "tenant-signature": {
    folder: "tenant-requests/signature",
    maxBytes: 2 * 1024 * 1024,
    accept: { "image/jpeg": "jpg", "image/png": "png" },
  },
  "tenant-aadhaar": {
    folder: "tenant-requests/aadhaar",
    maxBytes: 10 * 1024 * 1024,
    accept: { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" },
  },
  "tenant-police-verification": {
    folder: "tenant-requests/police-verification",
    maxBytes: 10 * 1024 * 1024,
    accept: { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" },
  },

  // Commercial module (additive). Same presigned direct-to-R2 flow as every
  // other target: the key is minted server-side from the caller's own
  // societyId claim, so a signed URL can only write inside that prefix.
  "business-logo": {
    folder: "business-logos",
    maxBytes: 2 * 1024 * 1024,
    accept: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  },
  "business-cover": {
    folder: "business-covers",
    maxBytes: 5 * 1024 * 1024,
    accept: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  },
};

// Maps the legacy `:field` path segment used by
// /v1/tenant-requests/upload/:field onto the target ids above, so old clients
// keep working while new ones can use the target id directly.
export const LEGACY_TENANT_FIELDS = {
  contract: "tenant-contract",
  // signature removed — replaced by the in-app acknowledgement.
  // aadhaar removed — no longer collected (D1).
  policeVerification: "tenant-police-verification",
  "police-verification": "tenant-police-verification",
};

export function resolveTarget(target) {
  const spec = UPLOAD_TARGETS[target];
  if (!spec) throw new ApiError(400, `Unknown upload target "${target}"`);
  return spec;
}

export function assertAcceptedType(spec, contentType) {
  const ext = spec.accept[contentType];
  if (!ext) {
    throw new ApiError(
      400,
      `Unsupported file type. Allowed: ${Object.keys(spec.accept).join(", ")}`,
    );
  }
  return ext;
}