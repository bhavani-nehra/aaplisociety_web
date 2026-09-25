"use client";
// components/visitor/OutboxStatus.js
// Shows the guard whether they're online and how many offline entries are
// waiting to sync. Disappears when online with nothing pending.
import { useEffect, useState } from "react";
import {
  getQueued,
  subscribe,
  syncOutbox,
  startAutoSync,
  isOnline,
} from "@/lib/visitor-outbox";
const S = {
  wrap: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 14px",
    borderRadius: 10,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 1.4,
  },
  offline: { background: "var(--bg-muted)", border: "1px solid var(--warning-bg)", color: "var(--warning-fg)" },
  pending: { background: "var(--primary-tint)", border: "1px solid var(--primary-tint)", color: "var(--primary-hover)" },
  spacer: { flex: 1 },
  btn: {
    border: "none",
    background: "var(--primary-hover)",
    color: "#fff",
    padding: "6px 12px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
export default function OutboxStatus() {
  const [queued, setQueued] = useState([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    startAutoSync();
    setQueued(getQueued());
    setOnline(isOnline());
    const unsub = subscribe(setQueued);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      unsub();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const pending = queued.length;
  const needFix = queued.filter((e) => e.status === "needs_flat").length;
  if (online && pending === 0) return null;
  const tone = online ? S.pending : S.offline;
  const style = Object.assign({}, S.wrap, tone);
  const retry = async () => {
    setBusy(true);
    try {
      await syncOutbox();
    } finally {
      setBusy(false);
    }
  };
  const fixNote = needFix ? " · " + needFix + " need a flat fix" : "";
  const word = pending === 1 ? "entry" : "entries";
  const onlineMsg = "" + pending + " offline " + word + " waiting to sync" + fixNote + ".";
  const offlineMsg =
    "\uD83D\uDCF4 You’re offline — entries are saved on this device and will send automatically when the network returns.";
  return (
    <div style={style}>
      <span>{online ? onlineMsg : offlineMsg}</span>
      <span style={S.spacer} />
      {online && pending > 0 ? (
        <button style={S.btn} onClick={retry} disabled={busy}>
          {busy ? "Syncing\u2026" : "Sync now"}
        </button>
      ) : null}
    </div>
  );
}
