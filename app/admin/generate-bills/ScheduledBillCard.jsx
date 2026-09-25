"use client";
// app/admin/generate-bills/ScheduledBillCard.jsx
//
// Spoonfeeds models/ScheduledBillRun to a non-technical admin. Before this
// existed, "Push & schedule" wrote a run that nothing showed anywhere — the
// only way to see it, force it early, or retry a failure was a developer
// hitting a raw API URL with a bearer token in a terminal. This is the
// screen instead: plain sentences, one big button, no jargon.
//
// Deliberately NOT a settings panel or a table. One card, one sentence, one
// action. If there's nothing to say, it renders nothing at all.

import PulseLoader from "@/components/brand/PulseLoader";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, CheckCircle2, TriangleAlert, X } from "lucide-react";

function monthLabel(periodId) {
  const [y, m] = String(periodId).split("-").map(Number);
  if (!y || !m) return periodId;
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function dateLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

const ONE_DAY = 24 * 60 * 60 * 1000;

export default function ScheduledBillCard({ billSeries = "RESIDENTIAL" }) {
  const [runs, setRuns] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bills/scheduled-runs", { credentials: "include" });
      const data = await res.json();
      if (res.ok) setRuns(data.runs || []);
    } catch {
      // Silent — this card is a convenience, not the primary flow. If it
      // can't load, it just shows nothing rather than an alarming error.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // While anything is RUNNING, keep checking every few seconds so "Creating
  // bills right now…" naturally flips to the done state on its own — a
  // non-technical admin should never have to refresh the page by hand.
  const hasRunning = runs.some((r) => r.status === "RUNNING");
  useEffect(() => {
    if (!hasRunning) return undefined;
    pollRef.current = setInterval(load, 3000);
    return () => clearInterval(pollRef.current);
  }, [hasRunning, load]);

  const relevant = runs.filter((r) => {
    // Runs written before billSeries existed on the schema have no such
    // field at all (lean() skips Mongoose defaults) — treat that as
    // RESIDENTIAL, same fallback processScheduledBillRun already uses.
    if ((r.billSeries || "RESIDENTIAL") !== billSeries) return false;
    if (dismissed.has(r._id)) return false;
    if (r.status === "CANCELLED") return false;
    if (r.status === "COMPLETED") {
      // Only brag about a success for a day — after that it's just noise.
      return Date.now() - new Date(r.completedAt || r.updatedAt).getTime() < ONE_DAY;
    }
    return true; // SCHEDULED, RUNNING, FAILED
  });

  if (!loaded || relevant.length === 0) return null;

  async function act(run, action, extra) {
    if (action === "cancel") {
      const month = monthLabel(run.periodId);
      const ok = window.confirm(
        `Cancel ${month} bills? They will NOT be created automatically anymore — you'll have to create them yourself later from this page.`,
      );
      if (!ok) return;
    }
    setBusyId(run._id);
    try {
      const res = await fetch("/api/bills/scheduled-runs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: run._id, ...extra }),
      });
      await res.json().catch(() => null);
    } finally {
      setBusyId(null);
      load();
    }
  }

  return (
    <div style={{ margin: "0 1.5rem 1rem", display: "flex", flexDirection: "column", gap: 10 }}>
      {relevant.map((run) => (
        <RunRow
          key={run._id}
          run={run}
          busy={busyId === run._id}
          onRunNow={() => act(run, "run-now")}
          onCancel={() => act(run, "cancel")}
          onReschedule={(runAt) => act(run, "reschedule", { runAt })}
          onDismiss={() => setDismissed((s) => new Set(s).add(run._id))}
        />
      ))}
    </div>
  );
}

