/**
 * Shared "recently viewed" localStorage helper for every area's Command Bar
 * (components/global/CommandBar.jsx). Generalized from
 * lib/accounting/recents.js (left untouched — the standalone accounting
 * QuickBar keeps using it) — identical shape and cap, just namespaced by
 * area so admin/member/security/superadmin histories never collide on a
 * shared device/browser profile (spec: "recents.<area>"). Per-viewer only,
 * never reaches the server. Wrapped in try/catch throughout since a private
 * window or blocked site data makes these throw.
 */
const MAX_RECENTS = 6;

function keyFor(area) {
  return `recents.${area || "default"}`;
}

export function readRecents(area) {
  try {
    const raw = window.localStorage.getItem(keyFor(area));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function pushRecent(area, entry) {
  try {
    const list = readRecents(area).filter((r) => !(r.type === entry.type && r.id === entry.id));
    list.unshift(entry);
    window.localStorage.setItem(keyFor(area), JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    /* best-effort convenience, never blocks navigation */
  }
}
