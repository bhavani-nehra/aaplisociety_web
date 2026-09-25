// lib/api-fetch-interceptor.js
//
// Gives EVERY browser call to /api/* the silent-refresh-and-retry that only
// lib/api-client.js had, without touching a single call site.
//
// ## Why an interceptor and not 85 rewrites
//
// final_audit_fix_plan/05 §A4 step 1 called for converting the 85 files that
// call fetch("/api/…") directly onto lib/api-client.js. Reading those call
// sites, that conversion is not mechanical: apiClient.request() returns PARSED
// JSON and THROWS on a non-2xx, while raw fetch returns a Response and leaves
// `res.ok` / `await res.json()` / error handling to the caller. Converting
// means rewriting the error handling of 85 files by hand, with no test suite
// to catch a missed branch.
//
// This does the same job in one file and changes no semantics: callers still
// get a Response, still read res.ok, still parse it themselves. The only
// difference is that a 401 is now retried once behind a refresh before they
// ever see it.
//
// ## What it deliberately does NOT touch
//
//   - anything that is not a same-origin /api/* request (R2 uploads, Brevo,
//     Turnstile, any absolute URL to another host)
//   - /api/auth/refresh itself, which would recurse
//   - requests whose body cannot be replayed (see canReplay)
//   - the server: this only ever runs in a browser
//
// ## Idempotency
//
// install() is safe to call repeatedly — React strict mode double-invokes
// effects in development, and a double-patched fetch would refresh twice and
// invalidate its own rotated token.

import { attemptRefresh, announceSessionEnded, fallbackRedirect } from "@/lib/session-refresh";

const PATCHED = "__aapliFetchPatched";

/**
 * A retry re-sends `init`. That is safe for the shapes below, and unsafe for a
 * stream — a ReadableStream body is consumed by the first attempt and the
 * retry would send an empty or errored body. Those requests still get the
 * refresh; they just are not replayed, and the caller sees the 401 as before.
 */
function canReplay(init) {
  const body = init?.body;
  if (body === undefined || body === null) return true;
  if (typeof body === "string") return true;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return true;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return true;
  if (ArrayBuffer.isView?.(body)) return true;
  return false; // ReadableStream and anything unrecognised
}

/** Same-origin /api/* only. Never an absolute URL to another host. */
function isOwnApiRequest(url) {
  try {
    const resolved = new URL(url, window.location.origin);
    if (resolved.origin !== window.location.origin) return false;
    return resolved.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

function isRefreshEndpoint(url) {
  try {
    return new URL(url, window.location.origin).pathname === "/api/auth/refresh";
  } catch {
    return false;
  }
}

/**
 * Reads the 401 body for whatever reason the ROUTE itself gives (e.g.
 * `lib/rbac/authorize.js`'s `{code:"UNAUTHENTICATED"}` or `{code:"FORBIDDEN"}`)
 * — used only for the "refreshed fine, but still 401" case below, where the
 * problem is the route denying THIS request, not the session. The session's
 * own typed reasons (SESSION_IDLE_EXPIRED / SESSION_MAX_AGE / SESSION_REVOKED)
 * live on `/api/auth/refresh`'s response instead — see attemptRefresh's
 * returned `detail` in lib/session-refresh.js. Clones first — the caller
 * still owns the original body and must be able to read it.
 */
async function readReason(response) {
  try {
    const data = await response.clone().json();
    return {
      code: data?.code,
      message: data?.message || data?.error,
      userMessage: data?.userMessage,
    };
  } catch {
    return {};
  }
}

export function installApiFetchInterceptor() {
  if (typeof window === "undefined") return;
  if (window[PATCHED]) return;

  const original = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input, init) {
    // `input` may be a string, a URL, or a Request. Only a Request carries its
    // own body, and a Request body is a stream we cannot replay — so those are
    // passed straight through.
    const isRequestObject = typeof Request !== "undefined" && input instanceof Request;
    const url = isRequestObject ? input.url : String(input);

    // `__aapliHandled` is set by lib/api-client.js, which does its own
    // refresh-and-retry. Without this opt-out both layers would retry the same
    // request — harmless (they share one refresh promise, so the token is not
    // rotated twice) but two extra round trips and two session-ended calls for
    // nothing. Unknown init keys are ignored by fetch, so this costs the
    // request nothing on the wire.
    if (
      isRequestObject ||
      init?.__aapliHandled ||
      !isOwnApiRequest(url) ||
      isRefreshEndpoint(url)
    ) {
      return original(input, init);
    }

    const response = await original(input, init);
    if (response.status !== 401) return response;

    if (!canReplay(init)) {
      // Still worth refreshing — the NEXT request the page makes will succeed
      // — but this one cannot be replayed, so the caller handles the 401.
      attemptRefresh();
      return response;
    }

    const refreshed = await attemptRefresh();
    if (refreshed.ok) {
      const retried = await original(input, init);
      if (retried.status !== 401) return retried;
      // Refreshed and STILL 401: this is not an expiry, it is a revocation or
      // a permission change. Nothing more to retry — read the ROUTE's own
      // reason (it has no SESSION_* code; that's expected here).
      announceSessionEnded(await readReason(retried));
      fallbackRedirect();
      return retried;
    }

    // The refresh failed because the server or network is down, not because the
    // session ended — hand back the original response and stay signed in.
    if (refreshed.transient) return response;

    // Refresh itself failed: its response carries the typed reason.
    announceSessionEnded(refreshed.detail);
    fallbackRedirect();
    return response;
  };

  window[PATCHED] = true;
}
