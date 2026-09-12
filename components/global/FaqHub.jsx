"use client";
/**
 * FaqHub — shared "help center" presentation component for every area's
 * /<area>/help route (docs/ux-overhaul/2026-09-01-faq-docs-hub-design.md).
 * Phase 1 wires this up for the admin area only; the same component is
 * reused unchanged for member/security/superadmin in Phase 2 — `area` and
 * `data` are the only per-area inputs, the same generalize-not-fork pattern
 * CommandBar already uses elsewhere in this overhaul.
 *
 * Search is a plain client-side substring filter over question+answer —
 * content is static and small, so there's no fetch/debounce here, the same
 * reasoning as CommandBar's own page/record matching.
 *
 * `?category=` deep-link handling: HelpPanel's "View in FAQ" link (Phase 3
 * cross-link, now wired) lands here with a category name in the URL — this
 * restricts the list to that one category, with a visible "Show all" link
 * to clear it. `?q=` (CommandBar search cross-link) is still Phase 4,
 * deliberately not built here.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  PageHeader, SearchInput, Accordion, Card, CardHead, EmptyState, Icon,
} from "@/components/revamp";

const AREA_LABELS = { admin: "Admin" };

// No existing product-support contact source: grepped lib/, app/ and
// package.json for supportEmail/supportPhone/contactEmail/"Contact us" etc.
// models/Society.js DOES have contactEmail/contactPhone, but that's the
// SOCIETY's own office contact — surfaced to residents on the mobile app's
// essential-contacts screen (app/api/v1/society/contacts/route.js) — a
// different audience from an admin needing AapliSociety's own support, and
// there's no route that exposes it for this purpose anyway. Per the spec
// ("fall back to a static support email/phone if none exists yet"), this IS
// that static fallback — swap for a real source if one is ever added.
const SUPPORT_EMAIL = "support@aaplisociety.com";
const SUPPORT_PHONE = "+91 22 4900 0000";

/**
 * The real click-path for this question — numbered, connected circles, the
 * same pattern HelpPanel uses (components/global/HelpPanel.jsx StepList) and
 * the Guided Setup wizard itself uses for its 6 steps
 * (app/admin/accounting/setup/PageClient.js StepCard) — one visual language
 * for "do these in order" across the whole admin area.
 */
function FaqSteps({ steps }) {
  if (!steps || !steps.length) return null;
  return (
    <ol style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
      {steps.map((step, i) => (
        <li key={i} style={{ display: "flex", gap: 10, position: "relative", paddingBottom: i === steps.length - 1 ? 0 : 10 }}>
          {i !== steps.length - 1 ? (
            <span aria-hidden="true" style={{ position: "absolute", left: 10, top: 22, bottom: -2, width: 1, background: "var(--r-hairline)" }} />
          ) : null}
          <span style={{
            width: 21, height: 21, borderRadius: 999, flexShrink: 0, zIndex: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, color: "var(--r-brand)",
            background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)",
          }}>{i + 1}</span>
          <span style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--r-fg-2)", paddingTop: 2 }}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function FaqWatch({ lines }) {
  if (!lines || !lines.length) return null;
  return (
    <ul style={{ display: "grid", gap: 5, margin: "10px 0 0", padding: 0, listStyle: "none" }}>
      {lines.map((line, i) => (
        <li key={i} style={{ display: "flex", gap: 7, fontSize: 12.5, lineHeight: 1.5, color: "var(--r-warning)" }}>
          <Icon name="alert-triangle" size={12} color="var(--r-warning)" style={{ marginTop: 2, flexShrink: 0 }} />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

export default function FaqHub({ area, data = [] }) {
  const [query, setQuery] = useState("");
  const searchParams = useSearchParams();
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get("category") || null);
  const areaLabel = AREA_LABELS[area] || (area ? area[0].toUpperCase() + area.slice(1) : "");
  const hasQuery = query.trim().length > 0;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.filter((item) => {
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (!needle) return true;
      return item.question.toLowerCase().includes(needle) || item.answer.toLowerCase().includes(needle);
    });
  }, [data, query, categoryFilter]);

  // Categories in first-seen order, restricted to categories that still
  // have at least one match — an empty accordion for a filtered-out
  // category would just be dead chrome.
  const categories = useMemo(() => {
    const seen = [];
    for (const item of filtered) {
      if (!seen.includes(item.category)) seen.push(item.category);
    }
    return seen;
  }, [filtered]);

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="life-buoy" size={11} /> Help</>}
        title={`${areaLabel} Help Center`}
        sub="Search answers or browse by category."
      />

      <div style={{ marginBottom: 20 }}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search a question…"
          autoFocus
        />
      </div>

      {categoryFilter ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, fontSize: 12.5, color: "var(--r-fg-3)" }}>
          <span>Showing only <strong style={{ color: "var(--r-fg-1)" }}>{categoryFilter}</strong></span>
          <button
            type="button"
            onClick={() => setCategoryFilter(null)}
            style={{ border: "none", background: "none", color: "var(--r-brand)", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, padding: 0 }}
          >
            Show all categories
          </button>
        </div>
      ) : null}

      {data.length === 0 ? (
        <EmptyState icon="help-circle" title="No FAQs yet" sub="Content for this area hasn't been added." />
      ) : categories.length === 0 ? (
        <EmptyState
          icon="search"
          title="No matching questions"
          sub={
            hasQuery
              ? `No results for "${query.trim()}"${categoryFilter ? ` in "${categoryFilter}"` : ""}. Try a different search term.`
              : `No questions in "${categoryFilter}" yet.`
          }
        />
      ) : (
        categories.map((category, i) => {
          const items = filtered.filter((item) => item.category === category);
          return (
            // `key` includes hasQuery so the (uncontrolled) Accordion remounts
            // — and re-reads defaultOpen — the moment a search becomes
            // active/inactive, without fighting a user's own manual toggle
            // while they keep typing (the key doesn't change on every
            // keystroke, only on the empty↔non-empty transition).
            <Accordion
              key={`${category}-${hasQuery ? "open" : "closed"}`}
              icon="help-circle"
              title={category}
              sub={`${items.length} question${items.length === 1 ? "" : "s"}`}
              defaultOpen={hasQuery || i === 0}
            >
              {items.map((item, idx) => (
                <div
                  key={item.question}
                  style={{
                    paddingTop: idx === 0 ? 0 : 14,
                    marginTop: idx === 0 ? 0 : 14,
                    borderTop: idx === 0 ? "none" : "1px solid var(--r-hairline)",
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--r-fg-1)", marginBottom: 4 }}>
                    {item.question}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.6 }}>
                    {item.answer}
                  </div>
                  <FaqSteps steps={item.steps} />
                  <FaqWatch lines={item.watch} />
                </div>
              ))}
            </Accordion>
          );
        })
      )}

      <Card style={{ marginTop: 24 }}>
        <CardHead title="Still need help?" sub="Reach out and we'll help you sort it out." />
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13 }}>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--r-brand)", textDecoration: "none" }}
          >
            <Icon name="mail" size={14} color="var(--r-fg-4)" /> {SUPPORT_EMAIL}
          </a>
          <a
            href={`tel:${SUPPORT_PHONE.replace(/\s+/g, "")}`}
            style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--r-brand)", textDecoration: "none" }}
          >
            <Icon name="phone" size={14} color="var(--r-fg-4)" /> {SUPPORT_PHONE}
          </a>
        </div>
      </Card>
    </div>
  );
}
