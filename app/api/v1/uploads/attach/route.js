/**
 * POST /v1/uploads/attach
 *
 * Plan 03 §8. The missing third step of the direct-to-R2 upload flow.
 *
 * ## What was wrong
 *
 * `/v1/uploads/sign` mints a presigned PUT and says, in a comment, that the
 * client-sent `size` is advisory because "the authoritative check is still the
 * headObject() in the attach step".
 *
 * There was no attach step. `headObject()` and `getObjectHeadBytes()` existed
 * in lib/v1/storage.js and were called by nobody, and Flutter's
 * upload_service.dart documented a three-step flow whose step 3 did not exist
 * on the server.
 *
 * So a client could sign an upload declaring `size: 1000`, then PUT an
 * arbitrarily large file of any content whatsoever. The only ceiling was R2's,
 * and the bytes were never magic-byte checked. That applied to EVERY presigned
 * target, not only visitor photos.
 *
 * ## What this does
 *
 * Asks R2 what actually landed:
 *
 *   1. the key is inside the caller's own society prefix, or 403
 *   2. the object exists, or 404
 *   3. its real ContentLength is within the target's limit, or 413
 *   4. its first bytes really are the type it claims, or 400
 *
 * A failed check deletes the object. An upload that cannot be attached has no
 * reason to stay in the bucket, and leaving it there is how a rejected 50MB
 * file still costs storage forever.
 *
 * ## Why it does not write the owning record
 *
 * Persisting `visitor.photoKey` belongs to the visitor route, which knows
 * about visitors. This endpoint verifies bytes and returns a key the caller
 * can then hand to whichever route owns the record. Doing both here would mean
 * this file importing every model that can own an upload.
 */
import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import {
  headObject,
  getObjectHeadBytes,
  deleteObject,
  presignDownload,
} from "@/lib/v1/storage";
import { resolveTarget } from "@/lib/v1/uploadPolicy";
import { detectFileType } from "@/lib/v1/fileSignature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req) => {
  const claims = getClaims(req);
  const societyId = requireTenant(claims);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") throw new ApiError(400, "JSON body required");

  const { key, target } = body;
  if (!key || typeof key !== "string") throw new ApiError(400, "key is required");
  const spec = resolveTarget(target);

  // The key must be one this society was given. `buildKey` mints
  // `${folder}/${societyId}/${uuid}.${ext}`, so both the folder and the tenant
  // are checked here — otherwise a caller could attach an object belonging to
  // another society, or file a tenant contract as a visitor photo to borrow the
  // larger limit.
  //
  // Checked BEFORE the object is touched: a mismatched key is never deleted,
  // because it is not ours to delete. Only an object that passed this gate and
  // then failed a later one is cleaned up.
  const expectedPrefix = `${spec.folder}/${societyId}/`;
  if (!key.startsWith(expectedPrefix)) {
    throw new ApiError(403, "That upload does not belong to this society.");
  }
  // Defence against a traversal-shaped key slipping through the prefix test.
  if (key.includes("..") || key.includes("//")) {
    throw new ApiError(400, "Malformed upload key.");
  }

  const head = await headObject(key);
  if (!head.exists) {
    // Either the PUT never completed or it has already been cleaned up. Worth
    // distinguishing from a size failure: the client should retry the upload,
    // not shrink the file.
    throw new ApiError(404, "That upload was not found. Please try uploading again.");
  }

  // The authoritative size check the sign step deferred to.
  if (head.size > spec.maxBytes) {
    await deleteObject(key);
    const limitKb = Math.round(spec.maxBytes / 1024);
    throw new ApiError(
      413,
      limitKb >= 1024
        ? `That file is too large (limit ${Math.round(limitKb / 1024)} MB).`
        : `That file is too large (limit ${limitKb} KB).`,
    );
  }

  // An empty object is a failed PUT that still created a key.
  if (head.size === 0) {
    await deleteObject(key);
    throw new ApiError(400, "That upload was empty. Please try again.");
  }

  // What the bytes actually are, not what anybody said they were. A ranged GET
  // of 512 bytes costs effectively nothing next to pulling the file back.
  const headBytes = await getObjectHeadBytes(key, 512);
  const actualType = detectFileType(headBytes);
  if (!actualType || !spec.accept[actualType]) {
    await deleteObject(key);
    throw new ApiError(
      400,
      `That file is not a supported image or document. Allowed: ${Object.keys(spec.accept).join(", ")}`,
    );
  }

  return json({
    ok: true,
    key,
    size: head.size,
    contentType: actualType,
    // Handed back so the caller can show the uploaded image immediately
    // without a second round trip to have the same key signed for reading.
    url: await presignDownload(key),
  });
});
