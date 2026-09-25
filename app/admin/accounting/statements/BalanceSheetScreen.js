"use client";

// Assets & Liabilities — the prescribed co-operative housing society Balance
// Sheet format: classic two-sided T-ledger (Liabilities | Assets), prior-year
// column on the outside, current-year column on the inside, exactly as the
// auditor's statement prints it. Same StatutoryStatements renderer the
// Accounting Lab uses, so this page and the Lab never diverge.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/accounting/generate/Icon";
import { PageHeader, FySelect, Btn, EmptyState } from "@/components/accounting/generate/PageHeader";
import { NoFinancialYear, SetupAdvisory } from "@/components/accounting/SetupGate";
import { useFinancialYears } from "@/components/accounting/generate/useFinancialYears";
import { Banner } from "@/components/accounting/generate/Primitives";
import { PrintArea } from "@/components/accounting/generate/PrintArea";
import { useSocietyName } from "@/components/accounting/generate/useSocietyName";
import StatutoryStatements from "@/components/accounting/StatutoryStatements";

async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function AssetsLiabilitiesScreen() {
  const router = useRouter();
  const { years, financialYearId, setFinancialYearId, loading: fyLoading } = useFinancialYears();
  const [bs, setBs] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);
  const society = useSocietyName();

  useEffect(() => {
    if (!financialYearId) return;
    let cancelled = false;
    setFetching(true);
    setError(null);
    fetchJSON(`/api/accounting/financial-statements/balance-sheet?financialYearId=${financialYearId}`)
      .then(({ statement }) => { if (!cancelled) setBs(statement); })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setFetching(false));
    return () => { cancelled = true; };
  }, [financialYearId]);

  return (
    <div>
      <PageHeader
        title="Assets & Liabilities"
        subtitle={bs ? `Balance Sheet as at ${new Date(bs.asOf).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}` : undefined}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <FySelect years={years} value={financialYearId} onChange={setFinancialYearId} />
            <Btn variant="secondary" onClick={() => window.print()} disabled={!bs}>
              <Icon name="file-text" size={14} /> Print
            </Btn>
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
      ) : !bs ? (
        <NoFinancialYear what="the Assets &amp; Liabilities statement" />
      ) : (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <PrintArea>
            <StatutoryStatements
              balanceSheet={bs}
              societyName={society.name}
              societyAddress={society.address}
              societyRegistrationNo={society.registrationNo}
              onAccountClick={(id) => router.push(`/admin/accounting/chart-of-accounts?openLedger=${id}`)}
            />
          </PrintArea>
        </div>
      )}
    </div>
  );
}
