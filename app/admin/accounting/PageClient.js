"use client";
/**
 * Accounting overview — built against the same "Pulse" kit as
 * /admin/dashboard (components/revamp): needs-attention tiles first, then a
 * bento of numbers, then context.
 *
 * The first version of this page was a column of prose. It read like
 * documentation, which is the opposite of the point: a checklist is scanned,
 * not read. Same content, same wording from AccountingSetupStateService — the
 * change here is entirely presentational.
 *
 * Every figure comes from /api/accounting/setup-state.
 */
import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  PageHeader, SectionLabel, ActionTile, Card, CardHead,
  Progress, Pill, Btn, Icon, EmptyState, RevampSkeleton, Modal, SmallStat,
} from "@/components/revamp";
import FinancialYearsPage from "./financial-years/PageClient";
import PostingRulesPage from "./posting-rules/PageClient";
import ValidationRulesPage from "./validation-rules/PageClient";
import FiscalConfigPage from "./fiscal-config/PageClient";
import AccountingSetupPage from "./setup/PageClient";

// Page 1 of the 6-page accounting environment: Configuration. Everything
// small — financial years, posting rules, book checks, fiscal mappings, the
// one-time guided setup — lives on this one page as tap-to-open cards, each
// opening a centered dialog (Modal) with the full section inside. Not a
// scrolling list of collapsed text, not a drawer sliding in from the side —
// a card grid you tap, exactly the Pulse pattern this environment is built
// around everywhere else.
const CONFIG_SECTIONS = [
  { key: "setup", icon: "zap", title: "Guided Setup", sub: "One-time: seed the standard heads, rules and checks", accent: "var(--r-brand)", Body: AccountingSetupPage },
  { key: "financial-years", icon: "calendar", title: "Financial Years", sub: "Create and advance the year", accent: "var(--r-accent)", Body: FinancialYearsPage },
  { key: "posting-rules", icon: "repeat", title: "Automatic Entries", sub: "What posts itself when a bill or payment happens", accent: "var(--r-success)", Body: PostingRulesPage },
  { key: "validation-rules", icon: "shield-check", title: "Book Checks", sub: "What's verified before a statement prints", accent: "var(--r-warning)", Body: ValidationRulesPage },
  { key: "fiscal-config", icon: "sliders-horizontal", title: "Fiscal Configuration", sub: "Default account mappings", accent: "var(--r-brand)", Body: FiscalConfigPage },
];

/** "1 April 2026" — never a bare "1 April", which could be any year. */
const fullDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : "—";

const STEP_ICON = {
  financialYear: "calendar",
  chartOfAccounts: "book-open",
  postingRules: "settings",
  validationRules: "shield",
  schedules: "layout-template",
  openingBalances: "wallet",
  activity: "receipt",
};

