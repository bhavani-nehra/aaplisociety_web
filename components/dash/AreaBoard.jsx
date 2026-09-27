"use client";
/**
 * Area overview boards — Security, Amenities, Shops & offices. Same design as
 * the admin dashboard (v4 mockups): header bar, dock of shortcuts, a tabbed
 * slab, a side summary and a row of panels. Data: /api/admin/area-overview.
 * Every row and card links to the page that owns it.
 */
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck, Calendar, Search, Plus, DoorOpen, Users, TriangleAlert, Ban, Megaphone, Settings2,
  Building2, CalendarCheck, Store, Banknote, FileText, Wallet, Tag, Download, EllipsisVertical, Clock3,
} from "lucide-react";
import { inr, compact, fmtDate } from "@/components/money/kit";
import "./dash.css";

const initialsOf = (n) => String(n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const timeOf = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }).toLowerCase();
const since = (d) => { const m = Math.max(0, Math.round((Date.now() - new Date(d)) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} m`; };
const Empty = ({ children }) => <div style={{ padding: "18px 8px", textAlign: "center", color: "var(--mut)", fontSize: 12.5, border: "1.5px dashed var(--bd)", borderRadius: 16 }}>{children}</div>;
const Av = ({ name }) => <span style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,.14)", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>{initialsOf(name)}</span>;
const Row = ({ href, sel, name, title, sub, amt, st, stc }) => (
  <Link href={href} className={`wr${sel ? " sel" : ""}`} style={{ gridTemplateColumns: "36px 1fr auto" }}>
    <Av name={name} />
    <span style={{ minWidth: 0 }}><b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</b><small>{sub}</small></span>
    <span style={{ display: "grid", justifyItems: "end", gap: 4 }}>{amt ? <b className="amt">{amt}</b> : null}<span className={`st ${stc || ""}`}>{st}</span></span>
  </Link>
);
const Mrow = ({ a, b }) => <div className="mrow"><span>{a}</span><b>{b}</b></div>;
const Card = ({ Icon, title, sub, tag, tc, href }) => (
  <Link href={href} className="fc"><div className="t"><span className="ic2"><Icon size={17} /></span><span className={`st ${tc || ""}`}>{tag}</span></div><b>{title}</b><small>{sub}</small></Link>
);
const Add = ({ href, title, sub }) => <Link href={href} className="fc add"><Plus size={18} /><b>{title}</b><small>{sub}</small></Link>;

function Hours({ vals }) {
  const now = new Date().getHours();
  const mx = Math.max(...vals, 1);
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24,1fr)", gap: 3, alignItems: "end", height: 150 }}>
        {vals.map((n, i) => <div key={i} title={`${i}h · ${n}`} style={{ height: `${8 + (n / mx) * 90}%`, minHeight: 5, borderRadius: 5, background: i === now ? "#f5f8ff" : i > now ? "rgba(255,255,255,.14)" : `rgba(155,184,255,${0.4 + (n / mx) * 0.5})` }} />)}
      </div>
      <div className="lg" style={{ justifyContent: "space-between", margin: "5px 0 10px" }}><span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>24h</span></div>
    </>
  );
}

function Slab({ tabs, cols = "1.15fr .85fr" }) {
  const [on, setOn] = useState(tabs[0].key);
  const cur = tabs.find((t) => t.key === on) || tabs[0];
  return (
    <div className="wb" style={{ gridColumn: "1/9" }}>
      <div className="wb-notch">{tabs.map((t) => <button key={t.key} className={t.key === on ? "on" : ""} onClick={() => setOn(t.key)}>{t.label} {t.badge ? <span className={t.late ? "late" : ""}>{t.badge}</span> : null}</button>)}</div>
      <div className="wb-tools"><Link href={cur.href} className="wb-ic" aria-label={`Open ${cur.label}`}><Download size={16} /></Link><span className="wb-ic"><EllipsisVertical size={16} /></span></div>
      <div className="pane on" style={{ gridTemplateColumns: cols }}>{cur.body}</div>
    </div>
  );
}

function Shell({ Icon, title, sub, cta, dock, children }) {
  const now = new Date();
  return (
    <div className="adm">
      <div className="hdr">
        <div className="l"><span className="ic"><Icon size={22} /></span><div><h1>{title}</h1><small>{sub}</small></div></div>
        <div className="r">
          <span className="pill"><Calendar size={15} />Today, {now.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
          <Link href="/admin/view-members" className="rb" aria-label="Search"><Search size={17} /></Link>
          <Link href={cta[1]} className="cta"><Plus size={15} />{cta[0]}</Link>
        </div>
      </div>
      <div className="grid">
        <div className="pn dockp" style={{ gridColumn: "1/13" }}>
          <div className="dock">{dock.map(([I, l, h, b, hot]) => <Link key={l} href={h} className={`dc${hot ? " hot" : ""}`}><i><I size={20} /></i>{l}{b ? <em>{b}</em> : null}</Link>)}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

const Side = ({ title, sub, rows, children }) => (
  <div className="pn" style={{ gridColumn: "9/13" }}>
    <div className="hd"><h2>{title}</h2><span className="s">{sub}</span></div>
    {rows.map(([a, b, h]) => <Link key={a} href={h} className="rw t" style={{ gridTemplateColumns: "1fr auto", padding: "8px 0" }}><span>{a}</span><b className="num">{b}</b></Link>)}
    {children}
  </div>
);
const Panel = ({ col, title, sub, dk, href, children }) => (
  <Link href={href} className="pn" style={{ gridColumn: col }}>
    <div className="hd"><h2>{title}</h2><span className="s">{sub}</span></div>{children}
  </Link>
);

// ── Security ─────────────────────────────────────────────────────────────
function Security({ d }) {
  const t = d.today;
  const tot = d.mix.reduce((a, x) => a + x.n, 0) || 1;
  const cols = ["#9db8ff", "#7c9cf7", "#b9c9f5", "#f87171"];
  const gate = (
    <>
      <div className="sb">
        <h3>Inside now <span className="sub">{t.inside} people</span></h3>
        {d.inside.length ? d.inside.slice(0, 7).map((v, i) => <Row key={i} href="/admin/visitors/active" sel={i === 1} name={v.name} title={v.name} sub={[v.flat && `Flat ${v.flat}`, `in ${timeOf(v.since)}`].filter(Boolean).join(", ")} amt={since(v.since)} st={v.purpose} stc="ok" />) : <Empty>Nobody is inside right now.</Empty>}
        <div style={{ marginTop: "auto" }}><Mrow a="Entries today" b={`${t.total}, ${t.exited} left`} /></div>
      </div>
      <div className="sb">
        <h3>Traffic today <span className="sub">entries per hour</span></h3>
        <div className="box">
          <Hours vals={d.hours} />
          {d.mix.length ? <><div className="seg" style={{ height: 30 }}>{d.mix.slice(0, 4).map((m, i) => <div key={m.label} style={{ flex: m.n, background: cols[i] }}>{m.label} {m.n}</div>)}</div><div className="lg" style={{ margin: "6px 0 4px", gap: 10, flexWrap: "wrap" }}>{d.mix.slice(0, 4).map((m) => <span key={m.label}>{Math.round((m.n / tot) * 100)}% {m.label}</span>)}</div></> : <Empty>No entries yet today.</Empty>}
          <div style={{ marginTop: "auto" }}><Mrow a="Peak hour" b={d.hours.some(Boolean) ? `${d.hours.indexOf(Math.max(...d.hours))}h, ${Math.max(...d.hours)} entries` : "—"} /><Mrow a="Turned away today" b={t.rejected} /></div>
        </div>
      </div>
    </>
  );
  const guards = (
    <>
      <div className="sb"><h3>Guards <span className="sub">{d.guards.length} on file</span></h3>
        <div className="cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {d.guards.map((g, i) => <Card key={`${g.name}-${i}`} Icon={ShieldCheck} title={g.name} sub="Security guard" tag={g.active ? "Active" : "Off"} tc={g.active ? "ok" : "r"} href="/admin/security-guards" />)}
          <Add href="/admin/security-guards" title="Add a guard" sub="Name, phone, post" />
        </div></div>
      <div className="sb"><h3>Last 7 days <span className="sub">entries a day</span></h3>
        <div className="box">{d.week.length ? d.week.map((w) => <div key={w.day} className="rw t" style={{ gridTemplateColumns: "70px 1fr 30px", borderColor: "rgba(255,255,255,.12)" }}><span>{fmtDate(w.day, { day: "numeric", month: "short" })}</span><div className="bl"><i style={{ width: `${(w.n / Math.max(...d.week.map((x) => x.n), 1)) * 100}%` }} /></div><b className="num">{w.n}</b></div>) : <Empty>No entries this week.</Empty>}</div></div>
    </>
  );
  const black = (
    <>
      <div className="sb"><h3>Blacklist <span className="sub">latest entries</span></h3>
        {d.blacklist.length ? d.blacklist.map((b, i) => <Row key={i} href="/admin/blacklist" name={b.name} title={b.name} sub={b.reason || "No reason recorded"} st={b.level === "block" ? "Blocked" : "Flagged"} stc={b.level === "block" ? "r" : "w"} />) : <Empty>Nobody is blacklisted.</Empty>}
      </div>
      <div className="sb"><h3>Rules <span className="sub">gate policy</span></h3><div className="cards">
        <Card Icon={Ban} title="Blacklist" sub="Add or lift a block" tag="Manage" href="/admin/blacklist" />
        <Card Icon={DoorOpen} title="Visitor log" sub="Every entry and exit" tag="Open" href="/admin/visitors/log" />
        <Card Icon={Clock3} title="Audit" sub="Who let whom in" tag="Open" href="/admin/visitors/audit" /></div></div>
    </>
  );
  return (
    <Shell Icon={ShieldCheck} title="Security" sub={`${d.guards.length} guards · ${t.total} visitors today · ${t.inside} inside`} cta={["Visitors", "/admin/visitors"]}
      dock={[[DoorOpen, "Visitors", "/admin/visitors", "", true], [Users, "Inside now", "/admin/visitors/active", t.inside], [ShieldCheck, "Guards", "/admin/security-guards"], [Ban, "Blacklist", "/admin/blacklist"], [FileText, "Visitor log", "/admin/visitors/log"], [Clock3, "Audit", "/admin/visitors/audit"], [Megaphone, "Post notice", "/admin/notices"], [Settings2, "Config", "/admin/society-config"]]}>
      <Slab tabs={[
        { key: "gate", label: "Gate", badge: t.total, href: "/admin/visitors", body: gate },
        { key: "guards", label: "Guards", badge: d.guards.length, href: "/admin/security-guards", body: guards },
        { key: "bl", label: "Blacklist", badge: d.blacklist.length || "", href: "/admin/blacklist", body: black },
      ]} />
      <Side title={`Today, ${new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}`} sub={`${timeOf(new Date())} now`}
        rows={[["Entries today", t.total, "/admin/visitors/log"], ["Inside now", t.inside, "/admin/visitors/active"], ["Left already", t.exited, "/admin/visitors/log"], ["Turned away", t.rejected, "/admin/visitors/audit"], ["Guards on file", d.guards.length, "/admin/security-guards"], ["Blacklisted", d.blacklist.length, "/admin/blacklist"]]} />
      <Panel col="1/7" title="Who is inside" sub="oldest first" href="/admin/visitors/active">
        {d.inside.length ? [...d.inside].reverse().slice(0, 4).map((v, i) => <div key={i} className="rw" style={{ gridTemplateColumns: "1fr auto" }}><span><b>{v.name}</b> <small>{v.flat && `Flat ${v.flat}`}</small></span><span className="tag">{since(v.since)}</span></div>) : <Empty>Nobody is inside right now.</Empty>}
      </Panel>
      <Panel col="7/13" dk title="Gate flow" sub="today" href="/admin/visitors/log">
        {[["Came in", t.total], ["Went out", t.exited], ["Still inside", t.inside], ["Turned away", t.rejected]].map(([a, b]) => <div key={a} className="rw t" style={{ gridTemplateColumns: "1fr auto" }}><span>{a}</span><b className="num">{b}</b></div>)}
      </Panel>
    </Shell>
  );
}

// ── Amenities ────────────────────────────────────────────────────────────
function Amenities({ d }) {
  const evs = d.events.map((e, i) => <Row key={i} href="/admin/amenities/events" sel={i === 1} name={e.title} title={e.title} sub={`${e.venue ? `${e.venue}, ` : ""}${fmtDate(e.at, { weekday: "short", day: "numeric", month: "short" })}, ${timeOf(e.at)}`} amt={e.capacity ? `${e.capacity} seats` : ""} st={String(e.status || "").toLowerCase().replace(/^./, (x) => x.toUpperCase())} stc="ok" />);
  const inc = d.incidents.map((i) => <Row key={i.no || i.title} href="/admin/amenities/incidents" name={i.title} title={`${i.no ? `${i.no} ` : ""}${i.title}`} sub={fmtDate(i.at, { day: "numeric", month: "short" })} st={i.status} stc={/high|critical/i.test(i.severity) ? "r" : /open/i.test(i.status) ? "w" : "ok"} />);
  const list = (
    <>
      <div className="sb"><h3>Amenities <span className="sub">{d.amenities.length} active</span></h3>
        <div className="cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {d.amenities.map((a) => <Card key={a.name} Icon={CalendarCheck} title={a.name} sub={a.location || "On site"} tag={a.hours} href="/admin/amenities/list" />)}
          <Add href="/admin/amenities/list" title="Add an amenity" sub="Slots, rules, fees" />
        </div></div>
      <div className="sb"><h3>Upcoming events <span className="sub">next on the calendar</span></h3>{evs.length ? evs.slice(0, 6) : <Empty>No events are planned.</Empty>}</div>
    </>
  );
  const events = <><div className="sb"><h3>Events <span className="sub">upcoming</span></h3>{evs.length ? evs : <Empty>No events are planned.</Empty>}</div><div className="sb"><h3>Manage <span className="sub">events</span></h3><div className="cards"><Card Icon={CalendarCheck} title="All events" sub="Registrations and waitlist" tag="Open" href="/admin/amenities/events" /><Add href="/admin/amenities/events" title="Plan an event" sub="Venue, date, seats" /></div></div></>;
  const incidents = <><div className="sb"><h3>Incidents <span className="sub">latest first</span></h3>{inc.length ? inc : <Empty>No incidents are recorded.</Empty>}</div><div className="sb"><h3>Follow up <span className="sub">open now: {d.openIncidents}</span></h3><div className="cards"><Card Icon={TriangleAlert} title="Incidents" sub="Assign and resolve" tag={d.openIncidents ? `${d.openIncidents} open` : "Clear"} tc={d.openIncidents ? "w" : "ok"} href="/admin/amenities/incidents" /><Card Icon={Wallet} title="Maintenance" sub="Closures and extensions" tag="Open" href="/admin/amenities/maintenance" /></div></div></>;
  return (
    <Shell Icon={CalendarCheck} title="Amenities" sub={`${d.amenities.length} amenities · ${d.events.length} events ahead · ${d.openIncidents} open incidents`} cta={["Manage amenities", "/admin/amenities/list"]}
      dock={[[CalendarCheck, "Amenities", "/admin/amenities/list", "", true], [Calendar, "Events", "/admin/amenities/events"], [TriangleAlert, "Incidents", "/admin/amenities/incidents", d.openIncidents], [Wallet, "Maintenance", "/admin/amenities/maintenance"], [Users, "Attendance", "/admin/amenities/attendance"], [Tag, "Categories", "/admin/amenities/categories"], [FileText, "Analytics", "/admin/amenities/analytics"], [Settings2, "Settings", "/admin/amenities/settings"]]}>
      <Slab cols="1.15fr .85fr" tabs={[
        { key: "a", label: "Amenities", badge: d.amenities.length, href: "/admin/amenities/list", body: list },
        { key: "e", label: "Events", badge: d.events.length || "", href: "/admin/amenities/events", body: events },
        { key: "i", label: "Incidents", badge: d.openIncidents || "", late: true, href: "/admin/amenities/incidents", body: incidents },
      ]} />
      <Side title="Amenities today" sub="at a glance" rows={[["Active amenities", d.amenities.length, "/admin/amenities/list"], ["Events ahead", d.events.length, "/admin/amenities/events"], ["Open incidents", d.openIncidents, "/admin/amenities/incidents"], ["Attendance", "Open", "/admin/amenities/attendance"], ["Analytics", "Open", "/admin/amenities/analytics"]]} />
      <Panel col="1/7" title="Opening hours" sub="every amenity" href="/admin/amenities/list">
        {d.amenities.slice(0, 5).map((a) => <div key={a.name} className="rw" style={{ gridTemplateColumns: "1fr auto" }}><span><b>{a.name}</b> <small>{a.days} days a week</small></span><span className="tag">{a.hours}</span></div>)}
        {!d.amenities.length && <Empty>No amenity is set up yet.</Empty>}
      </Panel>
      <Panel col="7/13" dk title="Next events" sub="dates" href="/admin/amenities/events">
        {d.events.slice(0, 4).map((e, i) => <div key={i} className="rw t" style={{ gridTemplateColumns: "1fr auto" }}><span>{e.title}</span><b className="num">{fmtDate(e.at, { day: "numeric", month: "short" })}</b></div>)}
        {!d.events.length && <Empty>No events are planned.</Empty>}
      </Panel>
    </Shell>
  );
}

// ── Shops ────────────────────────────────────────────────────────────────
function Shops({ d }) {
  const t = d.totals;
  const dues = [...d.rows].filter((r) => r.owed > 0).sort((a, b) => b.owed - a.owed);
  const leases = [...d.rows].filter((r) => r.leaseDays != null).sort((a, b) => a.leaseDays - b.leaseDays);
  const units = (
    <>
      <div className="sb"><h3>Shops and offices <span className="sub">{t.units} units, {t.occupied} occupied</span></h3>
        <div className="box">{d.rows.length ? <div className="plan" style={{ gridTemplateColumns: "1fr 1fr", gridAutoRows: "minmax(34px,1fr)" }}>
          {d.rows.slice(0, 14).map((s) => <Link key={s.id} href="/admin/commercial/shops" className={`u ${s.occupancy === "Vacant" ? "v" : s.owed > 0 ? "d" : s.leaseDays != null && s.leaseDays <= 60 ? "w" : ""}`}><span className="n">{s.id}</span><div><b>{s.name}</b><small>{s.occupancy === "Vacant" ? "Vacant" : s.owed > 0 ? compact(s.owed) : "Paid"}</small></div></Link>)}
        </div> : <Empty>No shops or offices yet. Add the first one.</Empty>}
          <div className="lg" style={{ marginTop: 10, flexWrap: "wrap", gap: "4px 12px" }}><span><i style={{ background: "rgba(155,184,255,.4)" }} />Paid</span><span><i style={{ background: "rgba(220,38,38,.5)" }} />Dues</span><span><i style={{ background: "rgba(245,158,11,.5)" }} />Lease ending</span><span><i style={{ border: "1.5px dashed #b9c9f5" }} />Vacant</span></div>
        </div></div>
      <div className="sb"><h3>Manage <span className="sub">commercial</span></h3><div className="cards">
        <Card Icon={Store} title="Shops & offices" sub={`${t.units} units`} tag="Open" href="/admin/commercial/shops" />
        <Card Icon={Banknote} title="Rate card" sub="Rates for every unit" tag="Edit" href="/admin/commercial/rate-card" />
        <Card Icon={Tag} title="Categories" sub="Trade types" tag="Edit" href="/admin/commercial/categories" />
        <Add href="/admin/commercial/shops" title="Add a shop" sub="Number, owner, area" /></div></div>
    </>
  );
  const due = <><div className="sb"><h3>Rent dues <span className="sub">largest first</span></h3>{dues.length ? dues.slice(0, 7).map((r, i) => <Row key={r.id} href="/admin/commercial/units" sel={i === 0} name={r.name} title={`${r.id} ${r.name}`} sub="Open commercial bills" amt={compact(r.owed)} st="Due" stc="r" />) : <Empty>No shop owes anything.</Empty>}<div style={{ marginTop: "auto" }}><Mrow a="Total owed" b={inr(t.owed)} /></div></div><div className="sb"><h3>Act <span className="sub">on dues</span></h3><div className="cards"><Card Icon={Wallet} title="Commercial bills" sub="Generate and view" tag="Open" href="/admin/commercial/units" /><Card Icon={FileText} title="Overview" sub="Collections" tag="Open" href="/admin/commercial" /></div></div></>;
  const lease = <><div className="sb"><h3>Leases <span className="sub">ending soonest</span></h3>{leases.length ? leases.slice(0, 7).map((r, i) => <Row key={r.id} href="/admin/commercial/shops" sel={i === 0} name={r.name} title={`${r.id} ${r.name}`} sub={`Ends ${fmtDate(r.leaseEnds, { day: "numeric", month: "short", year: "numeric" })}`} st={r.leaseDays < 0 ? "Ended" : `${r.leaseDays} d`} stc={r.leaseDays <= 60 ? "w" : "ok"} />) : <Empty>No lease end dates are recorded.</Empty>}</div><div className="sb"><h3>Renewals <span className="sub">next 60 days</span></h3><div className="cards"><Card Icon={Clock3} title="Ending soon" sub="Within 60 days" tag={String(t.ending)} tc={t.ending ? "w" : "ok"} href="/admin/commercial/shops" /></div></div></>;
  return (
    <Shell Icon={Store} title="Shops & offices" sub={`${t.units} units · ${t.occupied} occupied · ${t.vacant} vacant`} cta={["Add shop or office", "/admin/commercial/shops"]}
      dock={[[Store, "Shops", "/admin/commercial/shops", "", true], [Banknote, "Rate card", "/admin/commercial/rate-card"], [Tag, "Categories", "/admin/commercial/categories"], [Wallet, "Bills", "/admin/commercial/units", t.late], [FileText, "Overview", "/admin/commercial"], [Building2, "Businesses", "/admin/commercial/businesses"], [Megaphone, "Post notice", "/admin/notices"], [Settings2, "Config", "/admin/society-config"]]}>
      <Slab cols="1.25fr .75fr" tabs={[
        { key: "u", label: "Units", badge: t.units, href: "/admin/commercial/shops", body: units },
        { key: "d", label: "Dues", badge: t.late || "", late: true, href: "/admin/commercial/units", body: due },
        { key: "l", label: "Leases", badge: t.ending || "", href: "/admin/commercial/shops", body: lease },
      ]} />
      <Side title="Commercial today" sub="rent roll" rows={[["Units", t.units, "/admin/commercial/shops"], ["Occupied", t.occupied, "/admin/commercial/shops"], ["Vacant", t.vacant, "/admin/commercial/shops"], ["Shops with dues", t.late, "/admin/commercial/units"], ["Owed in total", compact(t.owed), "/admin/commercial/units"], ["Leases ending in 60 days", t.ending, "/admin/commercial/shops"]]} />
      <Panel col="1/7" title="Largest dues" sub="shops" href="/admin/commercial/units">
        {dues.slice(0, 4).map((r) => <div key={r.id} className="rw" style={{ gridTemplateColumns: "1fr auto" }}><span><b>{r.id}</b> <small>{r.name}</small></span><span className="tag r">{compact(r.owed)}</span></div>)}
        {!dues.length && <Empty>No shop owes anything.</Empty>}
      </Panel>
      <Panel col="7/13" dk title="Occupancy" sub={`${t.units} units`} href="/admin/commercial/shops">
        <div className="stk"><div style={{ flex: t.occupied || 0.001, background: "#6b8eef" }}>{t.occupied} occupied</div><div style={{ flex: t.vacant || 0.001, background: "none", border: "1.5px dashed #b9c9f5", color: "#b9c9f5", paddingLeft: 3 }}>{t.vacant}</div></div>
      </Panel>
    </Shell>
  );
}

export default function AreaBoard({ area }) {
  const q = useQuery({
    queryKey: ["area-overview", area],
    queryFn: async () => {
      const r = await fetch(`/api/admin/area-overview?area=${area}`, { credentials: "include" });
      if (!r.ok) throw new Error("Could not load this overview");
      return r.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  if (!q.data) return <div className="adm" style={{ minHeight: 400 }}><div className="pn" style={{ height: 240 }}><p className="mut">{q.error ? "Could not load this overview. Refresh to try again." : "Loading…"}</p></div></div>;
  if (area === "security") return <Security d={q.data} />;
  if (area === "amenities") return <Amenities d={q.data} />;
  return <Shops d={q.data} />;
}
