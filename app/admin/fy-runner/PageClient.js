"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader, Card, Btn, Pill, Progress, Segmented, Icon, Accordion } from "@/components/revamp";
import StatutoryStatements from "@/components/accounting/StatutoryStatements";
import { apiClient } from "@/lib/api-client";
import { postNdjson } from "@/lib/ndjson-client";
import notify from "@/lib/notify";
import { isCommercialUnit } from "@/lib/commercial/constants";

// Year Runner — runs Financial Year 2026-27 end to end on the real books:
// books setup -> opening position -> bills + collections month by month ->
// statutory statements. Every write goes through an existing route; the
// month grid is read from the Bill collection (/api/admin/fy-runner/status),
// never from anything this page remembers on its own.

const START_YEAR = 2026;
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(START_YEAR, 3 + i, 1);
  return {
    idx: i,
    year: d.getFullYear(),
    month0: d.getMonth(),
    periodId: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    short: d.toLocaleString("en-IN", { month: "short" }),
    label: d.toLocaleString("en-IN", { month: "long", year: "numeric" }),
  };
});

const OPENING_FUND_CODE = "3001";
const RECEIVABLE_CODE = "1003";
const ADVANCE_CODE = "2001";

const inr = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function StepDot({ n, state }) {
  const done = state === "done";
  const active = state === "active";
  return (
    <span
      style={{
        width: 28, height: 28, borderRadius: 999, flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 700,
        background: done ? "var(--r-success)" : active ? "var(--r-brand)" : "var(--r-surface-3)",
        color: done || active ? "#fff" : "var(--r-fg-3)",
      }}
    >
      {done ? <Icon name="check" size={15} stroke={2.5} /> : n}
    </span>
  );
}

function Row({ ok, title, detail, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--r-hairline)" }}>
      <span style={{ color: ok ? "var(--r-success)" : "var(--r-warning)", display: "inline-flex" }}>
        <Icon name={ok ? "circle-check" : "circle-dashed"} size={18} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)" }}>{title}</div>
        {detail && <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 2 }}>{detail}</div>}
      </div>
      {right}
    </div>
  );
}

function Numeric({ label, value, tone }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "var(--r-fg-3)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 650, fontFamily: "var(--r-font-num)", color: tone || "var(--r-fg-1)", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function PctInput({ value, onChange, min, max, disabled }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: 62, padding: "4px 6px", borderRadius: 6, fontSize: 14, fontWeight: 600, textAlign: "right",
          border: "1px solid var(--r-border)", background: "var(--r-surface)", color: "var(--r-fg-1)", fontFamily: "inherit",
        }}
      />
      <span style={{ fontSize: 13, color: "var(--r-fg-3)" }}>%</span>
    </span>
  );
}

