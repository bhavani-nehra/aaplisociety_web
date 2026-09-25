"use client";
/**
 * Admin dashboard — revamped against the design system's "Pulse" kit
 * (ui_kits/revamp/AdminViews.jsx → AdminDashboard).
 *
 * Layout follows the kit's "today first" order: needs-attention tiles, then a
 * bento of heroic numbers led by one large collection card, then context
 * (quick actions, FY summary, recent payments, monthly breakdown).
 *
 * Every figure still comes from /api/admin/dashboard-stats exactly as before —
 * this change is presentational, the query, the period/FY filters and the
 * derived values are unchanged.
 */
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  PageHeader, SectionLabel, ActionTile, Card, CardHead, MiniMetric, MiniTable,
  Progress, Sparkline, Avatar, Pill, Btn, Select, Icon, SummaryStat, EmptyState,
} from "@/components/revamp";
import styles from "./dashboard-styles.module.css";

// A staggered framer-motion fade-in used to wrap every tile below. Removed:
// on this page it could leave tiles stuck at opacity:0 with no visible
// failure mode to debug from, and per the product's own Operate-mode
// guidance a dashboard shouldn't choreograph its own load anyway — the
// admin is here for the numbers, not to watch them arrive. Tiles now render
// immediately, every time, with nothing async standing between mount and
// visible.

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmt(n) {
  return (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Compact rupee for the hero number: ₹8.47L / ₹1.24Cr / ₹9,400. */
function compactINR(n) {
  const v = Number(n || 0);
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)}L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

function Ring({ pct, color = "var(--r-brand)", size = 80, stroke = 8 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--r-surface-3)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s cubic-bezier(.16,1,.3,1)" }}
      />
    </svg>
  );
}

/** Collection-rate tier color — same 80%/50% thresholds used everywhere else
 *  on this page (the header ring, the MiniTable pills), pulled out once so
 *  the new chart below can't silently drift from them. */
function tierColor(rate) {
  return rate >= 80 ? "var(--r-success)" : rate >= 50 ? "var(--r-warning)" : "var(--r-danger)";
}

/** Rounded-top, square-baseline bar path — dataviz mark spec: 4px rounded
 *  data-end, square at the baseline, growing from a single baseline. */
function roundedTopRectPath(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, Math.max(h, 0));
  if (h <= 0) return "";
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/** Monthly breakdown as a small bar chart, ahead of the full table below it —
 *  the table already existed and stays as the accessible/exact data view;
 *  this is the "at a glance" read the plain numbers table couldn't give.
 *  Each bar is a meter: track height = that month's billed amount (scaled to
 *  the series max), fill height = collected, fill colored by the same
 *  collection-rate tier used everywhere else on this page. Rate is
 *  direct-labeled on every bar — for a trend this short (months), the rate
 *  IS the headline, not incidental detail, so labeling every point is the
 *  point rather than clutter. */
