"use client";
// One-tap "Turn on visitor alerts" button for residents.
// Tap once -> browser asks permission -> device is registered for free push.
// After that, every guard "Remind" reaches this phone with zero extra steps.
import { useEffect, useState } from "react";
const S = {
  wrap: { display: "inline-flex", flexDirection: "column", gap: 6 },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    color: "var(--on-solid)",
    background: "var(--primary)",
  },
  btnOn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 10,
    border: "none",
    color: "var(--on-solid)",
    background: "var(--success)",
    cursor: "default",
  },
  btnOff: { background: "var(--fg-5)", cursor: "not-allowed" },
  hint: { fontSize: 12, color: "var(--fg-4)", maxWidth: 320, lineHeight: 1.4 },
};
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
export default function EnablePush({ label = "\uD83D\uDD14 Turn on visitor alerts" }) {
  const [state, setState] = useState("idle"); // idle | on | working | unsupported | denied
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) setState("on");
    });
  }, []);
  const enable = async () => {
    setState("working");
    setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const res = await fetch("/api/push/subscribe", { credentials: "include" });
      const data = await res.json();
      if (!data.publicKey) {
        setMsg("Alerts aren\u2019t set up on the server yet. Ask the admin to add VAPID keys.");
        setState("idle");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      });
      setState("on");
    } catch (e) {
      setMsg(e.message || "Could not enable alerts");
      setState("idle");
    }
  };
  if (state === "unsupported") {
    return (
      <span style={S.hint}>
        To get gate alerts on iPhone, open this site in Safari and tap Share →
        “Add to Home Screen”, then open it from the home screen.
      </span>
    );
  }
  if (state === "on") {
    return (
      <div style={S.wrap}>
        <button style={S.btnOn} disabled>
          Alerts are on
        </button>
        <span style={S.hint}>You’ll get a notification the moment someone’s at your gate.</span>
      </div>
    );
  }
  if (state === "denied") {
    return (
      <span style={S.hint}>
        Notifications are blocked. Enable them for this site in your browser
        settings, then reload.
      </span>
    );
  }
  return (
    <div style={S.wrap}>
      <button
        style={state === "working" ? { ...S.btn, ...S.btnOff } : S.btn}
        onClick={enable}
        disabled={state === "working"}
      >
        {state === "working" ? "Enabling\u2026" : label}
      </button>
      {msg ? <span style={S.hint}>{msg}</span> : null}
    </div>
  );
}