function RunRow({ run, busy, onRunNow, onCancel, onReschedule, onDismiss }) {
  const month = monthLabel(run.periodId);
  const [pickingDate, setPickingDate] = useState(false);
  const [newDate, setNewDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });

  if (run.status === "RUNNING") {
    return (
      <Shell tone="info">
        <PulseLoader size={30} />
        <div style={{ flex: 1 }}>
          <Big>Creating {month} bills right now…</Big>
          <Small>This can take a minute. This box will update on its own — no need to refresh.</Small>
        </div>
      </Shell>
    );
  }

  if (run.status === "COMPLETED") {
    return (
      <Shell tone="success">
        <CheckCircle2 size={22} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <Big>{month} bills are created and sent </Big>
          <Small>
            {run.billsCreated} bill{run.billsCreated === 1 ? "" : "s"} created — every member
            was notified.
          </Small>
        </div>
        <DismissButton onClick={onDismiss} />
      </Shell>
    );
  }

  if (run.status === "FAILED") {
    return (
      <Shell tone="danger">
        <TriangleAlert size={22} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <Big>Something went wrong creating {month} bills</Big>
          <Small>Nothing was lost — it&apos;s safe to try again.</Small>
        </div>
        <BigButton tone="danger" busy={busy} onClick={onRunNow}>
          Try again
        </BigButton>
      </Shell>
    );
  }

  // SCHEDULED
  const overdue = new Date(run.runAt).getTime() <= Date.now();

  if (!overdue) {
    return (
      <Shell tone="info">
        <CalendarClock size={22} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <Big>{month} bills will be created automatically on {dateLabel(run.runAt)}</Big>
          <Small>
            Don&apos;t want to wait?{" "}
            <LinkButton onClick={onCancel} disabled={busy}>
              cancel this schedule
            </LinkButton>
            .
          </Small>
        </div>
        <BigButton tone="success" busy={busy} onClick={onRunNow}>
          Create now
        </BigButton>
      </Shell>
    );
  }

  // Overdue: three real choices, spelled out — do it today, pick a new day,
  // or stop it entirely. No single button guessing what the admin meant.
  return (
    <Shell tone="warning" column>
      <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%" }}>
        <TriangleAlert size={22} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <Big>{month} bills were due on {dateLabel(run.runAt)} and haven&apos;t been created yet</Big>
          <Small>Choose what to do:</Small>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, width: "100%", paddingLeft: 36 }}>
        <BigButton tone="warning" busy={busy} onClick={onRunNow}>
          Create now (today)
        </BigButton>
        <BigButton
          tone="neutral"
          busy={busy}
          onClick={() => setPickingDate((v) => !v)}
        >
          Schedule again (pick a date)
        </BigButton>
      </div>
      {pickingDate && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            paddingLeft: 36,
            width: "100%",
          }}
        >
          <input
            type="date"
            value={newDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setNewDate(e.target.value)}
            style={{
              padding: "0.5rem 0.7rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              color: "var(--fg-1)",
              fontSize: "0.85rem",
            }}
          />
          <BigButton
            tone="success"
            busy={busy}
            onClick={() => {
              onReschedule(newDate);
              setPickingDate(false);
            }}
          >
            Confirm new date
          </BigButton>
        </div>
      )}
      <div style={{ paddingLeft: 36, width: "100%" }}>
        <Small>
          Changed your mind entirely?{" "}
          <LinkButton onClick={onCancel} disabled={busy}>
            cancel this schedule
          </LinkButton>
          .
        </Small>
      </div>
    </Shell>
  );
}

function LinkButton({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        color: "var(--fg-4)",
        textDecoration: "underline",
        cursor: disabled ? "default" : "pointer",
        font: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function Shell({ tone, children, column }) {
  const bg = {
    info: "var(--accent-tint)",
    success: "var(--success-bg)",
    danger: "var(--danger-bg)",
    warning: "var(--warning-bg)",
  }[tone];
  const border = {
    info: "var(--border)",
    success: "var(--success)",
    danger: "var(--danger)",
    warning: "var(--warning)",
  }[tone];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: column ? "column" : "row",
        alignItems: column ? "stretch" : "center",
        gap: column ? 12 : 14,
        padding: "1rem 1.25rem",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        color: "var(--fg-1)",
      }}
    >
      {children}
    </div>
  );
}

function Big({ children }) {
  return <div style={{ fontWeight: 700, fontSize: "0.98rem" }}>{children}</div>;
}

function Small({ children }) {
  return (
    <div style={{ fontSize: "0.82rem", color: "var(--fg-4)", marginTop: 3 }}>{children}</div>
  );
}

function BigButton({ tone, busy, onClick, children }) {
  // "neutral" is the outline/secondary look for a second-choice action
  // (Schedule again) sitting next to a solid primary one (Create now) —
  // it must not compete for the eye the way two solid buttons would.
  const neutral = tone === "neutral";
  const bg = neutral
    ? "transparent"
    : { danger: "var(--danger)", warning: "var(--warning)" }[tone] || "var(--success)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        padding: "0.7rem 1.4rem",
        borderRadius: 10,
        border: neutral ? "1.5px solid var(--border)" : "none",
        background: bg,
        color: neutral ? "var(--fg-1)" : "#fff",
        fontWeight: 800,
        fontSize: "0.92rem",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.7 : 1,
        display: "flex",
        alignItems: "center",
        gap: 8,
        whiteSpace: "nowrap",
      }}
    >
      {busy && <PulseLoader size={24} />}
      {busy ? "Working…" : children}
    </button>
  );
}

function DismissButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        color: "var(--fg-4)",
        padding: 6,
      }}
    >
      <X size={18} />
    </button>
  );
}
