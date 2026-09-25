/**
 * PUT    /v1/members/me/avatar  — set the caller's profile photo
 * DELETE /v1/members/me/avatar  — remove it
 * GET    /v1/members/me/avatar  — read the current one, signed
 *
 * Plan 03 §9.
 *
 * ## "Exactly one active profile image" is enforced by the schema
 *
 * `User.avatarKey` is a single string. There is nowhere to put a second image,
 * so there can never be a set of them with a flag deciding which is live — and
 * therefore no way for that flag to be wrong.
 *
 * ## Arbitrary object attachment is impossible by construction
 *
 * The caller sends a `key`, which sounds like it lets them name any object in
 * the bucket. It does not: `/v1/uploads/attach` has already checked that the
 * key sits under `member-avatars/<their own societyId>/`, and that prefix was
 * minted server-side from their own token claims by `buildKey`. A client
 * cannot obtain a signed PUT for anybody else's prefix, so a key it can
 * legitimately hold is one it legitimately owns.
 *
 * This route re-runs that same prefix check rather than trusting that attach
 * was called: nothing stops a client skipping attach and calling this directly.
 */
import { withRoute, ApiError, json } from "@/lib/v1/http";
import { getClaims, requireTenant } from "@/lib/v1/auth";
import User from "@/models/User";
import { presignDownload, deleteObject, headObject } from "@/lib/v1/storage";
import { resolveTarget } from "@/lib/v1/uploadPolicy";
import connectDB from "@/lib/mongodb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function callerId(claims) {
  const id = claims?.userId || claims?.sub || claims?.id;
  if (!id) throw new ApiError(401, "Sign in to change your profile photo.");
  return id;
}

export const GET = withRoute(async (req) => {
  await connectDB();
  const claims = getClaims(req);
  requireTenant(claims);
  const user = await User.findById(callerId(claims)).select("avatarKey").lean();
  return json({
    ok: true,
    avatarKey: user?.avatarKey || null,
    // Signed per request rather than stored, because R2 objects are private
    // and a stored URL would either expire or be permanently public.
    avatarUrl: user?.avatarKey ? await presignDownload(user.avatarKey) : null,
  });
});

export const PUT = withRoute(async (req) => {
  await connectDB();
  const claims = getClaims(req);
  const societyId = requireTenant(claims);
  const userId = callerId(claims);

  const body = await req.json().catch(() => null);
  const key = body?.key;
  if (!key || typeof key !== "string") throw new ApiError(400, "key is required");

  const spec = resolveTarget("member-avatar");
  // Re-checked here, not assumed. Nothing stops a client skipping the attach
  // step and calling this route directly with a key it picked.
  if (!key.startsWith(`${spec.folder}/${societyId}/`)) {
    throw new ApiError(403, "That image does not belong to this society.");
  }
  if (key.includes("..") || key.includes("//")) {
    throw new ApiError(400, "Malformed image key.");
  }

  // The object has to exist and be within the cap. A member who skipped attach
  // would otherwise set their avatar to a key holding anything at all.
  const head = await headObject(key);
  if (!head.exists) {
    throw new ApiError(404, "That image was not found. Please upload it again.");
  }
  if (head.size > spec.maxBytes) {
    await deleteObject(key);
    throw new ApiError(413, `That image is too large (limit ${Math.round(spec.maxBytes / 1024)} KB).`);
  }

  const user = await User.findById(userId).select("avatarKey");
  if (!user) throw new ApiError(404, "Account not found.");

  // Captured before the overwrite: afterwards this record is the only thing
  // that knew the old key, and it no longer does.
  const previousKey = user.avatarKey;
  user.avatarKey = key;
  await user.save();

  // After the save, so a failure here cannot leave the account pointing at a
  // deleted object. An orphan costs storage; a dangling reference costs the
  // member their photo.
  if (previousKey && previousKey !== key) {
    try {
      await deleteObject(previousKey);
    } catch (e) {
      console.error("[member-avatar] could not delete replaced object", previousKey, e?.message);
    }
  }

  return json({ ok: true, avatarKey: key, avatarUrl: await presignDownload(key) });
});

export const DELETE = withRoute(async (req) => {
  await connectDB();
  const claims = getClaims(req);
  requireTenant(claims);

  const user = await User.findById(callerId(claims)).select("avatarKey");
  if (!user) throw new ApiError(404, "Account not found.");

  const previousKey = user.avatarKey;
  user.avatarKey = null;
  await user.save();

  // Removing a profile photo means the image is gone, not hidden. Leaving the
  // object behind would keep a member's face in the bucket after they asked
  // for it to be removed.
  if (previousKey) {
    try {
      await deleteObject(previousKey);
    } catch (e) {
      console.error("[member-avatar] could not delete removed object", previousKey, e?.message);
    }
  }

  return json({ ok: true, avatarKey: null, avatarUrl: null });
});
