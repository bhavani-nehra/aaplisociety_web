"use client";
/**
 * Statements → "Print & Save": the Balance Sheet and the Income & Expenditure
 * account in the exact printed layout (lib/accounting/yearEndSheets.js), with
 * Print (A4 landscape, one sheet per page), Save as PDF / HTML, and
 * "What changed since opening" underneath.
 */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import "@/components/money/money.css";
import { inr, Skeleton, BandError, Empty } from "@/components/money/kit";
import { useFinancialYears } from "@/components/accounting/generate/useFinancialYears";
import { useSocietyName } from "@/components/accounting/generate/useSocietyName";
import { FySelect } from "@/components/accounting/generate/PageHeader";
import { yearEndSheetsHtml, movementSinceOpening } from "@/lib/accounting/yearEndSheets";

async function getJSON(url) {
  const res = await fetch(url, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function slug(s) {
  return String(s || "society").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function YearEndSheets() {
  const { years, financialYearId, setFinancialYearId, loading: fyLoading, error: fyError } = useFinancialYears();
  const society = useSocietyName();
  const frame = useRef(null);
  const [showAll, setShowAll] = useState(false);

  const q = useQuery({
    queryKey: ["year-end-sheets", financialYearId],
    enabled: !!financialYearId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const qs = `financialYearId=${financialYearId}`;
      const [b, i] = await Promise.all([
        getJSON(`/api/accounting/financial-statements/balance-sheet?${qs}`),
        getJSON(`/api/accounting/financial-statements/income-expenditure?${qs}`),
      ]);
      return { bs: b.statement, ie: i.statement };
    },
  });

  const html = useMemo(() => (q.data ? yearEndSheetsHtml(society, q.data.bs, q.data.ie) : ""), [q.data, society]);
  const moves = useMemo(() => (q.data ? movementSinceOpening(q.data.bs) : []), [q.data]);
  const moved = moves.filter((m) => Math.abs(m.change) >= 0.005);
  const shown = showAll ? moves : moved;

  const printIt = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };
  const saveHtml = () => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug(society.name)}-statements-${q.data?.bs?.financialYearLabel || "year"}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  if (fyLoading) return <div className="mn" style={{ marginTop: 16 }}><Skeleton h={420} /></div>;
  if (fyError) return <div className="mn" style={{ marginTop: 16 }}><BandError error={{ message: fyError }} /></div>;
  if (!years.length) return <div className="mn" style={{ marginTop: 16 }}><Empty>No year set up yet. Open “Set up your books” and add the first year.</Empty></div>;

  const bs = q.data?.bs;
  return (
    <div className="mn" style={{ display: "grid", gap: 14, marginTop: 16 }}>
      <div className="mn-card mn-h" style={{ flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="mn-lbl">Year-end sheets</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>Balance Sheet and Income &amp; Expenditure, as they print</div>
          <div className="mn-sub" style={{ marginTop: 2 }}>A4 landscape, one sheet per page. To save a PDF, press Save PDF and pick “Save as PDF” as the printer.</div>
        </div>
        <div className="mn-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <FySelect years={years} value={financialYearId} onChange={setFinancialYearId} />
          <button className="mn-btn" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Loading…" : "Refresh"}</button>
          <button className="mn-btn" onClick={saveHtml} disabled={!html}>Save HTML</button>
          <button className="mn-btn" onClick={printIt} disabled={!html}>Save PDF</button>
          <button className="mn-btn solid" onClick={printIt} disabled={!html}>Print</button>
        </div>
      </div>

      {q.isLoading ? <Skeleton h={520} /> : q.error ? <BandError error={q.error} onRetry={q.refetch} /> : (
        <>
          {bs && (
            <div className="mn-grid">
              <div className="mn-card mn-s4">
                <div className="mn-lbl">Assets at year end</div>
                <div className="mn-num" style={{ fontSize: 24, marginTop: 6 }}>{inr(bs.totalAssetsCurrent, 2)}</div>
                <div className="mn-sub">{bs.priorFinancialYearLabel ? `${inr(bs.totalAssetsPrior, 2)} at opening` : "no prior year in the books"}</div>
              </div>
              <div className="mn-card mn-s4">
                <div className="mn-lbl">Liabilities + funds</div>
                <div className="mn-num" style={{ fontSize: 24, marginTop: 6 }}>{inr(bs.totalLiabilitiesCurrent + bs.totalEquityInclSurplusCurrent, 2)}</div>
                <div className="mn-sub">{bs.currentYearSurplusOrDeficit >= 0 ? "includes surplus " : "includes deficit "}{inr(Math.abs(bs.currentYearSurplusOrDeficit), 2)}</div>
              </div>
              <div className="mn-card mn-s4">
                <div className="mn-lbl">Both sides agree</div>
                <div className="mn-num" style={{ fontSize: 24, marginTop: 6, color: bs.isBalancedCurrent ? "var(--mn-ok)" : "var(--mn-bad)" }}>{bs.isBalancedCurrent ? "Yes ✓" : "No ✗"}</div>
                <div className="mn-sub">{bs.isBalancedCurrent ? "Assets equal liabilities + funds" : `Off by ${inr(Math.abs(bs.totalAssetsCurrent - bs.totalLiabilitiesCurrent - bs.totalEquityInclSurplusCurrent), 2)} — run the Books check`}</div>
              </div>
            </div>
          )}

          <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
            <iframe ref={frame} title="Year-end sheets" srcDoc={html} style={{ width: "100%", height: 900, border: 0, display: "block", background: "#e9e9e9" }} />
          </div>

          <div className="mn-card">
            <div className="mn-h" style={{ flexWrap: "wrap", gap: 8 }}>
              <div>
                <div className="mn-lbl">What changed since opening</div>
                <div className="mn-sub" style={{ marginTop: 2 }}>{moved.length} of {moves.length} heads moved between 1 April and the year end.</div>
              </div>
              <button className="mn-btn" onClick={() => setShowAll((v) => !v)}>{showAll ? "Only what moved" : "Show all heads"}</button>
            </div>
            {shown.length ? (
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr className="mn-sub" style={{ textAlign: "left" }}>
                      <th style={{ padding: "6px 8px" }}>Head</th>
                      <th style={{ padding: "6px 8px" }}>Side</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>At opening</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>At year end</th>
                      <th style={{ padding: "6px 8px", textAlign: "right" }}>Change</th>
                      <th style={{ padding: "6px 8px" }}>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((m) => (
                      <tr key={m.key} style={{ borderTop: "1px solid var(--mn-line)" }}>
                        <td style={{ padding: "8px", fontWeight: 600 }}>{m.name}</td>
                        <td style={{ padding: "8px" }} className="mn-sub">{m.side}</td>
                        <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{inr(m.opening, 2)}</td>
                        <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{inr(m.closing, 2)}</td>
                        <td style={{ padding: "8px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: m.change > 0 ? "var(--mn-ok)" : m.change < 0 ? "var(--mn-bad)" : undefined }}>{m.change > 0 ? "+" : ""}{inr(m.change, 2)}</td>
                        <td style={{ padding: "8px" }} className="mn-sub">{m.why}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div style={{ marginTop: 12 }}><Empty>Nothing moved since opening.</Empty></div>}
          </div>
        </>
      )}
    </div>
  );
}
