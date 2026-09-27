"use client";
/**
 * Admin dashboard board — the approved "registry" design (v5-b): header bar,
 * quick-action dock, a today panel, one tabbed slab (Security / Amenities /
 * Shops / Members), then aging, vitals, queue, registry, notices, cash and the
 * billing cycle. Markup and class names follow screenshots/mockups/v5*.html so
 * the look matches; every figure is read from the society's own data
 * (/api/admin/dashboard-board and /api/admin/money/insights). Where the
 * society has no data for a block, the block says so instead of inventing rows.
 * Every card links to the page that owns it.
 */
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Building2 as Buildings, CalendarRange, Calendar, Search, Plus, IndianRupee, FileText, Receipt, BookOpenText,
  Users, UserPlus, Megaphone, Ticket, ArrowLeftRight, DoorOpen, CalendarCheck, Settings2,
  Download, EllipsisVertical as MoreVertical, UserRound, Landmark, Wallet, Banknote,
} from "lucide-react";
import { useMoneyInsights, inr, compact, fmtDate, flatOf, pct, currentFy } from "@/components/money/kit";
import "./dash.css";

const DOCK = [
  [IndianRupee, "Record payment", "/admin/payments", "late", true],
  [FileText, "Generate bills", "/admin/generate-bills"],
  [Receipt, "View bills", "/admin/view-bills"],
  [BookOpenText, "Ledger", "/admin/ledger"],
  [Users, "Members", "/admin/view-members"],
  [UserPlus, "Add member", "/admin/view-members"],
  [Megaphone, "Post notice", "/admin/notices"],
  [Ticket, "Complaints", "/admin/complaints", "complaints"],
  [ArrowLeftRight, "Transfers", "/admin/view-members", "transfers"],
  [DoorOpen, "Visitors", "/admin/visitors"],
  [CalendarCheck, "Amenities", "/admin/amenities"],
  [Settings2, "Config", "/admin/society-config"],
];

