"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader, Card, CardHead, Btn, Pill, Icon, Segmented, SmallStat,
  EmptyState, RevampSkeleton,
} from "@/components/revamp";

async function api(url) {
  const res = await fetch(url, { credentials: "include" });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const STATUS_TONE = { Pending: "warning", Approved: "info", Entered: "paid", Exited: "neutral", Rejected: "unpaid" };
const fmtTime = (v) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

export default function AdminVisitorsOverview() {
  const router = useRouter();
  const [summary, setSummary] = useState({});
  const [recent, setRecent] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, an] = await Promise.all([
        api("/api/admin/visitors?limit=8"),
        api(`/api/admin/visitors/analytics?days=${days}`),
      ]);
      setSummary((list && list.summary) || {});
      setRecent((list && list.visitors) || []);
      setAnalytics(an);
    } catch (_) {
      // best-effort — an empty dashboard is still a valid render
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  const maxPurpose = analytics ? Math.max(1, ...analytics.byPurpose.map((p) => p.count)) : 1;

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="door-open" size={11} /> Operations · Visitors</>}
        title="Visitor management"
        sub="Live gate activity, approvals and visitor trends."
        right={<Btn variant="secondary" icon="list" onClick={() => router.push("/admin/visitors/log")}>Open full log</Btn>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
        <SmallStat label="Inside now" value={summary.Entered || 0} />
        <SmallStat label="Awaiting approval" value={summary.Pending || 0} />
        <SmallStat label="Approved" value={summary.Approved || 0} />
        <SmallStat label="Rejected" value={summary.Rejected || 0} />
        <SmallStat label="Logged all time" value={total} />
      </div>

      {loading ? (
        <RevampSkeleton h={400} />
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--r-fg-1)" }}>Trends</div>
              <Segmented value={days} onChange={setDays} options={[{ value: 7, label: "7d" }, { value: 30, label: "30d" }, { value: 90, label: "90d" }]} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 20 }}>
              <Card>
                <CardHead title="By purpose" />
                {analytics && analytics.byPurpose.length ? (
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {analytics.byPurpose.map((p) => (
                      <div key={p._id || "none"} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 110, fontSize: 12.5, color: "var(--r-fg-3)" }}>{p._id || "Other"}</span>
                        <span style={{ flex: 1, height: 8, background: "var(--r-surface-3)", borderRadius: 999, overflow: "hidden" }}>
                          <span style={{ display: "block", height: "100%", width: `${Math.round((p.count / maxPurpose) * 100)}%`, background: "var(--r-brand)", borderRadius: 999 }} />
                        </span>
                        <span style={{ width: 32, textAlign: "right", fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-1)" }}>{p.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon="bar-chart-3" title="No data yet" />
                )}
              </Card>
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--r-fg-1)" }}>Recent activity</div>
              <Btn variant="ghost" size="sm" onClick={() => router.push("/admin/visitors/log")}>Open visitor log</Btn>
            </div>
            <Card padded={recent.length === 0}>
              {recent.length === 0 ? (
                <EmptyState icon="door-open" title="No visitors yet" />
              ) : (
                recent.map((v, i) => (
                  <div key={v._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 18px", borderTop: i > 0 ? "1px solid var(--r-hairline)" : "none" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{v.name}</div>
                      <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <span>{v.purpose}</span> · Flat {v.memberId?.wing ? `${v.memberId.wing}-` : ""}{v.memberId?.flatNo || "—"} · {fmtTime(v.createdAt)}
                      </div>
                    </div>
                    <Pill tone={STATUS_TONE[v.status] || "neutral"} dot={false}>{v.status}</Pill>
                  </div>
                ))
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
