// lib/cache.js
//
// Thin JSON layer over lib/redis.js. Same public surface as before
// (get / set / del / delPattern / getOrSet) so no caller changes.
//
// Two real bugs fixed here, beyond the transport swap:
//
// 1. delPattern was a silent no-op. It referenced `this.client`, which was
//    never assigned anywhere in this module - the module imports a redis
//    singleton instead. `this.client?.isOpen` was therefore always undefined,
//    the guard returned early every single time, and every cache invalidation
//    that used a wildcard silently did nothing. Stale member lists and stale
//    billing snapshots were being served indefinitely and looked like
//    "caching bugs". It now uses SCAN + DEL for real.
//
// 2. Errors were logged on every call. With Upstash down that produced four
//    identical lines per render. Logging now happens once per cooldown inside
//    lib/redis.js, and this layer is silent.
//
// 2026-08-14: added TTL jitter and getOrSetSWR (stale-while-revalidate).
// Every cache TTL previously expired at exactly N seconds. When many keys
// are written at roughly the same moment (e.g. a burst of members opening
// the app right after a deploy, all populating the same handful of society
// keys), they also expire at roughly the same moment, so the miss traffic
// arrives in a synchronized burst instead of being spread out. Jitter adds a
// small random extra amount to every TTL so expiries desynchronize over
// time. This only ever *extends* a TTL, never shortens it, so it is safe for
// the rate-limit counters and cron lock that also go through cache.set().
import { after } from "next/server";
import redis from "./redis";

