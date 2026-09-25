"use client";

// Income & Expenditure Account — the prescribed co-operative housing society
// format: classic two-sided T-ledger (Expenditure | Income), prior-year
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

export default function IncomeExpenditureScreen() {
  const router = useRouter();
  const { years, financialYearId, setFinancialYearId, loading: fyLoading } = useFinancialYears();
  const [ie, setIe] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!financialYearId) return;
    let cancelled = false;
    setFetching(true);
    setError(null);
    fetchJSON(`/api/accounting/financial-statements/income-expenditure?financialYearId=${financialYearId}`)
      .then(({ statement }) => { if (!cancelled) setIe(statement); })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setFetching(false));
    return () => { cancelled = true; };
  }, [financialYearId]);

  const selectedYear = years.find((y) => String(y._id) === String(financialYearId));
  const society = useSocietyName();

  return (
    <div>
      <PageHeader
        title="Income & Expenditure Account"
        subtitle={ie ? `for the year ended ${ie.financialYearLabel}${ie.priorFinancialYearLabel ? ` · comparative with ${ie.priorFinancialYearLabel}` : ""}` : undefined}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <FySelect years={years} value={financialYearId} onChange={setFinancialYearId} />
            <Btn variant="secondary" onClick={() => window.print()} disabled={!ie}>
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
      ) : !ie ? (
        <NoFinancialYear what="the Income &amp; Expenditure statement" />
      ) : (
        <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <PrintArea>
            <StatutoryStatements
              incomeExpenditure={ie}
              ieAsOf={selectedYear?.endDate}
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
