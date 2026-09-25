"use client";
import { useCallback, useEffect, useState } from "react";
import { installIdleTracking, isPageIdleForPolling } from "@/lib/idle-tracker";
import {
  PageHeader,
  Card,
  CardHead,
  Btn,
  Pill,
  Icon,
  EmptyState,
  RevampSkeleton,
  Toast,
} from "@/components/revamp";
import { ZoomableAvatar, timeAgo, fmtTime } from "@/components/visitor/ui";
import { PURPOSE_ICON } from "@/lib/visitor-config";
import CallButton from "@/components/visitor/CallButton";

// Auto-refresh so a resident sees a guard-logged visitor without reloading.
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

// Same status -> Pill tone mapping used by the admin visitor pages
// (app/admin/visitors/PageClient.js, app/admin/visitors/log/PageClient.js).
const STATUS_TONE = {
  Pending: "warning",
  Approved: "info",
  Entered: "paid",
  Exited: "neutral",
  Rejected: "unpaid",
  Expired: "neutral",
};

export default function MemberVisitorsPage() {
  const [pending, setPending] = useState([]);
  const [today, setToday] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const notify = (message, type = "info") => {
    setToast({ msg: message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async (silent) => {
    // Plan 05 §A3: a background poll must not keep a visible-but-abandoned
    // tab's session alive forever — see lib/idle-tracker.js.
    if (silent && isPageIdleForPolling()) return;
    if (!silent) setLoading(true);
    try {
      const [p, t] = await Promise.all([
        api("/api/visitor/list?scope=pending&limit=50").catch(() => ({
          visitors: [],
        })),
        api("/api/visitor/list?scope=today&limit=50").catch(() => ({
          visitors: [],
        })),
      ]);
      setPending((p && (p.visitors || p.data)) || []);
      setToday((t && (t.visitors || t.data)) || []);
    } catch (e) {
      notify(e.message || "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    installIdleTracking();
    load();
    // Poll only while the tab is visible -- cuts background Vercel invocations.
    let timer = null;
    const start = () => {
      if (timer == null) timer = setInterval(() => load(true), POLL_MS);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else {
        load(true);
        start();
      }
    };
    if (typeof document === "undefined" || !document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stop();
    };
  }, [load]);

  // One tap. The backend records the decision and notifies the guard instantly.
  const decide = async (id, action) => {
    setBusyId(id + action);
    try {
      await api("/api/visitor/approve", {
        method: "POST",
        body: JSON.stringify({ visitorId: id, action }),
      });
      notify(
        action === "approve"
          ? "Approved — the guard can now let them in ✓"
          : "Denied — the guard has been told to turn them away",
        action === "approve" ? "success" : "info",
      );
      await load(true);
    } catch (e) {
      notify(e.message || "Action failed", "error");
    } finally {
      setBusyId(null);
    }
  };

  // Offline entries the guard already let in — resident confirms after the fact.
  const confirmEntry = async (id, decision) => {
    setBusyId(id + decision);
    try {
      await api("/api/visitor/confirm-entry", {
        method: "PATCH",
        body: JSON.stringify({ visitorId: id, decision }),
      });
      notify(
        decision === "acknowledge"
          ? "Thanks — entry confirmed ✓"
          : "Flagged — the guard has been alerted to verify at the gate",
        decision === "acknowledge" ? "success" : "info",
      );
      await load(true);
    } catch (e) {
      notify(e.message || "Action failed", "error");
    } finally {
      setBusyId(null);
    }
  };

  const needConfirm = today.filter(
    (v) =>
      v.entryMethod === "OfflineEntry" &&
      (!v.offlineMeta ||
        !v.offlineMeta.confirmation ||
        v.offlineMeta.confirmation.status === "Pending"),
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <PageHeader
        eyebrow={
          <>
            <Icon name="door-open" size={11} /> My Flat
          </>
        }
        title="My Visitors"
        sub="Approve people at the gate and see today’s activity"
        right={
          <Btn variant="ghost" icon="refresh-cw" onClick={() => load()}>
            Refresh
          </Btn>
        }
      />

      {loading ? (
        <RevampSkeleton h={280} />
      ) : (
        <>
          {/* Someone already entered (offline) — confirm after the fact */}
          {needConfirm.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="alert-triangle" size={15} color="var(--r-danger)" />
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--r-fg-1)", margin: 0 }}>
                  Someone entered to meet you — please confirm ({needConfirm.length})
                </h2>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--r-fg-4)", margin: "6px 0 14px", lineHeight: 1.5 }}>
                The gate logged these entries (the network may have been down, so you’re
                seeing it now). Tap <b>Yes, I know them</b> or <b>I don’t recognise</b> —
                flagging instantly alerts the guard.
              </p>
              {needConfirm.map((v) => {
                const id = v._id || v.id;
                return (
                  <Card
                    key={id}
                    style={{ border: "2px solid var(--r-danger)", background: "var(--r-danger-soft)", marginBottom: 12 }}
                  >
                    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                      <ZoomableAvatar src={v.photo} name={v.name} size={64} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--r-fg-1)" }}>{v.name}</div>
                        <div style={{ fontSize: 13, color: "var(--r-fg-3)", marginTop: 3 }}>
                          {PURPOSE_ICON[v.purpose] || ""} {v.purpose} · entered {timeAgo(v.entryTime || v.createdAt)}
                        </div>
                        {v.offlineMeta && v.offlineMeta.note ? (
                          <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginTop: 4 }}>{v.offlineMeta.note}</div>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                      <Btn
                        variant="primary"
                        size="lg"
                        icon="check"
                        disabled={busyId === id + "acknowledge"}
                        onClick={() => confirmEntry(id, "acknowledge")}
                      >
                        {busyId === id + "acknowledge" ? "Saving…" : "Yes, I know them"}
                      </Btn>
                      <Btn
                        variant="dangerSolid"
                        size="lg"
                        icon="alert-triangle"
                        disabled={busyId === id + "flag"}
                        onClick={() => confirmEntry(id, "flag")}
                      >
                        {busyId === id + "flag" ? "Alerting…" : "I don’t recognise"}
                      </Btn>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Waiting for YOUR approval */}
          {pending.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="door-open" size={15} color="var(--r-warning)" />
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--r-fg-1)", margin: 0 }}>
                  Someone’s at the gate — your approval needed ({pending.length})
                </h2>
              </div>
              <p style={{ fontSize: 12.5, color: "var(--r-fg-4)", margin: "6px 0 14px", lineHeight: 1.5 }}>
                Tap <b>Allow</b> to let them in, or <b>Deny</b> to turn them away. The guard
                sees your choice instantly.
              </p>
              {pending.map((v) => {
                const id = v._id || v.id;
                return (
                  <Card
                    key={id}
                    style={{ border: "2px solid var(--r-warning)", background: "var(--r-warning-soft)", marginBottom: 12 }}
                  >
                    <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                      <ZoomableAvatar src={v.photo} name={v.name} size={64} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--r-fg-1)" }}>{v.name}</div>
                        <div style={{ fontSize: 13, color: "var(--r-fg-3)", marginTop: 3 }}>
                          {PURPOSE_ICON[v.purpose] || ""} {v.purpose} · arrived {timeAgo(v.createdAt)}
                        </div>
                        {v.phone ? (
                          <div style={{ fontSize: 13, color: "var(--r-fg-3)", marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
                            <Icon name="phone" size={12} color="var(--r-fg-4)" /> {v.phone}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)", margin: "16px 0 0" }}>
                      Do you want to allow this visitor in?
                    </p>
                    <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                      <Btn
                        variant="primary"
                        size="lg"
                        icon="check"
                        disabled={busyId === id + "approve"}
                        onClick={() => decide(id, "approve")}
                      >
                        {busyId === id + "approve" ? "Allowing…" : "Allow"}
                      </Btn>
                      <Btn
                        variant="dangerSolid"
                        size="lg"
                        icon="x"
                        disabled={busyId === id + "reject"}
                        onClick={() => decide(id, "reject")}
                      >
                        {busyId === id + "reject" ? "Denying…" : "Deny"}
                      </Btn>
                      <CallButton
                        phone={(v.enteredBy && v.enteredBy.phone) || ""}
                        label="Call guard"
                        title="Call the guard at the gate"
                      />
                    </div>
                    {!(v.enteredBy && v.enteredBy.phone) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--r-fg-4)", marginTop: 10 }}>
                        <Icon name="alert-circle" size={12} />
                        Guard's number isn't on file — ask the admin to add it so you can call the gate.
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          {/* Today's activity log */}
          <Card>
            <CardHead title={`Today’s visitors (${today.length})`} sub="Everyone who came to your flat today." />
            {today.length === 0 ? (
              <EmptyState icon="door-open" title="No visitors yet" sub="When someone arrives at the gate for your flat, they’ll show up here." />
            ) : (
              today.map((v, i) => {
                const id = v._id || v.id;
                return (
                  <div
                    key={id}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "12px 0",
                      borderTop: i > 0 ? "1px solid var(--r-hairline)" : "none",
                    }}
                  >
                    <ZoomableAvatar src={v.photo} name={v.name} size={42} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--r-fg-1)", fontSize: 14 }}>{v.name}</div>
                      <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 2 }}>
                        {PURPOSE_ICON[v.purpose] || ""} {v.purpose} · {fmtTime(v.createdAt)}
                        {v.entryTime ? ` · in ${fmtTime(v.entryTime)}` : ""}
                        {v.exitTime ? ` · out ${fmtTime(v.exitTime)}` : ""}
                      </div>
                    </div>
                    <Pill tone={STATUS_TONE[v.status] || "neutral"}>{v.status}</Pill>
                  </div>
                );
              })
            )}
          </Card>
        </>
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