/** JSON.parse that returns null instead of throwing on a poisoned entry. */
function safeParse(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") return raw; // Upstash may already decode
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DEFAULT_JITTER_SECONDS = 5;
function jittered(ttlSeconds, jitterSeconds = DEFAULT_JITTER_SECONDS) {
  return Math.max(1, Math.floor(ttlSeconds) + Math.floor(Math.random() * jitterSeconds));
}

// De-duplicates concurrent getOrSet/getOrSetSWR calls for the same key
// *within one instance*. Two requests landing on the same warm Lambda at the
// same time used to both miss and both hit Mongo. This collapses them into
// one promise. It is not a distributed lock and deliberately so - a
// cross-instance lock costs 2 extra Redis writes per miss, which is the
// trade you already rejected in the previous version of this file.
const inflight = new Map();

// Dashboard stats are derived from bills, payments and members. Every route
// that changes those already clears one of the keys below for its society, so
// piggy-back on that signal instead of editing each mutation route: whenever
// one of them is deleted, drop that society's cached dashboard stats too.
const SOCIETY_DATA_KEY = /^(?:payments:outstanding|billing:generated|billing:list|members:list|v1:ledger|v1:bills):([^:*]+)/;
async function invalidateDashboardFor(keys) {
  const societies = new Set();
  for (const k of keys) {
    const m = typeof k === "string" ? SOCIETY_DATA_KEY.exec(k) : null;
    if (m) societies.add(m[1]);
  }
  for (const sid of societies) {
    try {
      const found = await redis.scanKeys(`dash:stats:${sid}:*`);
      if (found.length) await redis.del(...found);
    } catch {}
  }
}

const cache = {
  async get(key) {
    return safeParse(await redis.get(key));
  },

  // SEC-18: throws on transport failure instead of degrading to the memory
  // mirror, so a caller that must distinguish "no value" from "could not read"
  // can. See redis.getStrict. Used only by lib/session-epoch.js.
  async getStrict(key) {
    return safeParse(await redis.getStrict(key));
  },

  async set(key, data, ttlSeconds = 300) {
    await redis.setex(key, jittered(ttlSeconds), JSON.stringify(data));
  },

  async del(...keys) {
    const flat = keys.flat().filter(Boolean);
    if (flat.length) await redis.del(...flat);
    await invalidateDashboardFor(flat);
  },

  /**
   * Delete every key matching a glob, e.g. "members:list:abc123:*".
   * Previously a no-op. See the note at the top of this file.
   */
  async delPattern(pattern) {
    await invalidateDashboardFor([pattern]);
    if (!pattern || !pattern.includes("*")) {
      // Not actually a pattern - a plain DEL is one round trip instead of a
      // full SCAN.
      if (pattern) await redis.del(pattern);
      return 0;
    }
    const keys = await redis.scanKeys(pattern);
    if (!keys.length) return 0;

    // Chunk the DEL. A single command with thousands of arguments can exceed
    // the REST body limit.
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 256) {
      deleted += (await redis.del(...keys.slice(i, i + 256))) || 0;
    }
    return deleted;
  },

  /**
   * Read-through cache. On miss, runs fetchFn, stores the result, returns it.
   * Never throws because of the cache: if Redis is unavailable this degrades
   * to a direct fetchFn call.
   */
  async getOrSet(key, fetchFn, ttlSeconds = 300) {
    const cached = safeParse(await redis.get(key));
    if (cached !== null) return cached;

    // Collapse concurrent misses on this instance.
    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
      try {
        const data = await fetchFn();
        if (data !== undefined && data !== null) {
          await redis.setex(key, jittered(ttlSeconds), JSON.stringify(data));
        }
        return data;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);
    return promise;
  },

  /**
   * Stale-while-revalidate read-through cache.
   *
   * - Age <= softTtlSeconds: serve the cached value, no work at all.
   * - softTtlSeconds < age <= hardTtlSeconds: serve the cached (stale) value
   *   immediately, and kick off a background refresh so the *next* request
   *   gets fresh data. The refresh is scheduled with Next's after() so it
   *   keeps running after the response is sent instead of racing a frozen
   *   serverless instance - a plain un-awaited promise has no such guarantee
   *   on Vercel.
   * - Past hardTtlSeconds, or never cached: the key has actually expired out
   *   of Redis (hard TTL *is* the Redis TTL), so this is a normal blocking
   *   miss - collapsed with concurrent requests on this instance via
   *   `inflight`, same as getOrSet.
   *
   * Use this instead of getOrSet for anything read far more often than it
   * changes (society-wide lists, directories) where a few seconds of
   * staleness is fine but a blocking Mongo round trip on every expiry is
   * wasted latency the caller can't see any benefit from.
   */
  async getOrSetSWR(key, fetchFn, { softTtlSeconds, hardTtlSeconds, jitterSeconds = DEFAULT_JITTER_SECONDS } = {}) {
    if (!softTtlSeconds || !hardTtlSeconds || hardTtlSeconds < softTtlSeconds) {
      throw new Error("getOrSetSWR requires hardTtlSeconds >= softTtlSeconds > 0");
    }

    const store = async (data) => {
      await redis.setex(
        key,
        jittered(hardTtlSeconds, jitterSeconds),
        JSON.stringify({ data, storedAt: Date.now() }),
      );
    };

    const runFetch = () => {
      const promise = (async () => {
        try {
          const data = await fetchFn();
          if (data !== undefined && data !== null) await store(data);
          return data;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, promise);
      return promise;
    };

    const raw = safeParse(await redis.get(key));
    if (raw && typeof raw === "object" && "storedAt" in raw && "data" in raw) {
      const ageSeconds = (Date.now() - raw.storedAt) / 1000;
      if (ageSeconds <= softTtlSeconds) return raw.data;

      // Stale but within hard TTL - serve it now, refresh in the background.
      if (!inflight.has(key)) {
        const revalidate = runFetch().catch((err) => {
          console.warn(`[cache] SWR revalidate failed for ${key}:`, err?.message || err);
        });
        try {
          after(() => revalidate);
        } catch {
          // Not inside a request context (e.g. invoked from a cron job) -
          // nothing to extend the lifetime of; the promise still runs on
          // its own, just without Vercel's post-response guarantee.
        }
      }
      return raw.data;
    }

    // True miss (never cached, past hard TTL, or a pre-SWR value written by
    // plain set()/getOrSet() under the same key) - collapse concurrent
    // requests on this instance.
    if (inflight.has(key)) return inflight.get(key);
    return runFetch();
  },

  /** Exposed for /api/health. */
  ping: () => redis.ping(),
};

export default cache;
