"use client";
/**
 * Balance sheet & year summary — the whole financial year on one page: what was
 * billed, the interest in it, what came in, what went out, what members still
 * owe and how much of the year is left. One request:
 * /api/admin/money/insights?view=yearbook.
 */
import { useState } from "react";
import Link from "next/link";
import { useMoneyInsights, inr, pct, currentFy, Skeleton, BandError, CapsuleBars } from "@/components/money/kit";

export default function YearSummaryPage() {
  const [fy, setFy] = useState(currentFy());
  const q = useMoneyInsights("yearbook", { fy });
  if (q.isLoading) return <div className="mn mn-grid" style={{ maxWidth: 1280, margin: "0 auto" }}><Skeleton h={90} /><Skeleton h={130} span="mn-s3" /><Skeleton h={130} span="mn-s3" /><Skeleton h={130} span="mn-s3" /><Skeleton h={130} span="mn-s3" /><Skeleton h={340} /></div>;
  if (q.error) return <BandError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const t = d.fyTotals;
  const toCollect = Math.max(t.billed - t.collected, 0);
  const monthsLeft = d.months.filter((m) => !m.bills).length;
  return (
    <div className="mn" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 14 }}>
      <div className="mn-card mn-h" style={{ flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: "var(--mn-navy)" }}>Balance sheet · {d.fyLabel}</div>
          <div className="mn-sub">Every bill, payment and expense of the year, month by month.</div>
        </div>
        <div className="mn-row" style={{ flexWrap: "wrap" }}>
          <select className="mn-btn" value={fy} onChange={(e) => setFy(parseInt(e.target.value, 10))} aria-label="Financial year">
            {[0, 1, 2, 3].map((k) => { const y = currentFy() - k; return <option key={y} value={y}>FY {y}-{String(y + 1).slice(-2)}</option>; })}
          </select>
          <Link className="mn-btn" href="/admin/accounting/statements?tab=print">Print &amp; save</Link>
          <Link className="mn-btn solid" href="/admin/accounting/statements">Full statements</Link>
        </div>
      </div>

      <div className="mn-grid">
        <Link href="/admin/view-bills" className="mn-dk mn-s3" style={{ textDecoration: "none" }}>
          <div className="mn-lbl">Billed this year</div><div className="mn-num" style={{ fontSize: 28, marginTop: 6 }}>{inr(t.billed)}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>{d.billsTotal} bills · {inr(d.interestTotal)} is interest</div>
        </Link>
        <Link href="/admin/payments" className="mn-card mn-s3" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="mn-lbl">Collected</div><div className="mn-num" style={{ fontSize: 28, marginTop: 6 }}>{inr(t.collected)}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>{pct(t.collected, t.billed)}% of what was billed</div>
        </Link>
        <Link href="/admin/late-payment" className="mn-card mn-s3" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="mn-lbl">Still to collect</div><div className="mn-num" style={{ fontSize: 28, marginTop: 6, color: "var(--mn-bad)" }}>{inr(d.dues.total)}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>{d.dues.units} flats · {inr(d.advance.total)} held in advance</div>
        </Link>
        <Link href="/admin/expenditure" className="mn-dk mn-s3" style={{ textDecoration: "none" }}>
          <div className="mn-lbl">Spent</div><div className="mn-num" style={{ fontSize: 28, marginTop: 6 }}>{inr(t.spent)}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>Left over {inr(t.surplus)}</div>
        </Link>
      </div>

      <div className="mn-grid">
        <div className="mn-card mn-s8">
          <div className="mn-lbl">Money in vs out, month by month</div>
          <div style={{ marginTop: 10 }}><CapsuleBars h={170} series={d.months.map((m) => ({ label: m.label, values: [m.collected, m.spent] }))} names={["in", "out"]} /></div>
        </div>
        <div className="mn-card mn-s4">
          <div className="mn-lbl">Where the year stands</div>
          <div style={{ display: "grid", gap: 10, marginTop: 12, fontSize: 13 }}>
            <div className="mn-h"><span className="mn-sub">Billed but not yet paid</span><b>{inr(toCollect)}</b></div>
            <div className="mn-h"><span className="mn-sub">Cash and bank (books)</span><b>{d.bank.available ? inr(d.bank.accounts.reduce((a, x) => a + x.balance, 0)) : "—"}</b></div>
            <div className="mn-h"><span className="mn-sub">Months not billed yet</span><b>{monthsLeft}</b></div>
            <div className="mn-h"><span className="mn-sub">Opening figures</span><Link className="mn-link" href="/admin/opening-balances">Open ›</Link></div>
          </div>
        </div>
      </div>

      <div className="mn-card" style={{ overflowX: "auto" }}>
        <div className="mn-lbl">Month by month</div>
        <table style={{ width: "100%", marginTop: 10, fontSize: 13, borderCollapse: "collapse", minWidth: 640 }}>
          <thead><tr style={{ color: "var(--mn-sub)", fontSize: 11 }}>
            {["Month", "Bills", "Billed", "Interest", "Collected", "Spent", "Net"].map((h, i) => <th key={h} style={{ padding: "6px 8px", textAlign: i ? "right" : "left" }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {d.months.map((m) => (
              <tr key={m.key} style={{ borderTop: "1px solid var(--mn-line)", textAlign: "right" }}>
                <td style={{ padding: 8, textAlign: "left", fontWeight: 650 }}>{m.label}</td>
                <td style={{ padding: 8 }}>{m.bills || "—"}</td>
                <td style={{ padding: 8 }}>{inr(m.billed)}</td>
                <td style={{ padding: 8 }}>{inr(m.interest)}</td>
                <td style={{ padding: 8 }}>{inr(m.collected)}</td>
                <td style={{ padding: 8 }}>{inr(m.spent)}</td>
                <td style={{ padding: 8, color: m.collected - m.spent < 0 ? "var(--mn-bad)" : "var(--mn-ok)", fontWeight: 650 }}>{inr(m.collected - m.spent)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid var(--mn-line)", textAlign: "right", fontWeight: 700 }}>
              <td style={{ padding: 8, textAlign: "left" }}>Year</td><td style={{ padding: 8 }}>{d.billsTotal}</td>
              <td style={{ padding: 8 }}>{inr(t.billed)}</td><td style={{ padding: 8 }}>{inr(d.interestTotal)}</td>
              <td style={{ padding: 8 }}>{inr(t.collected)}</td><td style={{ padding: 8 }}>{inr(t.spent)}</td><td style={{ padding: 8 }}>{inr(t.surplus)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
