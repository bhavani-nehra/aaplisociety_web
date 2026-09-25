"use client";
// Post-login entry animation (public/motions/07-scatter). Login calls
// playScatterIntro() right before navigating; this overlay (mounted once in
// app/layout.js, so it survives the route change) covers the destination
// page while it loads its data underneath, then fades out when the 4.4s
// animation ends.
import { useEffect, useRef, useState } from "react";
import PulseLoader from "./PulseLoader";

const EVENT = "aapli:scatter-intro";
// One-shot art (scatter-once-*.svg: repeatCount=1, freezes on its blank last
// frame, per-letter blur filters removed for smooth playback on slow GPUs).
const ANIM_MS = 5000;
const FADE_MS = 400;
const MAX_WAIT_MS = 45000; // dev-mode compiles can be slow; never trap the user

export function playScatterIntro() {
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {}
}

export default function ScatterIntro() {
  const [phase, setPhase] = useState("idle"); // idle | playing | waiting | fading
  const [startPath, setStartPath] = useState(null);
  const doneTimer = useRef(null);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const start = () => {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
      setStartPath(window.location.pathname);
      setPhase("playing");
    };
    // Warm the cache so the art is decoded and starts the instant login succeeds.
    ["light", "dark"].forEach((t) => {
      new Image().src = `/motions/07-scatter/scatter-once-${t}.svg`;
    });
    window.addEventListener(EVENT, start);
    return () => window.removeEventListener(EVENT, start);
  }, []);

  useEffect(() => {
    if (phase === "playing") {
      // Fallback only — the real timer starts from the image's onLoad so the
      // single play-through is measured from when the art actually begins.
      const t = setTimeout(() => setPhase("waiting"), ANIM_MS + 3000);
      return () => clearTimeout(t);
    }
    if (phase === "waiting") {
      // Hold until the destination route is mounted and its loaders are gone.
      const began = Date.now();
      const id = setInterval(() => {
        const routed = window.location.pathname !== startPath;
        const busy = document.querySelector(".pulse-loader:not([data-intro])");
        if ((routed && !busy) || Date.now() - began > MAX_WAIT_MS) {
          clearInterval(id);
          setPhase("fading");
        }
      }, 150);
      return () => clearInterval(id);
    }
    if (phase === "fading") {
      const t = setTimeout(() => setPhase("idle"), FADE_MS);
      return () => clearTimeout(t);
    }
  }, [phase, startPath]);

  if (phase === "idle") return null;
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: dark ? "#0a0f1e" : "#eef2ff",
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: "all",
        overflow: "hidden",
      }}
    >
      {phase === "playing" ? (
        <img
          src={`/motions/07-scatter/scatter-once-${dark ? "dark" : "light"}.svg`}
          onLoad={() => {
            clearTimeout(doneTimer.current);
            doneTimer.current = setTimeout(() => setPhase("waiting"), ANIM_MS);
          }}
          alt=""
          style={{
            // Artwork canvas is 300x150 but the wordmark only spans x 65-224
            // (159 units, centred at 144.6). Size the canvas so that span is
            // exactly the viewport width — edge to edge on any screen — and
            // shift it so the wordmark, not the canvas, is centred.
            position: "absolute",
            left: "50%",
            top: "50%",
            width: `${(300 / 159) * 100}vw`,
            maxWidth: "none",
            height: "auto",
            transform: `translate(-50%, -50%) translateX(${(5.4 / 300) * 100}%)`,
          }}
        />
      ) : (
        <PulseLoader size={96} data-intro />
      )}
    </div>
  );
}
