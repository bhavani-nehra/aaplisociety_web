"use client";
import { useCallback, useEffect, useState } from "react";
import { installIdleTracking, isPageIdleForPolling } from "@/lib/idle-tracker";
import {
  Card,
  PageHeader,
  Button,
  Avatar,
  StatusBadge,
  PurposeTag,
  Badge,
  Spinner,
  EmptyState,
  Toast,
  tokens,
  timeAgo,
  fmtTime,
} from "@/components/visitor/ui";
async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}
const S = {
  colWrap: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 },
  colTitle: { display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: tokens.text, marginBottom: 12 },
  count: { background: "var(--accent-tint)", color: tokens.primary, borderRadius: 999, padding: "1px 9px", fontSize: 12, fontWeight: 700 },
  item: { display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--bg-muted)" },
  body: { flex: 1, minWidth: 0 },
  name: { fontWeight: 600, color: tokens.text },
  meta: { fontSize: 12, color: tokens.sub, marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" },
  flat: { fontSize: 12, color: tokens.text, marginTop: 2 },
  actions: { marginTop: 8 },
  center: { display: "flex", justifyContent: "center", padding: 40 },
  liveDot: { display: "inline-block", width: 8, height: 8, borderRadius: 999, background: tokens.success, marginRight: 6 },
};
function Column({ title, icon, rows, action }) {
  return (
    <Card>
      <div style={S.colTitle}>
        <span>{icon}</span> {title} <span style={S.count}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="door-open" title="Nobody inside right now" />
      ) : (
        rows.map((v) => (
          <div key={v._id} style={S.item}>
            <Avatar src={v.photo} name={v.name} size={44} />
            <div style={S.body}>
              <div style={S.name}>{v.name}</div>
              <div style={S.meta}>
                <PurposeTag purpose={v.purpose} />
                {v.vehicleNumber && <Badge>{v.vehicleNumber}</Badge>}
              </div>
              <div style={S.flat}>
                Flat {v.memberId && v.memberId.wing ? v.memberId.wing + "-" : ""}
                {(v.memberId && v.memberId.flatNo) || "—"}
                {" · "}
                {timeAgo(v.entryTime || v.createdAt)}
              </div>
              {action && <div style={S.actions}>{action(v)}</div>}
            </div>
            <StatusBadge status={v.status} />
          </div>
        ))
      )}
    </Card>
  );
}
export default function AdminActiveVisitors() {
  const [data, setData] = useState({ Pending: [], Approved: [], Entered: [] });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(null);
  // `silent` polls do NOT toggle the full-page spinner, so background
  // refreshes no longer visibly flash/reload the tiles.
  const load = useCallback(async (silent = false) => {
    // Plan 05 §A3: a background poll (silent=true) must not keep a
    // visible-but-abandoned tab's session alive forever — see
    // lib/idle-tracker.js. A non-silent call is always a real user action
    // (or the initial mount) and is never skipped.
    if (silent && isPageIdleForPolling()) return;
    if (!silent) setLoading(true);
    try {
      const [p, a, e] = await Promise.all([
        api("/api/admin/visitors?status=Pending&limit=50"),
        api("/api/admin/visitors?status=Approved&limit=50"),
        api("/api/admin/visitors?status=Entered&limit=50"),
      ]);
      setData({
        Pending: (p && p.visitors) || [],
        Approved: (a && a.visitors) || [],
        Entered: (e && e.visitors) || [],
      });
    } catch (err) {
      if (!silent) setToast({ message: err.message || "Failed to load", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    installIdleTracking();
    load();
    // Poll every 45s and ONLY while the tab is visible: slashes Vercel function
    // invocations (was every 10s, even in background tabs) and stops the tiles
    // from visibly reloading while the admin is looking.
    let timer = null;
    const start = () => {
      if (timer == null) timer = setInterval(() => load(true), 45000);
    };
    const stop = () => {
      if (timer != null) { clearInterval(timer); timer = null; }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else { load(true); start(); }
    };
    if (typeof document === "undefined" || !document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
  }, [load]);
  const markExit = async (id) => {
    setBusy(id);
    try {
      await api("/api/visitor/exit", { method: "PATCH", body: JSON.stringify({ visitorId: id }) });
      setToast({ message: "Marked as exited", type: "success" });
      load();
    } catch (err) {
      setToast({ message: err.message || "Failed", type: "error" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <PageHeader
        title="Active Visitors"
        subtitle={
          <span>
            <span style={S.liveDot} />
            Live · auto-refreshing every 10s
          </span>
        }
        actions={
          <Button variant="ghost" onClick={load}>
            ↻ Refresh
          </Button>
        }
      />
      {loading ? (
        <div style={S.center}>
          <Spinner size={28} />
        </div>
      ) : (
        <div style={S.colWrap}>
          <Column title="Awaiting approval" icon="" rows={data.Pending} />
          <Column title="Approved · at gate" icon="" rows={data.Approved} />
          <Column
            title="Inside premises"
            icon=""
            rows={data.Entered}
            action={(v) => (
              <Button variant="subtle" size="sm" disabled={busy === v._id} onClick={() => markExit(v._id)}>
                Mark exit
              </Button>
            )}
          />
        </div>
      )}
      <Toast {...(toast || {})} onClose={() => setToast(null)} />
    </div>
  );
}