export default function PageClient() {
  // ── Data from the server ────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState(null); // /api/admin/fy-runner/status
  const [setup, setSetup] = useState({ steps: [], states: {} });
  const [heads, setHeads] = useState([]);
  const [members, setMembers] = useState([]);
  const [opening, setOpening] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [tb, setTb] = useState(null);
  const [health, setHealth] = useState(null);

  // ── Page state ──────────────────────────────────────────────────────────
  const [openStep, setOpenStep] = useState(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [openingAmounts, setOpeningAmounts] = useState({});
  const [openingBusy, setOpeningBusy] = useState(false);

  const [tier, setTier] = useState("full");
  const [lessPct, setLessPct] = useState(80);
  const [advPct, setAdvPct] = useState(120);
  const [overrides, setOverrides] = useState({});
  const [untilIdx, setUntilIdx] = useState(11);
  const [run, setRun] = useState(null); // { idx, phase, done, total }
  const [log, setLog] = useState([]);
  const stopRef = useRef(false);

  const [statements, setStatements] = useState(null);
  const [stmtBusy, setStmtBusy] = useState(false);

  const fy = status?.financialYear || null;
  const fyId = fy?._id || null;

  const addLog = useCallback((tone, text) => {
    setLog((l) => [{ id: Date.now() + Math.random(), at: new Date(), tone, text }, ...l].slice(0, 200));
  }, []);

  // ── Loaders ─────────────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    const s = await apiClient.get(`/api/admin/fy-runner/status?startYear=${START_YEAR}`);
    setStatus(s);
    return s;
  }, []);

  const loadChecks = useCallback(async (id) => {
    if (!id) return;
    const [t, h, o] = await Promise.all([
      apiClient.get(`/api/accounting/trial-balance?financialYearId=${id}`).catch(() => null),
      apiClient.get(`/api/accounting/health-dashboard?financialYearId=${id}`).catch(() => null),
      apiClient.get(`/api/accounting/opening-balance?financialYearId=${id}`).catch(() => null),
    ]);
    setTb(t?.trialBalance || null);
    setHealth(h?.dashboard || null);
    setOpening(o?.status || null);
    return t?.trialBalance || null;
  }, []);

  const loadAll = useCallback(async () => {
    setLoadError("");
    try {
      const [s, su, h, m, coa] = await Promise.all([
        loadStatus(),
        apiClient.get("/api/accounting/setup/run"),
        apiClient.get("/api/billing-heads/list").catch(() => ({ heads: [] })),
        apiClient.get("/api/billing-simulator/members"),
        apiClient.get("/api/accounting/chart-of-accounts").catch(() => ({ accounts: [] })),
      ]);
      setSetup({ steps: su.steps || [], states: su.states || {} });
      setHeads(h.heads || []);
      setMembers((m.members || []).filter((x) => !isCommercialUnit(x)));
      setAccounts(coa.accounts || []);
      await loadChecks(s?.financialYear?._id);
    } catch (e) {
      setLoadError(e.message || "Could not load the page.");
    } finally {
      setLoading(false);
    }
  }, [loadStatus, loadChecks]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const months = status?.months || [];
  const billed = (i) => (months[i]?.count || 0) > 0;
  const firstBilled = months.findIndex((m) => m.count > 0);
  const lastBilled = months.reduce((acc, m, i) => (m.count > 0 ? i : acc), -1);

  const setupDone = setup.steps.length > 0 && setup.steps.every((s) => setup.states[s.key]?.done);
  const booksReady = setupDone && heads.length > 0 && members.length > 0 && !!fyId;
  const openingDone = !!opening?.openingBalancesConfirmed;
  const yearDone = billed(11) && (months[11]?.open || 0) === 0;
  const yearBilled = billed(11);

  // What one click will do, in order: finish collecting the latest month
  // that is already billed, then bill + collect every month after it.
  const queue = useMemo(() => {
    const q = [];
    if (lastBilled >= 0 && months[lastBilled].open > 0 && months[lastBilled].imported === 0) {
      q.push({ idx: lastBilled, generate: false });
    }
    for (let i = lastBilled + 1; i <= untilIdx; i++) q.push({ idx: i, generate: true });
    return q;
  }, [months, lastBilled, untilIdx]);

  const currentStep = !booksReady ? 1 : !openingDone ? 2 : !yearBilled ? 3 : 4;
  const shownStep = openStep ?? currentStep;

  // Opening-position rows: every active balance-sheet head except the fund
  // that takes the balancing figure.
  const openingRows = useMemo(
    () =>
      accounts
        .filter((a) => a.isActive !== false && ["Asset", "Liability", "Equity"].includes(a.type) && a.code !== OPENING_FUND_CODE)
        .sort((a, b) => String(a.code).localeCompare(String(b.code))),
    [accounts],
  );
  const memberDues = useMemo(
    () => members.reduce((t, m) => t + (Number(m.openingPrincipal) || 0) + (Number(m.openingInterest) || 0), 0),
    [members],
  );
  const memberAdvance = useMemo(() => members.reduce((t, m) => t + (Number(m.advanceCredit) || 0), 0), [members]);

  useEffect(() => {
    if (!openingRows.length) return;
    setOpeningAmounts((prev) => {
      if (Object.keys(prev).length) return prev;
      const next = {};
      for (const a of openingRows) {
        if (a.code === RECEIVABLE_CODE && memberDues) next[a._id] = String(Math.round(memberDues * 100) / 100);
        if (a.code === ADVANCE_CODE && memberAdvance) next[a._id] = String(Math.round(memberAdvance * 100) / 100);
      }
      return next;
    });
  }, [openingRows, memberDues, memberAdvance]);

  const openingTotals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const a of openingRows) {
      const v = Number(openingAmounts[a._id]) || 0;
      if (!v) continue;
      if ((a.normalBalance || (a.type === "Asset" ? "Debit" : "Credit")) === "Debit") dr += v;
      else cr += v;
    }
    return { dr, cr, fund: dr - cr };
  }, [openingRows, openingAmounts]);

  // ── Step 1: books ───────────────────────────────────────────────────────
  async function setUpEverything() {
    setSetupBusy(true);
    try {
      for (const s of setup.steps) {
        const done = setup.states[s.key]?.done;
        if (done && s.key !== "fiscalConfig") continue;
        addLog("info", `Setup — ${s.title}…`);
        const r = await apiClient.post("/api/accounting/setup/run", { step: s.key });
        addLog("ok", r.message || `${s.title} done.`);
      }
      notify.success("Books are set up.");
    } catch (e) {
      addLog("err", `Setup stopped: ${e.message}`);
      notify.error(e.message);
    } finally {
      await loadAll();
      setSetupBusy(false);
    }
  }

  // ── Step 2: opening position ────────────────────────────────────────────
  async function postOpening(zero) {
    if (!fyId) return;
    const fund = accounts.find((a) => a.code === OPENING_FUND_CODE);
    setOpeningBusy(true);
    try {
      if (zero) {
        if (!(await notify.confirm("Confirm this society started FY 2026-27 with nothing in the books?"))) return;
        await apiClient.post("/api/accounting/opening-balance/confirm-zero", { financialYearId: fyId });
        addLog("ok", "Opening position confirmed as zero.");
      } else {
        if (!fund) throw new Error(`Account ${OPENING_FUND_CODE} (General Fund) is missing — run Step 1 first.`);
        const entries = openingRows
          .map((a) => ({ accountId: a._id, amount: Number(openingAmounts[a._id]) || 0 }))
          .filter((e) => e.amount > 0);
        if (!entries.length) throw new Error("Enter at least one amount, or choose “Started from zero”.");
        const url = opening?.canEnterOpening === false
          ? "/api/accounting/opening-balance/correction"
          : "/api/accounting/opening-balance";
        await apiClient.post(url, { financialYearId: fyId, openingFundAccountId: fund._id, entries });
        addLog("ok", `Opening balances posted (${entries.length} heads, ${inr(openingTotals.fund)} to General Fund).`);
      }
      notify.success("Opening position saved.");
      setOpenStep(null);
    } catch (e) {
      addLog("err", `Opening balances: ${e.message}`);
      notify.error(e.message);
    } finally {
      await loadChecks(fyId);
      setOpeningBusy(false);
    }
  }

  // ── Step 3: run the year ────────────────────────────────────────────────
  function paymentsFor() {
    return members.map((m) => {
      const t = overrides[m.id] || tier;
      return { memberId: m.id, tier: t === "skip" ? "custom" : t, percent: t === "skip" ? 0 : undefined };
    });
  }

  async function collect(m) {
    setRun((r) => ({ ...r, phase: "Collecting payments" }));
    const res = await apiClient.post("/api/admin/fy-runner/apply-payments", {
      payments: paymentsFor(),
      lessPercent: lessPct,
      advancePercent: advPct,
      periodLabel: m.label,
    });
    const t = res.totals || {};
    if (t.failed) {
      const first = (res.results || []).find((r) => r.status === "Error");
      throw new Error(`${t.failed} payment(s) failed${first ? ` — ${first.error}` : ""}`);
    }
    addLog("ok", `${m.label}: collected ${inr(t.paid)} of ${inr(t.outstanding)} (${t.skipped} skipped).`);
  }

  async function runYear() {
    if (!queue.length) return;
    if (!(lessPct > 0 && lessPct < 100)) return notify.error("“Less” must be between 1 and 99%.");
    if (!(advPct > 100 && advPct <= 500)) return notify.error("“Advance” must be between 101 and 500%.");
    const from = MONTHS[queue[0].idx].label;
    const to = MONTHS[queue[queue.length - 1].idx].label;
    const ok = await notify.confirm(
      `Bill and collect ${from} → ${to} for ${members.length} members? This writes real bills, receipts and vouchers.`,
      { tone: "warning" },
    );
    if (!ok) return;

    stopRef.current = false;
    for (const step of queue) {
      if (stopRef.current) {
        addLog("info", "Stopped.");
        break;
      }
      const m = MONTHS[step.idx];
      setRun({ idx: step.idx, phase: step.generate ? "Generating bills" : "Collecting payments", done: 0, total: members.length });
      try {
        if (step.generate) {
          try {
            const res = await postNdjson(
              "/api/bills/generate-final",
              {
                billMonth: m.month0,
                billYear: m.year,
                bills: members.map((x) => ({ memberId: x.id })),
                billSeries: "RESIDENTIAL",
                publishMode: "now",
              },
              (p) => setRun((r) => ({ ...r, done: p.done ?? r.done, total: p.total ?? r.total })),
            );
            if (res.failed) {
              throw new Error(`${res.failed} bill(s) failed${res.errors?.[0] ? ` — ${res.errors[0].error || res.errors[0]}` : ""}`);
            }
            addLog("ok", `${m.label}: ${res.count ?? members.length} bills generated.`);
          } catch (e) {
            if (!/already exist/i.test(e.message)) throw e;
            addLog("info", `${m.label}: already billed — collecting only.`);
          }
        }
        await collect(m);
        setRun((r) => ({ ...r, phase: "Checking books" }));
        const [, t] = await Promise.all([loadStatus(), loadChecks(fyId)]);
        if (t && !t.isBalanced) {
          throw new Error(`Trial balance off by ${inr(Math.abs(t.difference))} after ${m.label}.`);
        }
      } catch (e) {
        addLog("err", `${m.label}: ${e.message}`);
        notify.error(`${m.label}: ${e.message}`);
        await loadStatus().catch(() => {});
        break;
      }
    }
    setRun(null);
  }

  // ── Step 4: statements ──────────────────────────────────────────────────
  async function generateStatements() {
    setStmtBusy(true);
    try {
      const [t, bs, ie] = await Promise.all([
        apiClient.get(`/api/accounting/trial-balance?financialYearId=${fyId}`),
        apiClient.get(`/api/accounting/financial-statements/balance-sheet?financialYearId=${fyId}`),
        apiClient.get(`/api/accounting/financial-statements/income-expenditure?financialYearId=${fyId}`),
      ]);
      setStatements({ tb: t.trialBalance, bs: bs.statement, ie: ie.statement });
      setTimeout(() => document.getElementById("fy-statements")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      notify.error(e.message);
    } finally {
      setStmtBusy(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ padding: 40, color: "var(--r-fg-3)", display: "flex", gap: 10, alignItems: "center" }}>
        <Icon name="loader-circle" /> Loading the year…
      </div>
    );
  }

  const steps = [
    { n: 1, title: "Books", sub: booksReady ? "Ready" : "Needs setup" },
    { n: 2, title: "Opening position", sub: openingDone ? "Confirmed" : "1 April 2026" },
    { n: 3, title: "Bills & payments", sub: `${months.filter((m) => m.count > 0).length} of 12 months` },
    { n: 4, title: "Balance Sheet", sub: yearDone ? "Ready" : "After March 2027" },
  ];
  const stepState = (n) => (n < currentStep || (n === 4 && yearDone) ? "done" : n === currentStep ? "active" : "todo");
  const running = !!run;

  return (
    <div className="fyr" style={{ maxWidth: 1240, margin: "0 auto" }}>
      <style>{`
        .fyr-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 20px; align-items: start; }
        .fyr-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 20px; }
        .fyr-months { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .fyr-tiers { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .fyr-open-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
        @media (max-width: 1000px) { .fyr-grid { grid-template-columns: 1fr; } }
        @media (max-width: 640px) {
          .fyr-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .fyr-tiers, .fyr-open-grid { grid-template-columns: 1fr; }
        }
        @media print {
          body * { visibility: hidden; }
          #fy-statements, #fy-statements * { visibility: visible; }
          #fy-statements { position: absolute; inset: 0; }
        }
      `}</style>

      <PageHeader
        title="Financial Year 2026–27"
        sub={`${status?.societyName ? `${status.societyName} · ` : ""}April 2026 to March 2027 on the live books`}
        right={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {fy ? <Pill tone="info">{fy.label} · {fy.status}</Pill> : <Pill tone="warning">No Financial Year</Pill>}
            {tb && <Pill tone={tb.isBalanced ? "paid" : "overdue"}>{tb.isBalanced ? "Books balanced" : "Books not balanced"}</Pill>}
            <Btn size="sm" icon="refresh-cw" onClick={loadAll} disabled={running}>Refresh</Btn>
          </div>
        }
      />

      {loadError && (
        <Card style={{ marginBottom: 16, borderColor: "var(--r-danger)" }}>
          <div style={{ color: "var(--r-danger)", fontWeight: 600 }}>{loadError}</div>
        </Card>
      )}

      {/* Step rail */}
      <div className="fyr-steps">
        {steps.map((s) => {
          const st = stepState(s.n);
          const selected = shownStep === s.n;
          return (
            <button
              key={s.n}
              onClick={() => setOpenStep(s.n)}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", textAlign: "left",
                borderRadius: "var(--r-radius-lg)", cursor: "pointer", fontFamily: "inherit",
                background: selected ? "var(--r-surface)" : "var(--r-surface-2)",
                border: `1px solid ${selected ? "var(--r-brand)" : "var(--r-border)"}`,
                boxShadow: selected ? "var(--r-shadow-card)" : "none",
              }}
            >
              <StepDot n={s.n} state={st} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 650, color: "var(--r-fg-1)" }}>{s.title}</span>
                <span style={{ display: "block", fontSize: 12, color: "var(--r-fg-3)" }}>{s.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="fyr-grid">
        {/* ── Left: the step being worked on ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {shownStep === 1 && (
            <Card>
              <StepTitle
                title="Get the books ready"
                sub="Financial Year, account heads, mappings, posting rules, book checks and statement layout — the same six steps as Accounting setup."
              />
              {setup.steps.map((s) => (
                <Row key={s.key} ok={!!setup.states[s.key]?.done} title={s.title} detail={setup.states[s.key]?.detail} />
              ))}
              <Row
                ok={heads.length > 0}
                title="Billing heads"
                detail={heads.length ? `${heads.length} heads will be billed every month.` : "No billing heads — bills would be empty."}
                right={!heads.length && <Link href="/admin/billing-config" style={linkStyle}>Add heads</Link>}
              />
              <Row
                ok={members.length > 0}
                title="Members"
                detail={members.length ? `${members.length} residential members will be billed.` : "No residential members."}
                right={!members.length && <Link href="/admin/import-members" style={linkStyle}>Import</Link>}
              />
              <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                <Btn variant="primary" icon="zap" onClick={setUpEverything} disabled={setupBusy || running}>
                  {setupBusy ? "Setting up…" : setupDone ? "Re-check setup" : "Set up everything"}
                </Btn>
                {booksReady && <Btn iconR="arrow-right" onClick={() => setOpenStep(2)}>Next: opening position</Btn>}
              </div>
            </Card>
          )}

          {shownStep === 2 && (
            <Card>
              <StepTitle
                title="Opening position on 1 April 2026"
                sub="What the society had and owed when the year started. The difference goes to General Fund (3001)."
              />
              {!fyId ? (
                <Notice tone="warning">Finish Step 1 first — there is no Financial Year covering 2026-27 yet.</Notice>
              ) : openingDone ? (
                <Notice tone="success">Opening balances are confirmed for {fy.label}. Nothing to do here.</Notice>
              ) : (
                <>
                  {opening?.canEnterOpening === false && (
                    <Notice tone="info">
                      {opening.voucherCount} voucher(s) are already in this year, so this will be posted as an opening-balance correction.
                    </Notice>
                  )}
                  <div className="fyr-open-grid" style={{ marginTop: 12 }}>
                    {openingRows.map((a) => (
                      <label key={a._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--r-hairline)" }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 13.5, color: "var(--r-fg-1)", fontWeight: 550, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                          <span style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{a.code} · {a.type}</span>
                        </span>
                        <input
                          inputMode="decimal"
                          placeholder="0"
                          value={openingAmounts[a._id] ?? ""}
                          onChange={(e) => setOpeningAmounts((p) => ({ ...p, [a._id]: e.target.value.replace(/[^0-9.]/g, "") }))}
                          style={{ width: 120, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--r-border)", background: "var(--r-surface)", color: "var(--r-fg-1)", textAlign: "right", fontFamily: "var(--r-font-num)", fontSize: 14 }}
                        />
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap" }}>
                    <Numeric label="Debit side" value={inr(openingTotals.dr)} />
                    <Numeric label="Credit side" value={inr(openingTotals.cr)} />
                    <Numeric label="To General Fund" value={inr(openingTotals.fund)} tone={openingTotals.fund < 0 ? "var(--r-danger)" : undefined} />
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                    <Btn variant="primary" icon="check" onClick={() => postOpening(false)} disabled={openingBusy}>
                      {openingBusy ? "Posting…" : "Post opening balances"}
                    </Btn>
                    <Btn onClick={() => postOpening(true)} disabled={openingBusy}>Started from zero</Btn>
                  </div>
                </>
              )}
            </Card>
          )}

          {shownStep === 3 && (
            <Card>
              <StepTitle
                title="Bills & payments, month by month"
                sub="Pick how members pay, press Run. Each month: generate bills → record payments → check the trial balance → next month."
              />

              {firstBilled > 0 && (
                <Notice tone="info">
                  Billing here starts in {MONTHS[firstBilled].label}. {MONTHS[0].label} – {MONTHS[firstBilled - 1].label} are before
                  that, so they come in as bill history —{" "}
                  <Link href="/admin/import-bills" style={linkStyle}>import them here</Link>. Generating them now would restart every
                  member from their opening balance and break {MONTHS[firstBilled].label}’s carried-forward dues.
                </Notice>
              )}

              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-2)", margin: "16px 0 8px" }}>Every member pays</div>
              <div className="fyr-tiers">
                <TierCard active={tier === "less"} onClick={() => setTier("less")} icon="trending-down" title="Less" disabled={running}
                  sub="Leaves dues open, interest applies">
                  <PctInput value={lessPct} onChange={setLessPct} min={1} max={99} disabled={running} />
                </TierCard>
                <TierCard active={tier === "full"} onClick={() => setTier("full")} icon="circle-check" title="Full" disabled={running}
                  sub="Clears the bill exactly">
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)" }}>100%</span>
                </TierCard>
                <TierCard active={tier === "advance"} onClick={() => setTier("advance")} icon="trending-up" title="Advance" disabled={running}
                  sub="Extra goes to member advance">
                  <PctInput value={advPct} onChange={setAdvPct} min={101} max={500} disabled={running} />
                </TierCard>
              </div>

              <div style={{ marginTop: 14 }}>
                <Accordion
                  icon="users"
                  title="Different for some members"
                  sub={Object.keys(overrides).length ? `${Object.keys(overrides).length} member(s) differ` : "Optional"}
                >
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    {members.map((m) => (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--r-hairline)", flexWrap: "wrap" }}>
                        <span style={{ flex: 1, minWidth: 140, fontSize: 13 }}>
                          <b>{m.flat}</b> <span style={{ color: "var(--r-fg-3)" }}>{m.name}</span>
                        </span>
                        <Segmented
                          value={overrides[m.id] || "same"}
                          onChange={(v) =>
                            setOverrides((p) => {
                              const n = { ...p };
                              if (v === "same") delete n[m.id];
                              else n[m.id] = v;
                              return n;
                            })
                          }
                          options={[
                            { value: "same", label: "Same" },
                            { value: "less", label: "Less" },
                            { value: "full", label: "Full" },
                            { value: "advance", label: "Adv" },
                            { value: "skip", label: "Skip" },
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                </Accordion>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
                <label style={{ fontSize: 13, color: "var(--r-fg-2)", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  Run until
                  <select
                    value={untilIdx}
                    disabled={running}
                    onChange={(e) => setUntilIdx(Number(e.target.value))}
                    style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--r-border)", background: "var(--r-surface)", color: "var(--r-fg-1)", fontFamily: "inherit", fontSize: 13 }}
                  >
                    {MONTHS.filter((m) => m.idx > lastBilled || m.idx === lastBilled).map((m) => (
                      <option key={m.idx} value={m.idx}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <div style={{ flex: 1 }} />
                {running ? (
                  <Btn variant="danger" icon="square" onClick={() => (stopRef.current = true)}>Stop after this month</Btn>
                ) : (
                  <Btn variant="primary" size="lg" icon="play" onClick={runYear} disabled={!queue.length || !booksReady || !openingDone}>
                    {queue.length
                      ? `Run ${MONTHS[queue[0].idx].short} → ${MONTHS[queue[queue.length - 1].idx].short} ${MONTHS[queue[queue.length - 1].idx].year}`
                      : "Nothing left to run"}
                  </Btn>
                )}
              </div>
              {(!booksReady || !openingDone) && (
                <div style={{ fontSize: 12.5, color: "var(--r-warning)", marginTop: 8 }}>
                  Finish {!booksReady ? "Step 1" : "Step 2"} first.
                </div>
              )}

              {run && (
                <div style={{ marginTop: 18, padding: 14, borderRadius: "var(--r-radius)", background: "var(--r-brand-soft)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, fontWeight: 600, color: "var(--r-fg-1)", marginBottom: 8 }}>
                    <span>{MONTHS[run.idx].label} — {run.phase}</span>
                    {run.phase === "Generating bills" && <span>{run.done}/{run.total}</span>}
                  </div>
                  <Progress value={run.phase === "Generating bills" ? run.done : run.phase === "Collecting payments" ? 70 : 95} total={run.phase === "Generating bills" ? run.total || 1 : 100} />
                </div>
              )}
            </Card>
          )}

          {shownStep === 4 && (
            <Card>
              <StepTitle
                title="Year-end statements"
                sub="Income & Expenditure and Balance Sheet (with Cash in Bank / Cash in Hand), current and previous year, straight from the ledger."
              />
              {!yearBilled && (
                <Notice tone="info">March 2027 is not billed yet — you can still generate the statements as they stand today.</Notice>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <Btn variant="primary" icon="file-text" onClick={generateStatements} disabled={!fyId || stmtBusy}>
                  {stmtBusy ? "Building…" : "Generate Balance Sheet"}
                </Btn>
                {statements && <Btn icon="printer" onClick={() => window.print()}>Print</Btn>}
              </div>
            </Card>
          )}

          {/* Activity */}
          {log.length > 0 && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 650, color: "var(--r-fg-1)" }}>Activity</span>
                <Btn size="sm" variant="ghost" onClick={() => setLog([])}>Clear</Btn>
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto", fontSize: 13 }}>
                {log.map((l) => (
                  <div key={l.id} style={{ display: "flex", gap: 10, padding: "4px 0" }}>
                    <span style={{ color: "var(--r-fg-4)", fontFamily: "var(--r-font-num)", flexShrink: 0 }}>
                      {l.at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span style={{ color: l.tone === "err" ? "var(--r-danger)" : l.tone === "ok" ? "var(--r-fg-1)" : "var(--r-fg-3)" }}>{l.text}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* ── Right: the year at a glance + live checks ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 650, color: "var(--r-fg-1)", marginBottom: 12 }}>The year</div>
            <div className="fyr-months">
              {MONTHS.map((m) => (
                <MonthTile
                  key={m.idx}
                  m={m}
                  data={months[m.idx]}
                  beforeStart={firstBilled > 0 && m.idx < firstBilled && !billed(m.idx)}
                  running={run?.idx === m.idx}
                  queued={!run ? false : queue.some((q) => q.idx === m.idx) && m.idx > run.idx}
                />
              ))}
            </div>
            <div style={{ display: "flex", gap: 20, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--r-hairline)", flexWrap: "wrap" }}>
              <Numeric label="Billed" value={inr(months.reduce((t, m) => t + m.charges, 0))} />
              <Numeric label="Collected" value={inr(months.reduce((t, m) => t + m.paid, 0))} tone="var(--r-success)" />
            </div>
          </Card>

          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 650, color: "var(--r-fg-1)" }}>Live checks</span>
              {health && (
                <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--r-font-num)", color: health.healthScore >= 90 ? "var(--r-success)" : health.healthScore >= 60 ? "var(--r-warning)" : "var(--r-danger)" }}>
                  {Math.round(health.healthScore)}
                  <span style={{ fontSize: 12, color: "var(--r-fg-4)", fontWeight: 500 }}>/100</span>
                </span>
              )}
            </div>
            {tb && (
              <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: "var(--r-fg-3)", marginBottom: 6 }}>
                <span>Dr {inr(tb.totalDebit)}</span>
                <span>Cr {inr(tb.totalCredit)}</span>
              </div>
            )}
            {(health?.components || []).map((c) => (
              <div key={c.key} style={{ display: "flex", gap: 8, padding: "7px 0", borderTop: "1px solid var(--r-hairline)", fontSize: 13 }}>
                <span style={{ color: c.passed ? "var(--r-success)" : "var(--r-danger)", display: "inline-flex", paddingTop: 1 }}>
                  <Icon name={c.passed ? "circle-check" : "circle-alert"} size={15} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ color: "var(--r-fg-1)" }}>{c.label}</span>
                  {!c.passed && c.reason && <span style={{ display: "block", fontSize: 12, color: "var(--r-fg-3)", marginTop: 2 }}>{c.reason}</span>}
                </span>
                {!c.passed && c.navigationTarget && <Link href={c.navigationTarget} style={linkStyle}>Fix</Link>}
              </div>
            ))}
            {!health && <div style={{ fontSize: 13, color: "var(--r-fg-3)" }}>Checks appear once the Financial Year exists.</div>}
          </Card>
        </div>
      </div>

      {statements && (
        <div id="fy-statements" style={{ marginTop: 24 }}>
          <StatutoryStatements
            balanceSheet={statements.bs}
            incomeExpenditure={statements.ie}
            trialBalance={statements.tb}
            societyName={status?.societyName}
          />
        </div>
      )}
    </div>
  );
}

