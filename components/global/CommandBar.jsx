"use client";
/**
 * CommandBar — shared, config-driven search + quick actions bar mounted in
 * every area's shell (components/DashboardLayout.js today; eventually
 * components/SuperAdminLayout.js too — see
 * docs/ux-overhaul/2026-09-01-global-command-bar-design.md). Generalizes
 * components/accounting/QuickBar.jsx's proven UX — search box, `/` focus,
 * `n` quick-actions, `Esc` close-all, debounced record search, recents,
 * fails-open permission checks — into one component driven entirely by a
 * per-area `commandBarConfig` object instead of forking QuickBar per area.
 *
 * QuickBar is gone (2026-09-13 — it duplicated this component wholesale on
 * every accounting page, down to both binding the same "/" and "n" keydown
 * shortcuts globally, see app/admin/accounting/layout.js). Its three
 * accounting-only capabilities are folded in here, generically, so any
 * area's config can opt in the same way admin's now does:
 *
 *  - `extraPages` already covered QuickBar's static MODULE_PAGES list —
 *    admin's commandBarConfig now supplies the accounting module's page
 *    list through it, same as before.
 *  - A `recordSources` entry with `clientFetch`/`clientFilter` instead of
 *    `endpoint`/`query` is fetched ONCE (cached for the component's
 *    lifetime) and filtered locally on every keystroke, rather than hitting
 *    the network per keystroke — for a source with no server-side search
 *    param, like account heads (`/api/accounting/chart-of-accounts` only
 *    takes `type`/`includeInactive`/`withLock`, not a text query). This is
 *    exactly QuickBar's own `ensureAccounts()` + `accountMatches` pattern,
 *    generalized instead of copy-pasted.
 *  - `inboxFetcher` (already named in this file's Phase 1 note) is now
 *    implemented: an optional `async () => [{label, href, fixLabel,
 *    blocking}]` the caller supplies (admin's config builds it from
 *    lib/accounting/checkResolve.js, the same map Year-End Close reads, so
 *    the two can never disagree). Loaded once on mount so the bell's count
 *    badge is correct before anyone clicks it, matching QuickBar's own
 *    always-fetch behavior. Renders nothing when omitted.
 *  - `unfinishedCheck` (optional, sync, `() => {label, href} | null`) is
 *    QuickBar's "continue last unfinished workflow" localStorage scan,
 *    generalized — called once on mount, client-side only.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/revamp";
import { flattenNavigation, filterPages, extractResultsArray } from "@/lib/commandBar/utils";
import { readRecents, pushRecent } from "@/lib/recents";
import { useCan } from "@/lib/useCan";

export default function CommandBar({
  navigation = [],
  area = "default",
  recordSources = [],
  quickActions = [],
  extraPages = [],
  placeholder,
  inboxFetcher,
  inboxTitle = "Actions required",
  unfinishedCheck,
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sourceResults, setSourceResults] = useState({}); // { [source.label]: item[] }
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState([]);
  const can = useCan();
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  // label -> items[] | Promise<items[]> — populated once per clientFetch
  // source, on that source's first search, then reused for the component's
  // whole lifetime (same "fetch once, filter locally forever" contract
  // QuickBar's ensureAccounts() used).
  const clientCacheRef = useRef({});

  useEffect(() => { setRecents(readRecents(area)); }, [area]);

  // Inbox — "N actions required". Eager, not lazy: the count badge has to
  // be right before the bell is ever clicked. Renders nothing when the
  // caller supplies no inboxFetcher (every non-admin area today).
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxItems, setInboxItems] = useState(null); // null = not loaded yet
  const [inboxLoading, setInboxLoading] = useState(false);
  const loadInbox = useCallback(async () => {
    if (!inboxFetcher) return;
    setInboxLoading(true);
    try {
      setInboxItems(await inboxFetcher());
    } catch {
      setInboxItems([]);
    } finally {
      setInboxLoading(false);
    }
  }, [inboxFetcher]);
  useEffect(() => { loadInbox(); }, [loadInbox]);
  const inboxCount = inboxItems?.length ?? 0;

  // "Continue last unfinished workflow" — a single sync localStorage scan
  // the caller supplies, run once on mount. Renders nothing when omitted.
  const [unfinished, setUnfinished] = useState(null); // { label, href } | null
  useEffect(() => {
    if (!unfinishedCheck) return;
    try {
      setUnfinished(unfinishedCheck());
    } catch {
      // Best-effort, same as QuickBar's own try/catch around this scan.
    }
  }, [unfinishedCheck]);

  const pages = useMemo(() => [...flattenNavigation(navigation), ...extraPages], [navigation, extraPages]);
  const pageMatches = useMemo(() => filterPages(pages, q, can), [pages, q, can]);
  const visibleActions = quickActions.filter((a) => can(a.perm));

  // Power-user shortcuts — never required for normal use, pure
  // acceleration: "/" focuses search, "n" opens Quick Actions, "Esc" closes
  // whichever is open. Ignored while typing in any input/textarea/select so
  // normal forms across the area are unaffected. Same behaviour as
  // QuickBar's own shortcut handler.
  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;
      if (e.key === "Escape") { setOpen(false); setMenuOpen(false); setInboxOpen(false); return; }
      if (typing) return;
      if (e.key === "/") { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === "n" || e.key === "N") { e.preventDefault(); setMenuOpen((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced parallel search across every configured recordSource, each
  // independently try/caught so a failing source degrades to empty results
  // for itself only — never blocks the others or the page (spec: "Error
  // handling" / "Do: keep fails-open behavior"). A source with
  // `clientFetch` is fetched once (cached in clientCacheRef) and filtered
  // locally with `clientFilter` — no network round trip per keystroke; a
  // plain `endpoint`/`query` source still hits the network every keystroke,
  // debounced, as before.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setSourceResults({});
      if (!recents.length) setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    const controllers = recordSources.map(() => new AbortController());
    const t = setTimeout(async () => {
      const results = await Promise.all(
        recordSources.map(async (source, i) => {
          try {
            if (source.clientFetch) {
              if (!clientCacheRef.current[source.label]) {
                clientCacheRef.current[source.label] = source.clientFetch().catch(() => []);
              }
              const items = await clientCacheRef.current[source.label];
              return source.clientFilter(items || [], needle).slice(0, 6);
            }
            const url = `${source.endpoint}?${source.query}=${encodeURIComponent(needle)}&limit=6`;
            const res = await fetch(url, { credentials: "include", signal: controllers[i].signal });
            const json = await res.json().catch(() => ({}));
            return extractResultsArray(json).slice(0, 6);
          } catch {
            return [];
          }
        }),
      );
      const next = {};
      recordSources.forEach((source, i) => { next[source.label] = results[i]; });
      setSourceResults(next);
      setLoading(false);
    }, 250);
    return () => { clearTimeout(t); controllers.forEach((c) => c.abort()); };
  }, [q, recordSources, recents.length]);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setMenuOpen(false); setInboxOpen(false); } };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const goto = (href, recent) => {
    if (recent) { pushRecent(area, recent); setRecents(readRecents(area)); }
    setOpen(false); setMenuOpen(false); setQ("");
    router.push(href);
  };

  const hasAnyResults = pageMatches.length > 0 || Object.values(sourceResults).some((items) => items?.length);

  return (
    <div
      ref={boxRef}
      style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
    >
      <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 420 }}>
        <div style={{ position: "relative" }}>
          <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: 9, color: "var(--r-fg-4)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => (q.trim().length >= 2 || recents.length) && setOpen(true)}
            placeholder={placeholder || "Search a page or record… ( / )"}
            style={{
              width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8, fontSize: 13,
              border: "1px solid var(--r-hairline)", background: "var(--r-surface)", color: "var(--r-fg-1)",
            }}
          />
        </div>
        {open ? (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 40,
            background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: "var(--r-radius)",
            boxShadow: "var(--r-shadow-pop)", maxHeight: 340, overflowY: "auto",
          }}>
            {loading ? (
              <div style={{ padding: 14, fontSize: 12, color: "var(--r-fg-4)" }}>Searching…</div>
            ) : q.trim().length < 2 && recents.length ? (
              <div style={{ padding: "8px 4px" }}>
                <div style={groupTitleStyle}>Recently viewed</div>
                {recents.map((r) => (
                  <div key={`${r.type}-${r.id}`} style={rowStyle}>
                    <Icon name={r.icon || "search"} size={13} style={{ color: "var(--r-fg-4)" }} />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>{r.label}</div>
                    <button type="button" onClick={() => goto(r.href)} style={quickLinkStyle}>Open →</button>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {pageMatches.length ? (
                  <div style={{ padding: "8px 4px" }}>
                    <div style={groupTitleStyle}>Pages</div>
                    {pageMatches.map((p) => (
                      <div key={p.href} style={rowStyle}>
                        <span style={{ flexShrink: 0, display: "flex" }}>{p.icon}</span>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>{p.label}</div>
                        <button
                          type="button"
                          onClick={() => goto(p.href, { type: "page", id: p.href, label: p.label, href: p.href, icon: "file-text" })}
                          style={quickLinkStyle}
                        >Open →</button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {recordSources.map((source) => {
                  const items = sourceResults[source.label] || [];
                  if (!items.length) return null;
                  return (
                    <div key={source.label} style={{ padding: "8px 4px", borderTop: "1px solid var(--r-hairline)" }}>
                      <div style={groupTitleStyle}>{source.label}</div>
                      {items.map((item, idx) => {
                        const href = source.resultToHref(item);
                        const label = source.resultLabel(item);
                        const id = item?._id ?? item?.id ?? `${source.label}-${idx}`;
                        return (
                          <div key={id} style={rowStyle}>
                            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>{label}</div>
                            <button
                              type="button"
                              onClick={() => goto(href, { type: source.label.toLowerCase(), id, label, href, icon: source.icon || "search" })}
                              style={quickLinkStyle}
                            >Open →</button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {!loading && !hasAnyResults ? (
                  <div style={{ padding: 14, fontSize: 12, color: "var(--r-fg-4)" }}>No match for &ldquo;{q}&rdquo;.</div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      {unfinished ? (
        <button
          type="button"
          onClick={() => goto(unfinished.href)}
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
            background: "var(--r-warning-bg, #fff8e6)", color: "var(--r-warning-fg, #7a5b00)", border: "1px solid var(--r-warning, #f0c36d)", cursor: "pointer",
          }}
        >
          <Icon name="rotate-ccw" size={13} /> {unfinished.label}
        </button>
      ) : null}

      {inboxFetcher ? (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setInboxOpen((v) => !v)}
            title={inboxTitle}
            style={{
              position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
              width: 34, height: 34, borderRadius: 8, background: "var(--r-surface)",
              border: "1px solid var(--r-hairline)", cursor: "pointer",
            }}
          >
            <Icon name="bell" size={15} color="var(--r-fg-2)" />
            {inboxCount > 0 ? (
              <span style={{
                position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, padding: "0 3px", borderRadius: 999,
                background: "var(--r-danger)", color: "#fff", fontSize: 9.5, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{inboxCount}</span>
            ) : null}
          </button>
          {inboxOpen ? (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 40, width: 300,
              background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: "var(--r-radius)",
              boxShadow: "var(--r-shadow-pop)", padding: 10,
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
                {inboxLoading ? "Checking…" : inboxCount === 0 ? "You're all caught up" : `${inboxTitle} — ${inboxCount}`}
              </div>
              {!inboxLoading && inboxCount > 0 ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {inboxItems.map((item, i) => (
                    <div key={item.href || i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Icon name={item.blocking ? "alert-triangle" : "info"} size={13} color={item.blocking ? "var(--r-danger)" : "var(--r-warning)"} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--r-fg-2)" }}>{item.label}</div>
                      {item.href ? <button type="button" onClick={() => goto(item.href)} style={quickLinkStyle}>{item.fixLabel || "Fix"} →</button> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {quickActions.length ? (
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: "var(--r-brand)", color: "var(--r-brand-ink)", border: "1px solid var(--r-brand)", cursor: "pointer",
            }}
          >
            <Icon name="zap" size={14} /> Quick actions <span style={{ opacity: 0.7, fontWeight: 400 }}>(N)</span>
          </button>
          {menuOpen ? (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 40, minWidth: 220,
              background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: "var(--r-radius)",
              boxShadow: "var(--r-shadow-pop)", padding: 6,
            }}>
              {visibleActions.length === 0 ? (
                <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--r-fg-4)" }}>No quick actions available for your role.</div>
              ) : null}
              {visibleActions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => goto(a.href)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                    padding: "8px 10px", borderRadius: 6, fontSize: 13, color: "var(--r-fg-1)",
                    background: "transparent", border: "none", cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--r-surface-2)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <Icon name={a.icon} size={14} /> {a.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const groupTitleStyle = {
  padding: "2px 10px", fontSize: 10.5, fontWeight: 700, color: "var(--r-fg-4)",
  textTransform: "uppercase", letterSpacing: 0.4,
};

const rowStyle = { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px" };

const quickLinkStyle = {
  fontSize: 11.5, fontWeight: 600, color: "var(--r-brand)", background: "none",
  border: "none", cursor: "pointer", flexShrink: 0,
};
