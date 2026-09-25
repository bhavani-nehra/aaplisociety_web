"use client";
// Platform mission control.
//
// This is a working console, not a report: every society in the table can be
// acted on from the row it sits in — payment recorded, plan changed, suspended,
// reactivated, opened — individually or in bulk. Reading and doing live in the
// same place because the operator's loop is "see the problem, fix the problem",
// and bouncing them to another screen to act loses the context they just built.
//
// Every number comes from /api/admin/metrics, computed from real rows. Where a
// figure cannot be derived honestly — expected revenue before plan prices are
// set, a signal for a society with no history — the API returns null and this
// page says so. A fabricated number on the platform console is worse than a
// blank one: somebody acts on it.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";
import {
  Card, CardHead, SectionLabel, StatusPill, PlanChip, SignalBar, Sparkline,
  BarSeries, SocietyMark, Metric, NotConfigured, Empty, Btn,
  money, compactMoney, shortDate, relativeDays,
} from "../_components/PlatformUI";

const ACTION_TONES = {
  danger: ["var(--danger)", "var(--danger-bg)"],
  warning: ["var(--warning)", "var(--warning-bg)"],
  info: ["var(--info)", "var(--info-bg)"],
};

const COLUMNS = [
  { id: "name", label: "Society", align: "left" },
  { id: "members", label: "Members", align: "right", num: true },
  { id: "bills", label: "Bills", align: "right", num: true },
  { id: "collection", label: "Collected", align: "right", num: true },
  { id: "plan", label: "Plan", align: "left" },
  { id: "nextPaymentDate", label: "Next due", align: "left" },
  { id: "signal", label: "Signal", align: "left", num: true },
  { id: "status", label: "Status", align: "left" },
];