function MonthlyTrendChart({ trend }) {
  if (!trend || trend.length < 2) return null;
  const rows = trend.map((t) => {
    const billed = Number(t.totalBilled || 0);
    const collected = Number(t.totalCollected || 0);
    const rate = billed > 0 ? Math.round((collected / billed) * 100) : 0;
    return { label: t.label, billed, collected, rate };
  });
  const maxBilled = Math.max(...rows.map((r) => r.billed), 1);
  const plotH = 84;
  const barW = 18;
  const gap = 14;
  const topPad = 16;
  const bottomPad = 18;
  const w = rows.length * (barW + gap) - gap;
  return (
    <div style={{ padding: "4px 18px 2px" }}>
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${topPad + plotH + bottomPad}`}
        preserveAspectRatio="xMinYMin meet"
        style={{ display: "block", maxWidth: "100%" }}
      >
        {rows.map((r, i) => {
          const x = i * (barW + gap);
          const trackH = Math.max((r.billed / maxBilled) * plotH, 3);
          const fillH = r.collected > 0 ? Math.max((r.collected / maxBilled) * plotH, 3) : 0;
          const baseY = topPad + plotH;
          return (
            <g key={r.label}>
              <title>{`${r.label}: ${r.rate}% collected of ₹${fmt(r.billed)} billed`}</title>
              <path d={roundedTopRectPath(x, baseY - trackH, barW, trackH, 4)} fill="var(--r-surface-3)" />
              {fillH > 0 && (
                <path d={roundedTopRectPath(x, baseY - fillH, barW, fillH, 4)} fill={tierColor(r.rate)} />
              )}
              <text
                x={x + barW / 2}
                y={baseY - trackH - 6 < topPad - 2 ? topPad - 2 : baseY - trackH - 6}
                textAnchor="middle"
                fontSize="9"
                fontWeight="700"
                fill="var(--r-fg-3)"
              >
                {r.rate}%
              </text>
              <text x={x + barW / 2} y={baseY + 14} textAnchor="middle" fontSize="9" fill="var(--r-fg-5)">
                {String(r.label || "").slice(0, 3)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Wing-chip style mini stat used inside the bento tiles. */
function Chip({ label, value, tone }) {
  return (
    <div style={{ flex: 1, padding: "6px 8px", background: "var(--r-surface-2)", borderRadius: 7, border: "1px solid var(--r-hairline)", textAlign: "center" }}>
      <div style={{ fontSize: 10, color: "var(--r-fg-4)", fontWeight: 600 }}>{label}</div>
      <div className="revamp-num" style={{
        fontSize: 14, fontWeight: 700,
        color: tone === "success" ? "var(--r-success)" : tone === "danger" ? "var(--r-danger)" : "var(--r-fg-1)",
      }}>{value}</div>
    </div>
  );
}

// A society being handed its records has no reason to be checking a page it
// has never visited. The emailed link now lands here-adjacent, but a committee
// member who logs in a week later, from habit, would otherwise never see it.
// So the dashboard says so, once, until they have collected.
//
// Self-contained and failure-silent: an error leaves the dashboard exactly as
// it was rather than blocking it behind a fetch that has nothing to do with
// the numbers on it.
// Grace and read-only, said once.
//
// Blocked societies never reach this component — middleware redirects them to
// /subscription — so this covers only the two states where the app still works
// and the committee needs to know it will not for long.
//
// Deliberately admin-only and deliberately one banner, not a modal and not a
// per-page nag. A committee that sees the same warning forty times stops
// reading it, which is the outcome that actually costs a renewal.
function SubscriptionBanner() {
  // react-query so the persisted cache (lib/query-persist.js) restores it on refresh.
  const { data: ent } = useQuery({
    queryKey: ["entitlements"],
    queryFn: async () => {
      const r = await fetch("/api/entitlements", { credentials: "include" });
      return r.ok ? r.json() : null;
    },
    staleTime: 60_000,
  });
  const l = ent?.lifecycle;
  const lifecycle = l && (l.state === "grace" || l.state === "restricted") ? l : null;

  if (!lifecycle) return null;
  const urgent = lifecycle.state === "restricted";
  const blocksOn = lifecycle.blockedAt
    ? new Date(lifecycle.blockedAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
      })
    : null;

  // Was hardcoded #ef4444/#fef2f2/#111/etc — no dark-mode support (this
  // app's dark mode is opt-in via data-theme, so a hardcoded hex never
  // repaints) on the first screen every admin sees. Rewritten onto the
  // existing --danger-*/--warning-* triads (design-system audit, Plan 06).
  const tone = urgent ? "danger" : "warning";
  return (
    <div
      style={{
        border: `1.5px solid var(--${tone})`,
        background: `var(--${tone}-bg)`,
        color: `var(--${tone}-fg)`,
        borderRadius: 10,
        padding: "14px 18px",
        marginBottom: 16,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15 }}>
        {urgent
          ? "This account is read-only until the subscription is renewed"
          : "Your subscription has ended"}
      </div>
      <div style={{ fontSize: 13.5, marginTop: 2 }}>
        {lifecycle.message}
        {blocksOn && urgent ? ` Access closes on ${blocksOn}.` : ""}
      </div>
      <a
        href="/subscription/renew"
        className="btn"
        style={{
          marginTop: 10,
          background: `var(--${tone})`,
          color: "#fff",
          padding: "7px 16px",
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        Renew now
      </a>
    </div>
  );
}

function HandoverBanner() {
  const { data: ho } = useQuery({
    queryKey: ["society-handover"],
    queryFn: async () => {
      const r = await fetch("/api/v1/society-handover", { credentials: "include" });
      return r.ok ? r.json() : null;
    },
    staleTime: 60_000,
  });
  const pending = ho?.handover && !ho.handover.confirmedAt ? { ...ho, handover: ho.handover } : null;

  if (!pending) return null;
  const deadline = pending.scheduledErasure
    ? new Date(pending.scheduledErasure).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  // Same hardcoded-hex/no-dark-mode bug as SubscriptionBanner above —
  // rewritten onto --warning-* (design-system audit, Plan 06).
  return (
    <a
      href="/admin/data-handover"
      style={{
        display: "block",
        textDecoration: "none",
        border: "1.5px solid var(--warning)",
        background: "var(--warning-bg)",
        color: "var(--warning-fg)",
        borderRadius: 10,
        padding: "14px 18px",
        marginBottom: 16,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15 }}>
        A copy of your society's records is ready for you to save
      </div>
      <div style={{ fontSize: 13.5, marginTop: 2 }}>
        {deadline
          ? `Please save it before ${deadline}, when your society's information is removed from this system. `
          : "Download it and keep it with your society's own files. "}
        Click here to collect it — it takes about a minute.
      </div>
    </a>
  );
}

