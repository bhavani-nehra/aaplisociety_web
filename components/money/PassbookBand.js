"use client";
/**
 * Band above the Passbook (ledger) list, from
 * /api/admin/money/insights?view=passbook. With a flat picked it shows that
 * flat's year month by month; otherwise the whole society.
 */
import { useMoneyInsights, inr, compact, fmtDate, initials, pct, Skeleton, BandError, CapsuleBars, StackBar } from "./kit";

const TILE = { Paid: "paid", Partial: "part", Unpaid: "owe", Overdue: "owe", Scheduled: "owe" };

function MemberBand({ d }) {
  const m = d.member;
  return (
    <div className="mn-dk mn-s12">
      <div className="mn-orb" style={{ width: 260, height: 260, top: -120, right: -60 }} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr)", gap: 22, position: "relative" }} className="mn-pb">
        <div>
          <div className="mn-row">
            <span className="mn-av" style={{ width: 46, height: 46, borderRadius: 16, fontSize: 15 }}>{initials(m.ownerName)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }} className="mn-ell">{m.ownerName}</div>
              <div className="mn-sub">{m.wing ? `${m.wing}-` : ""}{m.flatNo} · FY {d.fy}-{String(d.fy + 1).slice(-2)}</div>
            </div>
          </div>
          <div className="mn-lbl" style={{ marginTop: 18 }}>{d.owes > 0 ? "Owes today" : m.advance > 0 ? "Paid ahead" : "Owes today"}</div>
          <div className="mn-num" style={{ fontSize: 36, marginTop: 4 }}>{inr(d.owes > 0 ? d.owes : m.advance, 2)}</div>
          <div className="mn-sub">{d.owes > 0 ? `as per ${d.owesPeriod || "latest open bill"}` : m.advance > 0 ? "held as advance for next bills" : "nothing due — all bills paid"}</div>
          <div className="mn-kv" style={{ marginTop: 14 }}>
            <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Billed this year</div><b>{compact(d.billedFy)}</b></div>
            <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Paid this year</div><b>{compact(d.paidFy)}</b></div>
            <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Last payment</div><b>{d.lastPayment ? compact(d.lastPayment.amount) : "—"}</b><div className="mn-sub" style={{ fontSize: 10.5 }}>{d.lastPayment ? `${fmtDate(d.lastPayment.date)} · ${d.lastPayment.mode || ""}` : "none yet"}</div></div>
          </div>
        </div>
        <div>
          <div className="mn-h" style={{ marginBottom: 10 }}>
            <span className="mn-lbl">Month by month</span>
            <span className="mn-sub">{d.paidMonths} of {d.billedMonths} bills paid in full</span>
          </div>
          <div className="mn-tiles">
            {d.tiles.map((t) => (
              <div key={`${t.label}-${t.year}`} className={`mn-tile ${t.status ? TILE[t.status] || "" : "none"}`} title={t.period || `${t.label} ${t.year}: no bill`}>
                <div className="mn-h"><b style={{ fontSize: 12 }}>{t.label}</b><span className="mn-sub" style={{ fontSize: 10 }}>{String(t.year).slice(-2)}</span></div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>{t.billed !== null ? compact(t.billed) : "—"}</div>
                <div className="mn-sub" style={{ fontSize: 10.5 }}>{t.status ? (t.paid ? `paid ${compact(t.paid)}` : t.status === "Paid" ? "paid" : "unpaid") : t.paid ? `paid ${compact(t.paid)}` : "no bill"}</div>
              </div>
            ))}
          </div>
          <div className="mn-legend" style={{ marginTop: 10, color: "var(--mn-on-navy-sub)" }}>
            <span><i style={{ background: "rgba(52,195,143,.6)" }} />Paid</span>
            <span><i style={{ background: "rgba(240,176,74,.6)" }} />Part paid</span>
            <span><i style={{ background: "rgba(240,113,113,.6)" }} />Owing</span>
            <span><i style={{ background: "rgba(245,248,255,.2)" }} />No bill</span>
          </div>
        </div>
      </div>
      <style>{`@media(max-width:900px){.mn-pb{grid-template-columns:1fr!important}}`}</style>
    </div>
  );
}

function SocietyBand({ d }) {
  const parts = [
    { label: "Owing", value: d.owing, color: "#f07171" },
    { label: "Paid ahead", value: d.inAdvance, color: "#93b0f5" },
    { label: "Settled", value: d.settled, color: "#34c38f" },
  ];
  const billed = d.months.reduce((s, m) => s + m.billed, 0);
  const paid = d.months.reduce((s, m) => s + m.paid, 0);
  return (
    <>
      <div className="mn-dk mn-s5">
        <div className="mn-orb" style={{ width: 220, height: 220, top: -90, right: -80 }} />
        <div className="mn-lbl">All passbooks · {d.members} flats</div>
        <div className="mn-row" style={{ gap: 26, marginTop: 10, position: "relative", flexWrap: "wrap" }}>
          <div><div className="mn-num" style={{ fontSize: 32 }}>{compact(d.dues)}</div><div className="mn-sub">owed by {d.owing} flat{d.owing === 1 ? "" : "s"}</div></div>
          <div><div className="mn-num" style={{ fontSize: 32 }}>{compact(d.advance)}</div><div className="mn-sub">held as advance · {d.inAdvance}</div></div>
        </div>
        <div style={{ marginTop: 18 }}><StackBar h={14} parts={parts} /></div>
        <div className="mn-h" style={{ marginTop: 10, fontSize: 12, flexWrap: "wrap" }}>
          {parts.map((p) => <span key={p.label}><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 3, background: p.color, marginRight: 6 }} />{p.label} {p.value}</span>)}
        </div>
        <div className="mn-sub" style={{ marginTop: 14 }}>Pick a flat below to read its passbook month by month.</div>
      </div>
      <div className="mn-card mn-s7">
        <div className="mn-h">
          <span className="mn-lbl">Billed and paid · FY {d.fy}-{String(d.fy + 1).slice(-2)}</span>
          <span className="mn-legend"><span><i style={{ background: "var(--mn-accent-3)" }} />Billed {compact(billed)}</span><span><i style={{ background: "var(--mn-navy)" }} />Paid {compact(paid)} · {pct(paid, billed)}%</span></span>
        </div>
        <div style={{ marginTop: 14 }}>
          <CapsuleBars h={200} series={d.months.map((m) => ({ label: m.label, values: [m.billed, m.paid] }))} colors={["var(--mn-accent-3)", "var(--mn-navy)"]} names={["billed", "paid"]} />
        </div>
      </div>
    </>
  );
}

export default function PassbookBand({ memberId, fy }) {
  const q = useMoneyInsights("passbook", { memberId: memberId && memberId !== "all" ? memberId : undefined, fy });
  if (q.isLoading) return <div className="mn mn-band mn-grid"><Skeleton h={240} span="mn-s5" /><Skeleton h={240} span="mn-s7" /></div>;
  if (q.error) return <BandError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  if (d.notFound) return null;
  return <div className="mn mn-band mn-grid">{d.scope === "member" ? <MemberBand d={d} /> : <SocietyBand d={d} />}</div>;
}
