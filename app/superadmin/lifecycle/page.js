"use client";
// Offboarding tracker.
//
// Deleting a society is a six-gate process that can sit half-finished for
// weeks, and until now none of it was visible: the gates lived in the purge
// cron, the handover state lived in another collection, and the only way to
// answer "what is this society waiting on?" was to read a skip reason in the
// ops table or query Mongo. A process nobody can see is a process nobody
// finishes — which is how a society ends up soft-deleted, paused, and holding
// personal data for months because one gate was never met.
//
// So: every society in the flow, what it has met, what it is waiting on, and
// the action for the thing that is blocking it.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";
import {
  Card, CardHead, SectionLabel, SocietyMark, Btn, Empty,
  shortDate, relativeDays,
} from "../_components/PlatformUI";

const GATE_LOOK = {
  done: { icon: "✓", fg: "var(--success)", bg: "var(--success-bg)", label: "Done" },
  pending: { icon: "◷", fg: "var(--warning)", bg: "var(--warning-bg)", label: "Waiting" },
  blocked: { icon: "✕", fg: "var(--danger)", bg: "var(--danger-bg)", label: "Blocked" },
  waived: { icon: "⤳", fg: "var(--info)", bg: "var(--info-bg)", label: "Waived" },
  "not-started": { icon: "○", fg: "var(--fg-4)", bg: "var(--bg-muted)", label: "Not started" },
};

