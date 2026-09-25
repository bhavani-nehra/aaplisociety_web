"use client";
// Full-screen pulse-grid loader shown while any button action is running
// (see lib/button-pending.js). Blocks clicks so nothing is submitted twice.
import { useSyncExternalStore } from "react";
import { subscribe, getSnapshot, getServerSnapshot } from "@/lib/button-pending";
import PulseLoader from "./PulseLoader";

export default function ActionLoader() {
  const busy = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (!busy) return null;
  return (
    <div
      role="status"
      aria-label="Working"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "color-mix(in srgb, var(--bg-canvas, #eef2ff) 70%, transparent)",
        backdropFilter: "blur(2px)",
      }}
    >
      <PulseLoader size={120} label="Working" />
    </div>
  );
}
