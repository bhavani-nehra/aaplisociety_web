"use client";
/** Band above the Late payments list, from /api/admin/money/insights?view=late. */
import { useMoneyInsights, inr, compact, flatOf, initials, pct, Skeleton, BandError, Empty, CapsuleBars, BarList, StackBar } from "./kit";

const AGE_COLORS = ["var(--mn-accent-2)", "var(--mn-accent)", "var(--mn-warn)", "var(--mn-bad)"];

export default function LateBand({ onRecord }) {
  const q = useMoneyInsights("late");
  if (q.isLoading) return <div className="mn mn-band mn-grid"><Skeleton h={220} span="mn-s4" /><Skeleton h={220} span="mn-s5" /><Skeleton h={220} span="mn-s3" /></div>;
  if (q.error) return <BandError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const worst = d.buckets.reduce((s, b) => s + (b.key === "61-90" || b.key === "90+" ? b.amount : 0), 0);

  return (
    <div className="mn mn-band mn-grid">
      <div className="mn-dk mn-s4">
        <div className="mn-orb" style={{ width: 200, height: 200, top: -90, right: -70 }} />
        <div className="mn-lbl">Past the due date</div>
        <div className="mn-num" style={{ fontSize: 38, marginTop: 6, position: "relative" }}>{inr(d.totalOverdue)}</div>
        <div className="mn-sub" style={{ marginTop: 4 }}>{d.overdueUnits} flat{d.overdueUnits === 1 ? "" : "s"} · {pct(worst, d.totalOverdue)}% of it older than 60 days</div>
        <div style={{ marginTop: 18 }}>
          <StackBar h={12} parts={[{ label: "Dues", value: d.principalOverdue, color: "#b9c8f3" }, { label: "Interest", value: d.interestOverdue, color: "#f0b04a" }]} />
          <div className="mn-h" style={{ marginTop: 8, fontSize: 12 }}>
            <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 3, background: "#b9c8f3", marginRight: 6 }} />Dues {inr(d.principalOverdue)}</span>
            <span><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 3, background: "#f0b04a", marginRight: 6 }} />Interest {inr(d.interestOverdue)}</span>
          </div>
        </div>
        <div className="mn-kv" style={{ marginTop: 16 }}>
          <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Owing, not due yet</div><b>{compact(d.notDue.amount)}</b><div className="mn-sub" style={{ fontSize: 10.5 }}>{d.notDue.units} flats</div></div>
          <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Pay-by day</div><b>{d.billPayFinalDay ? `${d.billPayFinalDay} of month` : "Not set"}</b><div className="mn-sub" style={{ fontSize: 10.5 }}>society rule</div></div>
        </div>
      </div>

      <div className="mn-card mn-s5">
        <div className="mn-h"><span className="mn-lbl">How old are the dues</span><span className="mn-sub">by oldest unpaid bill</span></div>
        <div style={{ marginTop: 14 }}>
          <CapsuleBars h={150} series={d.buckets.map((b) => ({ label: b.label, values: [b.amount] }))} colors={["var(--mn-accent)"]} format={inr} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8, marginTop: 10 }}>
          {d.buckets.map((b, i) => (
            <div key={b.key}>
              <div className="mn-sub mn-row" style={{ fontSize: 10.5, gap: 5 }}><i style={{ width: 7, height: 7, borderRadius: 99, background: AGE_COLORS[i], flexShrink: 0 }} />{b.label}</div>
              <b style={{ fontSize: 13 }}>{compact(b.amount)}</b>
              <div className="mn-sub" style={{ fontSize: 10.5 }}>{b.units} flat{b.units === 1 ? "" : "s"}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mn-card mn-s3">
        <div className="mn-lbl">By wing</div>
        <div style={{ marginTop: 14 }}>
          <BarList rows={d.wings.map((w) => ({ label: w.wing === "—" ? "No wing" : `Wing ${w.wing}`, note: `${w.units} flats`, value: w.amount }))} color="var(--mn-bad)" />
        </div>
      </div>

      <div className="mn-card mn-s12">
        <div className="mn-h"><span className="mn-lbl">Owes the most</span><span className="mn-sub">{d.overdueUnits ? `top ${d.top.length} of ${d.overdueUnits}` : ""}</span></div>
        {d.top.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginTop: 12 }}>
            {d.top.map((m) => (
              <div key={m.memberId} className="mn-row" style={{ padding: 10, borderRadius: 14, border: "1px solid var(--mn-line)", background: "var(--mn-card-2)" }}>
                <span className="mn-av">{initials(m.ownerName)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mn-ell" style={{ fontWeight: 650, fontSize: 13 }}>{m.ownerName || "—"} · {flatOf(m)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--mn-bad)" }}>{inr(m.balance)} · {m.daysOverdue} days · {m.openBills} bill{m.openBills === 1 ? "" : "s"}</div>
                </div>
                {m.contactNumber && <a className="mn-btn" href={`tel:${m.contactNumber}`} title={`Call ${m.contactNumber}`}>Call</a>}
                {onRecord && <button className="mn-btn solid" onClick={() => onRecord(m)}>Record</button>}
              </div>
            ))}
          </div>
        ) : <div style={{ marginTop: 12 }}><Empty>Nobody is past the due date. All clear.</Empty></div>}
      </div>
    </div>
  );
}
