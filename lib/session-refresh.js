// lib/session-refresh.js
//
// The ONE place a browser session is refreshed, and the one place the app
// decides a session is over.
//
// ## Why this is its own module
//
// lib/api-client.js already had a correct coalesced refresh. The problem was
// that only 30 files use it — 85 others call fetch("/api/…") directly and had
// no refresh at all, so an expired access token under one of those pages meant
// a bare 401, an error toast, and lost work. That is the "logged out in the
// middle of work" symptom in final_audit_fix_plan/05 §A2.1.
//
// The fix (05 §A4 step 1) is a global fetch interceptor rather than rewriting
// 85 call sites, but that only works if BOTH paths share one refresh promise.
// lib/refresh-token.js rotates on use and revokes the old jti, so two
// concurrent refreshes mean the second one invalidates the first — every
// request that was waiting on it then fails for real. Coalescing has to be
// global, not per-module, which is why it lives here and both callers import
// it.
//
// ## Session-over handling
//
// api-client used to call window.location.href = "/auth/login" directly. That
// throws away whatever the user had typed, with no warning and no way back.
// This module emits an event instead; the dialog that listens for it is
// Plan 05 §A5. Until that dialog exists, `fallbackRedirect` preserves today's
// behaviour so nothing regresses in the meantime.

/** Emitted on `window` when a session cannot be recovered. */
export const SESSION_ENDED_EVENT = "aapli:session-ended";

let refreshInFlight = null;

// The refresh token ROTATES on every use (lib/refresh-token.js revokes the
// old jti and issues a new one) — a token presented a second time is treated
// as reuse and rejected. `refreshInFlight` above only coalesces calls within
// ONE tab's JS runtime; it does nothing for a second browser TAB of the same
// origin, which has its own separate module instance and its own separate
// "nothing in flight" belief. Two tabs whose access tokens both happen to
// expire around the same time can each independently call
// /api/auth/refresh with the SAME refresh cookie: the first to reach the
// database wins and rotates it, the second's now-already-revoked token is
// rejected with SESSION_REVOKED — and that failure response clears the
// refresh cookie (see clearRefreshCookie in the route), which is shared
// browser-wide storage, wiping out the valid new cookie the first tab just
// received. Net result: a real, fresh session dies for every tab, cookies
// look present right up until that clear, and re-login is the only way out
// — exactly the "signed out mid-session with valid-looking cookies" report.
// The Web Locks API serializes this across tabs: whichever tab's request
// arrives at fetch() second simply waits for the lock, then sends whatever
// refresh cookie the browser is holding AT THAT MOMENT (cookies are read
// fresh per-request, never cached in JS) — which is already the first tab's
// freshly-rotated one, so its own request succeeds instead of colliding.
// Falls back to the plain per-tab behavior on a browser without Web Locks
// (Safari <15.4) — better than nothing, not a regression from before.
async function withCrossTabLock(fn) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("aapli-refresh-lock", fn);
  }
  return fn();
}

/**
 * At most one /api/auth/refresh call is in flight across the whole app —
 * within this tab via `refreshInFlight`, and across every tab of this origin
 * via the Web Locks API (see withCrossTabLock above). Concurrent callers
 * await the same promise.
 *
 * Plan 05 §A4: `/api/auth/refresh` itself is the ONLY place the typed reason
 * (SESSION_IDLE_EXPIRED / SESSION_MAX_AGE / SESSION_REVOKED / ACCOUNT_BLOCKED)
 * is ever produced — an arbitrary failing API route's own 401 body never
 * carries one of these codes, only the refresh endpoint's does. So callers
 * that want to show WHY a session ended must read it from here, not from
 * whatever request originally triggered the refresh attempt.
 *
 * @returns {Promise<{ok:true} | {ok:false, transient?:boolean, detail:{code?:string, message?:string, userMessage?:string}}>}
 */
export function attemptRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = withCrossTabLock(() =>
      fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      })
        .then(async (res) => {
          if (res.ok) return { ok: true };
          const body = await res.clone().json().catch(() => ({}));
          // Only a 401/403 from the refresh endpoint means the session is over.
          // A 5xx (database unreachable, deploy in progress) or a network error is
          // transient — logging the user out for it turned every outage into a
          // "session took too long" sign-out.
          const transient = res.status >= 500 || res.status === 429 || res.status === 408;
          return {
            ok: false,
            transient,
            detail: { code: body?.code, message: body?.message || body?.error, userMessage: body?.userMessage },
          };
        })
        .catch(() => ({ ok: false, transient: true, detail: {} })),
    ).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

let ended = false;

/**
 * The session is over and cannot be refreshed. Announces it once per page
 * lifetime — a burst of parallel 401s must not produce a burst of dialogs or
 * a redirect loop.
 *
 * @param {object} [detail] shape from the server's 401 body where available:
 *        { code, message, userMessage }. Plan 05 §A4 defines the codes
 *        (SESSION_IDLE_EXPIRED / SESSION_MAX_AGE / SESSION_REVOKED /
 *        ACCOUNT_BLOCKED); until that lands, `code` is usually undefined and
 *        the listener shows a generic message.
 */
export function announceSessionEnded(detail = {}) {
  if (typeof window === "undefined" || ended) return;
  ended = true;
  window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail }));
}

/**
 * Hard redirect to login — the pre-existing behaviour, kept as a fallback for
 * as long as no listener is mounted for SESSION_ENDED_EVENT. Once Plan 05 §A5
 * ships the dialog, this stops firing on its own because the dialog sets
 * `window.__aapliSessionDialogMounted`.
 */
export function fallbackRedirect() {
  if (typeof window === "undefined") return;
  if (window.__aapliSessionDialogMounted) return;
  window.location.href = "/auth/login";
}

/** Test/navigation helper: lets a fresh login re-arm the announcement. */
export function resetSessionEndedFlag() {
  ended = false;
}