function AccountingOverviewPageInner() {
  const router = useRouter();
  const [openKey, setOpenKey] = useState(null);
  const openSection = CONFIG_SECTIONS.find((s) => s.key === openKey) || null;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["accounting-setup-state"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/setup-state", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the checklist");
      return json;
    },
    staleTime: 30_000,
  });

  // Open auditor queries surface in "Do this next" (design doc §8: "admin
  // sees it in the Hub's 'Do this next'"). A role without auditor.workspace.
  // view (most of them) gets a 403 here, which the query just treats as "no
  // open queries" rather than an error the Hub has to explain.
  const { data: openNotes } = useQuery({
    queryKey: ["accounting-auditor-open-notes"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/auditor/notes?status=Open", { credentials: "include" });
      if (!res.ok) return [];
      const json = await res.json().catch(() => ({}));
      return json.notes || [];
    },
    staleTime: 30_000,
  });
  const openQueryCount = openNotes?.length || 0;

  const steps = data?.steps || [];
  const outstanding = useMemo(() => steps.filter((s) => s.status !== "done"), [steps]);
  const done = useMemo(() => steps.filter((s) => s.status === "done"), [steps]);
  const next = data?.nextStep;
  const fy = data?.financialYear;
  const c = data?.counts || {};
  const health = data?.health;

  const total = steps.length || 1;
  const pct = Math.round((done.length / total) * 100);
  const pctColor = pct === 100 ? "var(--r-success)" : pct >= 50 ? "var(--r-warning)" : "var(--r-danger)";

  const failing = (health?.components || []).filter((h) => !h.passed);

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      <PageHeader
        title="Configuration"
        sub={fy ? `Working year ${fy.label}, ${fullDate(fy.startDate)} to ${fullDate(fy.endDate)}.` : "No financial year yet. Create one to start keeping books."}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {fy ? <Pill tone={fy.status === "Locked" ? "neutral" : "paid"}>{fy.status}</Pill> : null}
            <Btn variant="secondary" onClick={() => refetch()}>Check again</Btn>
          </div>
        }
      />

      {isLoading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={120} /><RevampSkeleton h={220} />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon="alert-triangle" title="Could not load the checklist" sub={error.message} />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Btn variant="primary" onClick={() => refetch()}>Try again</Btn>
          </div>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 20 }}>
            <SectionLabel icon="alert-circle">{next ? "Do this next" : "Needs attention"}</SectionLabel>
            {!next && !failing.length && !openQueryCount ? (
              <p style={{ fontSize: 13, color: "var(--r-fg-3)" }}>Setup is complete and every book check passes.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {next ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13 }}><strong>{next.label}.</strong> {next.detail}</span>
                    {next.href ? <Btn size="sm" onClick={() => router.push(next.href)}>{next.fix ? "Fix it" : "Open"}</Btn> : null}
                  </div>
                ) : null}
                {failing.length ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13 }}><strong>{failing.length} book check{failing.length === 1 ? "" : "s"} failing.</strong> {failing[0]?.reason || "Statements may not print correctly."}</span>
                    {failing[0]?.navigationTarget ? <Btn size="sm" onClick={() => router.push(failing[0].navigationTarget)}>See why</Btn> : null}
                  </div>
                ) : null}
                {openQueryCount ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13 }}><strong>{openQueryCount} auditor quer{openQueryCount === 1 ? "y" : "ies"}</strong> waiting for an answer.</span>
                    <Btn size="sm" onClick={() => router.push("/admin/accounting/auditor?tab=queries")}>Answer queries</Btn>
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          <Card style={{ marginBottom: 24 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 32, alignItems: "start" }}>
              <div>
                <SmallStat icon="check-circle" label="Accounting setup" value={`${done.length} of ${steps.length}`} />
                <p style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 8, lineHeight: 1.6 }}>
                  {outstanding.length ? <><strong>{outstanding.length}</strong> step{outstanding.length === 1 ? "" : "s"} left, each waiting on the one above it. </> : "Every setup step is done. "}
                  {fy ? <>{fy.label} runs {fullDate(fy.startDate)} to {fullDate(fy.endDate)}; opening figures are {fy.openingBalancesConfirmed ? "carried in" : <strong>not entered yet</strong>}.</> : <strong>No financial year has been created.</strong>}
                </p>
                <Btn variant={outstanding.length ? "primary" : "secondary"} style={{ marginTop: 10 }} onClick={() => setOpenKey("setup")}>{outstanding.length ? "Continue setup" : "Open guided setup"}</Btn>
              </div>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "1fr auto", fontSize: 14 }}>
                {[
                  { label: "Book checks passing", value: typeof health?.healthScore === "number" ? `${Math.round(health.healthScore)}%` : "Needs a financial year", tone: failing.length ? "due" : null, go: () => document.getElementById("bookhealth")?.scrollIntoView({ behavior: "smooth" }) },
                  { label: "Account heads", value: c.accountsExpected ? `${c.accounts ?? 0} of ${c.accountsExpected}` : (c.accounts ?? 0), go: () => router.push("/admin/accounting/chart-of-accounts") },
                  { label: "Receipt and payment slips", value: c.vouchers ?? 0, go: () => router.push("/admin/accounting/vouchers") },
                  { label: "Journal entries", value: c.journalEntries ?? 0, go: () => router.push("/admin/accounting/journal-entries") },
                  { label: "Financial years", value: c.financialYears ?? 0, go: () => setOpenKey("financial-years") },
                  { label: "Funds", value: c.funds ?? 0 },
                  { label: "Entry rules", value: c.postingRules ?? 0, tone: !c.postingRules ? "due" : null },
                  { label: "Health checks", value: c.validationRules ?? 0, tone: !c.validationRules ? "due" : null },
                  { label: "Statement layouts", value: c.schedules ?? 0, tone: !c.schedules ? "due" : null },
                ].map((row, i) => (
                  <div key={row.label} style={{ display: "contents" }}>
                    <dt style={{ padding: "9px 0", borderTop: i ? "1px solid var(--r-border)" : "none", color: "var(--r-fg-3)", display: "flex", alignItems: "center", gap: 8 }}>
                      {row.tone ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--r-danger)", flexShrink: 0 }} /> : null}
                      {row.go ? <button type="button" onClick={row.go} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}>{row.label}</button> : row.label}
                    </dt>
                    <dd style={{ margin: 0, padding: "9px 0", borderTop: i ? "1px solid var(--r-border)" : "none", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--r-fg-1)", fontWeight: 600 }}>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Card>

          {/* ── CHECKLIST — back to a card grid (list rows read as
              documentation for what's meant to be a working config page;
              cards with real CTAs are the right shape here). The earlier
              dead-space problem was CSS Grid's default row-stretch forcing
              every card in a row to match its tallest sibling — fixed with
              alignItems:"start" instead of by giving up the card shape. */}
          <div id="checklist" style={{ marginBottom: 24 }}>
            <SectionLabel icon="list-checks">Setup checklist</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, alignItems: "start" }}>
              {steps.map((s) => (
                <StepCard key={s.key} step={s} onGo={() => s.href && router.push(s.href)} />
              ))}
            </div>
          </div>

          {/* ── HEALTH ──────────────────────────────────────────────── */}
          {health?.components?.length ? (
            <div id="bookhealth" style={{ marginBottom: 24 }}>
              <SectionLabel icon="activity">Are the books correct?</SectionLabel>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, alignItems: "start" }}>
                {health.components.map((h) => (
                  <div
                    key={h.key}
                    style={{
                      border: "1px solid " + (h.passed ? "var(--r-hairline)" : "var(--r-danger)"),
                      borderRadius: 12, padding: 14, background: "var(--r-surface)",
                      display: "flex", flexDirection: "column", gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <Icon name={h.passed ? "check-circle" : "alert-triangle"} size={18} color={h.passed ? "var(--r-success)" : "var(--r-danger)"} />
                      {!h.passed && h.navigationTarget ? (
                        <Btn size="sm" variant="primary" onClick={() => router.push(h.navigationTarget)}>Fix</Btn>
                      ) : null}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--r-fg-1)" }}>{h.label}</div>
                      <div style={{ fontSize: 12, color: "var(--r-fg-3)", marginTop: 4, lineHeight: 1.5 }}>{h.reason}</div>
                    </div>
                    {!h.passed && h.fix ? (
                      <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", lineHeight: 1.5, paddingTop: 6, borderTop: "1px dashed var(--r-hairline)" }}>
                        {h.fix}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* ── EVERYTHING SMALL, TAP TO OPEN ───────────────────────── */}
          <div style={{ marginBottom: 8 }}>
            <SectionLabel icon="layers">Setup & configuration</SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {CONFIG_SECTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setOpenKey(s.key)}
                  style={{
                    textAlign: "left", cursor: "pointer", fontFamily: "inherit",
                    border: "1px solid var(--r-hairline)", borderRadius: 14, padding: 18,
                    background: "var(--r-surface)", display: "flex", flexDirection: "column", gap: 10,
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, background: s.accent + "1f", color: s.accent,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon name={s.icon} size={17} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--r-fg-1)" }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 4, lineHeight: 1.5 }}>{s.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <Modal open={!!openSection} onClose={() => setOpenKey(null)} title={openSection?.title} sub={openSection?.sub} width={840}>
        {openSection ? <openSection.Body /> : null}
      </Modal>
    </div>
  );
}

export default function AccountingOverviewPage() {
  return (
    <Suspense fallback={<div style={{ display: "grid", gap: 12 }}><RevampSkeleton h={120} /><RevampSkeleton h={220} /></div>}>
      <AccountingOverviewPageInner />
    </Suspense>
  );
}

/** One checklist card. Scannable: mark, name, one line of state, an action. */
function StepCard({ step, onGo }) {
  const isDone = step.status === "done";
  const isBlocked = step.status === "blocked";
  const color = isDone ? "var(--r-success)" : isBlocked ? "var(--r-fg-5)" : "var(--r-danger)";
  const icon = isDone ? "check-circle" : isBlocked ? "clock" : "circle";

  return (
    <div
      style={{
        border: "1px solid " + (isDone ? "var(--r-hairline)" : isBlocked ? "var(--r-hairline)" : "var(--r-danger)"),
        borderRadius: 12, padding: 14, background: "var(--r-surface)",
        opacity: isBlocked ? 0.62 : 1, display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <Icon name={icon} size={18} color={color} />
        {!isDone && step.href ? (
          <Btn size="sm" variant={isBlocked ? "secondary" : "primary"} onClick={onGo}>
            {isBlocked ? "View" : "Fix"}
          </Btn>
        ) : null}
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--r-fg-1)" }}>{step.label}</span>
        </div>
        {step.urgent ? <Pill tone="overdue">do this first</Pill> : null}
        {isBlocked ? <Pill tone="neutral">waiting</Pill> : null}
        <div style={{ fontSize: 12, color: "var(--r-fg-3)", marginTop: 6, lineHeight: 1.5 }}>{step.detail}</div>
      </div>
      {step.missingItems?.length ? (
        <details style={{ paddingTop: 6, borderTop: "1px dashed var(--r-hairline)" }}>
          <summary style={{ fontSize: 11.5, color: "var(--r-fg-4)", cursor: "pointer" }}>
            See the {step.missingItems.length} missing
          </summary>
          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 5, lineHeight: 1.6 }}>
            {step.missingItems.join(", ")}
          </div>
        </details>
      ) : null}
    </div>
  );
}
