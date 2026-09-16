"use client";
/**
 * HelpPanel — page-level help, compact centered dialog (Modal, not Drawer —
 * a 360px full-height slide-over for 3-5 lines of content read as an
 * over-built container; see docs/design-skills/ redesign pass, 2026-09-12).
 * Mounted once per shell by HelpButton (components/global/HelpButton.jsx).
 * Content is keyed by usePathname() against a per-area static content map;
 * only the admin map exists in Phase 1
 * (docs/ux-overhaul/2026-09-01-contextual-help-design.md).
 *
 * Renders `entry.steps` as a real numbered, connected workflow (an <ol> of
 * numbered circles joined by a line — the same visual pattern the Guided
 * Setup wizard itself uses for its 6 steps, see StepCard in
 * app/admin/accounting/setup/PageClient.js), because "click this, then
 * this, then this" is what a page's help is actually for — not prose. Every
 * step names the real on-screen button/tab/field label, never a paraphrase.
 * `checklist`/`watch` render as real <ul><li> lists, not divs — screen
 * readers get list semantics (item count, position-in-set) a div can't
 * carry.
 *
 * Escape-to-close and role="dialog"/aria-modal are handled entirely inside
 * Modal (components/revamp) — this component does not add its own keydown
 * listener, and does not touch CommandBar's. Each floating panel in this
 * app closes itself independently on Escape.
 */
import { Fragment, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Modal, Icon } from "@/components/revamp";
import { ADMIN_HELP_PAGES } from "@/lib/help/pages.admin.js";

const TONE_COLOR = { ok: "var(--r-success)", warn: "var(--r-warning)", bad: "var(--r-danger)", info: "var(--r-fg-4)" };

// role (the same string DashboardLayout already receives, e.g. "Admin",
// "Member", "Security") doubles as the area identifier in this codebase —
// see app/admin/layout.js, app/member/layout.js (each passes a fixed,
// literal role= string regardless of the logged-in user's own role). Only
// "Admin" has content in Phase 1; other areas fall through to the "no help
// yet" fallback below until their own pages.<area>.js ships (spec Phase 3).
const AREA_CONTENT = {
  Admin: ADMIN_HELP_PAGES,
};

const AREA_HELP_ROUTE = {
  Admin: "/admin/help",
};

function SectionHeading({ icon, color, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, fontSize: 11.5, fontWeight: 700, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: 0.4 }}>
      <Icon name={icon} size={12} color={color} /> {children}
    </div>
  );
}

