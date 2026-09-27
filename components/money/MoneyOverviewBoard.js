"use client";
/**
 * Money overview board (/admin/money-overview and the Overview tab of
 * /admin/money). One request: /api/admin/money/insights?view=overview.
 * Every card links to the screen that owns its numbers.
 */
import { useState } from "react";
import Link from "next/link";
import { Wallet, CalendarRange, Calendar, Search, Plus, AlertCircle, PiggyBank, TrendingDown, TrendingUp, CalendarClock, Droplets, Gauge as GaugeIcon, Banknote } from "lucide-react";
import {
  useMoneyInsights, inr, compact, fmtDate, ago, flatOf, initials, pct, currentFy,
  Skeleton, BandError, Empty, Delta, AreaTrend, Sparkline, CapsuleBars, Ring, Donut, Heatmap, BarList, StackBar, PALETTE,
} from "./kit";

const HREF = {
  payments: "/admin/payments",
  receipts: "/admin/receipts",
  late: "/admin/late-payment",
  passbook: "/admin/ledger",
  expenses: "/admin/expenditure",
  bank: "/admin/accounting/registers",
  statements: "/admin/accounting/statements",
};

function Kpi({ label, value, sub, spark, sparkColor, href, tone, icon }) {
  return (
    <Link href={href} className="mn-card tight" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
      <div className="mn-h"><span className="mn-lbl">{label}</span>{icon}</div>
      <div className="mn-num" style={{ fontSize: 26, marginTop: 8, color: tone }}>{value}</div>
      <div className="mn-h" style={{ marginTop: 6, alignItems: "flex-end" }}>
        <span className="mn-sub">{sub}</span>
        {spark && <Sparkline values={spark} w={70} h={22} color={sparkColor} />}
      </div>
    </Link>
  );
}

function PaymentDetail({ p }) {
  if (!p) return <Empty>Pick a payment on the left.</Empty>;
  return (
    <>
      <div className="mn-h" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
        <div>
          <div className="mn-lbl">Payment</div>
          <div style={{ fontSize: 22, fontWeight: 650, marginTop: 4 }}># {p.transactionId || "—"}</div>
          <div className="mn-sub">{fmtDate(p.date, { day: "2-digit", month: "short", year: "numeric" })} · {p.paymentMode || "—"}{p.ref ? ` · ref ${p.ref}` : ""}</div>
        </div>
        <div className="mn-row">
          <span className="mn-av" style={{ width: 42, height: 42 }}>{initials(p.member?.ownerName)}</span>
          <div><div style={{ fontWeight: 700 }}>{p.member?.ownerName || "—"}</div><div className="mn-sub">{flatOf(p.member) || "no flat"}</div></div>
        </div>
      </div>
      <div className="mn-num" style={{ fontSize: 40, margin: "16px 0 12px" }}>{inr(p.amount, 2)}</div>
      <div className="mn-kv">
        <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Cleared dues</div><b>{inr(p.principal, 2)}</b></div>
        <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Cleared interest</div><b>{inr(p.interest, 2)}</b></div>
        <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Kept as advance</div><b>{inr(p.advance, 2)}</b></div>
      </div>
      <div className="mn-sub" style={{ marginTop: 12 }}>{p.description || "Payment received"}{p.billPeriodId ? ` · ${p.billPeriodId}` : ""}</div>
      <div className="mn-row" style={{ marginTop: 16, flexWrap: "wrap" }}>
        {p.member?._id && <Link className="mn-btn" href={`${HREF.passbook}?memberId=${p.member._id}`}>Open passbook</Link>}
        <Link className="mn-btn" href={HREF.receipts}>Receipts</Link>
        <Link className="mn-btn solid" href={HREF.payments}>All payments</Link>
      </div>
    </>
  );
}