const timeOf = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase();
const sinceOf = (d) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} m`;
};
const initialsOf = (n) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

const Empty = ({ children }) => (
  <div style={{ padding: "18px 8px", textAlign: "center", color: "var(--mut)", fontSize: 12.5, border: "1.5px dashed var(--bd)", borderRadius: 16 }}>{children}</div>
);
const Av = ({ name }) => (
  <span style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,.14)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>{initialsOf(name)}</span>
);
const Row = ({ href, sel, name, title, sub, amt, st, stc }) => (
  <Link href={href} className={`wr${sel ? " sel" : ""}`} style={{ gridTemplateColumns: "36px 1fr auto" }}>
    <Av name={name} />
    <span style={{ minWidth: 0 }}><b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</b><small>{sub}</small></span>
    <span style={{ display: "grid", justifyItems: "end", gap: 4 }}>{amt ? <b className="amt">{amt}</b> : null}<span className={`st ${stc || ""}`}>{st}</span></span>
  </Link>
);
const Mrow = ({ a, b }) => <div className="mrow"><span>{a}</span><b>{b}</b></div>;
const Card = ({ Icon, title, sub, tag, tc, href }) => (
  <Link href={href} className="fc">
    <div className="t"><span className="ic2"><Icon size={17} /></span><span className={`st ${tc || ""}`}>{tag}</span></div>
    <b>{title}</b><small>{sub}</small>
  </Link>
);

function Tabs({ b, tabs }) {
  const [on, setOn] = useState(tabs[0].key);
  const cur = tabs.find((t) => t.key === on) || tabs[0];
  return (
    <div className="wb" style={{ gridColumn: "5/13" }}>
      <div className="wb-notch">
        {tabs.map((t) => (
          <button key={t.key} className={t.key === on ? "on" : ""} onClick={() => setOn(t.key)}>
            {t.label} {t.badge ? <span className={t.late ? "late" : ""}>{t.badge}</span> : null}
          </button>
        ))}
      </div>
      <div className="wb-tools"><Link href={cur.href} className="wb-ic" aria-label={`Open ${cur.label}`}><Download size={16} /></Link><span className="wb-ic"><MoreVertical size={16} /></span></div>
      <div className="pane on" style={{ gridTemplateColumns: ".9fr 1.1fr" }}>{cur.body}</div>
    </div>
  );
}

export default function AdminBoard() {
  const fy = currentFy();
  const money = useMoneyInsights("overview", { fy });
  const board = useQuery({
    queryKey: ["dashboard-board"],
    queryFn: async () => {
      const r = await fetch("/api/admin/dashboard-board", { credentials: "include" });
      if (!r.ok) throw new Error("Could not load the board");
      return r.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const m = money.data;
  const b = board.data;
  if (!m && !b) {
    return <div className="adm" style={{ padding: 18, minHeight: 500 }}><div className="pn" style={{ height: 300 }}><p className="mut">{money.error || board.error ? "Could not load the dashboard. Refresh to try again." : "Loading the dashboard…"}</p></div></div>;
  }
  const c = b?.counts || {};
  const now = new Date();
  const monthName = now.toLocaleDateString("en-IN", { month: "long" });
  const badges = { late: m?.dues?.overdueUnits, complaints: c.complaintsOpen, transfers: c.transfers };

  // ── tabs ───────────────────────────────────────────────────────────────
  const insideRows = (b?.inside || []).map((v, i) => (
    <Row key={i} href="/admin/visitors" sel={i === 1} name={v.name} title={v.name} sub={[v.flat && `Flat ${v.flat}`, `in ${timeOf(v.since)}`].filter(Boolean).join(", ")} amt={sinceOf(v.since)} st={v.purpose} stc={/deliver/i.test(v.purpose) ? "" : "ok"} />
  ));
  const security = (
    <>
      <div className="sb">
        <h3>Inside now <span className="sub">{c.inside || 0} people</span></h3>
        {insideRows.length ? insideRows.slice(0, 6) : <Empty>Nobody is inside right now.</Empty>}
        <div style={{ marginTop: "auto" }}><Mrow a="Visitors today" b={`${c.visitorsToday || 0}, ${c.blacklisted || 0} on the blacklist`} /></div>
      </div>
      <div className="sb">
        <h3>Gate desk <span className="sub">today</span></h3>
        <div className="cards">
          <Card Icon={DoorOpen} title="Visitors log" sub={`${c.visitorsToday || 0} entries today`} tag="Open" href="/admin/visitors" />
          <Card Icon={UserRound} title="Guards" sub="Roster and posts" tag="Manage" href="/admin/security-guards" />
          <Card Icon={Ticket} title="Blacklist" sub={`${c.blacklisted || 0} people blocked`} tag={c.blacklisted ? "Review" : "Clear"} tc={c.blacklisted ? "w" : "ok"} href="/admin/blacklist" />
          <Link href="/admin/security-guards" className="fc add"><Plus size={18} /><b>Cover a gate</b><small>Assign a guard</small></Link>
        </div>
      </div>
    </>
  );
  const events = (b?.events || []).map((e, i) => (
    <Row key={i} href="/admin/amenities/events" sel={i === 1} name={e.title} title={e.title} sub={`${e.venue ? `${e.venue}, ` : ""}${fmtDate(e.at, { weekday: "short", day: "numeric", month: "short" })}, ${timeOf(e.at)}`} st={String(e.status || "").toLowerCase().replace(/^./, (x) => x.toUpperCase())} stc="ok" />
  ));
  const amenities = (
    <>
      <div className="sb">
        <h3>Upcoming events <span className="sub">next on the calendar</span></h3>
        {events.length ? events : <Empty>No events are planned.</Empty>}
        <div style={{ marginTop: "auto" }}><Mrow a="Active amenities" b={c.amenities || 0} /></div>
      </div>
      <div className="sb">
        <h3>Amenities <span className="sub">hours</span></h3>
        <div className="cards">
          {(b?.amenityRows || []).slice(0, 5).map((a, i) => <Card key={i} Icon={CalendarCheck} title={a.name} sub={a.location || "On site"} tag={a.hours} href="/admin/amenities" />)}
          <Link href="/admin/amenities" className="fc add"><Plus size={18} /><b>Manage amenities</b><small>Slots, rules, bookings</small></Link>
        </div>
      </div>
    </>
  );
  const shopList = b?.shopRows || [];
  const shops = (
    <>
      <div className="sb">
        <h3>Shops and offices <span className="sub">{c.shops || 0} units, {c.shopsLet || 0} occupied</span></h3>
        <div className="box">
          {shopList.length ? (
            <div className="plan" style={{ gridTemplateColumns: "1fr 1fr", gridAutoRows: "minmax(34px,1fr)" }}>
              {shopList.slice(0, 12).map((s) => (
                <Link key={s.id} href="/admin/commercial/shops" className={`u ${s.occupancy === "Vacant" ? "v" : s.ending ? "w" : ""}`}>
                  <span className="n">{s.id}</span><div><b>{s.name}</b><small>{s.occupancy === "Vacant" ? "Vacant" : s.ending ? "Lease ending" : "Let"}</small></div>
                </Link>
              ))}
            </div>
          ) : <Empty>No shops or offices are recorded yet.</Empty>}
          <div className="lg" style={{ marginTop: 10, flexWrap: "wrap", gap: "4px 12px" }}>
            <span><i style={{ background: "rgba(155,184,255,.4)" }} />Occupied</span><span><i style={{ background: "rgba(245,158,11,.5)" }} />Lease ending</span><span><i style={{ border: "1.5px dashed #b9c9f5" }} />Vacant</span>
          </div>
        </div>
      </div>
      <div className="sb">
        <h3>Commercial <span className="sub">at a glance</span></h3>
        <div className="cards">
          <Card Icon={Landmark} title="Shops & offices" sub={`${c.shops || 0} units`} tag="Open" href="/admin/commercial/shops" />
          <Card Icon={Banknote} title="Rate card" sub="Rates for every unit" tag="Edit" href="/admin/commercial/rate-card" />
          <Card Icon={Wallet} title="Overview" sub="Commercial dues" tag="Open" href="/admin/commercial" />
          <Link href="/admin/commercial/shops" className="fc add"><Plus size={18} /><b>Add a shop</b><small>Number, owner, area</small></Link>
        </div>
      </div>
    </>
  );
  const queueRows = (b?.queue || []).map((q, i) => (
    <Row key={i} href={q.href} sel={i === 1} name={q.title} title={q.title} sub={q.sub} st={q.age ? `${q.age} d` : "Today"} stc={q.age > 5 ? "r" : q.age > 2 ? "w" : ""} />
  ));
  const wings = b?.wings || [];
  const members = (
    <>
      <div className="sb">
        <h3>Requests in queue <span className="sub">members and tenants</span></h3>
        {queueRows.length ? queueRows : <Empty>Nothing is waiting for approval.</Empty>}
        <div style={{ marginTop: "auto" }}><Mrow a="Requests open" b={c.requestsOpen || 0} /></div>
      </div>
      <div className="sb">
        <h3>Who lives where <span className="sub">{c.flats || 0} flats</span></h3>
        <div className="box">
          {wings.map((w) => {
            const t = w.owner + w.tenant + w.vacant || 1;
            return (
              <Link key={w.wing} href="/admin/view-members" style={{ display: "block", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 5, color: "var(--dkmut)" }}>Wing {w.wing} · {t}</div>
                <div className="stk" style={{ height: 14 }}>
                  <div style={{ flex: w.owner || 0.001, background: "#9db8ff" }} /><div style={{ flex: w.tenant || 0.001, background: "rgba(155,184,255,.45)" }} /><div style={{ flex: w.vacant || 0.001, border: "1.5px dashed rgba(255,255,255,.4)" }} />
                </div>
              </Link>
            );
          })}
          {!wings.length && <Empty>No flats recorded yet.</Empty>}
          <div className="lg" style={{ marginTop: 6, flexWrap: "wrap", gap: "4px 12px" }}>
            <span><i style={{ background: "#9db8ff" }} />Owner {c.owners || 0}</span><span><i style={{ background: "rgba(155,184,255,.45)" }} />Tenant {c.tenants || 0}</span><span><i style={{ border: "1.5px dashed #b9c9f5" }} />Vacant {c.vacant || 0}</span>
          </div>
        </div>
      </div>
    </>
  );
  const tabs = [
    { key: "sec", label: "Security", badge: c.inside || "", href: "/admin/visitors", body: security },
    { key: "amen", label: "Amenities", badge: c.amenities || "", href: "/admin/amenities", body: amenities },
    { key: "shops", label: "Shops", badge: c.shops || "", href: "/admin/commercial/shops", body: shops },
    { key: "mem", label: "Members", badge: c.requestsOpen || c.flats || "", href: "/admin/view-members", body: members },
  ];

  // ── today panel: only things the society has on its calendar ────────────
  const events0 = [];
  if (m?.nextDue) events0.push([`Bills fall due · ${fmtDate(m.nextDue.date, { day: "numeric", month: "short" })}`, `${m.nextDue.bills} bills, ${inr(m.nextDue.amount)} open`, "now"]);
  (b?.events || []).slice(0, 3).forEach((e) => events0.push([e.title, `${fmtDate(e.at, { weekday: "short", day: "numeric", month: "short" })}, ${timeOf(e.at)}${e.venue ? `, ${e.venue}` : ""}`, ""]));
  if (m?.nextPayable) events0.push([`Pay ${m.nextPayable.name}`, `${inr(m.nextPayable.amount)} by ${fmtDate(m.nextPayable.date, { day: "numeric", month: "short" })}`, ""]);
  (b?.shopRows || []).filter((s) => s.ending).slice(0, 2).forEach((s) => events0.push([`Lease ends · ${s.id}`, `${s.name}, ${fmtDate(s.leaseEnds, { day: "numeric", month: "short", year: "numeric" })}`, ""]));
  const notice = (b?.notices || [])[0];
  const leases = (b?.shopRows || []).filter((s) => s.leaseEnds).map((s) => [s.id, Math.max(0, Math.round((new Date(s.leaseEnds) - now) / 864e5))]).sort((x, y) => x[1] - y[1]).slice(0, 5);

  const agingTot = (m?.aging || []).reduce((a, x) => a + x.amount, 0) || 1;
  const segCol = ["#6b8eef", "#8fa9f3", "#b9c9f5", "#f87171"];
  const cats = m?.categories || [];
  const catMax = Math.max(...cats.map((x) => x.total), 1);
  const modes = m?.modes || [];
  const tm = m?.thisMonth || {};

  return (
    <div className="adm">
      <div className="hdr">
        <div className="l">
          <span className="ic"><Buildings size={22} /></span>
          <div>
            <h1>Admin{(b?.society || m?.society) ? ` · ${b?.society || m?.society}` : ""}</h1>
            <small>{c.flats || 0} flats · {c.amenities || 0} amenities · {c.shops || 0} shops · FY {fy}-{String(fy + 1).slice(-2)}</small>
          </div>
        </div>
        <div className="r">
          <span className="pill"><CalendarRange size={15} />FY {fy}-{String(fy + 1).slice(-2)}</span>
          <span className="pill o"><Calendar size={15} />{monthName}</span>
          <Link href="/admin/view-members" className="rb" aria-label="Search members"><Search size={17} /></Link>
          <Link href="/admin/payments" className="cta"><Plus size={15} />Record payment</Link>
        </div>
      </div>

      <div className="grid">
        <div className="pn dockp" style={{ gridColumn: "1/13" }}>
          <div className="dock">
            {DOCK.map(([Icon, label, href, bk, hot]) => (
              <Link key={label} href={href} className={`dc${hot ? " hot" : ""}`}>
                <i><Icon size={20} /></i>{label}{badges[bk] ? <em>{badges[bk]}</em> : null}
              </Link>
            ))}
          </div>
        </div>

        <div className="pn dk cream" style={{ gridColumn: "1/5" }}>
          <div className="hd"><h2>Today, {now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</h2><span className="s">{timeOf(now)} now</span></div>
          {events0.length ? (
            <div className="tl">{events0.slice(0, 6).map(([t, s, st], i) => <div key={i} className={`e ${st}`}><b>{t}</b><small>{s}</small></div>)}</div>
          ) : <Empty>Nothing is scheduled.</Empty>}
          <div className="hd" style={{ margin: "8px 0" }}><h2>{notice ? notice.title : "Notices"}</h2><span className="s">{notice ? "latest notice" : "none yet"}</span></div>
          {notice ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><b className="num">{notice.reads} read</b><span className="mut num">of {c.flats || 0}</span></div>
              <div className="bl"><i style={{ width: `${pct(notice.reads, c.flats || 0)}%` }} /></div>
            </>
          ) : <Empty>No notice has gone out.</Empty>}
          <div className="hd" style={{ margin: "14px 0 6px" }}><h2>Leases</h2><span className="s">days left</span></div>
          {leases.length ? leases.map(([n, d]) => (
            <div key={n} className="rw t" style={{ gridTemplateColumns: "1fr 90px 34px" }}><span>{n}</span><div className="bl"><i style={{ width: `${Math.min(100, (d / 365) * 100)}%`, ...(d < 60 ? { background: "#f59e0b" } : {}) }} /></div><b className="num">{d}</b></div>
          )) : <span className="mut" style={{ fontSize: 12.5 }}>No lease end dates are recorded.</span>}
        </div>

        <Tabs b={b} tabs={tabs} />

        <Link href="/admin/late-payment" className="pn" style={{ gridColumn: "1/5" }}>
          <div className="hd"><h2>Overdue by age</h2><span className="s num">{compact(m?.dues?.overdue)}</span></div>
          {m?.aging?.some((x) => x.amount) ? (
            <>
              <div className="seg">{m.aging.map((x, i) => <div key={x.key} style={{ flex: Math.max(x.amount / agingTot * 100, 4), background: segCol[i] }}>{compact(x.amount)}</div>)}</div>
              <div className="lg" style={{ justifyContent: "space-between", margin: "6px 0" }}>{m.aging.map((x, i) => <span key={x.key} style={i === 3 ? { color: "var(--bad)" } : undefined}>{x.label}</span>)}</div>
            </>
          ) : <Empty>Nobody is past the due date.</Empty>}
          <div className="rw t" style={{ gridTemplateColumns: "1.4fr .55fr 84px", fontSize: 12, color: "var(--mut)", border: 0 }}><span>Flat and member</span><span>Owed</span><span>Late</span></div>
          {(m?.top || []).slice(0, 4).map((x) => (
            <div key={x.memberId} className="rw" style={{ gridTemplateColumns: "1.4fr .55fr 84px" }}><span><b>{flatOf(x)}</b> <small>{x.ownerName}</small></span><b className="num">{compact(x.balance)}</b><span className={`tag ${x.daysOverdue > 90 ? "r" : "w"}`}>{x.daysOverdue} days</span></div>
          ))}
        </Link>

        <div className="pn" style={{ gridColumn: "5/9" }}>
          <div className="hd"><h2>Society vitals</h2><span className="s">right now</span></div>
          {[
            ["Flats", c.flats, "/admin/view-members"], ["Flats on rent", c.tenants, "/admin/view-members"], ["Vacant flats", c.vacant, "/admin/view-members"],
            ["Open complaints", c.complaintsOpen, "/admin/complaints", c.complaintsOpen ? "dn" : ""], ["Tenant requests", c.tenantRequests, "/admin/tenant-requests"],
            ["Visitors today", c.visitorsToday, "/admin/visitors"], ["Amenities", c.amenities, "/admin/amenities"], ["Notices live", (b?.notices || []).length, "/admin/notices"],
          ].map(([l, v, h, tone]) => (
            <Link key={l} href={h} className="rw t" style={{ gridTemplateColumns: "1fr auto" }}><span>{l}</span><b className={`num ${tone || ""}`}>{(v || 0).toLocaleString("en-IN")}</b></Link>
          ))}
        </div>

        <div className="pn" style={{ gridColumn: "9/13" }}>
          <div className="hd"><h2>Waiting on you</h2><span className="chip">{queueRows.length} items</span></div>
          {(b?.queue || []).length ? (b.queue.map((q, i) => (
            <Link key={i} href={q.href} className="rw" style={{ gridTemplateColumns: "30px 1fr auto" }}><span className="ico"><ArrowLeftRight size={16} /></span><span><b>{q.title}</b><br /><small>{q.sub}</small></span><span className={`tag ${q.age > 5 ? "r" : q.age > 2 ? "w" : ""}`}>{q.age ? `${q.age} d` : "Today"}</span></Link>
          ))) : <Empty>Nothing is waiting for you.</Empty>}
          <div style={{ marginTop: "auto", paddingTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Link href="/admin/complaints" className="chip">Complaints {c.complaintsOpen || 0}</Link>
            <Link href="/admin/tenant-requests" className="chip">Tenants {c.tenantRequests || 0}</Link>
            <Link href="/admin/profile-edit-requests" className="chip">Edits {c.profileEdits || 0}</Link>
          </div>
        </div>

        <Link href="/admin/view-members" className="pn" style={{ gridColumn: "1/5" }}>
          <div className="hd"><h2>Flats and members</h2><span className="s">{c.flats || 0} flats</span></div>
          <div className="stk"><div style={{ flex: c.owners || 0.001, background: "#6b8eef" }}>{c.owners || 0} owners</div><div style={{ flex: c.tenants || 0.001, background: "#b9c9f5" }}>{c.tenants || 0}</div><div style={{ flex: c.vacant || 0.001, background: "none", border: "1.5px dashed var(--mut)", color: "var(--mut)", paddingLeft: 3 }}>{c.vacant || 0}</div></div>
          <div className="lg" style={{ margin: "6px 0 8px" }}><span>Owner-occupied</span><span>Rented</span><span>Vacant</span></div>
          {[["Ownership transfers open", c.transfers], ["Tenant requests", c.tenantRequests], ["Profile edits pending", c.profileEdits], ["Blacklisted visitors", c.blacklisted]].map(([a, v]) => (
            <div key={a} className="rw t" style={{ gridTemplateColumns: "1fr auto" }}><span>{a}</span><b className="num">{v || 0}</b></div>
          ))}
        </Link>

        <Link href="/admin/notices" className="pn" style={{ gridColumn: "5/9" }}>
          <div className="hd"><h2>Notices</h2><span className="chip">{(b?.notices || []).length} live</span></div>
          {(b?.notices || []).length ? b.notices.map((n, i) => {
            const w = pct(n.reads, c.flats || 0);
            return <div key={i} className="rw t" style={{ gridTemplateColumns: "1fr 90px 40px" }}><span>{n.title}</span><div className="bl"><i style={{ width: `${w}%` }} /></div><b className="num">{w}%</b></div>;
          }) : <Empty>No notice has gone out yet.</Empty>}
          <span className="mut" style={{ marginTop: "auto", fontSize: 12 }}>Bar shows how many flats have opened it.</span>
        </Link>

        <Link href="/admin/accounting/registers" className="pn" style={{ gridColumn: "9/13" }}>
          <div className="hd"><h2>Cash and bank</h2><span className="s">as per books</span></div>
          {m?.bank?.available && m.bank.accounts.length ? m.bank.accounts.slice(0, 4).map((a, i) => (
            <div key={i} className="acct"><span className="ico">{a.kind === "Cash" ? <Banknote size={16} /> : <Landmark size={16} />}</span><span><b>{a.name}</b><small>{a.lastEntry ? `last entry ${fmtDate(a.lastEntry)}` : "no entries yet"}</small></span><b className="num">{inr(a.balance)}</b></div>
          )) : <Empty>Turn on the books to see bank and cash.</Empty>}
        </Link>

        <Link href="/admin/money-overview" className="pn" style={{ gridColumn: "1/13" }}>
          <div className="hd"><h2>Billing cycle and spends</h2><span className="s">{tm.label} · {m?.fyLabel}</span></div>
          <div className="chev" style={{ marginBottom: 16, "--h": "66px" }}>
            {[
              ["Configure", `${m?.heads?.length || 0} heads`, "done"],
              ["Generate", `${tm.bills || 0} bills`, tm.bills ? "done" : ""],
              ["Collect", `${pct(tm.collected, tm.billed)}% in`, tm.bills ? "now" : ""],
              ["Reconcile", `${c.requestsOpen || 0} open`, ""],
              ["Close month", "Books", ""],
            ].map(([n, s, st]) => <div key={n} className={st}>{n}<small>{s}</small></div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 26px" }}>
            {cats.slice(0, 6).map((x) => (
              <div key={x.category} className="rw" style={{ gridTemplateColumns: "1fr 70px 62px", border: 0 }}><span>{x.category}</span><div className="bl"><i style={{ width: `${(x.total / catMax) * 100}%` }} /></div><span className="num mut">{compact(x.total)}</span></div>
            ))}
            {!cats.length && <span className="mut">No expenses recorded this year.</span>}
          </div>
        </Link>
      </div>
    </div>
  );
}
