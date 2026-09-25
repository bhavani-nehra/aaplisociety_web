"use client";

// Generate Statements — the flagship live-build screen. One click builds the
// full statutory package live from real posted General Ledger data: rows
// type out and totals count up section by section (Income → Expenditure →
// Assets → Liabilities → Trial Balance/Validation), never a spinner-then-dump.

import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "@/components/accounting/generate/Icon";
import { PageHeader, FySelect, Btn, EmptyState } from "@/components/accounting/generate/PageHeader";
import { NoFinancialYear, SetupAdvisory } from "@/components/accounting/SetupGate";
import { useFinancialYears } from "@/components/accounting/generate/useFinancialYears";
import {
  fmtINR,
  MoneyRow,
  StatRow,
  GroupCaption,
  SectionCard,
  Banner,
  HealthGauge,
} from "@/components/accounting/generate/Primitives";
import { PrintArea } from "@/components/accounting/generate/PrintArea";
import { useSocietyName } from "@/components/accounting/generate/useSocietyName";
import StatutoryStatements from "@/components/accounting/StatutoryStatements";
import notify from "@/lib/notify";

const STEPS = [
  { key: "income", label: "Income", icon: "trending-up" },
  { key: "expenditure", label: "Expenditure", icon: "trending-down" },
  { key: "assets", label: "Assets", icon: "bar-chart-3" },
  { key: "liabilities", label: "Liabilities", icon: "wallet" },
  { key: "other", label: "Validation", icon: "clipboard-list" },
];

const TOTALS_META = {
  income: { label: "Total Income", accent: "var(--success)", icon: "trending-up", title: "Income" },
  expenditure: { label: "Total Expenditure", accent: "var(--danger)", icon: "trending-down", title: "Expenditure" },
  assets: { label: "Total Assets", accent: "var(--accent)", icon: "bar-chart-3", title: "Assets" },
  liabilities: { label: "Total Liabilities & Funds", accent: "var(--primary)", icon: "wallet", title: "Liabilities & Funds" },
  other: { label: null, accent: "var(--primary)", icon: "clipboard-list", title: "Trial Balance & Validation" },
};

function scheduleRows(groups) {
  const u = [];
  (groups || []).forEach((g) => {
    if (g.accounts.length === 0) return;
    u.push({ type: "group", label: g.label });
    g.accounts.forEach((a) => u.push({ type: "row", row: { label: a.name, current: a.current, prior: a.prior } }));
  });
  return u;
}

function buildUnits({ ie, bs, health }) {
  const u = [];

  u.push({ type: "header", sectionKey: "income" });
  u.push(...scheduleRows(ie.income).map((x) => ({ ...x, sectionKey: "income" })));
  u.push({ type: "total", sectionKey: "income" });

  u.push({ type: "header", sectionKey: "expenditure" });
  u.push(...scheduleRows(ie.expense).map((x) => ({ ...x, sectionKey: "expenditure" })));
  if (ie.depreciationGroup) u.push(...scheduleRows([ie.depreciationGroup]).map((x) => ({ ...x, sectionKey: "expenditure" })));
  u.push({ type: "total", sectionKey: "expenditure" });
  u.push({ type: "banner", sectionKey: "expenditure", banner: "surplus" });

  u.push({ type: "header", sectionKey: "assets" });
  u.push(...scheduleRows(bs.assets).map((x) => ({ ...x, sectionKey: "assets" })));
  u.push({ type: "total", sectionKey: "assets" });

  u.push({ type: "header", sectionKey: "liabilities" });
  u.push(...scheduleRows(bs.liabilities).map((x) => ({ ...x, sectionKey: "liabilities" })));
  u.push(...scheduleRows(bs.equity).map((x) => ({ ...x, sectionKey: "liabilities" })));
  u.push({ type: "group", sectionKey: "liabilities", label: "Income & Expenditure A/c" });
  u.push({ type: "row", sectionKey: "liabilities", row: { label: "Surplus / Deficit for the year (c/f)", current: bs.currentYearSurplusOrDeficit, prior: bs.priorYearSurplusOrDeficit } });
  u.push({ type: "total", sectionKey: "liabilities" });
  u.push({ type: "banner", sectionKey: "liabilities", banner: "balance" });

  u.push({ type: "header", sectionKey: "other" });
  (health.components || []).forEach((c) =>
    u.push({
      type: "statrow",
      sectionKey: "other",
      row: {
        label: c.label,
        value: c.passed ? "Passed" : "Failed",
        tone: c.passed ? "success" : "danger",
        icon: c.passed ? "check-circle" : "alert-triangle",
      },
    }),
  );
  u.push({ type: "banner", sectionKey: "other", banner: "health" });
  return u;
}

