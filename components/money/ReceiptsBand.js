"use client";
/** Band above the Receipts list, from /api/admin/money/insights?view=receipts. */
import { useMoneyInsights, inr, compact, fmtDate, flatOf, pct, Skeleton, BandError, Empty, Ring, CapsuleBars, BarList } from "./kit";

export default function ReceiptsBand({ fy }) {
  const q = useMoneyInsights("receipts", { fy });
  if (q.isLoading) return <div className="mn mn-band mn-grid"><Skeleton h={220} span="mn-s4" /><Skeleton h={220} span="mn-s5" /><Skeleton h={220} span="mn-s3" /></div>;
  if (q.error) return <BandError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const printedPct = pct(d.printed, d.issued);
  const coverage = pct(d.issued, d.paymentsInFy);
  const missing = Math.max(d.paymentsInFy - d.issued, 0);

  return (
    <div className="mn mn-band mn-grid">
      <div className="mn-dk mn-s4">
        <div className="mn-orb" style={{ width: 200, height: 200, top: -80, right: -80 }} />
        <div className="mn-lbl">Receipts this year · FY {d.fy}-{String(d.fy + 1).slice(-2)}</div>
        <div className="mn-row" style={{ gap: 18, marginTop: 12, position: "relative" }}>
          <Ring value={printedPct} size={108} stroke={10} color="#f5f8ff" track="rgba(245,248,255,.14)">
            <div><div className="mn-num" style={{ fontSize: 24 }}>{printedPct}%</div><div className="mn-sub" style={{ fontSize: 10 }}>printed</div></div>
          </Ring>
          <div style={{ display: "grid", gap: 8 }}>
            <div><div className="mn-num" style={{ fontSize: 30 }}>{d.issued}</div><div className="mn-sub">issued · {compact(d.amount)}</div></div>
            <div className="mn-row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="mn-chip mute">{d.printed} printed</span>
              <span className="mn-chip mute">{d.notPrinted} not printed</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16, position: "relative" }}>
          <div className="mn-h" style={{ fontSize: 12, marginBottom: 6 }}>
            <span className="mn-sub">Payments with a receipt</span>
            <b>{d.issued} of {d.paymentsInFy}</b>
          </div>
          <div className="mn-bar-h"><i style={{ width: `${Math.min(coverage, 100)}%` }} /></div>
          <div className="mn-sub" style={{ marginTop: 8 }}>{missing ? `${missing} payment${missing === 1 ? "" : "s"} this year have no receipt yet.` : "Every payment this year has a receipt."}</div>
        </div>
      </div>

      <div className="mn-card mn-s5">
        <div className="mn-h"><span className="mn-lbl">Receipts issued by month</span><span className="mn-sub">count</span></div>
        <div style={{ marginTop: 14 }}>
          <CapsuleBars h={180} series={d.months.map((m) => ({ label: m.label, values: [m.count] }))} colors={["var(--mn-accent)"]} format={(v) => `${v} receipt${v === 1 ? "" : "s"}`} />
        </div>
      </div>

      <div className="mn-card mn-s3">
        <div className="mn-lbl">By payment mode</div>
        <div style={{ marginTop: 14 }}>
          <BarList rows={d.modes.map((m) => ({ label: m.mode, value: m.count }))} format={(v) => String(v)} color="var(--mn-navy)" />
        </div>
      </div>

      <div className="mn-s12" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {d.latest.map((r) => (
          <div key={r._id} className="mn-slip">
            <div className="mn-h">
              <span className="mn-lbl">Receipt</span>
              <span className={`mn-chip ${r.status === "Downloaded" ? "" : "warn"}`}>{r.status === "Downloaded" ? "Printed" : "Not printed"}</span>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}># {r.receiptNo}</div>
            <div className="mn-sub mn-ell">{[r.member?.ownerName, flatOf(r.member), r.billPeriodId].filter(Boolean).join(" · ")}</div>
            <div className="cut" />
            <div className="mn-h">
              <div>
                <div className="mn-num" style={{ fontSize: 24 }}>{inr(r.amount)}</div>
                <div className="mn-sub">{fmtDate(r.paidAt, { day: "2-digit", month: "short", year: "numeric" })} · {r.paymentMode || "—"}</div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11 }} className="mn-sub">
                <div>Dues {inr(r.principal)}</div>
                <div>Interest {inr(r.interest)}</div>
                {r.advance > 0 && <div>Advance {inr(r.advance)}</div>}
              </div>
            </div>
          </div>
        ))}
        {!d.latest.length && <Empty>No receipts issued yet. They appear here as soon as the first one is generated below.</Empty>}
      </div>
    </div>
  );
}