function SkelBlock({ h = 100, r = 12, style }) {
  return <div className="skeleton" style={{ height: h, borderRadius: r, ...style }} />;
}

/** Shape-matched placeholder shown while dashboard stats load. */
function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div style={{ marginBottom: 24 }}>
        <SkelBlock h={14} r={4} style={{ width: 140, marginBottom: 12 }} />
        <div className={styles.attentionGrid}>
          {[0, 1, 2].map((i) => <SkelBlock key={i} h={104} />)}
        </div>
      </div>
      <div className={styles.bento}>
        {[0, 1, 2, 3].map((i) => <SkelBlock key={i} h={132} />)}
      </div>
      <SkelBlock h={120} style={{ margin: "14px 0" }} />
      <SkelBlock h={150} style={{ marginBottom: 14 }} />
      <div className={styles.bottomGrid}>
        <SkelBlock h={320} />
        <SkelBlock h={320} />
      </div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const now = new Date();
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [yearOptions, setYearOptions] = useState([now.getFullYear()]);
  const [minYear, setMinYear] = useState(now.getFullYear());
  const [minMonth, setMinMonth] = useState(1);
  const [latestBill, setLatestBill] = useState(null); // { year, month } of the newest bill, so billed future months stay selectable
  // FY starts Apr — compute current FY year
  const currentFyYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const [fyYear, setFyYear] = useState(currentFyYear);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12
  // Selectable range ends at the later of today and the newest bill — a
  // society whose bills run ahead of the calendar (simulated or pre-generated
  // months) must be able to open them.
  const endIdx = Math.max(currentYear * 12 + currentMonth, latestBill ? latestBill.year * 12 + latestBill.month : 0);
  const endYear = Math.floor((endIdx - 1) / 12);
  const endMonth = ((endIdx - 1) % 12) + 1;
  const endFyYear = endMonth >= 4 ? endYear : endYear - 1;
  const { data: yearRange } = useQuery({
    queryKey: ["year-range"],
    queryFn: async () => {
      const r = await fetch("/api/billing/year-range", { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    const d = yearRange;
    if (!d) return;
    const min = d.minYear || currentYear;
    const years = [];
    const last = Math.max(currentYear, d.maxYear || 0);
    for (let y = min; y <= last; y++) years.push(y);
    if (d.maxYear && d.maxMonth) setLatestBill({ year: d.maxYear, month: d.maxMonth });
    if (years.length > 0) setYearOptions(years);
    setMinYear(min);
    setMinMonth(d.minMonth || 1);
  }, [yearRange, currentYear]);
  // When year changes, clamp month to current month if we're on the current year
  const handleYearChange = (newYear) => {
    setFilterYear(newYear);
    if (newYear === endYear && filterMonth > endMonth) {
      setFilterMonth(endMonth);
    } else if (newYear === minYear && filterMonth < minMonth) {
      setFilterMonth(minMonth);
    }
  };
  // Months available: clamp start at minMonth for minYear, clamp end at currentMonth for currentYear
  const availableMonths = MONTHS.map((m, i) => ({
    label: m,
    value: i + 1,
  })).filter((m) => {
    if (filterYear === minYear && m.value < minMonth) return false;
    if (filterYear === endYear && m.value > endMonth) return false;
    return true;
  });
  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats", filterMonth, filterYear, fyYear],
    queryFn: async () => {
      const res = await fetch(
        `/api/admin/dashboard-stats?month=${filterMonth}&year=${filterYear}&fyYear=${fyYear}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });
  const outstanding = stats?.outstanding || {};
  const period = stats?.period || {};
  const fy = stats?.fy || {};
  const trend = stats?.trend || [];
  const recentPayments = stats?.recentPayments || [];
  const paymentModes = stats?.paymentModes || [];
  const totalMembers = stats?.totalMembers || 0;
  const collectionRate = period.collectionRate || 0;
  const fyCollectionRate = fy.collectionRate || 0;
  const fyYearOptions = useMemo(() => {
    const opts = [];
    const minFy = yearOptions[0] || currentYear - 2;
    // Cap FY at the FY of the newest bill or today, whichever is later
    for (let y = minFy; y <= Math.max(currentFyYear, endFyYear); y++) opts.push(y);
    return opts;
  }, [yearOptions, currentFyYear, endFyYear]);
  const periodLabel = filterMonth && filterYear
    ? `${MONTHS[filterMonth - 1]} ${filterYear}`
    : filterYear || "All";

  const collectedTrend = useMemo(() => trend.map((t) => Number(t.totalCollected || 0)), [trend]);
  const balanceTrend = useMemo(() => trend.map((t) => Number(t.totalBalance || 0)), [trend]);
  const avgCollected = collectedTrend.length
    ? collectedTrend.reduce((a, b) => a + b, 0) / collectedTrend.length
    : 0;

  const rateColor = tierColor(collectionRate);

  // Momentum — this period's collection vs the one right before it in the
  // same trend series already fetched above. No new request, no invented
  // number: trend[trend.length-1] is the current period, [-2] the prior one.
  const momentum = useMemo(() => {
    if (collectedTrend.length < 2) return null;
    const curr = collectedTrend[collectedTrend.length - 1];
    const prev = collectedTrend[collectedTrend.length - 2];
    if (!prev) return null;
    return Math.round(((curr - prev) / prev) * 100);
  }, [collectedTrend]);

  // Top payment mode — same paymentModes array already shown inside the
  // collection-rate card, just surfaced as its own headline stat.
  const topMode = useMemo(() => {
    if (!paymentModes.length) return null;
    return [...paymentModes].sort((a, b) => (b.total || 0) - (a.total || 0))[0];
  }, [paymentModes]);

  const quickLinks = [
    { label: "Generate Bills", icon: "file-text", path: "/admin/generate-bills" },
    { label: "Record Payment", icon: "credit-card", path: "/admin/payments" },
    { label: "View Bills", icon: "receipt", path: "/admin/view-bills" },
    { label: "Import Members", icon: "upload", path: "/admin/import-members" },
    { label: "Ledger", icon: "book-open", path: "/admin/ledger" },
    { label: "Billing Config", icon: "settings", path: "/admin/billing-config" },
    { label: "Bill Template", icon: "layout-template", path: "/admin/bill-template" },
    { label: "Society Config", icon: "building-2", path: "/admin/society-config" },
  ];

  return (
    <div className={styles.wrap} style={{ maxWidth: 1480, margin: "0 auto" }}>
      <SubscriptionBanner />
      <HandoverBanner />
      <PageHeader
        eyebrow={<><Icon name="calendar" size={11} /> {periodLabel} · {fy.label || `FY ${fyYear}-${String(fyYear + 1).slice(-2)}`}</>}
        title="Dashboard"
        sub="Society financial overview — collection, dues and recent activity."
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Select value={filterMonth} onChange={(v) => setFilterMonth(Number(v))} title="Bill month">
              {availableMonths.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <Select value={filterYear} onChange={(v) => handleYearChange(Number(v))} title="Bill year">
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Select value={fyYear} onChange={(v) => setFyYear(Number(v))} title="Financial year">
              {fyYearOptions.map((y) => <option key={y} value={y}>FY {y}-{String(y + 1).slice(-2)}</option>)}
            </Select>
          </div>
        }
      />

      {isLoading ? (
        <DashboardSkeleton />
      ) : (
      <>

      {/* ── NEEDS ATTENTION ─────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <SectionLabel icon="sparkles">Needs attention</SectionLabel>
        <div className={styles.attentionGrid}>
          <div>
            <ActionTile
              tone="danger"
              icon="alert-triangle"
              headline={`${outstanding.unpaidBillCount || 0} unpaid bills`}
              sub={`₹${fmt(outstanding.total)} outstanding across all periods`}
              cta="Open bills"
              onClick={() => router.push("/admin/view-bills")}
            />
          </div>
          <div>
            <ActionTile
              tone="warning"
              icon="percent"
              headline={`₹${fmt(outstanding.interest)} interest accrued`}
              sub={`₹${fmt(period.interestCharged)} charged in ${periodLabel}`}
              cta="Late payment"
              onClick={() => router.push("/admin/late-payment")}
            />
          </div>
          <div>
            <ActionTile
              tone={collectionRate >= 80 ? "success" : "info"}
              icon="trending-up"
              headline={`${collectionRate}% collected — ${periodLabel}`}
              sub={`${period.paidCount || 0} paid · ${period.unpaidCount || 0} pending of ${period.totalCount || 0} bills`}
              cta="Record payment"
              onClick={() => router.push("/admin/payments")}
            />
          </div>
        </div>
      </div>

      {/* ── BENTO METRICS ───────────────────────────────────────────── */}
      <div className={styles.bento}>
        {/* Collection — hero */}
        <div className={styles.bentoHero}>
        <Card style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <CardHead
              title={`Collection · ${periodLabel}`}
              sub={`₹${fmt(period.totalBilled)} billed this period`}
              right={<Pill tone={collectionRate >= 80 ? "paid" : collectionRate >= 50 ? "partial" : "overdue"}>{collectionRate}% collected</Pill>}
            />
            <div className="revamp-num" style={{ fontSize: 52, fontWeight: 700, color: "var(--r-fg-1)", letterSpacing: "-0.025em", lineHeight: 1, marginBottom: 10 }}>
              {compactINR(period.totalCollected)}
            </div>
            <div style={{ fontSize: 13, color: "var(--r-fg-3)", marginBottom: 18 }}>
              <span style={{ color: "var(--r-fg-1)", fontWeight: 600 }}>{period.paidCount || 0}</span> of {period.totalCount || 0} bills paid ·{" "}
              <span style={{ color: "var(--r-fg-1)", fontWeight: 600 }}>{totalMembers}</span> members
            </div>
            <Progress value={collectionRate} total={100} color={rateColor} height={8} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--r-fg-4)" }}>
              <span>Outstanding · <span className="revamp-num" style={{ color: "var(--r-danger)", fontWeight: 600 }}>₹{fmt(period.totalBalance)}</span></span>
              <span>Billed · <span className="revamp-num" style={{ color: "var(--r-fg-2)", fontWeight: 600 }}>₹{fmt(period.totalBilled)}</span></span>
            </div>
          </div>
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--r-hairline)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: "var(--r-fg-4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {trend.length}-month collection
              </div>
              <div style={{ fontSize: 11, color: "var(--r-fg-3)" }}>Avg {compactINR(avgCollected)}/mo</div>
            </div>
            {collectedTrend.length > 1
              ? <Sparkline data={collectedTrend} w={420} h={50} color="var(--r-brand)" id="collect" />
              : <div style={{ fontSize: 11, color: "var(--r-fg-5)" }}>Not enough history yet.</div>}
          </div>
        </Card>
        </div>

        {/* Members */}
        <div>
        <MiniMetric
          label="Members" value={totalMembers} icon="users"
          delta={`${period.totalCount || 0} bills this period`}
          onClick={() => router.push("/admin/view-members")}
          extra={
            <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
              <Chip label="Paid" value={period.paidCount || 0} tone="success" />
              <Chip label="Unpaid" value={period.unpaidCount || 0} tone="danger" />
            </div>
          }
        />
        </div>

        {/* Collection rate ring + payment modes */}
        <div>
        <Card>
          <CardHead title="Collection rate" sub={periodLabel} />
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Ring pct={collectionRate} color={rateColor} size={84} stroke={9} />
              <div className="revamp-num" style={{ position: "absolute", fontSize: 18, fontWeight: 700, color: "var(--r-fg-1)" }}>{collectionRate}%</div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "var(--r-fg-4)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>By mode</div>
              {paymentModes.length === 0 && <div style={{ fontSize: 11, color: "var(--r-fg-5)" }}>No payments yet</div>}
              {paymentModes.slice(0, 4).map((m) => (
                <div key={m.mode} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "3px 0", borderBottom: "1px solid var(--r-hairline)" }}>
                  <span style={{ color: "var(--r-fg-4)" }}>{m.mode}</span>
                  <span className="revamp-num" style={{ fontWeight: 600, color: "var(--r-fg-2)" }}>₹{fmt(m.total)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
        </div>

        {/* Outstanding */}
        <div>
        <MiniMetric
          label="Total outstanding" value={compactINR(outstanding.total)} icon="alert-triangle" tone="danger"
          delta={`${outstanding.unpaidBillCount || 0} unpaid bills · ₹${fmt(outstanding.interest)} interest`}
          onClick={() => router.push("/admin/view-bills")}
          extra={balanceTrend.length > 1 ? (
            <div style={{ marginTop: 12 }}><Sparkline data={balanceTrend} w={160} h={28} color="var(--r-danger)" id="bal" /></div>
          ) : null}
        />
        </div>

        {/* FY */}
        <div>
        <MiniMetric
          label={fy.label || `FY ${fyYear}`} value={compactINR(fy.totalCollected)} icon="wallet" tone="paid"
          delta={`of ₹${fmt(fy.totalBilled)} billed · ${fyCollectionRate}% rate`}
          onClick={() => router.push("/admin/ledger")}
          extra={<div style={{ marginTop: 12 }}><Progress value={fyCollectionRate} total={100} color="var(--r-accent)" height={5} /></div>}
        />
        </div>

        {/* Momentum — vs previous period in the same trend series */}
        {momentum !== null && (
          <div>
            <MiniMetric
              label="Momentum" value={`${momentum > 0 ? "+" : ""}${momentum}%`}
              icon={momentum >= 0 ? "trending-up" : "trending-down"}
              tone={momentum >= 0 ? "success" : "danger"}
              delta="Collected vs previous period"
            />
          </div>
        )}

        {/* Top payment mode — same data already listed in the ring card, surfaced */}
        {topMode && (
          <div>
            <MiniMetric
              label="Top payment mode" value={topMode.mode || "—"} icon="credit-card"
              delta={`₹${fmt(topMode.total)} via ${topMode.mode}`}
            />
          </div>
        )}
      </div>

      {/* ── QUICK ACTIONS ───────────────────────────────────────────── */}
      <Card style={{ marginBottom: 14 }}>
        <CardHead title="Quick actions" sub="The eight routes admins reach for most" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
          {quickLinks.map((link) => (
            <button
              key={link.label}
              onClick={() => router.push(link.path)}
              style={{
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10,
                padding: "14px 12px", background: "var(--r-surface-2)",
                border: "1px solid var(--r-border)", borderRadius: 10,
                cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-2)",
                fontFamily: "inherit", textAlign: "left",
                transition: "border-color 0.15s, background 0.15s, transform 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--r-brand-soft)";
                e.currentTarget.style.borderColor = "var(--r-brand)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--r-surface-2)";
                e.currentTarget.style.borderColor = "var(--r-border)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <Icon name={link.icon} size={18} />
              {link.label}
            </button>
          ))}
        </div>
      </Card>

      {/* ── FY SUMMARY ──────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 14 }}>
        <CardHead title={`${fy.label || `FY ${fyYear}`} — full year summary`} sub="Financial year runs April → March" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 20 }}>
          <SummaryStat label="Total billed" value={`₹${fmt(fy.totalBilled)}`} />
          <SummaryStat label="Collected" value={`₹${fmt(fy.totalCollected)}`} tone="paid" />
          <SummaryStat label="Outstanding" value={`₹${fmt(outstanding.total)}`} tone="overdue" />
          <SummaryStat label="Prior year dues" value={`₹${fmt(outstanding.total - fy.totalBalance)}`} tone="warning" />
          <SummaryStat label="FY collection rate" value={`${fyCollectionRate}%`} />
        </div>
      </Card>

      {/* ── RECENT PAYMENTS + MONTHLY BREAKDOWN ─────────────────────── */}
      <div className={styles.bottomGrid}>
        <Card padded={false} style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>Latest payments</div>
              <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 2 }}>{recentPayments.length} most recent entries</div>
            </div>
            <Btn variant="ghost" size="sm" iconR="arrow-right" onClick={() => router.push("/admin/payments")}>View all</Btn>
          </div>
          {recentPayments.length === 0 ? (
            <EmptyState icon="credit-card" title="No payments recorded" sub="Payments appear here as soon as they are entered." />
          ) : (
            <div style={{ overflowX: "auto" }} className="revamp-scroll">
              <MiniTable
                cols={[
                  { label: "Member" }, { label: "Period" }, { label: "Mode" },
                  { label: "Amount", align: "right", num: true }, { label: "Date", align: "right" },
                ]}
                rows={recentPayments.map((p, i) => {
                  const flat = p.memberId ? `${p.memberId.wing || ""}${p.memberId.wing ? "-" : ""}${p.memberId.flatNo || ""}` : "—";
                  const name = p.memberId?.ownerName || flat;
                  return {
                    key: p._id || i,
                    cells: [
                      <div key="m" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Avatar name={name} size={28} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>{name}</div>
                          <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>{flat}</div>
                        </div>
                      </div>,
                      <span key="p" style={{ color: "var(--r-fg-3)", fontSize: 12 }}>{p.billPeriodId || "—"}</span>,
                      <Pill key="mode" tone="info" dot={false}>{p.paymentMode || "Cash"}</Pill>,
                      <span key="a" className="revamp-num" style={{ color: "var(--r-success)", fontWeight: 600 }}>
                        +₹{(p.amount || 0).toLocaleString("en-IN")}
                      </span>,
                      <span key="d" style={{ fontSize: 11, color: "var(--r-fg-4)", whiteSpace: "nowrap" }}>
                        {p.date ? new Date(p.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                        {p.createdBy ? <div style={{ color: "var(--r-fg-5)" }}>by {p.createdBy}</div> : null}
                      </span>,
                    ],
                  };
                })}
              />
            </div>
          )}
        </Card>

        <Card padded={false} style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>Monthly breakdown</div>
              <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 2 }}>Click a row to jump to that period</div>
            </div>
            <Btn variant="ghost" size="sm" iconR="arrow-right" onClick={() => router.push("/admin/ledger")}>Ledger</Btn>
          </div>
          {trend.length === 0 ? (
            <EmptyState icon="bar-chart-3" title="No billing data" sub="Generate a bill cycle to populate the trend." />
          ) : (
            <>
              <MonthlyTrendChart trend={trend} />
              <div style={{ overflowX: "auto" }} className="revamp-scroll">
              <MiniTable
                cols={[
                  { label: "Period" }, { label: "Billed", align: "right", num: true },
                  { label: "Collected", align: "right", num: true }, { label: "Balance", align: "right", num: true },
                  { label: "Rate", align: "right" },
                ]}
                onRowClick={(r) => { setFilterMonth(r.meta.billMonth + 1); setFilterYear(r.meta.billYear); }}
                rows={[...trend].reverse().map((t, i) => {
                  const rate = t.totalBilled > 0 ? Math.round((t.totalCollected / t.totalBilled) * 100) : 0;
                  return {
                    key: t.label || i,
                    meta: t,
                    cells: [
                      <span key="l" style={{ fontWeight: 600, color: "var(--r-fg-1)", fontSize: 12.5 }}>{t.label}</span>,
                      <span key="b" style={{ fontSize: 12 }}>₹{fmt(t.totalBilled)}</span>,
                      <span key="c" style={{ fontSize: 12, color: "var(--r-success)", fontWeight: 600 }}>₹{fmt(t.totalCollected)}</span>,
                      <span key="x" style={{ fontSize: 12, color: "var(--r-danger)" }}>₹{fmt(t.totalBalance)}</span>,
                      <Pill key="r" tone={rate >= 80 ? "paid" : rate >= 50 ? "partial" : "overdue"} dot={false}>{rate}%</Pill>,
                    ],
                  };
                })}
              />
              </div>
            </>
          )}
        </Card>
      </div>
      </>
      )}
    </div>
  );
}