function DueDetail({ m }) {
  if (!m) return <Empty>Pick a flat on the left.</Empty>;
  return (
    <>
      <div className="mn-row">
        <span className="mn-av" style={{ width: 42, height: 42 }}>{initials(m.ownerName)}</span>
        <div><div style={{ fontWeight: 700, fontSize: 16 }}>{m.ownerName || "—"}</div><div className="mn-sub">{flatOf(m)} · oldest {m.oldestPeriod || "—"}</div></div>
      </div>
      <div className="mn-lbl" style={{ marginTop: 18 }}>Owes today</div>
      <div className="mn-num" style={{ fontSize: 40, margin: "4px 0 12px" }}>{inr(m.balance, 2)}</div>
      <div className="mn-kv">
        <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Days past due</div><b>{m.daysOverdue}</b></div>
        <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Open bills</div><b>{m.openBills}</b></div>
        <div><div className="mn-sub" style={{ fontSize: 10.5 }}>Interest in it</div><b>{inr(m.interest, 2)}</b></div>
      </div>
      <div className="mn-row" style={{ marginTop: 16, flexWrap: "wrap" }}>
        {m.contactNumber && <a className="mn-btn" href={`tel:${m.contactNumber}`}>Call {m.contactNumber}</a>}
        <Link className="mn-btn" href={`${HREF.passbook}?memberId=${m.memberId}`}>Open passbook</Link>
        <Link className="mn-btn solid" href={HREF.late}>Record payment</Link>
      </div>
    </>
  );
}

function Workbench({ d }) {
  const [sel, setSel] = useState(0);
  const list = d.recent;
  const cur = list[sel] || list[0];
  const tabs = [
    { key: "payments", label: "Payments", n: d.thisMonth.count, on: true },
    { key: "receipts", label: "Receipts", n: d.receipts, href: HREF.receipts },
    { key: "late", label: "Late", n: d.dues.overdueUnits, href: HREF.late, late: true },
    { key: "passbook", label: "Passbook", href: HREF.passbook },
    { key: "expenses", label: "Expenses", href: HREF.expenses },
  ];
  return (
    <div className="mn-wb mn-s12">
      <div className="mn-wb-notch" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={!!t.on} className={t.on ? "on" : ""} onClick={() => { if (!t.on) window.location.assign(t.href); }}>
            {t.label}{t.n ? <span className={t.late ? "late" : ""}>{t.n}</span> : null}
          </button>
        ))}
      </div>
      <div className="mn-wb-grid">
        <div>
          <p className="mn-wb-h">Recent payments</p>
          <div className="mn-wb-rows">
            {list.map((x, i) => (
              <button key={x._id || i} className={`mn-wb-row ${i === sel ? "sel" : ""}`} onClick={() => setSel(i)}>
                <span className="mn-av">{initials(x.member?.ownerName)}</span>
                <span style={{ minWidth: 0 }}>
                  <b className="mn-ell">{x.member?.ownerName || x.description || "Payment"}</b>
                  <small className="mn-ell">{[flatOf(x.member), x.paymentMode, fmtDate(x.date)].filter(Boolean).join(" · ")}</small>
                </span>
                <span className="amt">{compact(x.amount)}</span>
              </button>
            ))}
            {!list.length && <Empty h={200}>No payments recorded yet.</Empty>}
          </div>
          <div style={{ marginTop: 14 }}><Link className="mn-link" href={HREF.payments} style={{ color: "#9db8ff" }}>Open full list ›</Link></div>
        </div>
        <div className="mn-wb-detail">
          <div className="mn-wb-glow" />
          <div style={{ position: "relative" }}><PaymentDetail p={cur} /></div>
        </div>
      </div>
    </div>
  );
}

