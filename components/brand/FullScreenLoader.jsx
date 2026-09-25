"use client";
import PulseLoader from "./PulseLoader";

/** Opaque full-viewport cover with the pulse-grid loader — blocks clicks. */
export default function FullScreenLoader({ label = "Loading" }) {
  return (
    <div
      role="status"
      aria-label={label}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-canvas, #eef2ff)",
      }}
    >
      <PulseLoader size={120} label={label} />
    </div>
  );
}
