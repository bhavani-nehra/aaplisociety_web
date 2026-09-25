"use client";
// Subscriptions — the money surface of the platform console.
//
// Reads the same /api/admin/metrics payload as the dashboard (so the two can
// never disagree about who is overdue) and writes through
// /api/admin/subscriptions/:id, which owns the multi-field consistency a
// payment requires.

import { Suspense, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";
import {
  Card, CardHead, SectionLabel, StatusPill, PlanChip, SocietyMark, Metric,
  Btn, Empty, NotConfigured, money, compactMoney, shortDate, relativeDays,
} from "../_components/PlatformUI";

const PLANS = ["Free", "Basic", "Premium", "Enterprise"];
const STATUSES = ["Active", "Trial", "Suspended", "Expired"];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "trial", label: "Trial" },
  { id: "active", label: "Active" },
  { id: "suspended", label: "Suspended" },
  { id: "expired", label: "Expired" },
  { id: "unpriced", label: "No plan price" },
];

// useSearchParams() below needs a Suspense boundary above it, or client-side
// navigation to this page throws Next's missing-suspense error overlay.
export default function SubscriptionsPage() {
  return (
    <Suspense fallback={null}>
      <SubscriptionsPageInner />
    </Suspense>
  );
}

function SubscriptionsPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [admin, setAdmin] = useState(null);
  const [filter, setFilter] = useState(params.get("filter") || "all");
  const [q, setQ] = useState("");
  const [panel, setPanel] = useState(null); // society row being acted on

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const user = d.user || d;
        if (user.role !== "SuperAdmin") router.push("/superadmin/login");
        else setAdmin(user);
      })
      .catch(() => router.push("/superadmin/login"));
  }, [router]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["platform-metrics"],
    queryFn: async () => {
      const res = await fetch("/api/admin/metrics", { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load");
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
    onSuccess: (json, variables) => {
      notify.success(json.summary || "Updated");
      queryClient.invalidateQueries({ queryKey: ["platform-metrics"] });
      // Recording a payment or changing a plan is one decision and closing on
      // it is right. Granting modules is a handful of decisions in a row —
      // closing after each would mean reopening the drawer per module. Keep it
      // open and take the new state from the response, so the switches move
      // now rather than when the invalidated query comes back.
      if (variables?.action === "set-modules") {
        setPanel((p) => (p ? { ...p, modules: json.modules || p.modules } : p));
      } else {
        setPanel(null);
      }
    },
    onError: (e) => notify.error(e.message),
  });

  const rows = useMemo(() => {
    const all = data?.societies || [];
    const now = Date.now();
    const prices = data?.pricing?.prices || {};
    return all.filter((s) => {
      const matchesQ =
        !q ||
        [s.name, s.area, s.contactEmail, s.registrationNo, s.societyCode]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q.toLowerCase()));
      if (!matchesQ) return false;
      switch (filter) {
        case "overdue":
          return s.nextPaymentDate && new Date(s.nextPaymentDate).getTime() < now && s.status === "Active";
        case "trial": return s.status === "Trial";
        case "active": return s.status === "Active";
        case "suspended": return s.status === "Suspended";
        case "expired": return s.status === "Expired";
        case "unpriced": return !prices[s.plan];
        default: return true;
      }
    });
  }, [data, filter, q]);

  if (!admin || isLoading) {
    return <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>Loading subscriptions…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--danger)" }}>
        {error.message}
        <div style={{ marginTop: 14 }}><Btn onClick={() => refetch()}>Retry</Btn></div>
      </div>
    );
  }

  const { totals, pricing, byPlan } = data;
  const priced = pricing.configured;

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto", color: "var(--fg-2)" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "var(--fg-1)" }}>Subscriptions</h1>
        <p style={{ color: "var(--fg-4)", fontSize: 13, marginTop: 4 }}>
          Plans, renewals and recorded payments across {totals.societies} societies.
        </p>
      </div>

      {!priced && (
        <Card style={{ marginBottom: 16, borderColor: "var(--warning)" }}>
          <NotConfigured
            what="No plan has a price yet, so expected revenue, arrears and 'no plan price' filtering can't be computed. Recorded payments below are still real."
            action="Set plan prices"
            href="/superadmin/settings"
          />
        </Card>
      )}

      {/* Money summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 18 }}>
        <Card><Metric label="Collected this month" value={compactMoney(totals.collectedThisMonth)} sub={`last month ${compactMoney(totals.collectedLastMonth)}`} /></Card>
        <Card>
          {priced
            ? <Metric label="Expected monthly" value={compactMoney(totals.expectedMonthly)} sub={`${byPlan ? Object.values(byPlan).reduce((n, v) => n + v.active, 0) : 0} active on a plan`} />
            : <Metric label="Expected monthly" value="—" sub="prices not set" />}
        </Card>
        <Card>
          {priced
            ? <Metric label="Arrears" value={compactMoney(totals.arrears)} tone={totals.arrears > 0 ? "var(--warning)" : "var(--success)"} sub={totals.arrears > 0 ? "expected minus collected" : "nothing outstanding"} />
            : <Metric label="Arrears" value="—" sub="needs plan prices" />}
        </Card>
        <Card><Metric label="Lifetime collected" value={compactMoney(totals.lifetimeCollected)} sub="all recorded payments" /></Card>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <Btn key={f.id} size="sm" variant={filter === f.id ? "primary" : "secondary"} onClick={() => setFilter(f.id)}>
              {f.label}
            </Btn>
          ))}
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search society, code, email…"
          style={{
            flex: 1, minWidth: 220, padding: "8px 12px", borderRadius: 8,
            border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))",
            color: "var(--fg-2)", fontSize: 13, outline: "none",
          }}
        />
      </div>

      <Card padded={false}>
        {rows.length === 0 ? (
          <Empty title="Nothing matches" sub="Try a different filter or search." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["Society", "Plan", "Status", "Next due", "Last paid", "Lifetime", ""].map((h, i) => (
                    <th key={h || i} style={{
                      textAlign: i >= 5 ? "right" : "left", padding: "10px 14px", fontSize: 10,
                      fontWeight: 700, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.6px",
                      background: "var(--bg-sunken)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const overdue = s.nextPaymentDate && new Date(s.nextPaymentDate) < new Date() && s.status === "Active";
                  return (
                    <tr key={s._id}>
                      <td style={cell}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                          <SocietyMark name={s.name} size={30} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{s.name}</div>
                            <div style={{ fontSize: 11, color: "var(--fg-4)" }}>{s.stats.members} members · {s.area || "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td style={cell}><PlanChip plan={s.plan} price={pricing.prices[s.plan]} /></td>
                      <td style={cell}>
                        <StatusPill status={s.status} />
                        {s.status === "Trial" && s.trialEndsAt && (
                          <div style={{ fontSize: 10.5, color: new Date(s.trialEndsAt) < new Date() ? "var(--danger)" : "var(--fg-4)", marginTop: 3 }}>
                            ends {relativeDays(s.trialEndsAt)}
                          </div>
                        )}
                      </td>
                      <td style={{ ...cell, color: overdue ? "var(--danger)" : "var(--fg-3)", fontWeight: overdue ? 700 : 400 }}>
                        {s.nextPaymentDate ? `${shortDate(s.nextPaymentDate)}` : "—"}
                        {overdue && <div style={{ fontSize: 10.5 }}>{relativeDays(s.nextPaymentDate)}</div>}
                      </td>
                      <td style={{ ...cell, color: "var(--fg-3)" }}>{s.lastPaymentDate ? shortDate(s.lastPaymentDate) : "—"}</td>
                      <td style={{ ...cell, textAlign: "right", fontWeight: 600 }}>{s.lifetimeCollected ? money(s.lifetimeCollected) : "—"}</td>
                      <td style={{ ...cell, textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <Btn size="sm" onClick={() => setPanel(s)}>Manage</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => router.push(`/superadmin/societies/${s._id}`)}>Open</Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {panel && (
        <ManagePanel
          society={panel}
          prices={pricing.prices}
          catalogue={data?.moduleCatalogue || []}
          busy={act.isPending}
          onClose={() => setPanel(null)}
          onAct={(body) => act.mutate({ id: panel._id, ...body })}
        />
      )}
    </div>
  );
}

const cell = { padding: "12px 14px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };

/* ── Manage drawer ─────────────────────────────────────────────────────── */

function ManagePanel({ society, prices, catalogue = [], busy, onClose, onAct }) {
  const modules = society.modules || {};
  const [amount, setAmount] = useState(prices[society.plan] || "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("");
  const [txnId, setTxnId] = useState("");
  const [days, setDays] = useState(14);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)", height: "100%", background: "var(--bg-surface)",
          borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflowY: "auto",
        }}
      >
        <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <SocietyMark name={society.name} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{society.name}</div>
              <div style={{ fontSize: 11.5, color: "var(--fg-4)" }}>
                {society.societyCode || society.registrationNo || "—"}
              </div>
            </div>
          </div>
          <Btn variant="ghost" size="sm" onClick={onClose}>Close</Btn>
        </div>

        <div style={{ padding: 20, display: "grid", gap: 22 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Metric label="Status" value={<StatusPill status={society.status} />} />
            <Metric label="Lifetime paid" value={money(society.lifetimeCollected)} />
          </div>

          <div>
            <SectionLabel>Record a payment</SectionLabel>
            <div style={{ display: "grid", gap: 9 }}>
              <Field label="Amount (₹)">
                <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} />
              </Field>
              <Field label="Date">
                <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} style={input} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
                <Field label="Method"><input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="UPI, NEFT…" style={input} /></Field>
                <Field label="Reference"><input value={txnId} onChange={(e) => setTxnId(e.target.value)} placeholder="optional" style={input} /></Field>
              </div>
              <Btn
                variant="primary"
                disabled={busy || !amount}
                onClick={() => onAct({ action: "record-payment", amount: Number(amount), date, method, transactionId: txnId })}
              >
                {busy ? "Saving…" : `Record ${amount ? money(amount) : "payment"}`}
              </Btn>
              <div style={{ fontSize: 11, color: "var(--fg-4)", lineHeight: 1.5 }}>
                Appends to payment history, moves the last-paid date, and rolls the next due date one month on.
                A payment on a trial or expired subscription activates it; a suspended one stays suspended.
              </div>
            </div>
          </div>

          <div>
            <SectionLabel>Plan</SectionLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PLANS.map((p) => (
                <Btn
                  key={p}
                  size="sm"
                  variant={society.plan === p ? "primary" : "secondary"}
                  disabled={busy || society.plan === p}
                  onClick={() => onAct({ action: "change-plan", planType: p })}
                >
                  {p}{prices[p] ? ` · ${money(prices[p])}` : ""}
                </Btn>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Status</SectionLabel>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STATUSES.map((st) => (
                <Btn
                  key={st}
                  size="sm"
                  variant={st === "Suspended" ? "danger" : society.status === st ? "primary" : "secondary"}
                  disabled={busy || society.status === st}
                  onClick={async () => {
                    if (st === "Suspended" && !(await notify.confirm(`Suspend ${society.name}? Members lose access immediately.`, { tone: "warning" }))) return;
                    onAct({ action: "set-status", status: st });
                  }}
                >
                  {st}
                </Btn>
              ))}
            </div>
          </div>

          <div>
            <SectionLabel>Add-on modules</SectionLabel>
            <div style={{ fontSize: 11, color: "var(--fg-4)", lineHeight: 1.5, marginBottom: 8 }}>
              Everything not listed here is base and cannot be switched off —
              billing, accounting, members, communication, roles and access, and
              the society&apos;s right to its own data.
            </div>
            {catalogue.length ? (
              <div style={{ display: "grid", gap: 6 }}>
                {catalogue.map((m) => {
                  const on = modules[m.key] === true;
                  return (
                    <div
                      key={m.key}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        gap: 10, padding: "8px 11px", borderRadius: 8,
                        border: "1px solid var(--border)", background: "var(--bg-subtle, transparent)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.label}</div>
                        {m.description ? (
                          <div style={{ fontSize: 11, color: "var(--fg-4)", lineHeight: 1.45 }}>
                            {m.description}
                          </div>
                        ) : null}
                      </div>
                      <Btn
                        size="sm"
                        variant={on ? "primary" : "secondary"}
                        disabled={busy}
                        onClick={async () => {
                          // Revoking hides a module a society may be using
                          // right now. Granting one is reversible and harmless,
                          // so only the takeaway asks.
                          if (
                            on &&
                            !(await notify.confirm(
                              `Turn off ${m.label} for ${society.name}? Anyone using it loses those pages within five minutes.`,
                              { tone: "warning" },
                            ))
                          )
                            return;
                          onAct({ action: "set-modules", modules: { [m.key]: !on } });
                        }}
                      >
                        {on ? "On" : "Off"}
                      </Btn>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--fg-4)" }}>No add-on modules defined.</div>
            )}
            <div style={{ fontSize: 11, color: "var(--fg-4)", lineHeight: 1.5, marginTop: 8 }}>
              A society on trial has everything regardless of these switches;
              the trial ending is what makes them take effect.
            </div>
          </div>

          <div>
            <SectionLabel>Trial</SectionLabel>
            <div style={{ fontSize: 12, color: "var(--fg-4)", marginBottom: 8 }}>
              {society.trialEndsAt ? `Currently ends ${shortDate(society.trialEndsAt)} (${relativeDays(society.trialEndsAt)})` : "No trial end date set"}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="number" min="1" max="90" value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ ...input, width: 90 }} />
              <Btn size="sm" disabled={busy} onClick={() => onAct({ action: "extend-trial", days })}>Extend by {days} days</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const input = {
  width: "100%", padding: "8px 11px", borderRadius: 8, fontSize: 13,
  border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))",
  color: "var(--fg-2)", outline: "none", fontFamily: "inherit",
};

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, color: "var(--fg-4)", fontWeight: 600, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