export default function MoneyOverviewBoard() {
  const [fy, setFy] = useState(currentFy());
  const q = useMoneyInsights("overview", { fy });
  if (q.isLoading) {
    return (
      <div className="mn mn-grid">
        <Skeleton h={70} /><Skeleton h={300} span="mn-s5" /><Skeleton h={300} span="mn-s4" /><Skeleton h={300} span="mn-s3" />
        <Skeleton h={260} span="mn-s4" /><Skeleton h={260} span="mn-s5" /><Skeleton h={260} span="mn-s3" />
      </div>
    );
  }
  if (q.error) return <BandError error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const tm = d.thisMonth;
  const s = d.series;
  const target = tm.billed;
  const achieved = pct(tm.collected, target);
  const unpaidBills = Math.max(tm.bills - tm.paidBills - tm.partialBills, 0);
  const modeTotal = d.modes.reduce((a, m) => a + m.total, 0);
  const headTotal = d.heads.reduce((a, h) => a + h.total, 0);
  const heads = d.heads.slice(0, 6).map((h, i) => ({ label: h.head, value: h.total, color: PALETTE[i % PALETTE.length] }));
  const agingMax = Math.max(...d.aging.map((b) => b.amount), 1);
  const bankAccounts = d.bank.accounts.filter((a) => a.kind === "Bank");
  const cash = d.bank.accounts.filter((a) => a.kind === "Cash");
  const bankTotal = bankAccounts.reduce((a, b) => a + b.balance, 0);
  const cashTotal = cash.reduce((a, b) => a + b.balance, 0);
  const heatPeak = d.heat.reduce((best, c) => (c.total > (best?.total || 0) ? c : best), null);
  const lastWithIncome = [...s].reverse().find((m) => m.collected || m.spent);

  return (
    <div className="mn mn-grid">
      {/* header */}
      <div className="mn-card tight mn-s12 mn-h" style={{ flexWrap: "wrap", padding: "14px 24px" }}>
        <div className="mn-row" style={{ gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 16, background: "#1e3a8a", color: "#f5f8ff", display: "grid", placeItems: "center" }}><Wallet size={20} /></span>
          <div>
            <div style={{ fontSize: 19, fontWeight: 600, color: "var(--mn-navy)", lineHeight: 1 }} className="mn-ov-title">Money{d.society ? ` · ${d.society}` : ""}</div>
            <div className="mn-sub" style={{ marginTop: 5 }}>Accounting overview · {d.members} flats</div>
          </div>
        </div>
        <div className="mn-row" style={{ flexWrap: "wrap", gap: 8 }}>
          <label className="mn-row" style={{ background: "var(--mn-tint)", borderRadius: 99, padding: "7px 12px", fontSize: 12, fontWeight: 500, color: "var(--mn-navy)", gap: 6 }}>
            <CalendarRange size={14} />
            <select value={fy} onChange={(e) => setFy(parseInt(e.target.value, 10))} aria-label="Financial year" style={{ background: "transparent", border: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>
              {[0, 1, 2, 3].map((k) => { const y = currentFy() - k; return <option key={y} value={y}>FY {y}-{String(y + 1).slice(-2)}</option>; })}
            </select>
          </label>
          <span className="mn-row" style={{ border: "1px solid var(--mn-line)", borderRadius: 99, padding: "7px 12px", fontSize: 12, color: "var(--mn-sub)", gap: 6 }}><Calendar size={14} />1 Apr – 31 Mar</span>
          <button className="mn-btn" style={{ width: 36, height: 36, padding: 0, justifyContent: "center", background: "transparent", border: "1px solid var(--mn-line)" }} onClick={() => q.refetch()} disabled={q.isFetching} aria-label="Refresh figures" title={q.isFetching ? "Refreshing…" : "Refresh"}><Search size={15} /></button>
          <Link className="mn-btn solid" href={HREF.payments} style={{ background: "#6b8eef", color: "#f5f8ff", padding: "8px 16px" }}><Plus size={14} />Record payment</Link>
        </div>
        <style>{`:root[data-theme="dark"] .mn-ov-title{color:var(--mn-ink)!important}`}</style>
      </div>

      {/* hero */}
      <div className="mn-dk mn-s5">
        <div className="mn-orb" style={{ width: 240, height: 240, top: -100, right: -60 }} />
        <div className="mn-h" style={{ alignItems: "flex-start", position: "relative" }}>
          <div>
            <div className="mn-lbl">Collected · {tm.label}</div>
            <div className="mn-num" style={{ fontSize: 42, marginTop: 6 }}>{inr(tm.collected)}</div>
            <div className="mn-row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
              <Delta now={tm.collected} before={tm.prevMonth} label="Against last month" />
              <span className="mn-sub">{tm.prevMonth ? `last month ${inr(tm.prevMonth)}` : "nothing last month"}</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="mn-lbl">Billed this month</div>
            <div className="mn-num" style={{ fontSize: 22, marginTop: 4 }}>{inr(target)}</div>
            <div className="mn-sub">{target ? `${achieved}% collected` : "no bill yet"}</div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}><AreaTrend onDark h={140} points={s.map((m) => ({ label: m.label, v: m.collected }))} /></div>
      </div>

      {/* KPIs */}
      <div className="mn-s4" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Kpi label="Pending dues" value={compact(d.dues.total)} sub={`${d.dues.units} flats owe`} href={HREF.late} tone="var(--mn-bad)" icon={<AlertCircle size={14} color="#dc2626" />} />
        <Kpi label="Advance held" value={compact(d.advance.total)} sub={`${d.advance.members} flats paid ahead`} href={HREF.passbook} icon={<PiggyBank size={14} color="#6b8eef" />} />
        <Kpi label="Spent this month" value={compact(tm.expenses)} sub={`${compact(d.fyTotals.spent)} this year`} spark={s.map((m) => m.spent)} sparkColor="var(--mn-warn)" href={HREF.expenses} icon={<TrendingDown size={14} color="#f59e0b" />} />
        <Kpi label="Left over this year" value={compact(d.fyTotals.surplus)} sub="collected minus spent" spark={s.map((m) => m.collected - m.spent)} sparkColor="var(--mn-ok)" href={HREF.statements} tone={d.fyTotals.surplus < 0 ? "var(--mn-bad)" : "var(--mn-ok)"} icon={<TrendingUp size={14} color="#059669" />} />
      </div>

      {/* efficiency + modes */}
      <div className="mn-s3" style={{ display: "grid", gap: 14 }}>
        <div className="mn-dk" style={{ padding: 16 }}>
          <div className="mn-lbl">This month's bills</div>
          <div className="mn-row" style={{ gap: 14, marginTop: 10 }}>
            <Ring value={pct(tm.paidBills, tm.bills)} size={88} stroke={9} color="#f5f8ff" track="rgba(245,248,255,.14)">
              <div className="mn-num" style={{ fontSize: 19 }}>{pct(tm.paidBills, tm.bills)}%</div>
            </Ring>
            <div style={{ display: "grid", gap: 5, fontSize: 12, flex: 1 }}>
              <div className="mn-h"><span className="mn-sub">Paid</span><b>{tm.paidBills}</b></div>
              <div className="mn-h"><span className="mn-sub">Part paid</span><b>{tm.partialBills}</b></div>
              <div className="mn-h"><span className="mn-sub">Unpaid</span><b>{unpaidBills}</b></div>
            </div>
          </div>
        </div>
        <Link href={HREF.payments} className="mn-card" style={{ padding: 16, textDecoration: "none", color: "inherit" }}>
          <div className="mn-lbl">How members pay</div>
          <div style={{ marginTop: 12 }}><StackBar h={14} parts={d.modes.map((m, i) => ({ label: m.mode, value: m.total, color: PALETTE[i % PALETTE.length] }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 12px", marginTop: 10, fontSize: 11.5 }}>
            {d.modes.slice(0, 4).map((m, i) => (
              <div key={m.mode} className="mn-h"><span><i style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: PALETTE[i % PALETTE.length], marginRight: 5 }} />{m.mode}</span><b>{pct(m.total, modeTotal)}%</b></div>
            ))}
            {!d.modes.length && <span className="mn-sub">No payments this year.</span>}
          </div>
        </Link>
      </div>

      {/* billed by head */}
      <div className="mn-card mn-s4">
        <div className="mn-lbl">Billed by head · {d.fyLabel}</div>
        {heads.length ? (
          <div className="mn-row" style={{ gap: 16, marginTop: 14, alignItems: "center" }}>
            <Donut parts={heads} size={124} center={<div><div className="mn-num" style={{ fontSize: 16 }}>{compact(headTotal)}</div><div className="mn-sub" style={{ fontSize: 10 }}>billed</div></div>} />
            <div style={{ display: "grid", gap: 6, fontSize: 12, flex: 1, minWidth: 0 }}>
              {heads.map((h) => (
                <div key={h.label} className="mn-h"><span className="mn-ell"><i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 3, background: h.color, marginRight: 6 }} />{h.label}</span><b>{pct(h.value, headTotal)}%</b></div>
              ))}
            </div>
          </div>
        ) : <div style={{ marginTop: 12 }}><Empty h={130}>No bills this year yet.</Empty></div>}
      </div>

      {/* aging */}
      <Link href={HREF.late} className="mn-card mn-s5" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="mn-h"><span className="mn-lbl">How old are the dues</span><span className="mn-chip mute">{d.dues.overdueUnits} flats late</span></div>
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          {d.aging.map((b, i) => (
            <div key={b.key} style={{ display: "grid", gridTemplateColumns: "92px 1fr 56px 84px", gap: 10, alignItems: "center", fontSize: 12.5 }}>
              <b>{b.label}</b>
              <div className="mn-bar-h"><i style={{ width: `${b.amount ? Math.max((b.amount / agingMax) * 100, 4) : 0}%`, background: ["var(--mn-accent-2)", "var(--mn-accent)", "var(--mn-warn)", "var(--mn-bad)"][i] }} /></div>
              <span className="mn-sub" style={{ textAlign: "right" }}>{b.units} flats</span>
              <b style={{ textAlign: "right" }}>{compact(b.amount)}</b>
            </div>
          ))}
        </div>
        <div className="mn-h" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--mn-line)", fontSize: 12.5 }}>
          <span className="mn-sub">Late total{d.notDue.units ? ` · ${compact(d.notDue.amount)} more not yet due` : ""}</span>
          <b style={{ fontSize: 16 }}>{inr(d.dues.overdue)}</b>
        </div>
      </Link>

      {/* bank + cash */}
      <div className="mn-s3" style={{ display: "grid", gap: 14 }}>
        <Link href={HREF.bank} className="mn-dk" style={{ textDecoration: "none", padding: 16 }}>
          <div className="mn-lbl">Bank{bankAccounts.length === 1 ? ` · ${bankAccounts[0].name}` : ` · ${bankAccounts.length} accounts`}</div>
          <div className="mn-num" style={{ fontSize: 26, marginTop: 8 }}>{d.bank.available ? inr(bankTotal) : "—"}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>{d.bank.available ? `as per books · ${d.bank.fyLabel}` : "Turn on the books to see this"}</div>
        </Link>
        <Link href={HREF.bank} className="mn-card" style={{ padding: 16, textDecoration: "none", color: "inherit" }}>
          <div className="mn-lbl">Cash in hand</div>
          <div className="mn-num" style={{ fontSize: 26, marginTop: 8 }}>{d.bank.available ? inr(cashTotal) : "—"}</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>{cash[0]?.lastEntry ? `last entry ${ago(cash[0].lastEntry)}` : "no cash entries"}</div>
        </Link>
      </div>

      {/* heatmap */}
      <div className="mn-card mn-s5">
        <div className="mn-h"><span className="mn-lbl">Payments, last 12 weeks</span><span className="mn-sub">{heatPeak?.total ? `peak ${inr(heatPeak.total)} on ${fmtDate(heatPeak.date)}` : "no payments"}</span></div>
        <div style={{ marginTop: 14 }}><Heatmap cells={d.heat} cell={15} /></div>
      </div>

      {/* in vs out */}
      <Link href={HREF.statements} className="mn-card mn-s4" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="mn-h"><span className="mn-lbl">Money in vs out</span><span className="mn-legend"><span><i style={{ background: "var(--mn-navy)" }} />In</span><span><i style={{ background: "var(--mn-accent-2)" }} />Out</span></span></div>
        <div className="mn-row" style={{ gap: 16, marginTop: 8 }}>
          <div><div className="mn-num" style={{ fontSize: 19 }}>{compact(d.fyTotals.collected)}</div><div className="mn-sub" style={{ fontSize: 10.5 }}>in this year</div></div>
          <div><div className="mn-num" style={{ fontSize: 19 }}>{compact(d.fyTotals.spent)}</div><div className="mn-sub" style={{ fontSize: 10.5 }}>out</div></div>
          <div><div className="mn-num" style={{ fontSize: 19, color: d.fyTotals.surplus < 0 ? "var(--mn-bad)" : "var(--mn-ok)" }}>{d.fyTotals.surplus >= 0 ? "+" : ""}{compact(d.fyTotals.surplus)}</div><div className="mn-sub" style={{ fontSize: 10.5 }}>{lastWithIncome ? `to ${lastWithIncome.label}` : "left"}</div></div>
        </div>
        <div style={{ marginTop: 10 }}><CapsuleBars h={130} series={s.map((m) => ({ label: m.label, values: [m.collected, m.spent] }))} names={["in", "out"]} /></div>
      </Link>

      {/* expenses by category */}
      <Link href={HREF.expenses} className="mn-card mn-s3" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="mn-lbl">Spent on · {d.fyLabel}</div>
        <div style={{ marginTop: 14 }}><BarList rows={d.categories.map((c) => ({ label: c.category, value: c.total }))} color="var(--mn-navy)" /></div>
      </Link>

      {/* dues row */}
      <Link href={HREF.payments} className="mn-card mn-s3" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="mn-h"><span className="mn-lbl">Next due{d.nextDue ? ` · ${fmtDate(d.nextDue.date, { weekday: "short", day: "numeric", month: "short" })}` : ""}</span><CalendarClock size={15} /></div>
        <div className="mn-num" style={{ fontSize: 26, marginTop: 4 }}>{d.nextDue ? inr(d.nextDue.amount) : "—"}</div>
        <div className="mn-sub" style={{ marginTop: 4 }}>{d.nextDue ? `${d.nextDue.bills} bills open on that date` : "No bill is waiting on a due date"}</div>
      </Link>
      <Link href="/admin/accounting/registers" className="mn-card mn-s3" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="mn-h"><span className="mn-lbl">Bill to pay{d.nextPayable ? ` · ${fmtDate(d.nextPayable.date, { weekday: "short", day: "numeric", month: "short" })}` : ""}</span><Droplets size={15} color="#6b8eef" /></div>
        <div className="mn-num" style={{ fontSize: 26, marginTop: 4 }}>{d.nextPayable ? inr(d.nextPayable.amount) : "—"}</div>
        <div className="mn-sub" style={{ marginTop: 4 }}>{d.nextPayable ? `${d.nextPayable.name} · ${Math.max(0, Math.ceil((new Date(d.nextPayable.date) - new Date()) / 864e5))} days left` : "Nothing owed to a vendor is due"}</div>
      </Link>
      <Link href={HREF.expenses} className="mn-card mn-s3" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="mn-h"><span className="mn-lbl">Spend vs billed</span><GaugeIcon size={15} /></div>
        <div className="mn-h" style={{ alignItems: "flex-end" }}>
          <div><div className="mn-num" style={{ fontSize: 26, marginTop: 4 }}>{pct(d.fyTotals.spent, d.fyTotals.billed)}%</div><span className="mn-sub">{compact(d.fyTotals.spent)} of {compact(d.fyTotals.billed)}</span></div>
          <Ring value={pct(d.fyTotals.spent, d.fyTotals.billed)} size={46} stroke={6} color="var(--mn-navy)" track="var(--mn-tint)" />
        </div>
      </Link>
      <Link href={HREF.statements} className="mn-card mn-s3" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="mn-h"><span className="mn-lbl">Left of what was billed</span><Wallet size={15} color="#059669" /></div>
        <div className="mn-num" style={{ fontSize: 26, marginTop: 4, color: "var(--mn-ok)" }}>{inr(Math.max(d.fyTotals.billed - d.fyTotals.spent, 0))}</div>
        <div className="mn-bar-h" style={{ marginTop: 8, height: 8 }}><i style={{ width: `${Math.min(100, 100 - pct(d.fyTotals.spent, d.fyTotals.billed))}%`, background: "linear-gradient(90deg,#1e3a8a,#6b8eef)" }} /></div>
        <span className="mn-sub" style={{ marginTop: 4, display: "block" }}>{Math.max(0, 100 - pct(d.fyTotals.spent, d.fyTotals.billed))}% of this year's billing left</span>
      </Link>

      <Workbench d={d} />

      {/* defaulters */}
      <div className="mn-card mn-s6" style={{ alignSelf: "start" }}>
        <div className="mn-h"><span className="mn-lbl">Top defaulters · {d.dues.overdueUnits} flats</span><Link className="mn-btn" href={HREF.late}>Open late list</Link></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10, marginTop: 14 }}>
          {d.top.slice(0, 4).map((m) => (
            <div key={m.memberId} className="mn-row">
              <span className="mn-av">{initials(m.ownerName)}</span>
              <div style={{ minWidth: 0 }}><div className="mn-ell" style={{ fontWeight: 650, fontSize: 13 }}>{m.ownerName} · {flatOf(m)}</div><div style={{ fontSize: 11.5, color: "var(--mn-bad)" }}>{inr(m.balance)} · {m.daysOverdue} days</div></div>
            </div>
          ))}
          {!d.top.length && <Empty>Nobody is past the due date.</Empty>}
        </div>
        <div className="mn-h" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--mn-line)" }}><span className="mn-sub">Late total</span><b>{inr(d.dues.overdue)}</b></div>
      </div>

      {/* activity */}
      <div className="mn-card mn-s6" style={{ alignSelf: "start" }}>
        <div className="mn-lbl">Recent activity</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginTop: 14 }}>
          {d.activity.map((a, i) => (
            <div key={i} className="mn-row" style={{ alignItems: "flex-start" }}>
              <span className="mn-av" style={{ width: 30, height: 30, borderRadius: 10, fontSize: 12, background: a.kind === "expense" ? "var(--mn-warn-bg)" : a.kind === "receipt" ? "var(--mn-card-2)" : "var(--mn-ok-bg)", color: a.kind === "expense" ? "var(--mn-warn)" : a.kind === "receipt" ? "var(--mn-sub)" : "var(--mn-ok)" }}>{a.kind === "expense" ? "↑" : a.kind === "receipt" ? "▤" : "↓"}</span>
              <div style={{ minWidth: 0 }}>
                <div className="mn-ell" style={{ fontSize: 12.5 }}><b>{a.text}</b> {inr(a.amount)}</div>
                <div className="mn-sub mn-ell" style={{ fontSize: 11 }}>{[ago(a.at), a.sub].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
          ))}
          {!d.activity.length && <Empty>Nothing yet.</Empty>}
        </div>
      </div>
    </div>
  );
}
