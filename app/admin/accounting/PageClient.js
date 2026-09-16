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
  PageHeader, SectionLabel, ActionTile, Card, CardHead, MiniMetric,
  Progress, Pill, Btn, Icon, EmptyState, RevampSkeleton, Modal,
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
        eyebrow={
          fy ? (
            <><Icon name="calendar" size={11} /> {fy.label} · {fullDate(fy.startDate)} — {fullDate(fy.endDate)}</>
          ) : (
            <><Icon name="alert-triangle" size={11} /> No financial year yet</>
          )
        }
        title="Configuration"
        sub="Where the society's books stand, and everything small needed to set them up — one page."
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {fy ? <Pill tone={fy.status === "Locked" ? "neutral" : "paid"}>{fy.status}</Pill> : null}
            <Btn icon="refresh-cw" onClick={() => refetch()} title="Re-check">Re-check</Btn>
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
          {/* ── NEEDS ATTENTION ─────────────────────────────────────── */}
          <div style={{ marginBottom: 24 }}>
            <SectionLabel icon="sparkles">
              {next ? "Do this next" : "Needs attention"}
            </SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
              {next ? (
                <ActionTile
                  tone={next.urgent ? "danger" : "warning"}
                  icon={STEP_ICON[next.key] || "circle"}
                  headline={next.label}
                  sub={next.detail}
                  cta={next.fix ? "Fix it" : "Open"}
                  onClick={() => next.href && router.push(next.href)}
                />
              ) : (
                <ActionTile
                  tone="success"
                  icon="check-circle"
                  headline="Setup is complete"
                  sub="From here it is the monthly work — bills, payments, and statements at year end."
                  cta="Raise bills"
                  onClick={() => router.push("/admin/generate-bills")}
                />
              )}

              {failing.length ? (
                <ActionTile
                  tone="danger"
                  icon="alert-triangle"
                  headline={`${failing.length} book check${failing.length === 1 ? "" : "s"} failing`}
                  sub={failing[0]?.reason || "Statements may not print correctly."}
                  cta="See why"
                  onClick={() => failing[0]?.navigationTarget && router.push(failing[0].navigationTarget)}
                />
              ) : null}

              {openQueryCount ? (
                <ActionTile
                  tone="warning"
                  icon="message-circle-question"
                  headline={`${openQueryCount} auditor quer${openQueryCount === 1 ? "y" : "ies"} open`}
                  sub="Raised against an entry or head — the auditor is waiting on these."
                  cta="Answer"
                  onClick={() => router.push("/admin/accounting/auditor?tab=queries")}
                />
              ) : null}

              {outstanding.length > 1 ? (
                <ActionTile
                  tone="info"
                  icon="list-checks"
                  headline={`${outstanding.length} steps still to do`}
                  sub="Each one waits on the one above it. Work down the list."
                  cta="See list"
                  onClick={() => document.getElementById("checklist")?.scrollIntoView({ behavior: "smooth" })}
                />
              ) : null}
            </div>
          </div>

          {/* ── BENTO ───────────────────────────────────────────────── */}
          {/* Fixed 3-col "1.4fr 1fr 1fr" cramped every card into a squeezed
              sliver on a ~900px-wide viewport (a laptop, not a phone — this
              page is never meant to need a media query). minmax lets the
              5 cards wrap to their own rows instead, same pattern the
              SMALL STATS grid just below already uses.
              align-items defaults to "stretch" in CSS Grid, so every
              MiniMetric here was being force-stretched to match the much
              taller "Setup progress" card's height — each one drew its
              label/number/delta at the top and then just left a large
              blank gap below, which is exactly the "thin content, dead
              space underneath" look. "start" lets each card size to its
              own content instead. Each MiniMetric also now carries a real
              second data point via `extra` (a mini progress bar, a status
              pill, a failing-check list) so the empty space that opens up
              gets filled with more information, not left blank. */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.4fr) repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 14, alignItems: "start" }}>
            <Card
              hover
              onClick={() => setOpenKey("setup")}
              style={{
                display: "flex", flexDirection: "column", justifyContent: "space-between",
                cursor: "pointer",
              }}
              title="Open the guided setup"
            >
              <div>
                <CardHead
                  title="Setup progress"
                  sub={fy ? `Working year ${fy.label}` : "No financial year yet"}
                  right={<Pill tone={pct === 100 ? "paid" : "partial"}>{pct}%</Pill>}
                />
                <div className="revamp-num" style={{ fontSize: 52, fontWeight: 700, color: "var(--r-fg-1)", letterSpacing: "-0.025em", lineHeight: 1, marginBottom: 10 }}>
                  {done.length}<span style={{ fontSize: 26, color: "var(--r-fg-4)" }}> / {steps.length}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--r-fg-3)", marginBottom: 18 }}>
                  steps done · <span style={{ color: "var(--r-fg-1)", fontWeight: 600 }}>{outstanding.length}</span> remaining
                </div>
                <Progress value={pct} total={100} color={pctColor} height={8} />
              </div>
              {fy ? (
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--r-hairline)", fontSize: 12, color: "var(--r-fg-3)", lineHeight: 1.7 }}>
                  <div><strong style={{ color: "var(--r-fg-1)" }}>{fy.label}</strong> runs {fullDate(fy.startDate)} to {fullDate(fy.endDate)}</div>
                  <div>
                    Opening figures:{" "}
                    {fy.openingBalancesConfirmed
                      ? <span style={{ color: "var(--r-success)", fontWeight: 600 }}>carried in</span>
                      : <span style={{ color: "var(--r-danger)", fontWeight: 600 }}>not entered</span>}
                  </div>
                </div>
              ) : null}
            </Card>

            <MiniMetric
              label="Books health" icon="activity"
              value={typeof health?.healthScore === "number" ? `${Math.round(health.healthScore)}%` : "—"}
              tone={failing.length ? "danger" : "success"}
              delta={
                typeof health?.healthScore === "number"
                  ? failing.length ? `${failing.length} check(s) failing` : "All checks passing"
                  : "Needs a financial year first"
              }
              onClick={() => document.getElementById("bookhealth")?.scrollIntoView({ behavior: "smooth" })}
              extra={
                typeof health?.healthScore === "number" ? (
                  <div style={{ marginTop: 12 }}>
                    <Progress value={health.healthScore} total={100} color={failing.length ? "var(--r-danger)" : "var(--r-success)"} height={5} />
                    {failing.length ? (
                      <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                        {failing.slice(0, 2).map((h) => (
                          <div key={h.key} style={{ fontSize: 10.5, color: "var(--r-fg-4)", display: "flex", alignItems: "center", gap: 5 }}>
                            <Icon name="x" size={10} color="var(--r-danger)" /> {h.label}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null
              }
            />

            <MiniMetric
              label="Account heads" icon="book-open"
              value={c.accounts ?? 0}
              delta={c.accountsExpected ? `of ${c.accountsExpected} standard heads` : null}
              tone={c.accounts >= (c.accountsExpected || 0) ? "success" : "danger"}
              onClick={() => router.push("/admin/accounting/chart-of-accounts")}
              extra={
                c.accountsExpected ? (
                  <div style={{ marginTop: 12 }}>
                    <Progress
                      value={c.accounts ?? 0} total={c.accountsExpected}
                      color={(c.accounts ?? 0) >= c.accountsExpected ? "var(--r-success)" : "var(--r-warning)"}
                      height={5}
                    />
                  </div>
                ) : null
              }
            />

            <MiniMetric
              label="Entries recorded" icon="receipt"
              value={c.vouchers ?? 0}
              delta={c.vouchers ? "receipt & payment slips" : "nothing recorded yet"}
              onClick={() => router.push("/admin/ledger")}
              extra={
                <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, color: "var(--r-brand)" }}>
                  <Icon name="arrow-right" size={11} /> {c.vouchers ? "Open the ledger" : "Raise the first bill"}
                </div>
              }
            />

            <MiniMetric
              label="Financial years" icon="calendar"
              value={c.financialYears ?? 0}
              delta={fy ? `working year ${fy.label}` : "none created"}
              onClick={() => setOpenKey("financial-years")}
              extra={
                fy ? (
                  <div style={{ marginTop: 12 }}>
                    <Pill tone={fy.status === "Locked" ? "neutral" : "paid"}>{fy.status}</Pill>
                  </div>
                ) : (
                  <div style={{ marginTop: 12, fontSize: 11, fontWeight: 600, color: "var(--r-brand)", display: "flex", alignItems: "center", gap: 5 }}>
                    <Icon name="plus" size={11} /> Create one
                  </div>
                )
              }
            />
          </div>

          {/* ── SMALL STATS — one strip, not five separate cards ───────
              Five identical bordered boxes in a row was the same tile
              repeated five times with nothing but the number changed; one
              Card with hairline dividers reads as one fact with five parts,
              which is what this actually is. */}
          <Card style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", flexWrap: "wrap" }}>
              {[
                { icon: "git-branch", label: "Journal entries", value: c.journalEntries ?? 0 },
                { icon: "pie-chart", label: "Funds", value: c.funds ?? 0 },
                { icon: "settings", label: "Entry rules", value: c.postingRules ?? 0, danger: !c.postingRules },
                { icon: "shield", label: "Health checks", value: c.validationRules ?? 0, danger: !c.validationRules },
                { icon: "layout-template", label: "Statement layouts", value: c.schedules ?? 0, danger: !c.schedules },
              ].map((s, i) => (
                <div key={s.label} style={{
                  flex: "1 1 150px", padding: i ? "0 0 0 18px" : 0,
                  marginLeft: i ? 18 : 0, borderLeft: i ? "1px solid var(--r-hairline)" : "none",
                }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--r-fg-4)", fontWeight: 500 }}>
                    <Icon name={s.icon} size={13} /> {s.label}
                  </div>
                  <div className="revamp-num" style={{
                    fontSize: 24, fontWeight: 700, marginTop: 5, letterSpacing: "-0.02em",
                    color: s.danger ? "var(--r-danger)" : "var(--r-fg-1)",
                  }}>{s.value}</div>
                </div>
              ))}
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
