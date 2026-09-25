// lib/redis.js
//
// WAS: ioredis opening a TCP socket to a Redis Labs host that no longer
// resolves, which is where `getaddrinfo ENOTFOUND
// redis-17336.crce281.ap-south-1-3.ec2.cloud.redislabs.com` came from.
//
// NOW: Upstash REST. Two reasons this is the right transport here, not just a
// different URL:
//
//   1. Serverless functions are frozen between invocations. A TCP client
//      cannot keep a socket alive across that boundary, so every cold start
//      pays a handshake and every freeze leaks a connection. "Connection is
//      closed" in your log is exactly that. REST is stateless - each command
//      is one HTTPS request, and there is nothing to keep alive.
//   2. Upstash's REST endpoint is the only one that works from Edge runtime.
//      ioredis needs `node:net`, which Edge does not have.
//
// Zero new dependencies - this is plain fetch. You do NOT need `npm i
// @upstash/redis`.
//
// Env (you already have both):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// REDIS_URL is now unused. Delete it from Vercel so nothing accidentally
// reconnects to the dead host.

const URL_BASE = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// Dev skips Redis (slow remote round-trips) unless USE_REDIS_IN_DEV=1.
export const isRedisConfigured =
  Boolean(URL_BASE && TOKEN) &&
  (process.env.NODE_ENV === "production" || process.env.USE_REDIS_IN_DEV === "1");

// Warn exactly once at module load instead of on every command. The old code
// logged the same connection error four times per page render, which is what
// made your terminal unreadable.
if (!isRedisConfigured) {
  const why =
    URL_BASE && TOKEN
      ? "Upstash vars are set but disabled in dev (set USE_REDIS_IN_DEV=1 to enable). "
      : "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set. ";
  console.warn(
    "[redis] " +
      why +
      "Falling back to a per-instance in-memory cache. This is safe but not " +
      "shared between serverless instances.",
  );
}

// ── In-memory fallback ──────────────────────────────────────────────────────
// Used when Upstash is unconfigured or unreachable. Scoped to one warm Lambda,
// so two instances can briefly disagree. That is acceptable for everything we
// cache (all of it is derived data with a short TTL and a fingerprint guard),
// and it is strictly better than hammering Mongo on every request.
const memory = new Map(); // key -> { value: string, expiresAt: number }
const MEMORY_MAX_KEYS = 500;

function memoryGet(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt && hit.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

function memorySet(key, value, ttlSeconds) {
  // Cheap bounded eviction: drop the oldest insertion. Map preserves insertion
  // order, so the first key is the oldest.
  if (memory.size >= MEMORY_MAX_KEYS && !memory.has(key)) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
  });
}

// ── Circuit breaker ─────────────────────────────────────────────────────────
// If Upstash starts failing, stop calling it for 30s. Without this, an outage
// turns every cache lookup into a failed HTTPS round trip *on top of* the
// Mongo query it was supposed to avoid - the cache becomes a latency tax.
let breakerOpenUntil = 0;
const BREAKER_COOLDOWN_MS = 30_000;
let breakerLoggedAt = 0;

function breakerIsOpen() {
  return Date.now() < breakerOpenUntil;
}

function tripBreaker(err) {
  breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
  // Log at most once per cooldown so an outage cannot spam the log.
  if (Date.now() - breakerLoggedAt > BREAKER_COOLDOWN_MS) {
    breakerLoggedAt = Date.now();
    console.warn(
      `[redis] Upstash unreachable (${err?.message || err}). ` +
        `Using in-memory cache for the next ${BREAKER_COOLDOWN_MS / 1000}s.`,
    );
  }
}

/**
 * Send one Redis command over the REST API.
 * Command form is an array: ["SET", key, value, "EX", 60]
 * Returns the raw `result`, or throws.
 */
async function command(args, { timeoutMs = 3000 } = {}) {
  if (!isRedisConfigured) throw new Error("Upstash not configured");
  if (breakerIsOpen()) throw new Error("circuit open");

  // Never let a slow cache call hold up a request. 3s is already generous for
  // an in-region Upstash hop; past that the DB read would have finished.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(URL_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args.map(String)),
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upstash ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    if (json.error) throw new Error(`Upstash: ${json.error}`);
    return json.result;
  } catch (err) {
    tripBreaker(err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send several commands in one HTTPS round trip.
 * Returns an array of results, with `null` in the slot of any that errored.
 */
async function pipeline(commands) {
  if (!commands.length) return [];
  if (!isRedisConfigured) throw new Error("Upstash not configured");
  if (breakerIsOpen()) throw new Error("circuit open");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(`${URL_BASE}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      signal: ac.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash pipeline ${res.status}`);
    const json = await res.json();
    return (Array.isArray(json) ? json : []).map((r) => r?.result ?? null);
  } catch (err) {
    tripBreaker(err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public surface ──────────────────────────────────────────────────────────
// Deliberately mirrors the small slice of the ioredis API that lib/cache.js
// already used (get / setex / del), so cache.js needed almost no rewrite and
// nothing else in the codebase has to change.

const redis = {
  configured: isRedisConfigured,

  async get(key) {
    try {
      const v = await command(["GET", key]);
      return v === undefined ? null : v;
    } catch {
      return memoryGet(key);
    }
  },

  // SEC-18: same read, but a transport failure THROWS instead of silently
  // falling back to the in-process memory mirror.
  //
  // get() is right for caches: a miss and an outage are both "no cached value,
  // go compute it". It is wrong for a security floor, where a miss means
  // "nothing to enforce, allow" and an outage means "cannot prove anything".
  // Collapsing those two into null is what made the session-epoch check
  // fail OPEN during an Upstash outage — a handed-over Secretary's revoked
  // token kept working. Only lib/session-epoch.js uses this.
  async getStrict(key) {
    const v = await command(["GET", key]);
    return v === undefined ? null : v;
  },

  async setex(key, ttlSeconds, value) {
    memorySet(key, value, ttlSeconds); // always mirror locally
    try {
      await command(["SET", key, value, "EX", Math.max(1, Math.floor(ttlSeconds))]);
      return true;
    } catch {
      return false;
    }
  },

  async del(...keys) {
    const flat = keys.flat().filter(Boolean);
    if (!flat.length) return 0;
    for (const k of flat) memory.delete(k);
    try {
      return (await command(["DEL", ...flat])) || 0;
    } catch {
      return 0;
    }
  },

  /**
   * Non-blocking key scan. Replaces the KEYS call the old delPattern tried to
   * make. KEYS is O(N) and blocks the whole Redis server; SCAN is cursored and
   * safe to run against a live database.
   *
   * Capped at 5000 keys so a pathological pattern like "*" cannot spin.
   */
  async scanKeys(pattern, { count = 200, max = 5000 } = {}) {
    const found = [];
    let cursor = "0";
    try {
      do {
        const res = await command(["SCAN", cursor, "MATCH", pattern, "COUNT", count]);
        if (!Array.isArray(res)) break;
        cursor = String(res[0]);
        const batch = res[1] || [];
        found.push(...batch);
        if (found.length >= max) break;
      } while (cursor !== "0");
      return found;
    } catch {
      // Fallback: pattern-match the in-memory keys instead.
      const rx = new RegExp(
        "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
      );
      return [...memory.keys()].filter((k) => rx.test(k));
    }
  },

  pipeline,
  command,

  /** Health probe for /api/health. */
  async ping() {
    if (!isRedisConfigured) return { ok: false, reason: "not_configured" };
    try {
      const started = Date.now();
      await command(["PING"], { timeoutMs: 2000 });
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  },
};

export default redis;