export default function PlatformDashboard() {
  const [admin, setAdmin] = useState(null);
  const router = useRouter();
  const queryClient = useQueryClient();

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState({ key: "members", dir: "desc" });
  const [selected, setSelected] = useState(() => new Set());
  const [payFor, setPayFor] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        const user = data.user || data;
        if (user.role !== "SuperAdmin") router.push("/superadmin/login");
        else setAdmin(user);
      })
      .catch(() => router.push("/superadmin/login"));
  }, [router]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["platform-metrics"],
    queryFn: async () => {
      const res = await fetch("/api/admin/metrics", { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load metrics");
      return res.json();
    },
    staleTime: 60 * 1000,
    enabled: !!admin,
  });

  const act = useMutation({
    mutationFn: async ({ id, ...body }) => {
      const res = await fetch(`/api/admin/subscriptions/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Action failed");
      return json;
    },
    onSuccess: (json) => {
      notify.success(json.summary || "Updated");
      queryClient.invalidateQueries({ queryKey: ["platform-metrics"] });
      setPayFor(null);
    },
    onError: (e) => notify.error(e.message),
  });

  const societies = data?.societies || [];

  const rows = useMemo(() => {
    const filtered = societies.filter((s) => {
      const matchesQ =
        !q ||
        [s.name, s.area, s.contactEmail, s.registrationNo, s.societyCode]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q.toLowerCase()));
      const matchesStatus = statusFilter === "all" || s.status === statusFilter;
      return matchesQ && matchesStatus;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (s) => {
      switch (sort.key) {
        case "members": return s.stats.members;
        case "bills": return s.stats.bills;
        case "collection": return s.lifetimeCollected;
        case "signal": return s.signal?.score ?? -1;
        case "nextPaymentDate": return s.nextPaymentDate ? new Date(s.nextPaymentDate).getTime() : Infinity;
        case "plan": return s.plan;
        case "status": return s.status;
        default: return (s.name || "").toLowerCase();
      }
    };
    return [...filtered].sort((a, b) => {
      const av = value(a); const bv = value(b);
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });
  }, [societies, q, statusFilter, sort]);

  if (!admin || isLoading) {
    return <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>Loading platform data…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--danger)" }}>
        {error.message}
        <div style={{ marginTop: 14 }}><Btn onClick={() => refetch()}>Retry</Btn></div>
      </div>
    );
  }

  const { totals, byStatus, byPlan, series, actions, activity, pricing, ops } = data;
  const priced = pricing.configured;
  const collectedDelta = totals.collectedLastMonth
    ? ((totals.collectedThisMonth - totals.collectedLastMonth) / totals.collectedLastMonth) * 100
    : null;
  const collectionRate = totals.bills ? Math.round((totals.paidBills / totals.bills) * 100) : null;
  const atRisk = societies.filter((s) => s.signal?.band === "risk");
  const renewals = societies
    .filter((s) => s.nextPaymentDate)
    .sort((a, b) => new Date(a.nextPaymentDate) - new Date(b.nextPaymentDate))
    .slice(0, 7);

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r._id));

  const bulk = async (status) => {
    const targets = rows.filter((r) => selected.has(r._id) && r.status !== status);
    if (!targets.length) return;
    const ok = await notify.confirm(
      `${status === "Suspended" ? "Suspend" : "Set to " + status} ${targets.length} societ${targets.length > 1 ? "ies" : "y"}?` +
        (status === "Suspended" ? " Members lose access immediately." : ""),
      { tone: status === "Suspended" ? "warning" : "default" },
    );
    if (!ok) return;
    for (const t of targets) {
      // Sequential on purpose: each write is audited, and a burst of parallel
      // writes against the same collection buys nothing at this scale.
      // eslint-disable-next-line no-await-in-loop
      await act.mutateAsync({ id: t._id, action: "set-status", status }).catch(() => {});
    }
    setSelected(new Set());
  };

  return (
    <div style={{ maxWidth: 1560, margin: "0 auto", color: "var(--fg-2)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.7px" }}>
            Platform owner · {admin.name || admin.email}
          </div>
          <h1 style={{ fontSize: 27, fontWeight: 700, margin: "6px 0 0", color: "var(--fg-1)" }}>Mission control</h1>
          <p style={{ color: "var(--fg-4)", fontSize: 13, marginTop: 4 }}>
            Updated {new Date(data.generatedAt).toLocaleTimeString("en-IN")} · live from the database, not cached
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn onClick={() => refetch()} disabled={isFetching}>{isFetching ? "Refreshing…" : "Refresh"}</Btn>
          <Btn onClick={() => router.push("/superadmin/operations")}>Operations</Btn>
          <Btn onClick={() => router.push("/superadmin/subscriptions")}>Subscriptions</Btn>
          <Btn variant="primary" onClick={() => router.push("/superadmin/societies")}>Onboard society</Btn>
        </div>
      </div>

      {/* KPI STRIP */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 18 }}>
        <Kpi label="Societies" value={totals.societies} sub={`${byStatus.Active || 0} active · ${byStatus.Trial || 0} trial`} />
        <Kpi label="Members" value={totals.members.toLocaleString("en-IN")} sub="across all societies" />
        <Kpi label="Bills raised" value={totals.bills.toLocaleString("en-IN")} sub={`${totals.paidBills.toLocaleString("en-IN")} paid`} />
        <Kpi
          label="Collection rate"
          value={collectionRate === null ? "—" : `${collectionRate}%`}
          sub={collectionRate === null ? "no bills yet" : "paid vs raised"}
          tone={collectionRate !== null && collectionRate < 50 ? "var(--warning)" : undefined}
        />
        <Kpi
          label="Collected MTD"
          value={compactMoney(totals.collectedThisMonth)}
          sub={collectedDelta === null ? "no prior month" : `${collectedDelta >= 0 ? "▲" : "▼"} ${Math.abs(collectedDelta).toFixed(0)}% MoM`}
          tone={collectedDelta !== null && collectedDelta < 0 ? "var(--warning)" : undefined}
        />
        <Kpi
          label="Arrears"
          value={priced ? compactMoney(totals.arrears) : "—"}
          sub={priced ? (totals.arrears > 0 ? "expected minus collected" : "nothing outstanding") : "needs plan prices"}
          tone={priced && totals.arrears > 0 ? "var(--danger)" : undefined}
        />
        <Kpi label="Lifetime" value={compactMoney(totals.lifetimeCollected)} sub="all recorded payments" />
        <Kpi
          label="Cron health"
          value={ops?.cron?.overall ? ops.cron.overall.toUpperCase() : "—"}
          sub={ops?.cron ? `${ops.cron.attention} of ${ops.cron.total} need attention` : "unavailable"}
          tone={ops?.cron?.attention ? "var(--danger)" : "var(--success)"}
          onClick={() => router.push("/superadmin/operations")}
        />
      </div>

      {/* ACTION ITEMS */}
      {actions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionLabel>Needs attention</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 11 }}>
            {actions.map((a, i) => {
              const [fg, bg] = ACTION_TONES[a.tone] || ACTION_TONES.info;
              return (
                <button key={i} onClick={() => router.push(a.href)} style={{
                  textAlign: "left", display: "flex", gap: 12, alignItems: "stretch", padding: 14,
                  borderRadius: 13, background: "var(--bg-surface)", border: "1px solid var(--border)",
                  cursor: "pointer", fontFamily: "inherit", width: "100%",
                }}>
                  <span style={{ width: 7, borderRadius: 4, background: fg, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--fg-1)" }}>{a.headline}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--fg-3)", marginTop: 3 }}>{a.sub}</span>
                  </span>
                  <span style={{ alignSelf: "center", fontSize: 12, fontWeight: 700, color: fg, background: bg, padding: "4px 9px", borderRadius: 7, whiteSpace: "nowrap" }}>{a.cta}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* REVENUE + SIDE PANELS */}
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14, marginBottom: 14 }}>
        <Card>
          <CardHead
            title="Revenue"
            sub="Collected is money recorded against a society. Expected is plan price × active societies."
            right={priced ? <StatusPill status={totals.arrears > 0 ? "Suspended" : "Active"} /> : null}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, marginBottom: 18 }}>
            <Metric label="Collected this month" value={compactMoney(totals.collectedThisMonth)} sub={`last month ${compactMoney(totals.collectedLastMonth)}`} />
            {priced ? (
              <>
                <Metric label="Expected monthly" value={compactMoney(totals.expectedMonthly)} />
                <Metric label="Shortfall" value={compactMoney(totals.arrears)} tone={totals.arrears > 0 ? "var(--warning)" : "var(--success)"} />
              </>
            ) : (
              <div style={{ gridColumn: "span 2" }}>
                <div style={{ fontSize: 10.5, color: "var(--fg-4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Expected monthly</div>
                <NotConfigured what="No plan has a price yet, so expected revenue and arrears can't be calculated." action="Set plan prices" href="/superadmin/settings" />
              </div>
            )}
          </div>
          <SectionLabel>Collected · last 12 months</SectionLabel>
          <BarSeries data={series.revenue} height={130} />
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
            <SectionLabel>Plan mix</SectionLabel>
            <div style={{ display: "grid", gap: 8 }}>
              {Object.entries(byPlan).map(([plan, v]) => (
                <div key={plan} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 92 }}><PlanChip plan={plan} price={v.price} /></div>
                  <div style={{ flex: 1, height: 6, background: "var(--bg-muted)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${totals.societies ? (v.societies / totals.societies) * 100 : 0}%`, height: "100%", background: "var(--primary)", borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--fg-4)", minWidth: 76 }}>{v.societies} societ{v.societies === 1 ? "y" : "ies"}</span>
                  <strong style={{ fontSize: 12.5, minWidth: 60, textAlign: "right" }}>{priced ? compactMoney(v.expectedMonthly) : "—"}</strong>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
          <Card>
            <CardHead title="Societies" sub="By subscription status" right={<span style={{ fontSize: 22, fontWeight: 700, color: "var(--fg-1)" }}>{totals.societies}</span>} />
            <div style={{ display: "flex", gap: 5, marginBottom: 14 }}>
              {["Active", "Trial", "Suspended", "Expired"].map((st) => {
                const n = byStatus[st] || 0;
                const tone = { Active: "var(--success)", Trial: "var(--info)", Suspended: "var(--danger)", Expired: "var(--fg-5)" }[st];
                return (
                  <button key={st} onClick={() => setStatusFilter(statusFilter === st ? "all" : st)} title={`Filter: ${st}`} style={{
                    flex: 1, background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  }}>
                    <div style={{ height: 5, borderRadius: 3, background: n ? tone : "var(--bg-muted)", opacity: statusFilter === "all" || statusFilter === st ? 1 : 0.35 }} />
                    <div style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 5, display: "flex", justifyContent: "space-between" }}>
                      <span>{st}</span><strong style={{ color: "var(--fg-2)" }}>{n}</strong>
                    </div>
                  </button>
                );
              })}
            </div>
            <SectionLabel>New societies · 12 months</SectionLabel>
            <Sparkline data={series.signups} height={36} color="var(--accent)" />
          </Card>

          {ops && (
            <Card>
              <CardHead title="Operations" sub="Scheduled jobs and queues" right={<Btn size="sm" variant="ghost" onClick={() => router.push("/superadmin/operations")}>Details</Btn>} />
              <div style={{ display: "grid", gap: 9 }}>
                <RowStat label="Jobs needing attention" value={`${ops.cron.attention} / ${ops.cron.total}`} tone={ops.cron.attention ? "var(--danger)" : "var(--success)"} />
                {ops.cron.never > 0 && <RowStat label="Never run" value={ops.cron.never} tone="var(--warning)" />}
                <RowStat label="Purges blocked" value={ops.queues.purgeBlocked} tone={ops.queues.purgeBlocked ? "var(--warning)" : undefined} />
                <RowStat label="Purges ready" value={ops.queues.purgeReady} />
                <RowStat label="Handovers uncollected" value={ops.queues.handoversPending} tone={ops.queues.handoversPending ? "var(--warning)" : undefined} />
                <RowStat label="Module denials (7d)" value={ops.queues.denials7d} />
              </div>
            </Card>
          )}

          <Card>
            <CardHead title="Upcoming renewals" sub="Nearest due first" />
            {renewals.length === 0 ? (
              <Empty title="No renewal dates set" sub="Record a payment to start a billing cycle." />
            ) : (
              <div style={{ display: "grid", gap: 9 }}>
                {renewals.map((s) => {
                  const overdue = new Date(s.nextPaymentDate) < new Date();
                  return (
                    <div key={s._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <button onClick={() => router.push(`/superadmin/societies/${s._id}`)} style={linkBtn}>{s.name}</button>
                      <span style={{ display: "flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 11.5, fontWeight: 600, color: overdue ? "var(--danger)" : "var(--fg-4)" }}>{relativeDays(s.nextPaymentDate)}</span>
                        <Btn size="sm" onClick={() => setPayFor(s)}>Record</Btn>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="At risk" sub="Low collection, gone quiet, or lapsed" />
            {atRisk.length === 0 ? (
              <Empty title="Nothing at risk" />
            ) : (
              <div style={{ display: "grid", gap: 11 }}>
                {atRisk.slice(0, 6).map((s) => (
                  <div key={s._id}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <button onClick={() => router.push(`/superadmin/societies/${s._id}`)} style={{ ...linkBtn, fontWeight: 600 }}>{s.name}</button>
                      <SignalBar signal={s.signal} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 2 }}>{s.signal.reasons.join(" · ")}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* MANAGEMENT TABLE */}
      <Card padded={false} style={{ marginBottom: 14 }}>
        <div style={{ padding: "14px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Manage societies</div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, code, email, reg no…"
            style={{
              flex: 1, minWidth: 200, padding: "7px 11px", borderRadius: 8, fontSize: 12.5,
              border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))",
              color: "var(--fg-2)", outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 5 }}>
            {["all", "Active", "Trial", "Suspended", "Expired"].map((f) => (
              <Btn key={f} size="sm" variant={statusFilter === f ? "primary" : "secondary"} onClick={() => setStatusFilter(f)}>
                {f === "all" ? "All" : f}
              </Btn>
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{rows.length} shown</span>
        </div>

        {selected.size > 0 && (
          <div style={{ padding: "9px 16px", background: "var(--bg-sunken)", borderTop: "1px solid var(--border)", display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 12.5 }}>{selected.size} selected</strong>
            <Btn size="sm" onClick={() => bulk("Active")} disabled={act.isPending}>Activate</Btn>
            <Btn size="sm" variant="danger" onClick={() => bulk("Suspended")} disabled={act.isPending}>Suspend</Btn>
            <Btn size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Btn>
          </div>
        )}

        <div style={{ overflowX: "auto", borderTop: "1px solid var(--border)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 34 }}>
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={() => setSelected(allShownSelected ? new Set() : new Set(rows.map((r) => r._id)))}
                    aria-label="Select all shown"
                  />
                </th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.id}
                    onClick={() => setSort((s) => ({ key: c.id, dir: s.key === c.id && s.dir === "desc" ? "asc" : "desc" }))}
                    style={{ ...th, textAlign: c.align, cursor: "pointer", userSelect: "none" }}
                  >
                    {c.label}{sort.key === c.id ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                  </th>
                ))}
                <th style={{ ...th, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={COLUMNS.length + 2}><Empty title="Nothing matches" sub="Try a different filter or search." /></td></tr>
              )}
              {rows.map((s) => {
                const overdue = s.nextPaymentDate && new Date(s.nextPaymentDate) < new Date() && s.status === "Active";
                const rate = s.stats.bills ? Math.round((s.stats.paidBills / s.stats.bills) * 100) : null;
                return (
                  <tr key={s._id} style={{ background: selected.has(s._id) ? "var(--bg-sunken)" : "transparent" }}>
                    <td style={td}>
                      <input type="checkbox" checked={selected.has(s._id)} onChange={() => toggle(s._id)} aria-label={`Select ${s.name}`} />
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <SocietyMark name={s.name} size={30} />
                        <div style={{ minWidth: 0 }}>
                          <button onClick={() => router.push(`/superadmin/societies/${s._id}`)} style={{ ...linkBtn, fontWeight: 600, fontSize: 13 }}>{s.name}</button>
                          <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{s.area || "—"}{s.societyCode ? ` · ${s.societyCode}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{s.stats.members}</td>
                    <td style={{ ...td, textAlign: "right" }}>{s.stats.bills}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={{ fontWeight: 600 }}>{s.lifetimeCollected ? money(s.lifetimeCollected) : "—"}</div>
                      {rate !== null && <div style={{ fontSize: 10.5, color: rate < 50 ? "var(--warning)" : "var(--fg-4)" }}>{rate}% of bills</div>}
                    </td>
                    <td style={td}><PlanChip plan={s.plan} price={pricing.prices[s.plan]} /></td>
                    <td style={{ ...td, color: overdue ? "var(--danger)" : "var(--fg-3)", fontWeight: overdue ? 700 : 400, whiteSpace: "nowrap" }}>
                      {s.nextPaymentDate ? shortDate(s.nextPaymentDate) : "—"}
                      {s.status === "Trial" && s.trialEndsAt && (
                        <div style={{ fontSize: 10.5, color: new Date(s.trialEndsAt) < new Date() ? "var(--danger)" : "var(--fg-4)" }}>
                          trial {relativeDays(s.trialEndsAt)}
                        </div>
                      )}
                    </td>
                    <td style={td}><SignalBar signal={s.signal} /></td>
                    <td style={td}><StatusPill status={s.status} /></td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 5 }}>
                        <Btn size="sm" onClick={() => setPayFor(s)} disabled={act.isPending}>Payment</Btn>
                        {s.status === "Suspended" || s.status === "Expired" ? (
                          <Btn size="sm" onClick={() => act.mutate({ id: s._id, action: "set-status", status: "Active" })} disabled={act.isPending}>Activate</Btn>
                        ) : (
                          <Btn
                            size="sm"
                            variant="danger"
                            disabled={act.isPending}
                            onClick={async () => {
                              if (!(await notify.confirm(`Suspend ${s.name}? Members lose access immediately.`, { tone: "warning" }))) return;
                              act.mutate({ id: s._id, action: "set-status", status: "Suspended" });
                            }}
                          >
                            Suspend
                          </Btn>
                        )}
                        <Btn size="sm" variant="ghost" onClick={() => router.push(`/superadmin/societies/${s._id}`)}>Open</Btn>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ACTIVITY */}
      <Card>
        <CardHead title="Platform activity" sub="From the audit trail" right={<Btn size="sm" variant="ghost" onClick={() => router.push("/superadmin/logs")}>All logs</Btn>} />
        {activity.length === 0 ? (
          <Empty title="No recorded activity yet" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
            {activity.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 10px", background: "var(--bg-sunken)", borderRadius: 9 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: "var(--fg-2)", textTransform: "lowercase" }}>{a.action.replaceAll("_", " ")}</div>
                  {a.society && <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{a.society}</div>}
                </div>
                <div style={{ fontSize: 11, color: "var(--fg-5)", whiteSpace: "nowrap" }}>{relativeDays(a.at)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {payFor && (
        <PaymentDialog
          society={payFor}
          suggested={pricing.prices[payFor.plan]}
          busy={act.isPending}
          onClose={() => setPayFor(null)}
          onSubmit={(body) => act.mutate({ id: payFor._id, ...body })}
        />
      )}
    </div>
  );
}

/* ── bits ─────────────────────────────────────────────────────────────── */

const th = {
  padding: "9px 12px", fontSize: 10, fontWeight: 700, color: "var(--fg-4)",
  textTransform: "uppercase", letterSpacing: "0.6px", background: "var(--bg-sunken)",
  borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", textAlign: "left",
};
const td = { padding: "10px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };
const linkBtn = {
  background: "none", border: "none", padding: 0, color: "var(--fg-2)",
  cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, textAlign: "left",
  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%",
};

function Kpi({ label, value, sub, tone, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12,
        padding: "13px 14px", cursor: onClick ? "pointer" : "default",
      }}
    >
      <div style={{ fontSize: 10, color: "var(--fg-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 700, marginTop: 5, color: tone || "var(--fg-1)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "var(--fg-4)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function RowStat({ label, value, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 12, color: "var(--fg-4)" }}>{label}</span>
      <strong style={{ fontSize: 13, color: tone || "var(--fg-1)" }}>{value}</strong>
    </div>
  );
}

function PaymentDialog({ society, suggested, busy, onClose, onSubmit }) {
  const [amount, setAmount] = useState(suggested || "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [txnId, setTxnId] = useState("");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(420px, 100%)", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
          <SocietyMark name={society.name} />
          <div>
            <div style={{ fontWeight: 700 }}>Record payment</div>
            <div style={{ fontSize: 12, color: "var(--fg-4)" }}>{society.name}</div>
          </div>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-4)" }}>
            Amount (₹)
            <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} style={dlgInput} autoFocus />
          </label>
          <label style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-4)" }}>
            Date
            <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} style={dlgInput} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-4)" }}>
              Method
              <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="UPI, NEFT…" style={dlgInput} />
            </label>
            <label style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-4)" }}>
              Reference
              <input value={txnId} onChange={(e) => setTxnId(e.target.value)} placeholder="optional" style={dlgInput} />
            </label>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 12, lineHeight: 1.5 }}>
          Rolls the next due date one month on and reactivates a trial or expired subscription. A suspended society stays suspended.
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={busy || !amount} onClick={() => onSubmit({ action: "record-payment", amount: Number(amount), date, method, transactionId: txnId })}>
            {busy ? "Saving…" : `Record ${amount ? money(amount) : ""}`}
          </Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}

const dlgInput = {
  width: "100%", marginTop: 4, padding: "8px 11px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))",
  color: "var(--fg-2)", outline: "none", fontFamily: "inherit",
};
