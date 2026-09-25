"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  StatCard,
  StatusBadge,
  PurposeTag,
  Avatar,
  EmptyState,
  Spinner,
  Toast,
  Modal,
  Field,
  Textarea,
  grid,
  tokens,
  timeAgo,
} from "@/components/visitor/ui";
import OfflineEntryForm from "@/components/visitor/OfflineEntryForm";
import OutboxStatus from "@/components/visitor/OutboxStatus";
const POLL_MS = 30000;
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
// ---- styles ----
const S = {
  loadingWrap: { display: "flex", justifyContent: "center", padding: 60 },
  colsWrap: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 16,
    marginTop: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: tokens.text, margin: "0 0 6px" },
  helpText: { fontSize: 12.5, color: tokens.sub, margin: "0 0 14px", lineHeight: 1.5 },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "14px 0",
    borderBottom: "1px solid var(--bg-muted)",
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontWeight: 600, color: tokens.text, fontSize: 14 },
  rowMeta: { fontSize: 12, color: tokens.sub, marginTop: 2 },
  // Buttons wrap onto their own line so every action is always visible.
  actions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 10,
  },
  callBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    fontSize: 13,
    fontWeight: 600,
    borderRadius: tokens.radiusSm,
    border: tokens.border,
    color: tokens.text,
    textDecoration: "none",
    background: "var(--bg-surface)",
  },
  warnTag: { color: "var(--warning-fg)", fontWeight: 700, fontSize: 12, marginLeft: 8 },
  expTag: { color: tokens.danger, fontWeight: 700, fontSize: 12, marginLeft: 8 },
  sosP: { color: tokens.sub, fontSize: 14, marginTop: 0, marginBottom: 14 },
};
export default function SecurityDashboardPage() {
  const [stats, setStats] = useState(null);
  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);
  const [inside, setInside] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [sosOpen, setSosOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [sosNote, setSosNote] = useState("");
  const [sosBusy, setSosBusy] = useState(false);
  const notify = (message, type = "info") => setToast({ message, type });
  const load = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const [s, p, exp, a, i] = await Promise.all([
        api("/api/security/stats").catch(() => null),
        api("/api/visitor/list?scope=pending&limit=50").catch(() => ({ visitors: [] })),
        api("/api/visitor/list?status=Expired&limit=50").catch(() => ({ visitors: [] })),
        api("/api/visitor/list?status=Approved&limit=50").catch(() => ({ visitors: [] })),
        api("/api/visitor/list?scope=active&limit=50").catch(() => ({ visitors: [] })),
      ]);
      if (s) setStats(s.stats || s);
      // Merge Pending + Expired into one "needs action" list, oldest first.
      const pendingList = (p && (p.visitors || p.data)) || [];
      const expiredList = (exp && (exp.visitors || exp.data)) || [];
      const merged = [...pendingList, ...expiredList].sort(
        (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      );
      setPending(merged);
      setApproved((a && (a.visitors || a.data)) || []);
      setInside((i && (i.visitors || i.data)) || []);
    } catch (e) {
      notify(e.message || "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
    // Poll only while the tab is visible -- cuts background Vercel invocations.
    let t = null;
    const start = () => {
      if (t == null) t = setInterval(() => load(true), POLL_MS);
    };
    const stop = () => {
      if (t != null) { clearInterval(t); t = null; }
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
  // Every action is one tap. The backend does the real work; the guard just
  // sees the result as a toast and the list refreshes.
  const act = async (id, kind) => {
    setBusyId(id + kind);
    try {
      if (kind === "enter") {
        await api("/api/visitor/enter", { method: "PATCH", body: JSON.stringify({ visitorId: id }) });
        notify("Visitor let in — resident notified ✓", "success");
      } else if (kind === "exit") {
        await api("/api/visitor/exit", { method: "PATCH", body: JSON.stringify({ visitorId: id }) });
        notify("Visitor checked out ✓", "success");
      } else if (kind === "deny") {
        await api("/api/visitor/approve", { method: "POST", body: JSON.stringify({ visitorId: id, action: "reject" }) });
        notify("Visitor denied & turned away", "info");
      } else if (kind === "override") {
        await api("/api/visitor/guard-admit", { method: "PATCH", body: JSON.stringify({ visitorId: id }) });
        notify("Visitor allowed in — resident notified ✓", "success");
      } else if (kind === "remind") {
        const r = await api("/api/visitor/remind", { method: "PATCH", body: JSON.stringify({ visitorId: id }) });
        const ch = (r.delivered || []).filter(Boolean).join(" + ");
        notify(
          ch
            ? `Resident reminded on ${ch} ✓`
            : "Reminder sent — resident notified in the app ✓",
          "success",
        );
      }
      await load(true);
    } catch (e) {
      notify(e.message || "Action failed", "error");
    } finally {
      setBusyId(null);
    }
  };
  const sendSos = async () => {
    setSosBusy(true);
    try {
      await api("/api/visitor/sos", { method: "POST", body: JSON.stringify({ note: sosNote }) });
      notify("SOS broadcast sent to admins & security ✓", "success");
      setSosOpen(false);
      setSosNote("");
    } catch (e) {
      notify(e.message || "Failed to send SOS", "error");
    } finally {
      setSosBusy(false);
    }
  };
  const onOfflineDone = (outcome) => {
    setOfflineOpen(false);
    if (outcome === "sent")
      notify("Entry logged — resident notified to confirm ✓", "success");
    else if (outcome === "queued")
      notify(
        "Saved on device — it will send automatically when online ✓",
        "info",
      );
    load(true);
  };
  const statList = stats
    ? [
        { label: "Inside now", value: stats.insideNow ?? 0, color: tokens.success, icon: "\uD83C\uDFE0" },
        { label: "Pending approval", value: stats.pendingNow ?? 0, color: "var(--warning)", icon: "\u23F3" },
        { label: "Visitors today", value: stats.totalToday ?? 0, color: tokens.primary, icon: "\uD83D\uDC65" },
        { label: "Entered today", value: stats.enteredToday ?? 0, color: "var(--accent)", icon: "\u2705" },
        { label: "Exited today", value: stats.exitedToday ?? 0, color: tokens.sub, icon: "\uD83D\uDEAA" },
        { label: "Rejected today", value: stats.rejectedToday ?? 0, color: tokens.danger, icon: "\u26D4" },
      ]
    : [];
  const renderRow = (v, kind) => {
    const id = v._id || v.id;
    const waitSecs = Math.floor((Date.now() - new Date(v.createdAt).getTime()) / 1000);
    const isExpired = v.status === "Expired";
    const waitedLong = kind === "pending" && (isExpired || waitSecs > 900); // >15 min or expired
    const rowStyle = {
      ...S.row,
      ...(isExpired
        ? { background: "var(--danger-bg)", borderRadius: 8, padding: "14px 10px" }
        : waitedLong
        ? { background: "var(--warning-bg)", borderRadius: 8, padding: "14px 10px" }
        : {}),
    };
    const flat =
      (v.memberId && v.memberId.wing ? v.memberId.wing + "-" : "") +
      ((v.memberId && v.memberId.flatNo) || "\u2014");
    return (
      <div key={id} style={rowStyle}>
        <Avatar src={v.photo} name={v.name} />
        <div style={S.rowMain}>
          <div style={S.rowName}>
            {v.name}
            {isExpired ? (
              <span style={S.expTag}>⛔ No reply — {Math.floor(waitSecs / 60)}m</span>
            ) : waitedLong ? (
              <span style={S.warnTag}>⚠ Waiting {Math.floor(waitSecs / 60)}m</span>
            ) : null}
          </div>
          <div style={S.rowMeta}>
            <PurposeTag purpose={v.purpose} /> &middot; Flat {flat} &middot;{" "}
            {kind === "inside"
              ? "in " + timeAgo(v.entryTime || v.updatedAt)
              : timeAgo(v.createdAt)}
          </div>
          <div style={S.actions}>
            <StatusBadge status={v.status} />
            {kind === "pending" &&
              (() => {
                const phone =
                  (v.memberId &&
                    (v.memberId.contactNumber || v.memberId.whatsappNumber)) ||
                  v.phone ||
                  "";
                const cleanPhone = String(phone).replace(/[^\d+]/g, "");
                return (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={busyId === id + "remind"}
                      onClick={() => act(id, "remind")}
                      title="Ping the resident again on the app, WhatsApp & SMS — fully automatic"
                    >
                      {busyId === id + "remind" ? "Reminding\u2026" : "\uD83D\uDD14 Remind"}
                    </Button>
                    {cleanPhone && (
                      <a
                        href={`tel:${cleanPhone}`}
                        style={S.callBtn}
                        title={`Call the flat (${cleanPhone})`}
                      >
                        📞 Call
                      </a>
                    )}
                    <Button
                      size="sm"
                      variant="success"
                      disabled={!!busyId}
                      onClick={() => act(id, "override")}
                      title="Admit the visitor now — use after the resident confirms by phone"
                    >
                      ✅ Allow in
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!!busyId}
                      onClick={() => act(id, "deny")}
                      title="Turn the visitor away"
                    >
                      ⛔ Deny
                    </Button>
                  </>
                );
              })()}
            {kind === "approved" && (
              <Button
                size="sm"
                variant="success"
                disabled={busyId === id + "enter"}
                onClick={() => act(id, "enter")}
              >
                ✅ Allow in
              </Button>
            )}
            {kind === "inside" && (
              <Button
                size="sm"
                variant="subtle"
                disabled={busyId === id + "exit"}
                onClick={() => act(id, "exit")}
              >
                🚪 Check out
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div>
      <PageHeader
        title="Gate Dashboard"
        subtitle="Live visitor activity at your gate"
        actions={
          <>
            <Button variant="ghost" size="md" onClick={() => load()}>
              ↻ Refresh
            </Button>
            <Button variant="subtle" size="md" onClick={() => setOfflineOpen(true)}>
              📝 Offline entry
            </Button>
            <Button variant="danger" size="md" onClick={() => setSosOpen(true)}>
              🚨 SOS
            </Button>
          </>
        }
      />
      <OutboxStatus />
      {loading && !stats ? (
        <div style={S.loadingWrap}>
          <Spinner size={30} />
        </div>
      ) : (
        <>
          <div style={grid(180)}>
            {statList.map((s) => (
              <StatCard key={s.label} {...s} />
            ))}
          </div>
          <div style={S.colsWrap}>
            <Card>
              <h3 style={S.sectionTitle}>
                Awaiting resident approval ({pending.length})
              </h3>
              <p style={S.helpText}>
                The resident has already been notified in the app. <b>No reply yet?</b>{" "}
                Tap <b>🔔 Remind</b> to ping them again automatically (app + WhatsApp
                + SMS — you don’t type anything), or <b>📞 Call</b> the flat. Once they
                confirm, tap <b>✅ Allow in</b>. Tap <b>⛔ Deny</b> to turn the visitor
                away.
              </p>
              {pending.length === 0 ? (
                <EmptyState
                  icon="hourglass"
                  title="No one waiting"
                  subtitle="All visitor requests have been actioned."
                />
              ) : (
                pending.map((v) => renderRow(v, "pending"))
              )}
            </Card>
            <Card style={approved.length > 0 ? { borderColor: "var(--success)", borderWidth: 2 } : {}}>
              <h3 style={S.sectionTitle}>
                Resident approved — let them in ({approved.length})
              </h3>
              <p style={S.helpText}>
                The resident said yes. Verify the visitor and tap <b>✅ Allow in</b>.
              </p>
              {approved.length === 0 ? (
                <EmptyState
                  icon="circle-check"
                  title="Nothing to action"
                  subtitle="No approved visitors waiting at the gate."
                />
              ) : (
                approved.map((v) => renderRow(v, "approved"))
              )}
            </Card>
            <Card>
              <h3 style={S.sectionTitle}>Currently inside ({inside.length})</h3>
              <p style={S.helpText}>
                Visitors on the premises. Tap <b>🚪 Check out</b> when they leave.
              </p>
              {inside.length === 0 ? (
                <EmptyState
                  icon="🏠"
                  title="Nobody inside"
                  subtitle="No active visitors on premises."
                />
              ) : (
                inside.map((v) => renderRow(v, "inside"))
              )}
            </Card>
          </div>
        </>
      )}
      <Modal
        open={offlineOpen}
        title="📝 Offline person entry"
        onClose={() => setOfflineOpen(false)}
      >
        <p style={S.sosP}>
          Use this when someone is already being let in — it works even with no
          network. The entry is saved on this device, and the resident gets a
          high-priority “someone entered to meet you” alert to confirm.
        </p>
        <OfflineEntryForm onDone={onOfflineDone} />
      </Modal>
      <Modal
        open={sosOpen}
        title="🚨 Raise SOS alert"
        onClose={() => setSosOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSosOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={sosBusy} onClick={sendSos}>
              {sosBusy ? "Sending\u2026" : "Broadcast SOS"}
            </Button>
          </>
        }
      >
        <p style={S.sosP}>
          This immediately alerts all admins, the secretary and other guards. Use only for
          genuine emergencies.
        </p>
        <Field label="What's happening? (optional)">
          <Textarea
            value={sosNote}
            onChange={(e) => setSosNote(e.target.value)}
            placeholder="e.g. Unauthorised person refusing to leave at main gate"
          />
        </Field>
      </Modal>
      <Toast {...(toast || {})} onClose={() => setToast(null)} />
    </div>
  );
}