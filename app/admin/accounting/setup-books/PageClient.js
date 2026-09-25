"use client";
/**
 * Set up your books — the six setup jobs in the order a person does them.
 * Every section is the existing screen, mounted only when its section is
 * opened (the Accordion renders children on open), so the page itself costs
 * one call: /api/accounting/setup-state for the ticks.
 */
import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { PageHeader, Icon, RevampSkeleton, Accordion, Pill, Progress, Btn } from "@/components/revamp";
import FinancialYearsPage from "../financial-years/PageClient";
import ChartOfAccountsPage from "../chart-of-accounts/PageClient";
import AccountingSetupPage from "../setup/PageClient";
import FiscalConfigPage from "../fiscal-config/PageClient";
import OpeningBalancesPage from "../../opening-balances/PageClient";
import FormatPage from "../format/PageClient";
import PostingRulesPage from "../posting-rules/PageClient";
import ValidationRulesPage from "../validation-rules/PageClient";

const DONE = "done";

function stepOf(steps, key) {
  return (steps || []).find((s) => s.key === key) || null;
}

function Part({ title, children }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--r-fg-4)", margin: "10px 0 8px" }}>{title}</div>
      {children}
    </div>
  );
}

const SECTIONS = [
  {
    key: "year",
    icon: "calendar",
    title: "1. Your year",
    sub: "The year your books run for — 1 April to 31 March.",
    status: (st) => stepOf(st.steps, "financialYear")?.status,
    Body: () => <FinancialYearsPage />,
  },
  {
    key: "heads",
    icon: "book-open",
    title: "2. Account heads",
    sub: "The list of heads every rupee is written under (chart of accounts).",
    status: (st) => stepOf(st.steps, "chartOfAccounts")?.status,
    Body: () => <ChartOfAccountsPage />,
  },
  {
    key: "turn-on",
    icon: "zap",
    title: "3. Turn on the books",
    sub: "One button sets up heads, automatic entries and checks. The Books switch then picks which heads bills and payments use.",
    status: (st) => {
      const need = ["chartOfAccounts", "postingRules", "validationRules"].map((k) => stepOf(st.steps, k)?.status);
      if (need.some((s) => s === "blocked")) return "blocked";
      return st.accountingEnabled && need.every((s) => s === DONE) ? DONE : "missing";
    },
    Body: () => (
      <>
        <Part title="Set everything up"><AccountingSetupPage /></Part>
        <Part title="Books switch"><FiscalConfigPage /></Part>
      </>
    ),
  },
  {
    key: "opening",
    icon: "wallet",
    title: "4. Where you stood on 1 April",
    sub: "Bank, cash, dues owed by members, funds — the figures the year starts from.",
    status: (st) => stepOf(st.steps, "openingBalances")?.status,
    Body: () => <OpeningBalancesPage />,
  },
  {
    key: "layout",
    icon: "layout-template",
    title: "5. Sheet layout",
    sub: "Which head prints where on the Balance Sheet and the Income & Expenditure account.",
    status: (st) => stepOf(st.steps, "schedules")?.status,
    Body: () => <FormatPage />,
  },
  {
    key: "advanced",
    icon: "settings",
    title: "6. Advanced",
    sub: "Automatic entries (what posts itself when a bill or payment happens) and book checks.",
    status: (st) => {
      const a = stepOf(st.steps, "postingRules")?.status;
      const b = stepOf(st.steps, "validationRules")?.status;
      if (a === DONE && b === DONE) return DONE;
      return a === "blocked" || b === "blocked" ? "blocked" : "missing";
    },
    Body: () => (
      <>
        <Part title="Automatic entries"><PostingRulesPage /></Part>
        <Part title="Book checks"><ValidationRulesPage /></Part>
      </>
    ),
  },
];

function Badge({ status }) {
  if (!status) return null;
  if (status === DONE) return <Pill tone="paid">Done</Pill>;
  if (status === "blocked") return <Pill tone="neutral">Later</Pill>;
  return <Pill tone="overdue">Needs you</Pill>;
}

function SetupBooksInner() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("section");
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["accounting-setup-state"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/setup-state", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the setup state");
      return json;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const statuses = SECTIONS.map((s) => (data ? s.status(data) : null));
  const done = statuses.filter((s) => s === DONE).length;
  const firstOpen = initial && SECTIONS.some((s) => s.key === initial)
    ? initial
    : SECTIONS[statuses.findIndex((s) => s && s !== DONE)]?.key;

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="book-open" size={11} /> Books</>}
        title="Set up your books"
        sub="Six jobs, top to bottom. Done means that part is finished; Needs you means it is waiting on you."
        right={<Btn variant="secondary" onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Checking…" : "Check again"}</Btn>}
      />
      {isLoading ? (
        <div style={{ display: "grid", gap: 12 }}><RevampSkeleton h={70} /><RevampSkeleton h={320} /></div>
      ) : (
        <>
          {error ? <div style={{ fontSize: 13, color: "var(--r-danger)", marginBottom: 12 }}>{error.message}</div> : null}
          <div style={{ border: "1px solid var(--r-hairline)", borderRadius: 12, background: "var(--r-surface)", padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
              <strong style={{ color: "var(--r-fg-1)" }}>{done} of {SECTIONS.length} done</strong>
              <span style={{ color: "var(--r-fg-4)" }}>{data?.financialYear ? `Year ${data.financialYear.label}` : "No year yet"}</span>
            </div>
            <Progress value={done} total={SECTIONS.length} color={done === SECTIONS.length ? "var(--r-success)" : "var(--r-brand)"} height={8} />
          </div>
          {SECTIONS.map((s, i) => (
            <Accordion key={s.key} icon={s.icon} title={s.title} sub={s.sub} badge={<Badge status={statuses[i]} />} defaultOpen={s.key === firstOpen}>
              <s.Body />
            </Accordion>
          ))}
        </>
      )}
    </div>
  );
}

export default function SetupBooksPage() {
  return (
    <Suspense fallback={<div style={{ display: "grid", gap: 12 }}><RevampSkeleton h={90} /><RevampSkeleton h={320} /></div>}>
      <SetupBooksInner />
    </Suspense>
  );
}
