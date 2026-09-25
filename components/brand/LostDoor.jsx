"use client";

import { motion, useReducedMotion } from "framer-motion";

// Original artwork: "4 [door] 4" — chunky extruded digits, with the 0 as an
// arched doorway whose door hangs ajar onto an empty, softly lit room. Pure
// SVG + gradients, so it themes crisply and carries no external assets.
const FOUR =
  "M62 0 L0 92 L0 112 L62 112 L62 140 L92 140 L92 112 L112 112 L112 90 L92 90 L92 0 Z M62 34 L62 90 L22 90 Z";
const FRAME = "M150 205 V100 a60 60 0 0 1 120 0 V205 Z";
const ARCH = "M162 205 V100 a48 48 0 0 1 96 0 V205 Z";
const DEPTH = 14;
const LAYERS = Array.from({ length: DEPTH }, (_, i) => DEPTH - i);
const shade = (d) => 0.35 + (0.65 * (DEPTH - d)) / DEPTH;

function Four({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {LAYERS.map((d) => (
        <path
          key={d}
          d={FOUR}
          fillRule="evenodd"
          fill="#1e3a8a"
          opacity={shade(d)}
          transform={`translate(${d * 0.7} ${d})`}
        />
      ))}
      <path d={FOUR} fillRule="evenodd" fill="url(#ld-face)" stroke="#fff" strokeOpacity="0.55" />
    </g>
  );
}

export default function LostDoor() {
  const reduce = useReducedMotion();
  const loop = (dur, delay = 0) => ({ duration: dur, repeat: Infinity, ease: "easeInOut", delay });
  const swing = reduce
    ? undefined
    : {
        d: [
          "M162 66 L118 52 L118 212 L162 200 Z",
          "M162 66 L132 56 L132 208 L162 200 Z",
          "M162 66 L118 52 L118 212 L162 200 Z",
        ],
      };

  return (
    <motion.svg
      viewBox="-50 0 500 260"
      role="img"
      aria-label="A giant 404 where the zero is an open doorway to an empty room"
      style={{ width: "100%", maxWidth: 500, overflow: "visible" }}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 110, damping: 14 }}
    >
      <defs>
        <linearGradient id="ld-face" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9bcff" />
          <stop offset="1" stopColor="#5b7bd9" />
        </linearGradient>
        <linearGradient id="ld-leaf" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f7b76e" />
          <stop offset="1" stopColor="#d9743a" />
        </linearGradient>
        <radialGradient id="ld-room" cx="0.5" cy="0.85" r="0.95">
          <stop offset="0" stopColor="#fff7d9" />
          <stop offset="0.55" stopColor="#dbe4ff" />
          <stop offset="1" stopColor="#8ea3ee" />
        </radialGradient>
        <linearGradient id="ld-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2b8" stopOpacity="0.9" />
          <stop offset="1" stopColor="#fff2b8" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="ld-ground" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#0b1230" stopOpacity="0.38" />
          <stop offset="1" stopColor="#0b1230" stopOpacity="0" />
        </radialGradient>
        <clipPath id="ld-clip">
          <path d={ARCH} />
        </clipPath>
      </defs>

      <ellipse cx="210" cy="236" rx="230" ry="14" fill="url(#ld-ground)" />

      <Four x={-34} y={62} />
      <Four x={320} y={62} />

      {/* doorway: extruded frame, then the empty room */}
      {LAYERS.map((d) => (
        <path key={d} d={FRAME} fill="#1e3a8a" opacity={shade(d)} transform={`translate(${d * 0.7} ${d})`} />
      ))}
      <path d={FRAME} fill="url(#ld-face)" stroke="#fff" strokeOpacity="0.55" />
      <path d={ARCH} fill="url(#ld-room)" />
      <g clipPath="url(#ld-clip)">
        <path d="M162 178 H258" stroke="#fff" strokeOpacity="0.6" />
        {/* a lonely picture hook */}
        <circle cx="222" cy="96" r="2.5" fill="#1e3a8a" fillOpacity="0.45" />
        <path d="M222 99 v10" stroke="#1e3a8a" strokeOpacity="0.3" />
        {/* dust drifting in the light */}
        {[0, 1, 2, 3].map((i) => (
          <motion.circle
            key={i}
            cx={190 + i * 18}
            cy={190}
            r={1.8}
            fill="#fff"
            animate={reduce ? undefined : { cy: [190, 90], opacity: [0, 0.9, 0] }}
            transition={{ duration: 3.6 + i * 0.5, repeat: Infinity, ease: "easeOut", delay: i * 0.8 }}
          />
        ))}
      </g>

      {/* light spilling across the floor */}
      <motion.path
        d="M162 205 L258 205 L330 246 L92 246 Z"
        fill="url(#ld-beam)"
        animate={reduce ? undefined : { opacity: [0.55, 1, 0.55] }}
        transition={loop(3.4)}
      />

      {/* the door, hanging ajar */}
      <motion.path
        d="M162 66 L118 52 L118 212 L162 200 Z"
        fill="url(#ld-leaf)"
        stroke="#fff"
        strokeOpacity="0.5"
        animate={swing}
        transition={loop(4.6)}
      />
      <circle cx="126" cy="136" r="4" fill="#ffe08a" stroke="#b8862b" />

      {/* doormat, with opinions */}
      <path d="M170 210 L250 210 L268 232 L152 232 Z" fill="#2fbf8a" stroke="#fff" strokeOpacity="0.5" />
      <text x="210" y="225" textAnchor="middle" fontSize="8" fontWeight="800" letterSpacing="1.2" fill="#fff" style={{ fontFamily: "inherit" }}>
        NOT YOUR HOUSE
      </text>
    </motion.svg>
  );
}
