// Rate limiting for /v1 routes.
//
// ## Why this was rewritten
//
// The previous implementation kept counters in a module-level `Map`. On Vercel
// every concurrent serverless instance gets its own copy of that Map, and every
// cold start throws it away. So a "10 attempts per 15 minutes" login limit was
// really "10 attempts per warm instance" - ten instances meant a hundred
// attempts, and an attacker could simply keep opening fresh connections until
// they got a cold one. The limit that protects your OTP/forgot-password
// endpoints from becoming somebody's free SMS gateway was effectively
// decorative.
//
// This version uses Upstash Redis over its REST API (plain fetch - no TCP
// socket, no connection pooling, works fine from a serverless function) so the
// counter is shared by every instance. It falls back to the old in-memory
// behaviour when Upstash is not configured, so local development and preview
// deploys keep working without extra setup.
//
// ## Setup
//   1. Create a free Upstash Redis database (pick the region closest to your
//      Vercel function region - Mumbai/Singapore).
//   2. Set these env vars in Vercel:
//        UPSTASH_REDIS_REST_URL
//        UPSTASH_REDIS_REST_TOKEN
//
// ## Fail-open, deliberately
// If Redis is unreachable we allow the request rather than 500. A rate limiter
// that takes down login because a cache blipped is a worse outage than the
// brute-force it prevents. Failures are logged via console.error (visible in
// platform logs); this path deliberately swallows the error rather than
// re-throwing, so it will NOT show up as a Sentry event (see instrumentation.js,
// which captures unhandled exceptions/request errors, not console.* calls).
import { ApiError } from "./http";
import { clientIp } from "./auth";

const REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
// Dev skips Redis (slow remote round-trips) unless USE_REDIS_IN_DEV=1.
const REDIS_ENABLED =
  Boolean(REST_URL && REST_TOKEN) &&
  (process.env.NODE_ENV === "production" || process.env.USE_REDIS_IN_DEV === "1");

let warnedNoRedis = false;

// ---------------------------------------------------------------------------
// In-memory fallback (unchanged semantics from the original implementation)
// ---------------------------------------------------------------------------
const buckets = new Map();

function memoryLimit(id, windowMs, limit) {
  const now = Date.now();
  let entry = buckets.get(id);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    buckets.set(id, entry);
  }
  entry.count += 1;
  return {
    count: entry.count,
    exceeded: entry.count > limit,
    decrement: () => {
      entry.count = Math.max(0, entry.count - 1);
    },
  };
}

// Occasional cleanup so the Map doesn't grow unbounded on a long-lived instance.
export function sweepBuckets() {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (now > v.resetAt) buckets.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Upstash REST helpers
// ---------------------------------------------------------------------------
async function redis(command) {
  const res = await fetch(REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    // Never let a slow cache hold a login request open.
    signal: AbortSignal.timeout(1500),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const body = await res.json();
  return body.result;
}

// Fixed-window counter. INCR the key, and on the first hit of a window set the
// expiry. Two round trips are avoided by pipelining both commands in one call.
async function redisLimit(id, windowMs, limit) {
  const key = `rl:${id}`;
  const ttlSeconds = Math.ceil(windowMs / 1000);
  const result = await redis([
    ["INCR", key],
    ["EXPIRE", key, String(ttlSeconds), "NX"],
  ]);
  // Pipelined responses come back as an array of { result } entries.
  const count = Array.isArray(result)
    ? Number(result[0]?.result ?? result[0])
    : Number(result);
  return {
    count,
    exceeded: count > limit,
    decrement: () => redis([["DECR", key]]).catch(() => {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
// options: { windowMs, limit, key, message, skipSuccessfulRequests }
//
// NOTE: this is now async - `await enforceRateLimit(...)`. It returns a
// commit(success) fn; call commit(true) after a successful attempt when using
// skipSuccessfulRequests, matching express-rate-limit's behaviour.
export async function enforceRateLimit(req, name, options) {
  const { windowMs, limit, key } = options;
  const id = `${name}:${key ?? clientIp(req)}`;

  let outcome;
  if (REDIS_ENABLED) {
    try {
      outcome = await redisLimit(id, windowMs, limit);
    } catch (err) {
      // Fail open, but leave a trail.
      console.error(`[v1/ratelimit] Redis unavailable, falling back: ${err.message}`);
      outcome = memoryLimit(id, windowMs, limit);
    }
  } else {
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      console.warn(
        "[v1/ratelimit] UPSTASH_REDIS_REST_URL/TOKEN not set - using per-instance " +
          "in-memory limits. On serverless the effective limit is (limit x warm instances).",
      );
    }
    outcome = memoryLimit(id, windowMs, limit);
  }

  if (outcome.exceeded) {
    throw new ApiError(429, options.message ?? "Too many requests, try again later");
  }

  return function commit(success) {
    if (options.skipSuccessfulRequests && success) {
      // Fire-and-forget: the caller should not wait on bookkeeping.
      try {
        const r = outcome.decrement();
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch {
        /* ignore */
      }
    }
  };
}
