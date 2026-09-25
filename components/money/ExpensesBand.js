"use client";
/** Band above the Expenses list, from /api/admin/money/insights?view=expenses. */
import { useMoneyInsights, inr, compact, fmtDate, pct, Skeleton, BandError, Empty, CapsuleBars, BarList, Gauge, Delta } from "./kit";

export default function ExpensesBand({ fy }) {
  const q = useMoneyInsights("expenses", { fy });
  if (q.isLoading) return <div className="mn mn-band mn-grid"><Skeleton h={230} span="mn-s5" /><Skeleton h={230} span="mn-s7" /></div>;
  if (q.error) return <BandError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const ratio = pct(d.spent, d.collected);
  const left = d.collected - d.spent;
  const avg = d.months.filter((m) => m.spent > 0).length ? d.spent / d.months.filter((m) => m.spent > 0).length : 0;

  return (
    <div className="mn mn-band mn-grid">
      <div className="mn-dk mn-s5">
        <div className="mn-orb" style={{ width: 220, height: 220, top: -90, right: -80 }} />
        <div className="mn-h" style={{ alignItems: "flex-start", position: "relative" }}>
          <div>
            <div className="mn-lbl">Spent this year · FY {d.fy}-{String(d.fy + 1).slice(-2)}</div>
            <div className="mn-num" style={{ fontSize: 38, marginTop: 6 }}>{inr(d.spent)}</div>
            <div className="mn-row" style={{ marginTop: 6, gap: 8, flexWrap: "wrap" }}>
              {d.lastYear ? <Delta now={d.spent} before={d.lastYear} invert label="Against last year" /> : null}
              <span className="mn-sub">{d.count} entries · about {compact(avg)} a month</span>
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <Gauge value={ratio} size={120} />
            <div style={{ marginTop: -26 }}><div className="mn-num" style={{ fontSize: 20 }}>{ratio}%</div><div className="mn-sub" style={{ fontSize: 10 }}>of money in</div></div>
          </div>
        </div>
        <div className="mn-kv" style={{ marginTop: 16, position: "relative" }}>
          <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Collected</div><b>{compact(d.collected)}</b></div>
          <div><div className="mn-sub" style={{ fontSize: 10.5 }}>{left >= 0 ? "Left over" : "Short by"}</div><b>{compact(Math.abs(left))}</b></div>
          <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Not in books</div><b>{d.notPosted}</b><div className="mn-sub" style={{ fontSize: 10.5 }}>{d.notPosted ? "needs posting" : "all posted"}</div></div>
        </div>
      </div>

      <div className="mn-card mn-s7">
        <div className="mn-h">
          <span className="mn-lbl">Money in and out by month</span>
          <span className="mn-legend"><span><i style={{ background: "var(--mn-accent-2)" }} />Collected</span><span><i style={{ background: "var(--mn-navy)" }} />Spent</span></span>
        </div>
        <div style={{ marginTop: 14 }}>
          <CapsuleBars h={200} series={d.months.map((m) => ({ label: m.label, values: [m.collected, m.spent] }))} colors={["var(--mn-accent-2)", "var(--mn-navy)"]} names={["in", "out"]} />
        </div>
      </div>

      <div className="mn-card mn-s4">
        <div className="mn-lbl">Where it goes</div>
        {d.categories.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            {d.categories.slice(0, 6).map((c) => (
              <div key={c.category} style={{ padding: "10px 12px", borderRadius: 14, background: "var(--mn-card-2)", border: "1px solid var(--mn-line)", minWidth: 0 }}>
                <div className="mn-sub mn-ell" style={{ fontSize: 11 }}>{c.category}</div>
                <div style={{ fontWeight: 650, fontSize: 15, marginTop: 2 }}>{compact(c.total)}</div>
                <div className="mn-bar-h" style={{ height: 5, marginTop: 6 }}><i style={{ width: `${pct(c.total, d.spent)}%` }} /></div>
                <div className="mn-sub" style={{ fontSize: 10.5, marginTop: 4 }}>{pct(c.total, d.spent)}% · {c.count} entr{c.count === 1 ? "y" : "ies"}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ marginTop: 12 }}><Empty>No expenses this year yet.</Empty></div>}
      </div>

      <div className="mn-card mn-s4">
        <div className="mn-lbl">Paid to most</div>
        <div style={{ marginTop: 14 }}>
          <BarList rows={d.vendors.map((v) => ({ label: v.vendor, note: `${v.count}×`, value: v.total }))} color="var(--mn-navy)" />
        </div>
      </div>

      <div className="mn-card mn-s4">
        <div className="mn-h"><span className="mn-lbl">Repeats every month</span><span className="mn-sub">3+ months</span></div>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {d.recurring.map((r) => (
            <div key={`${r.category}-${r.vendor}`} className="mn-h" style={{ fontSize: 12.5, padding: "8px 10px", borderRadius: 12, background: "var(--mn-card-2)" }}>
              <div style={{ minWidth: 0 }}>
                <div className="mn-ell" style={{ fontWeight: 600 }}>{r.category}{r.vendor ? ` · ${r.vendor}` : ""}</div>
                <div className="mn-sub" style={{ fontSize: 11 }}>{r.months} months · last {fmtDate(r.last)}</div>
              </div>
              <b>{compact(r.lastAmount)}</b>
            </div>
          ))}
          {!d.recurring.length && <Empty>Nothing repeats yet.</Empty>}
        </div>
      </div>
    </div>
  );
}