const linkStyle = { fontSize: 13, fontWeight: 600, color: "var(--r-brand)", textDecoration: "none", whiteSpace: "nowrap" };

function StepTitle({ title, sub }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 17, fontWeight: 650, color: "var(--r-fg-1)" }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--r-fg-3)", marginTop: 3, maxWidth: "70ch" }}>{sub}</div>
    </div>
  );
}

function Notice({ tone = "info", children }) {
  const c = {
    info: ["var(--r-brand-soft)", "var(--r-fg-1)"],
    warning: ["var(--r-warning-soft)", "var(--r-fg-1)"],
    success: ["var(--r-success-soft)", "var(--r-fg-1)"],
  }[tone];
  return (
    <div style={{ background: c[0], color: c[1], padding: "10px 12px", borderRadius: "var(--r-radius)", fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
      {children}
    </div>
  );
}

function TierCard({ active, onClick, icon, title, sub, children, disabled }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && onClick()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && onClick()}
      style={{
        padding: 14, borderRadius: "var(--r-radius-lg)", cursor: disabled ? "default" : "pointer",
        border: `2px solid ${active ? "var(--r-brand)" : "var(--r-border)"}`,
        background: active ? "var(--r-brand-soft)" : "var(--r-surface)",
        display: "flex", flexDirection: "column", gap: 8, opacity: disabled && !active ? 0.6 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name={icon} size={17} color={active ? "var(--r-brand)" : "var(--r-fg-3)"} />
        <span style={{ fontSize: 15, fontWeight: 650, color: "var(--r-fg-1)" }}>{title}</span>
      </div>
      {children}
      <span style={{ fontSize: 12, color: "var(--r-fg-3)" }}>{sub}</span>
    </div>
  );
}

function MonthTile({ m, data, beforeStart, running, queued }) {
  const count = data?.count || 0;
  const imported = (data?.imported || 0) > 0;
  let tone = "var(--r-fg-4)";
  let label = "Not billed";
  let bg = "var(--r-surface-2)";
  if (running) {
    tone = "var(--r-brand)"; label = "Running…"; bg = "var(--r-brand-soft)";
  } else if (count > 0 && imported) {
    tone = "var(--r-fg-2)"; label = "Imported";
  } else if (count > 0 && data.open === 0) {
    tone = "var(--r-success)"; label = "Paid"; bg = "var(--r-success-soft)";
  } else if (count > 0) {
    tone = "var(--r-warning)"; label = `${data.open} open`; bg = "var(--r-warning-soft)";
  } else if (beforeStart) {
    label = "History";
  } else if (queued) {
    tone = "var(--r-fg-3)"; label = "Queued";
  }
  const pct = data?.due ? Math.min(100, (data.paid / data.due) * 100) : 0;
  return (
    <div
      title={count ? `${count} bills · due ${inr(data.due)} · paid ${inr(data.paid)}` : m.label}
      style={{
        padding: "9px 10px", borderRadius: "var(--r-radius)", background: bg,
        border: `1px solid ${running ? "var(--r-brand)" : "var(--r-hairline)"}`, minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 13.5, fontWeight: 650, color: "var(--r-fg-1)" }}>{m.short}</span>
        <span style={{ fontSize: 10.5, color: "var(--r-fg-4)" }}>{String(m.year).slice(2)}</span>
      </div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: tone, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      {count > 0 && (
        <div style={{ height: 3, borderRadius: 2, background: "var(--r-surface-3)", marginTop: 6, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--r-success)" }} />
        </div>
      )}
    </div>
  );
}