export default function LifecyclePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [admin, setAdmin] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [waiveFor, setWaiveFor] = useState(null);

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

  const waive = useMutation({
    mutationFn: async ({ id, reason }) => {
      const res = await fetch(`/api/admin/societies/${id}/offboarding`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "waive-handover", reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed");
      return json;
    },
    onSuccess: (json) => {
      notify.success(json.summary || "Waived");
      queryClient.invalidateQueries({ queryKey: ["platform-metrics"] });
      setWaiveFor(null);
    },
    onError: (e) => notify.error(e.message),
  });

  const inFlow = data?.offboarding || [];
  // A handover on a live society is not part of the delete flow, but it is
  // still something in flight that somebody should be able to see.
  const strays = useMemo(
    () => (data?.societies || []).filter((s) => s.offboarding?.gates?.some((g) => g.id === "handover-collected" && g.state !== "not-started")),
    [data],
  );

  if (!admin || isLoading) {
    return <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>Loading lifecycle…</div>;
  }
  if (error) {
    return (
      <div style={{ padding: "3rem", textAlign: "center", color: "var(--danger)" }}>
        {error.message}
        <div style={{ marginTop: 14 }}><Btn onClick={() => refetch()}>Retry</Btn></div>
      </div>
    );
  }

  const ready = inFlow.filter((s) => s.offboarding?.purgeReady);
  const waiting = inFlow.filter((s) => !s.offboarding?.purgeReady);

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", color: "var(--fg-2)" }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "var(--fg-1)" }}>Offboarding</h1>
        <p style={{ color: "var(--fg-3)", fontSize: 13, marginTop: 4, maxWidth: 760, lineHeight: 1.6 }}>
          Erasing a society passes six gates. This is what each one in the flow has met and what it
          is waiting on. Nothing here is erased by looking at it — the purge cron does that, once
          every gate is green.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 11, marginBottom: 18 }}>
        <Tile label="In the flow" value={inFlow.length} sub="soft-deleted" tone="var(--fg-1)" />
        <Tile label="Ready to erase" value={ready.length} sub="all gates met" tone={ready.length ? "var(--danger)" : "var(--fg-4)"} />
        <Tile label="Waiting" value={waiting.length} sub="one or more gates open" tone={waiting.length ? "var(--warning)" : "var(--fg-4)"} />
        <Tile label="Handovers in flight" value={strays.length} sub="on live societies" tone="var(--info)" />
      </div>

      {inFlow.length === 0 ? (
        <Card>
          <Empty
            title="No society is being deleted"
            sub="Nothing is soft-deleted, so nothing is scheduled for erasure. Start a deletion from the Societies page."
          />
        </Card>
      ) : (
        <>
          {ready.length > 0 && (
            <>
              <SectionLabel>Ready to erase — next purge run will destroy these</SectionLabel>
              <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
                {ready.map((s) => (
                  <SocietyFlow
                    key={s._id}
                    row={s}
                    open={expanded === s._id}
                    onToggle={() => setExpanded(expanded === s._id ? null : s._id)}
                    onOpen={() => router.push(`/superadmin/societies/${s._id}`)}
                    onWaive={() => setWaiveFor(s)}
                  />
                ))}
              </div>
            </>
          )}
          {waiting.length > 0 && (
            <>
              <SectionLabel>Waiting</SectionLabel>
              <div style={{ display: "grid", gap: 10 }}>
                {waiting.map((s) => (
                  <SocietyFlow
                    key={s._id}
                    row={s}
                    open={expanded === s._id}
                    onToggle={() => setExpanded(expanded === s._id ? null : s._id)}
                    onOpen={() => router.push(`/superadmin/societies/${s._id}`)}
                    onWaive={() => setWaiveFor(s)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {strays.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <SectionLabel>Handovers on live societies</SectionLabel>
          <Card padded={false}>
            {strays.map((s, i) => {
              const gate = s.offboarding.gates.find((g) => g.id === "handover-collected");
              const look = GATE_LOOK[gate.state];
              return (
                <div
                  key={s._id}
                  style={{
                    display: "flex", gap: 12, alignItems: "center", padding: "12px 16px",
                    borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  }}
                >
                  <SocietyMark name={s.name} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{s.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{gate.detail}</div>
                  </div>
                  <span style={{ background: look.bg, color: look.fg, borderRadius: 999, padding: "2px 9px", fontSize: 10.5, fontWeight: 800 }}>
                    {look.label}
                  </span>
                  <Btn size="sm" onClick={() => router.push(`/superadmin/societies/${s._id}`)}>Open</Btn>
                </div>
              );
            })}
          </Card>
          <p style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 8, lineHeight: 1.6 }}>
            These societies are live. A handover was prepared for them without a deletion being
            started — harmless, and it will count towards gate 6 if one ever is.
          </p>
        </div>
      )}

      {waiveFor && (
        <WaiveDialog
          society={waiveFor}
          busy={waive.isPending}
          onClose={() => setWaiveFor(null)}
          onSubmit={(reason) => waive.mutate({ id: waiveFor._id, reason })}
        />
      )}
    </div>
  );
}

function Tile({ label, value, sub, tone }) {
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, color: "var(--fg-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone, marginTop: 4, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--fg-4)", marginTop: 3 }}>{sub}</div>
    </div>
  );
}

/** One society: a gate strip you can read at a glance, details on demand. */
function SocietyFlow({ row, open, onToggle, onOpen, onWaive }) {
  const plan = row.offboarding;
  const gates = plan?.gates || [];
  const met = gates.filter((g) => g.state === "done" || g.state === "waived").length;
  const blocker = gates.find((g) => g.state !== "done" && g.state !== "waived");
  const waived = gates.some((g) => g.id === "handover-collected" && g.state === "waived");
  const handoverOpen = gates.some(
    (g) => g.id === "handover-collected" && (g.state === "pending" || g.state === "not-started"),
  );

  return (
    <Card padded={false} style={{ borderLeft: `3px solid ${plan?.purgeReady ? "var(--danger)" : "var(--warning)"}` }}>
      <div style={{ padding: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <SocietyMark name={row.name} size={34} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg-1)" }}>{row.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>
            Deleted {shortDate(row.deletedAt)}
            {row.purgeScheduledFor ? ` · erase ${shortDate(row.purgeScheduledFor)} (${relativeDays(row.purgeScheduledFor)})` : " · no erase date"}
          </div>
        </div>

        {/* Six pips. The whole state of a society in one glance. */}
        <div style={{ display: "flex", gap: 4 }}>
          {gates.map((g) => {
            const look = GATE_LOOK[g.state] || GATE_LOOK["not-started"];
            return (
              <span
                key={g.id}
                title={`${g.title} — ${look.label}`}
                style={{ width: 22, height: 6, borderRadius: 3, background: look.fg, opacity: g.state === "not-started" ? 0.35 : 1 }}
              />
            );
          })}
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-1)", minWidth: 34, textAlign: "right" }}>
          {met}/{gates.length}
        </span>

        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" onClick={onToggle}>{open ? "Hide" : "Gates"}</Btn>
          <Btn size="sm" variant="ghost" onClick={onOpen}>Open</Btn>
        </div>
      </div>

      {!open && blocker && (
        <div style={{ padding: "0 14px 13px", fontSize: 12, color: "var(--fg-3)" }}>
          <strong style={{ color: "var(--fg-1)" }}>Waiting on:</strong> {blocker.title.toLowerCase()} — {blocker.detail}
        </div>
      )}

      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: 14, display: "grid", gap: 9 }}>
          {gates.map((g, i) => {
            const look = GATE_LOOK[g.state] || GATE_LOOK["not-started"];
            return (
              <div key={g.id} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 7, flexShrink: 0, background: look.bg, color: look.fg,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800,
                }}>
                  {look.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)" }}>
                    <span style={{ color: "var(--fg-5)", marginRight: 6 }}>{i + 1}</span>{g.title}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 2, lineHeight: 1.5 }}>{g.detail}</div>
                </div>
              </div>
            );
          })}

          {handoverOpen && (
            <div style={{ marginTop: 6, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <Btn size="sm" variant="danger" onClick={onWaive}>Waive the handover requirement</Btn>
              <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 6, lineHeight: 1.55, maxWidth: 640 }}>
                For a society that cannot collect its records — a dissolved committee, a dead address.
                It erases a society that never received its own copy, so it takes a written reason and
                is recorded against the erasure.
              </div>
            </div>
          )}
          {waived && (
            <div style={{ marginTop: 6, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 11.5, color: "var(--info)" }}>
              The handover requirement was waived for this society.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function WaiveDialog({ society, busy, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const enough = reason.trim().length >= 20;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 100%)", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--fg-1)" }}>Waive the handover</div>
        <div style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 6, lineHeight: 1.6 }}>
          {society.name} will be erased without ever having collected its own copy of its records.
          That is sometimes the only option, and it is always a judgement — so it is recorded as one,
          with your name against it.
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoFocus
          placeholder="Why can this society not collect its records? e.g. committee dissolved in 2025, registered address bounces, no contactable office bearer."
          style={{
            width: "100%", marginTop: 14, minHeight: 110, padding: "10px 12px", borderRadius: 9,
            border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))",
            color: "var(--fg-1)", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical",
          }}
        />
        <div style={{ fontSize: 11, color: enough ? "var(--success)" : "var(--fg-4)", marginTop: 6 }}>
          {reason.trim().length}/20 characters minimum
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" disabled={busy || !enough} onClick={() => onSubmit(reason.trim())}>
            {busy ? "Recording…" : "Waive and record"}
          </Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}
