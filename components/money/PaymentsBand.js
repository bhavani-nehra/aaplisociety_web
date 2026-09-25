"use client";
/** Band above the Payments list: how money is coming in, from /api/admin/money/insights?view=payments. */
import {
  useMoneyInsights, inr, compact, fmtDate, flatOf, initials, Delta, Skeleton, BandError, Empty,
  AreaTrend, CapsuleBars, Donut, Heatmap, StackBar, PALETTE,
} from "./kit";

export default function PaymentsBand() {
  const q = useMoneyInsights("payments");
  if (q.isLoading) return <div className="mn mn-band mn-grid"><Skeleton h={230} span="mn-s5" /><Skeleton h={230} span="mn-s4" /><Skeleton h={230} span="mn-s3" /></div>;
  if (q.error) return <BandError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const w = d.windows;
  const modeTotal = d.modes.reduce((s, m) => s + m.total, 0);
  const modes = d.modes.map((m, i) => ({ label: m.mode, value: m.total, count: m.count, color: PALETTE[i % PALETTE.length] }));
  const peak = d.heat.reduce((best, c) => (c.total > (best?.total || 0) ? c : best), null);
  const activeDays = d.heat.filter((c) => c.count > 0).length;
  const split = [
    { label: "Old dues (principal)", value: Math.max(w.month - w.interest - w.advance, 0), color: "var(--mn-navy)" },
    { label: "Interest", value: w.interest, color: "var(--mn-warn)" },
    { label: "Kept as advance", value: w.advance, color: "var(--mn-accent-2)" },
  ];

  return (
    <div className="mn mn-band mn-grid">
      {/* wave banner */}
      <div className="mn-dk mn-s5">
        <div className="mn-orb" style={{ width: 220, height: 220, top: -90, right: -70 }} />
        <div className="mn-h" style={{ position: "relative", alignItems: "flex-start" }}>
          <div>
            <div className="mn-lbl">Collected in {d.monthLabel}</div>
            <div className="mn-num" style={{ fontSize: 40, marginTop: 6 }}>{inr(w.month)}</div>
            <div className="mn-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
              <Delta now={w.month} before={w.prevMonth} label="Against last month" />
              <span className="mn-sub">{w.prevMonth ? `last month ${inr(w.prevMonth)}` : "nothing last month"} · {w.monthCount} payment{w.monthCount === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div style={{ display: "grid", gap: 6, textAlign: "right" }}>
            <span className="mn-chip mute">Today {compact(w.today)} · {w.todayCount}</span>
            <span className="mn-chip mute">7 days {compact(w.week)} · {w.weekCount}</span>
          </div>
        </div>
        <div style={{ marginTop: 12, position: "relative" }}>
          <AreaTrend onDark h={120} points={d.months.map((m) => ({ label: m.label, v: m.total }))} />
        </div>
      </div>

      {/* this month by day */}
      <div className="mn-card mn-s4">
        <div className="mn-h"><span className="mn-lbl">{d.monthLabel}, day by day</span><span className="mn-sub">largest {inr(w.largest)}</span></div>
        <div style={{ marginTop: 14 }}>
          <CapsuleBars h={170} series={d.monthDaily.map((x) => ({ label: x.day % 5 === 1 ? String(x.day) : "", values: [x.total] }))} colors={["var(--mn-accent)"]} format={inr} />
        </div>
      </div>

      {/* mode split */}
      <div className="mn-card mn-s3">
        <div className="mn-lbl">How members pay · FY</div>
        {modes.length ? (
          <>
            <div style={{ display: "grid", placeItems: "center", margin: "12px 0" }}>
              <Donut parts={modes} size={118} center={<div><div className="mn-num" style={{ fontSize: 17 }}>{compact(modeTotal)}</div><div className="mn-sub" style={{ fontSize: 10 }}>this year</div></div>} />
            </div>
            <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
              {modes.slice(0, 5).map((m) => (
                <div key={m.label} className="mn-h">
                  <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 3, background: m.color, marginRight: 6 }} />{m.label}</span>
                  <span className="mn-sub">{m.count} · <b style={{ color: "var(--mn-ink)" }}>{Math.round((m.value / modeTotal) * 100)}%</b></span>
                </div>
              ))}
            </div>
          </>
        ) : <div style={{ marginTop: 12 }}><Empty h={180}>No payments this year yet.</Empty></div>}
      </div>

      {/* 12-week heatmap */}
      <div className="mn-card mn-s5">
        <div className="mn-h"><span className="mn-lbl">Last 12 weeks</span><span className="mn-sub">{activeDays} day{activeDays === 1 ? "" : "s"} with payments</span></div>
        <div style={{ marginTop: 14 }}><Heatmap cells={d.heat} /></div>
        <div className="mn-h" style={{ marginTop: 12 }}>
          <span className="mn-legend"><span><i style={{ background: "var(--mn-card-2)" }} />None</span><span><i style={{ background: "var(--mn-accent-3)" }} /></span><span><i style={{ background: "var(--mn-accent)" }} /></span><span><i style={{ background: "var(--mn-navy)" }} />Most</span></span>
          <span className="mn-sub">{peak && peak.total ? `Busiest ${fmtDate(peak.date)} · ${inr(peak.total)}` : "No payments in these weeks"}</span>
        </div>
      </div>

      {/* where this month's money went */}
      <div className="mn-card mn-s4">
        <div className="mn-lbl">What this month's money cleared</div>
        <div style={{ marginTop: 16 }}><StackBar parts={split} h={16} /></div>
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {split.map((s) => (
            <div key={s.label} className="mn-h" style={{ fontSize: 12.5 }}>
              <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 3, background: s.color, marginRight: 6 }} />{s.label}</span>
              <b>{inr(s.value)}</b>
            </div>
          ))}
        </div>
        <div className="mn-sub" style={{ marginTop: 14 }}>{d.reversedCount ? `${d.reversedCount} payment${d.reversedCount === 1 ? "" : "s"} undone this year` : "No payments undone this year"}</div>
      </div>

      {/* latest */}
      <div className="mn-card mn-s3">
        <div className="mn-lbl">Latest in</div>
        <div className="mn-list" style={{ marginTop: 10 }}>
          {d.recent.slice(0, 4).map((p) => (
            <div key={p._id} className="mn-row" style={{ fontSize: 12 }}>
              <span className="mn-av">{initials(p.member?.ownerName)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mn-ell" style={{ fontWeight: 600 }}>{p.member?.ownerName || p.description || "Payment"}</div>
                <div className="mn-sub mn-ell">{[flatOf(p.member), p.paymentMode, fmtDate(p.date)].filter(Boolean).join(" · ")}</div>
              </div>
              <b>{compact(p.amount)}</b>
            </div>
          ))}
          {!d.recent.length && <Empty>No payments recorded yet.</Empty>}
        </div>
      </div>
    </div>
  );
}
