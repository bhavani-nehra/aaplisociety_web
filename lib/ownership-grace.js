// lib/ownership-grace.js
//
// Edge-safe read of "is this user a seller inside their post-transfer grace
// window", so middleware.js can enforce read-only access without touching
// Mongo — the same shape as lib/session-epoch.js and for the same reason.
//
// ## Why the window is enforced by HTTP method
//
// Master Prompt 2 §7: after a transfer takes effect the previous owner keeps
// READ-ONLY access for a short period so they can collect their own records,
// then loses the flat. "Read-only" could be implemented as a check in every
// mutating handler — several hundred of them — and it would work right up until
// somebody forgot, and the forgotten one is a former owner still adding
// visitors to a flat they no longer own.
//
// Method is the one property every write shares and no handler can opt out of.
// That is why takeover read-only mode (middleware.js) works the same way, and
// this deliberately mirrors it rather than inventing a second mechanism.
import cache from "@/lib/cache";

const PREFIX = "owner-grace:";

function key(userId) {
  return `${PREFIX}${userId}`;
}

/**
 * Called by the service when a transfer takes effect. TTL'd to the window, so
 * the flag expires on its own — a missed sweep cannot leave somebody
 * permanently read-only.
 */
export async function setOwnerGrace(userId, endsAt) {
  if (!userId || !endsAt) return;
  const seconds = Math.max(1, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
  await cache.set(key(userId), { endsAt: new Date(endsAt).toISOString() }, seconds);
}

/** Cleared when the window is closed early by an admin. */
export async function clearOwnerGrace(userId) {
  if (!userId) return;
  await cache.del(key(userId));
}

/**
 * @returns {Promise<{ endsAt: string } | null>} null when this user is not a
 * seller in grace — which is almost everybody, almost always.
 *
 * Fails OPEN on a cache error, deliberately: the consequence of a false
 * negative is a former owner briefly retaining write access to one flat during
 * a Redis outage, while the consequence of failing closed would be blocking
 * every write in the product for every user whenever the cache blips. The
 * durable record is the OwnershipTransfer document either way.
 */
export async function readOwnerGrace(userId) {
  if (!userId) return null;
  try {
    const value = await cache.get(key(userId));
    if (!value?.endsAt) return null;
    if (new Date(value.endsAt).getTime() <= Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}