function BulletList({ icon, color, heading, lines }) {
  if (!lines || !lines.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <SectionHeading icon={icon} color={color}>{heading}</SectionHeading>
      <ul style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
        {lines.map((line, i) => (
          <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.5, color: "var(--r-fg-2)" }}>
            <Icon name={icon} size={13} color={color} style={{ marginTop: 2, flexShrink: 0 }} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The page's real shape, drawn — boxes joined by arrows, not a sentence
 * describing a shape. `entry.flow` is 3-6 short node labels; this is the
 * one thing on the panel that is an actual picture, not text with numbers.
 */
function FlowDiagram({ flow }) {
  if (!flow || flow.length < 2) return null;
  return (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5 }}>
      {flow.map((node, i) => (
        <Fragment key={i}>
          <span style={{
            padding: "7px 11px", borderRadius: 8, fontSize: 11.5, fontWeight: 700,
            color: "var(--r-fg-1)", background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)",
            whiteSpace: "nowrap",
          }}>
            {node}
          </span>
          {i !== flow.length - 1 ? <Icon name="arrow-right" size={13} color="var(--r-fg-5)" style={{ flexShrink: 0 }} /> : null}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * Fetches this society's real, current data from the same API the page
 * itself calls (entry.liveCheck, lib/help/pages.admin.js) — so this section
 * says what's actually true right now, not a static description that reads
 * the same regardless of what's really in the database.
 */
function useLiveStatus(entry, open) {
  const [state, setState] = useState({ loading: false, rows: null, error: null });
  useEffect(() => {
    if (!open || !entry?.liveCheck) {
      setState({ loading: false, rows: null, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ loading: true, rows: null, error: null });
    entry.liveCheck()
      .then((rows) => { if (!cancelled) setState({ loading: false, rows, error: null }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, rows: null, error: e?.message || "Could not check." }); });
    return () => { cancelled = true; };
  }, [entry, open]);
  return state;
}

function LiveStatus({ loading, rows, error }) {
  if (!loading && !rows?.length && !error) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <SectionHeading icon="activity" color="var(--r-brand)">Live, right now</SectionHeading>
      {loading ? (
        <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>Checking this society's real data…</div>
      ) : error ? (
        <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>Couldn't check live status: {error}</div>
      ) : (
        <div style={{ display: "grid", gap: 7 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--r-fg-2)" }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: TONE_COLOR[row.tone] || TONE_COLOR.info, flexShrink: 0 }} />
              <span>{row.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The actual click-path, as a connected number-badge timeline — mirrors
 * StepCard's own numbered circle in the Guided Setup wizard
 * (app/admin/accounting/setup/PageClient.js) so this looks like the same
 * pattern the app already uses for "do these in order", not an invented one.
 */
function StepList({ steps }) {
  if (!steps || !steps.length) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <SectionHeading icon="list-checks" color="var(--r-brand)">Steps</SectionHeading>
      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {steps.map((step, i) => (
          <li key={i} style={{ display: "flex", gap: 10, position: "relative", paddingBottom: i === steps.length - 1 ? 0 : 14 }}>
            {i !== steps.length - 1 ? (
              <span aria-hidden="true" style={{ position: "absolute", left: 11, top: 24, bottom: -2, width: 1, background: "var(--r-hairline)" }} />
            ) : null}
            <span style={{
              width: 23, height: 23, borderRadius: 999, flexShrink: 0, zIndex: 1,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11.5, fontWeight: 700, color: "var(--r-brand)",
              background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)",
            }}>{i + 1}</span>
            <span style={{ fontSize: 13, lineHeight: 1.55, color: "var(--r-fg-2)", paddingTop: 2 }}>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function HelpPanel({ open, onClose, role }) {
  const pathname = usePathname();
  const content = AREA_CONTENT[role] || null;
  const entry = content ? content[pathname] : null;
  const helpRoute = AREA_HELP_ROUTE[role] || "/admin/help";
  const live = useLiveStatus(entry, open);

  return (
    <Modal open={open} onClose={onClose} title={entry ? entry.title : "Help"} width={460}>
      {entry ? (
        <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--r-fg-2)" }}>
          <p style={{ margin: 0, fontWeight: 600, color: "var(--r-fg-1)" }}>{entry.body}</p>

          <FlowDiagram flow={entry.flow} />
          <LiveStatus loading={live.loading} rows={live.rows} error={live.error} />
          <StepList steps={entry.steps} />
          <BulletList icon="check-circle-2" color="var(--r-success)" heading="Before you click" lines={entry.checklist} />
          <BulletList icon="alert-triangle" color="var(--r-warning)" heading="Watch for" lines={entry.watch} />

          {entry.faqCategory ? (
            <a
              href={`${helpRoute}?category=${encodeURIComponent(entry.faqCategory)}`}
              style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, fontSize: 12.5, fontWeight: 600, color: "var(--r-brand)" }}
            >
              <Icon name="life-buoy" size={13} /> View "{entry.faqCategory}" in FAQ
            </a>
          ) : null}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: "var(--r-fg-4)" }}>
          No help written for this page yet — try the full FAQ below.
        </p>
      )}

      <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--r-hairline)" }}>
        <a
          href={helpRoute}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--r-brand)" }}
        >
          <Icon name="book-open" size={13} /> Browse the full Help Center
        </a>
      </div>
    </Modal>
  );
}