function bannerContent(kind, { ie, bs, health }) {
  if (kind === "surplus") {
    const s = ie.surplusOrDeficitCurrent;
    const deficit = s < 0;
    return { tone: deficit ? "danger" : "success", icon: deficit ? "trending-down" : "trending-up", text: deficit ? `Deficit for the year — Excess of Expenditure over Income: ${fmtINR(Math.abs(s))}` : `Surplus for the year — Excess of Income over Expenditure: ${fmtINR(s)}` };
  }
  if (kind === "balance") {
    const bal = bs.isBalancedCurrent;
    return { tone: bal ? "success" : "danger", icon: bal ? "check-circle" : "alert-triangle", text: bal ? "Balance Sheet balances ✓ — Total Assets = Total Liabilities & Funds" : "Balance Sheet does NOT balance — investigate" };
  }
  return { tone: "info", icon: "zap", text: `Statutory package complete — Accounting Health Score ${health.healthScore}/100.` };
}

function StepDots({ activeKey, reachedKeys }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
      {STEPS.map((s) => {
        const reached = reachedKeys.has(s.key);
        const active = s.key === activeKey;
        return (
          <div key={s.key} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderRadius: 10, background: reached ? "var(--primary-tint)" : "var(--bg-sunken)", border: `1px solid ${reached ? "var(--accent)" : "var(--border)"}` }}>
            <span style={{ width: 24, height: 24, borderRadius: "50%", background: reached ? "var(--primary)" : "var(--border)", color: reached ? "#fff" : "var(--fg-5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, animation: active ? "acctPulse 1.4s ease infinite" : "none" }}>
              <Icon name={s.icon} size={12} />
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: reached ? "var(--primary)" : "var(--fg-5)", whiteSpace: "nowrap" }}>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function GenerateStatementsScreen() {
  const { years, financialYearId, setFinancialYearId, loading: fyLoading } = useFinancialYears();
  const [data, setData] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | generating | done
  const [revealCount, setRevealCount] = useState(0);
  const [stamp, setStamp] = useState(null); // {hash, generatedAt, generatedByName} once exported
  const [stamping, setStamping] = useState(false);
  const society = useSocietyName();

  const loadData = useCallback(async (fyId) => {
    if (!fyId) return;
    setFetching(true);
    setFetchError(null);
    setStatus("idle");
    setRevealCount(0);
    try {
      const [{ statement: ie }, { statement: bs }, { dashboard: health }, { trialBalance }] = await Promise.all([
        fetchJSON(`/api/accounting/financial-statements/income-expenditure?financialYearId=${fyId}`),
        fetchJSON(`/api/accounting/financial-statements/balance-sheet?financialYearId=${fyId}`),
        fetchJSON(`/api/accounting/health-dashboard?financialYearId=${fyId}`),
        fetchJSON(`/api/accounting/trial-balance?financialYearId=${fyId}`),
      ]);
      setData({ ie, bs, health, trialBalance });
    } catch (e) {
      setFetchError(e.message);
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => { loadData(financialYearId); }, [financialYearId, loadData]);

  const units = useMemo(() => (data ? buildUnits(data) : []), [data]);

  useEffect(() => {
    if (status !== "generating") return;
    if (revealCount >= units.length) { setStatus("done"); return; }
    const u = units[revealCount];
    const delay = u.type === "header" ? 400 : u.type === "banner" ? 280 : u.type === "total" ? 240 : u.type === "group" ? 160 : 95;
    const t = setTimeout(() => setRevealCount((c) => c + 1), delay);
    return () => clearTimeout(t);
  }, [status, revealCount, units]);

  const start = () => { setRevealCount(0); setStatus("generating"); };

  /**
   * Export (signed) — stamps this exact statement with a hash before
   * printing, so the PDF a print-to-PDF produces carries proof of what it
   * said and when. Failure to stamp never blocks the print itself; the
   * admin still gets an unstamped PDF rather than no PDF.
   */
  const exportSigned = useCallback(async () => {
    setStamping(true);
    try {
      const res = await fetch("/api/accounting/statements/export-receipt", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financialYearId, financialYearLabel: data.ie.financialYearLabel,
          ie: data.ie, bs: data.bs, trialBalance: data.trialBalance,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.receipt) {
        setStamp({
          hash: json.receipt.hash,
          generatedAt: json.receipt.generatedAt,
          generatedByName: json.receipt.generatedByName,
        });
      } else {
        notify.error(json.error || "Could not stamp the export — printing unstamped.");
      }
    } catch {
      notify.error("Could not stamp the export — printing unstamped.");
    } finally {
      setStamping(false);
      // The stamp render above needs a tick to reach the print DOM before print() reads it.
      setTimeout(() => window.print(), 50);
    }
  }, [financialYearId, data]);
  // View-only reset: clears this page's revealed build back to the empty
  // state. Touches nothing but local component state — no API call, no
  // ledger data, no other accounting page affected.
  const resetView = () => { setStatus("idle"); setRevealCount(0); };

  const revealed = units.slice(0, revealCount);
  const reachedKeys = new Set(revealed.map((u) => u.sectionKey));
  const activeKey = status === "generating" ? (units[revealCount] || units[units.length - 1])?.sectionKey : (status === "done" ? "other" : null);

  const renderStep = (key) => {
    const sectionUnits = revealed.filter((u) => u.sectionKey === key);
    if (sectionUnits.length === 0) return <div key={key} />;
    const meta = TOTALS_META[key];
    const totalUnit = sectionUnits.find((u) => u.type === "total");
    const bannerUnit = sectionUnits.find((u) => u.type === "banner");
    const totals = {
      income: { current: data.ie.totalIncomeCurrent, prior: data.ie.totalIncomePrior },
      expenditure: { current: data.ie.totalExpenseCurrent, prior: data.ie.totalExpensePrior },
      assets: { current: data.bs.totalAssetsCurrent, prior: data.bs.totalAssetsPrior },
      liabilities: { current: data.bs.totalLiabilitiesCurrent + data.bs.totalEquityInclSurplusCurrent, prior: data.bs.totalLiabilitiesPrior + data.bs.totalEquityInclSurplusPrior },
    }[key];

    if (key === "other") {
      return (
        <div key={key} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
          <SectionCard title={meta.title} subtitle="Checked before the statutory statements are signed off" accent={meta.accent} icon={meta.icon}>
            {sectionUnits.filter((u) => u.type === "statrow").map((u, i) => (
              <StatRow key={i} label={u.row.label} value={u.row.value} tone={u.row.tone} icon={u.row.icon} animated />
            ))}
          </SectionCard>
          {bannerUnit && (
            <div style={{ background: "var(--bg-surface)", borderRadius: 12, border: "1px solid var(--border)", boxShadow: "0 2px 4px rgba(0,0,0,0.05)", padding: 24, textAlign: "center", animation: "acctFadeUp 0.4s ease" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-4)", marginBottom: 14 }}>Accounting Health Score</div>
              <HealthGauge score={data.health.healthScore} />
            </div>
          )}
        </div>
      );
    }

    return (
      <SectionCard
        key={key}
        title={meta.title}
        accent={meta.accent}
        icon={meta.icon}
        totalLabel={meta.label}
        totalCurrent={totalUnit ? totals.current : null}
        totalPrior={totalUnit ? totals.prior : null}
        animated
      >
        {sectionUnits.map((u, i) => {
          if (u.type === "row") return <MoneyRow key={i} label={u.row.label} current={u.row.current} prior={u.row.prior} animated />;
          if (u.type === "group") return <GroupCaption key={i}>{u.label}</GroupCaption>;
          return null;
        })}
        {bannerUnit && (() => {
          const b = bannerContent(bannerUnit.banner, data);
          return <Banner tone={b.tone} icon={b.icon} animated>{b.text}</Banner>;
        })()}
      </SectionCard>
    );
  };

  return (
    <div>
      <PageHeader
        title="Generate Statements"
        subtitle={data ? `${data.ie.financialYearLabel} · one click builds Income, Expenditure, Assets, Liabilities & Validation` : "one click builds Income, Expenditure, Assets, Liabilities & Validation"}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <FySelect years={years} value={financialYearId} onChange={setFinancialYearId} />
            {status !== "idle" && (
              <Btn variant="secondary" size="lg" onClick={resetView} disabled={status === "generating"}>
                <Icon name="refresh-ccw" size={14} /> Reset
              </Btn>
            )}
            <Btn variant="primary" size="lg" onClick={start} disabled={status === "generating" || fetching || !data}>
              <Icon name="zap" size={16} />
              {status === "generating" ? "Generating…" : status === "done" ? "Regenerate" : "Generate Final Statements"}
            </Btn>
          </div>
        }
      />

      {/* Financial Year exists, but something further down the checklist
          does not — and the output of this page gets signed. */}
      <SetupAdvisory />

      {fyLoading || fetching ? (
        <EmptyState text="Loading ledger data…" />
      ) : fetchError ? (
        <Banner tone="danger" icon="alert-triangle">{fetchError}</Banner>
      ) : !data ? (
        <NoFinancialYear what="generating statements" />
      ) : (
        <>
          {status !== "idle" && <StepDots activeKey={activeKey} reachedKeys={reachedKeys} />}

          {status === "idle" ? (
            <div style={{ border: "2px dashed var(--border-strong)", borderRadius: 14, padding: "64px 24px", textAlign: "center", color: "var(--fg-5)" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 14, color: "var(--border-strong)" }}><Icon name="zap" size={40} /></div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--fg-4)" }}>Nothing generated yet</p>
              <p style={{ margin: "6px 0 0", fontSize: 13 }}>Click Generate Final Statements to build the full statutory package for {data.ie.financialYearLabel}, live.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
                {renderStep("income")}
                {renderStep("expenditure")}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
                {renderStep("assets")}
                {renderStep("liabilities")}
              </div>
              {renderStep("other")}
            </div>
          )}

          {status === "done" && (
            <>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
                <Btn variant="secondary" onClick={() => window.print()}><Icon name="file-text" size={14} /> Print statements</Btn>
                <Btn variant="primary" disabled={stamping} onClick={exportSigned}>
                  <Icon name="shield-check" size={14} /> {stamping ? "Stamping…" : "Export (signed)"}
                </Btn>
              </div>

              <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-2)", marginBottom: 10 }}>Final statutory statements</div>
                <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                  <PrintArea>
                    {stamp ? (
                      <div style={{ fontSize: 10.5, color: "var(--fg-5)", borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 12 }}>
                        Exported by {stamp.generatedByName || "—"} on {new Date(stamp.generatedAt).toLocaleString("en-IN")} · verification hash {stamp.hash.slice(0, 16)}…
                      </div>
                    ) : null}
                    <StatutoryStatements
                      balanceSheet={data.bs}
                      incomeExpenditure={data.ie}
                      trialBalance={data.trialBalance}
                      societyName={society.name}
                      societyAddress={society.address}
                      societyRegistrationNo={society.registrationNo}
                    />
                  </PrintArea>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
