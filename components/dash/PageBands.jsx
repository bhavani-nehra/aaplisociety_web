"use client";
/**
 * Two-panel bands taken from the approved dashboard design, placed under the
 * stat cards of View members and View bills. Same panels as the dashboard
 * (flats and members, waiting on you, overdue by age, billing cycle); every
 * row links to the page that owns it.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { compact, flatOf, pct } from "@/components/money/kit";
import "./dash.css";

const Empty = ({ children }) => <div style={{ padding: "16px 8px", textAlign: "center", color: "var(--mut)", fontSize: 12.5, border: "1.5px dashed var(--bd)", borderRadius: 16 }}>{children}</div>;
const band = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 18 };
const panel = { minHeight: 230 };

export function MembersBand() {
  const q = useQuery({
    queryKey: ["dashboard-board"],
    queryFn: async () => {
      const r = await fetch("/api/admin/dashboard-board", { credentials: "include" });
      if (!r.ok) throw new Error("board");
      return r.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const b = q.data;
  if (!b) return null;
  const c = b.counts;
  return (
    <div className="adm" style={band}>
      <Link href="/admin/view-members" className="pn" style={panel}>
        <div className="hd"><h2>Flats and members</h2><span className="s">{c.flats} flats</span></div>
        <div className="stk"><div style={{ flex: c.owners || 0.001, background: "#6b8eef" }}>{c.owners} owners</div><div style={{ flex: c.tenants || 0.001, background: "#b9c9f5" }}>{c.tenants}</div><div style={{ flex: c.vacant || 0.001, border: "1.5px dashed var(--mut)", color: "var(--mut)", paddingLeft: 3 }}>{c.vacant}</div></div>
        <div className="lg" style={{ margin: "6px 0 8px" }}><span>Owner-occupied</span><span>Rented</span><span>Vacant</span></div>
        {b.wings.slice(0, 4).map((w) => {
          const t = w.owner + w.tenant + w.vacant || 1;
          return <div key={w.wing} className="rw t" style={{ gridTemplateColumns: "60px 1fr 34px" }}><span>Wing {w.wing}</span><div className="bl"><i style={{ width: `${((w.owner + w.tenant) / t) * 100}%` }} /></div><b className="num">{t}</b></div>;
        })}
      </Link>
      <div className="pn" style={panel}>
        <div className="hd"><h2>Waiting on you</h2><span className="chip">{b.queue.length} items</span></div>
        {b.queue.length ? b.queue.slice(0, 4).map((x, i) => (
          <Link key={i} href={x.href} className="rw" style={{ gridTemplateColumns: "1fr auto" }}><span><b>{x.title}</b><br /><small>{x.sub}</small></span><span className={`tag ${x.age > 5 ? "r" : x.age > 2 ? "w" : ""}`}>{x.age ? `${x.age} d` : "Today"}</span></Link>
        )) : <Empty>Nothing is waiting for approval.</Empty>}
        <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Link href="/admin/tenant-requests" className="chip">Tenants {c.tenantRequests}</Link>
          <Link href="/admin/profile-edit-requests" className="chip">Edits {c.profileEdits}</Link>
          <Link href="/admin/complaints" className="chip">Complaints {c.complaintsOpen}</Link>
        </div>
      </div>
    </div>
  );
}

export function BillsBand({ bills = [], label = "All periods" }) {
  if (!bills.length) return null;
  const now = Date.now();
  const open = bills.filter((b) => Number(b.balanceAmount) > 0.005);
  const buckets = [["0-30d", 0, 30], ["31-60d", 31, 60], ["61-90d", 61, 90], ["90d+", 91, 1e9]].map(([l, lo, hi]) => {
    const rows = open.filter((b) => { const d = Math.floor((now - new Date(b.dueDate)) / 864e5); return d >= lo && d <= hi; });
    return { label: l, amount: rows.reduce((a, b) => a + Number(b.balanceAmount || 0), 0), n: rows.length };
  });
  const tot = buckets.reduce((a, x) => a + x.amount, 0) || 1;
  const col = ["#6b8eef", "#8fa9f3", "#b9c9f5", "#f87171"];
  const top = [...open].sort((a, b) => Number(b.balanceAmount) - Number(a.balanceAmount)).slice(0, 3);
  const paid = bills.filter((b) => b.status === "Paid").length;
  const part = bills.filter((b) => b.status === "Partial").length;
  const rest = Math.max(bills.length - paid - part, 0);
  const billed = bills.reduce((a, b) => a + Number(b.totalAmount || 0), 0);
  const got = bills.reduce((a, b) => a + Number(b.amountPaid || 0), 0);
  return (
    <div className="adm" style={band}>
      <Link href="/admin/late-payment" className="pn" style={panel}>
        <div className="hd"><h2>Unpaid by age</h2><span className="s num">{compact(tot === 1 && !open.length ? 0 : tot)}</span></div>
        {open.length ? (
          <>
            <div className="seg">{buckets.map((x, i) => <div key={x.label} style={{ flex: Math.max(x.amount / tot * 100, 4), background: col[i] }}>{compact(x.amount)}</div>)}</div>
            <div className="lg" style={{ justifyContent: "space-between", margin: "6px 0" }}>{buckets.map((x, i) => <span key={x.label} style={i === 3 ? { color: "var(--bad)" } : undefined}>{x.label}</span>)}</div>
          </>
        ) : <Empty>Every bill in view is paid.</Empty>}
        {top.map((b) => <div key={b._id} className="rw" style={{ gridTemplateColumns: "1.4fr .55fr" }}><span><b>{flatOf(b.memberId || {})}</b> <small>{b.memberId?.ownerName}</small></span><b className="num">{compact(b.balanceAmount)}</b></div>)}
      </Link>
      <Link href="/admin/money-overview" className="pn" style={panel}>
        <div className="hd"><h2>Collection</h2><span className="s">{label}</span></div>
        <div className="chev" style={{ marginBottom: 14, "--h": "56px" }}>
          {[["Billed", compact(billed), "done"], ["Collected", `${pct(got, billed)}% in`, "now"], ["To collect", compact(Math.max(billed - got, 0)), ""]].map(([n, s, st]) => <div key={n} className={st}>{n}<small>{s}</small></div>)}
        </div>
        {[["Paid", paid], ["Part paid", part], ["Unpaid", rest]].map(([l, n]) => (
          <div key={l} className="rw t" style={{ gridTemplateColumns: "1fr 90px 34px" }}><span>{l}</span><div className="bl"><i style={{ width: `${pct(n, bills.length)}%` }} /></div><b className="num">{n}</b></div>
        ))}
      </Link>
    </div>
  );
}
