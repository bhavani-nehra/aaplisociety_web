"use client";

// Trial Balance & Validation — read-only diagnostic. Every check is an
// accordion row: expand it for the reason (why it passed/failed) and, on a
// failure, exactly how to fix it and where. Nothing on this page writes to
// the ledger — fixes happen on the page each "Go fix it" link points to.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/accounting/generate/Icon";
import { PageHeader, FySelect, Btn, EmptyState } from "@/components/accounting/generate/PageHeader";
import { NoFinancialYear, SetupAdvisory } from "@/components/accounting/SetupGate";
import { useFinancialYears } from "@/components/accounting/generate/useFinancialYears";
import { Banner, HealthGauge } from "@/components/accounting/generate/Primitives";
import { AccordionItem } from "@/components/accounting/generate/Accordion";

async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function OtherStatementsScreen() {
  const router = useRouter();
  const { years, financialYearId, setFinancialYearId, loading: fyLoading } = useFinancialYears();
  const [dashboard, setDashboard] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!financialYearId) return;
    let cancelled = false;
    setFetching(true);
    setError(null);
    fetchJSON(`/api/accounting/health-dashboard?financialYearId=${financialYearId}`)
      .then(({ dashboard }) => { if (!cancelled) setDashboard(dashboard); })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setFetching(false));
    return () => { cancelled = true; };
  }, [financialYearId]);

  const failedComponents = dashboard ? dashboard.components.filter((c) => !c.passed) : [];
  const passedComponents = dashboard ? dashboard.components.filter((c) => c.passed) : [];

  return (
    <div>
      <PageHeader
        title="Trial Balance & Validation"
        subtitle={dashboard ? `${dashboard.financialYearLabel} · read-only — books health checked before every statement` : "Read-only — books health checked before every statement"}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <FySelect years={years} value={financialYearId} onChange={setFinancialYearId} />
            <Btn variant="secondary" onClick={() => router.push("/admin/accounting/statements?tab=generate")}>
              <Icon name="zap" size={14} /> Watch it generate live
            </Btn>
          </div>
        }
      />

      {/* Financial Year exists, but something further down the checklist
          does not — and the output of this page gets signed. */}
      <SetupAdvisory />

      {fyLoading || fetching ? (
        <EmptyState text="Loading ledger data…" />
      ) : error ? (
        <Banner tone="danger" icon="alert-triangle">{error}</Banner>
      ) : !dashboard ? (
        <NoFinancialYear what="the trial balance" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, alignItems: "start" }}>
          <div style={{ background: "var(--bg-surface)", borderRadius: 12, border: "1px solid var(--border)", boxShadow: "0 2px 4px rgba(0,0,0,0.05)", overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, background: "var(--bg-sunken)" }}>
              <span style={{ width: 34, height: 34, borderRadius: 8, background: "var(--primary)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon name="clipboard-list" size={17} />
              </span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg-2)" }}>Books health</div>
                <div style={{ fontSize: 12, color: "var(--fg-4)" }}>
                  {failedComponents.length > 0
                    ? `${failedComponents.length} check(s) need attention — tap one for the reason and how to fix it`
                    : `All ${passedComponents.length} checks passed`}
                </div>
              </div>
            </div>
            {failedComponents.length > 0 && (
              <div style={{ padding: "4px 18px 4px" }}>
                {failedComponents.map((c) => (
                  <AccordionItem
                    key={c.key}
                    label={c.label}
                    passed={c.passed}
                    reason={c.reason}
                    fix={c.fix}
                    navigationTarget={c.navigationTarget}
                    defaultOpen
                  >
                    {c.key === "otherValidations" && c.failedChecks?.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                        {c.failedChecks.map((fc, i) => (
                          <div key={i} style={{ background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: 8, padding: "8px 10px" }}>
                            <div style={{ fontWeight: 600, color: "var(--danger-fg)", marginBottom: 2 }}>{fc.label}</div>
                            <div style={{ color: "var(--danger-fg)", marginBottom: fc.fix ? 6 : 0 }}>{fc.message}</div>
                            {fc.fix && (
                              <div style={{ color: "var(--warning-fg)", display: "flex", flexDirection: "column", gap: 6 }}>
                                <span><strong>How to fix:</strong> {fc.fix}</span>
                                {fc.navigationTarget && (
                                  <button
                                    onClick={() => router.push(fc.navigationTarget)}
                                    style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, background: "var(--primary)", border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}
                                  >
                                    Go fix it
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {c.items?.length > 0 && (
                      <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                        {c.items.slice(0, 10).map((it, i) => (
                          <li key={i} style={{ color: "var(--fg-4)" }}>{typeof it === "string" ? it : it.name || it.label || JSON.stringify(it)}</li>
                        ))}
                      </ul>
                    )}
                  </AccordionItem>
                ))}
              </div>
            )}

            {passedComponents.length > 0 && (
              <div style={{ padding: failedComponents.length > 0 ? "10px 18px 12px" : "4px 18px 12px" }}>
                {failedComponents.length > 0 && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-5)", margin: "8px 0 6px" }}>
                    Passed ({passedComponents.length})
                  </div>
                )}
                {passedComponents.map((c) => (
                  <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0" }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: "var(--success-bg)", color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon name="check-circle" size={13} />
                    </span>
                    <span style={{ fontSize: 13, color: "var(--fg-3)" }}>{c.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: "var(--bg-surface)", borderRadius: 12, border: "1px solid var(--border)", boxShadow: "0 2px 4px rgba(0,0,0,0.05)", padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-4)", marginBottom: 14 }}>Accounting Health Score</div>
            <HealthGauge score={dashboard.healthScore} />
            <div style={{ fontSize: 12, color: "var(--fg-5)", marginTop: 12 }}>Weighted across Trial Balance, validation checks, reconciliation and closing readiness.</div>
          </div>
        </div>
      )}
    </div>
  );
}
