/**
 * Pure helpers for components/global/CommandBar.jsx — kept dependency-free
 * (no React, no window/localStorage) so they're safe to unit test under
 * this repo's Jest config (testEnvironment: "node", no jsdom).
 */

// DashboardLayout's `navigation` prop is a nested
// [{ title, items: [{ name, path, icon }] }] list (see
// components/adminNavigation.js). CommandBar's "Pages" search group flattens
// it directly — the nav is already permission-filtered upstream (e.g.
// useVisibleAdminNavigation), so no extra permission check happens here.
// `icon` on a flattened entry may already be a JSX element (e.g.
// <LayoutDashboard/>) or a plain emoji string (e.g. "🚪") — both render fine
// as `{page.icon}`, so CommandBar must render it directly rather than
// wrapping it in <Icon name=.../> the way record-source results do.
export function flattenNavigation(navigation) {
  if (!Array.isArray(navigation)) return [];
  const pages = [];
  for (const group of navigation) {
    if (!group || !Array.isArray(group.items)) continue;
    for (const item of group.items) {
      if (!item || !item.path) continue;
      pages.push({ label: item.name, href: item.path, icon: item.icon });
    }
  }
  return pages;
}

// Same substring-match + fails-open permission gate QuickBar's own
// pageMatches/MODULE_PAGES filter uses (components/accounting/QuickBar.jsx)
// — an entry with no `perm` always shows; one with `perm` shows only once
// `can(perm)` says so (and `can` itself fails open until permissions load,
// per lib/useCan.js).
export function filterPages(pages, needle, can = () => true, limit = 6) {
  const q = String(needle || "").trim().toLowerCase();
  if (q.length < 2 || !Array.isArray(pages)) return [];
  return pages
    .filter((p) => p?.label && (!p.perm || can(p.perm)) && p.label.toLowerCase().includes(q))
    .slice(0, limit);
}

// A recordSource's `endpoint` (e.g. /api/members/list) returns a JSON body
// shaped `{ <name>: [...items], pagination: {...} }` — the array's key name
// varies per endpoint (members/bills/notices/visitors/societies), so rather
// than requiring every commandBarConfig.recordSources entry to also declare
// which key holds the array, CommandBar takes the first array-valued
// property of the response body. Verified against the real
// /api/members/list response shape (app/api/members/list/route.js), which
// returns `{ members: [...], pagination: {...} }`. Never throws — a
// malformed/error body (e.g. `{ error: "..." }`) has no array property and
// resolves to `[]`, matching the fails-open/never-blocks contract.
export function extractResultsArray(json) {
  if (!json || typeof json !== "object") return [];
  const arr = Object.values(json).find((v) => Array.isArray(v));
  return arr || [];
}
