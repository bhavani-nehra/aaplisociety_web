// lib/idle-tracker.js — Plan 05 Part A, steps 3 and 6.
//
// The refresh token itself IS the idle timer (lib/refresh-token.js): it only
// re-issues when a request actually happens, so an active user's rotations
// keep the 2h window moving and an idle user's window simply lapses. Nothing
// server-side needs to track "idle" at all.
//
// What DOES need client-side tracking: a genuinely idle *page* must not fake
// activity by polling in the background (step 3 — hooks/useNotifications.js
// and friends), and the user deserves a warning before the window lapses on
// them mid-thought (step 6 — a person reading a long report for two hours
// without touching the mouse is working, not idle, and the timer alone
// cannot tell the difference; the warning is what makes that tolerable).
//
// Interaction, not requests, is the signal tracked here — a user who is
// reading and not clicking generates no requests either, so tying the
// warning to raw interaction is the closer proxy to "is a human here."

const INTERACTION_EVENTS = ["mousemove", "keydown", "click", "touchstart"];

// Matches lib/refresh-token.js's REFRESH_TTL — kept as a literal here rather
// than imported because that module is server-only (imports the RefreshToken
// Mongoose model) and this one runs in the browser.
export const IDLE_WINDOW_MS = 2 * 60 * 60 * 1000;

let lastInteractionAt = Date.now();
let installed = false;

function markActive() {
  lastInteractionAt = Date.now();
}

/** Idempotent — safe to call from every component that needs it. */
export function installIdleTracking() {
  if (typeof window === "undefined" || installed) return;
  installed = true;
  for (const evt of INTERACTION_EVENTS) {
    window.addEventListener(evt, markActive, { passive: true });
  }
}

export function getLastInteractionAt() {
  return lastInteractionAt;
}

export function msSinceLastInteraction() {
  return Date.now() - lastInteractionAt;
}

/** A successful refresh (e.g. from the "Stay signed in" toast) counts as activity too. */
export function resetIdleClock() {
  markActive();
}

/**
 * True when a background poller should skip its tick: the tab isn't visible,
 * or nobody has touched the page for the full idle window. Without this, an
 * open-but-abandoned tab polls forever, silently renewing the refresh token
 * and requirement 2 ("logged out if not opened for a while") never fires.
 */
export function isPageIdleForPolling() {
  if (typeof document !== "undefined" && document.hidden) return true;
  return msSinceLastInteraction() >= IDLE_WINDOW_MS;
}
