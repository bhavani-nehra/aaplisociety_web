// lib/button-pending.js — one app-wide "action in progress" state.
// A capture-phase click listener marks the app busy the instant a button is
// clicked; any /api/* request that starts while busy is tracked and keeps it
// busy until it settles (+ HOLD_MS for follow-up reloads). If no request
// starts, the grace timer clears it (the click was a local action). components/brand/ActionLoader.jsx
// renders the pulse-grid loader from this state. Opt out: data-no-pending.
const GRACE_MS = 300;
const SUBMIT_GRACE_MS = 800;
// After the last tracked request settles, stay busy a little longer so the
// follow-up reload that a save usually triggers (list refetch, invalidate)
// starts under the loader instead of after it vanished.
const HOLD_MS = 600;
// Safety net: never trap the user behind the loader.
const MAX_BUSY_MS = 60000;
const BUTTON_SELECTOR = 'button, [role="button"], input[type="submit"], input[type="button"], a.btn';
const SKIP_SELECTOR =
  '[data-no-pending], aside, nav, [role="tab"], [aria-expanded], [aria-pressed], [aria-haspopup], [aria-selected]';

let installed = false;
let graceUntil = 0;
let graceTimer = null;
let inflight = 0;
let holdUntil = 0;
let busySince = 0;
let holdTimer = null;
let busy = false;
const listeners = new Set();

function recompute() {
  const now = performance.now();
  let next = inflight > 0 || now < graceUntil || now < holdUntil;
  if (next && busy && now - busySince > MAX_BUSY_MS) {
    inflight = 0;
    graceUntil = 0;
    holdUntil = 0;
    next = false;
  }
  if (next !== busy) {
    busy = next;
    busySince = now;
    listeners.forEach((l) => l());
  }
}

export const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getSnapshot = () => busy;
export const getServerSnapshot = () => false;

export function installButtonPending() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  document.addEventListener(
    "click",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest(BUTTON_SELECTOR) : null;
      if (!el || el.disabled || el.type === "reset" || el.closest(SKIP_SELECTOR)) return;
      const grace = el.type === "submit" ? SUBMIT_GRACE_MS : GRACE_MS;
      graceUntil = performance.now() + grace;
      clearTimeout(graceTimer);
      graceTimer = setTimeout(recompute, grace + 10);
      recompute();
    },
    true,
  );

  const origFetch = window.fetch.bind(window);
  window.fetch = function patchedFetch(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const promise = origFetch(input, init);
    // Track any /api request that starts while busy (not just inside the
    // click's grace window) so chained follow-up requests keep it engaged.
    if ((busy || performance.now() < graceUntil) && url.includes("/api/")) {
      inflight += 1;
      recompute();
      const done = () => {
        inflight -= 1;
        holdUntil = performance.now() + HOLD_MS;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(recompute, HOLD_MS + 10);
        recompute();
      };
      promise.then(done, done);
    }
    return promise;
  };
}
