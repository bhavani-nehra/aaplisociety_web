"use client";
// Shared building blocks for the platform console (dashboard, subscriptions,
// society detail). One module so the three pages cannot drift into three
// different-looking versions of the same status pill.
//
// Everything here paints from the app's own tokens in styles/globals.css, so
// these follow light/dark with the rest of the product. No hardcoded hex.

import { useMemo } from "react";

export const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const compactMoney = (n) => {
  const v = Number(n || 0);
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
  return money(v);
};

export const shortDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function relativeDays(d) {
  if (!d) return null;
  const diff = Math.round((new Date(d).getTime() - Date.now()) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return diff > 0 ? `in ${diff} days` : `${Math.abs(diff)} days ago`;
}

/* ── Surfaces ─────────────────────────────────────────────────────────── */

export function Card({ children, style, padded = true, ...rest }) {
  return (
    <div
      {...rest}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: padded ? 18 : 0,
        boxShadow: "var(--shadow-xs)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHead({ title, sub, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-1)" }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 3 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

export function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 10 }}>
      {children}
    </div>
  );
}

/* ── Status ───────────────────────────────────────────────────────────── */

const STATUS_TONES = {
  Active: ["var(--success)", "var(--success-bg)"],
  Trial: ["var(--info)", "var(--info-bg)"],
  Suspended: ["var(--danger)", "var(--danger-bg)"],
  Expired: ["var(--fg-4)", "var(--bg-muted)"],
};

export function StatusPill({ status, dot = false }) {
  const [fg, bg] = STATUS_TONES[status] || STATUS_TONES.Trial;
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 9px", borderRadius: 999, fontSize: 11,
        fontWeight: 700, background: bg, color: fg, whiteSpace: "nowrap",
      }}
    >
      {dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: fg }} />}
      {status || "Trial"}
    </span>
  );
}

const PLAN_TONES = {
  Free: ["var(--fg-4)", "var(--bg-muted)"],
  Basic: ["var(--fg-2)", "var(--bg-tertiary)"],
  Premium: ["var(--accent)", "var(--accent-tint)"],
  Enterprise: ["var(--bg-surface)", "var(--fg-2)"],
};

export function PlanChip({ plan, price }) {
  const [fg, bg] = PLAN_TONES[plan] || PLAN_TONES.Free;
  return (
    <span
      title={price ? `${plan} · ${money(price)}/month` : `${plan} · no price set`}
      style={{
        display: "inline-block", padding: "2px 8px", borderRadius: 6,
        fontSize: 10, fontWeight: 800, background: bg, color: fg,
        letterSpacing: "0.4px", textTransform: "uppercase", whiteSpace: "nowrap",
      }}
    >
      {plan || "Free"}
    </span>
  );
}

/**
 * The activity signal. Deliberately NOT called "health": it is computed from
 * collection rate, recency and subscription standing, and when there is not
 * enough history it renders as "New" rather than as a low score — an
 * onboarded-yesterday society is unknown, not unhealthy.
 */
export function SignalBar({ signal }) {
  if (!signal || signal.score === null) {
    return <span style={{ fontSize: 11, color: "var(--fg-5)" }} title="Not enough history yet">New</span>;
  }
  const color =
    signal.band === "good" ? "var(--success)" : signal.band === "watch" ? "var(--warning)" : "var(--danger)";
  return (
    <div title={signal.reasons?.join(" · ") || "Healthy"} style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <div style={{ width: 46, height: 5, background: "var(--bg-muted)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${signal.score}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)" }}>{signal.score}</span>
    </div>
  );
}

/* ── Charts ───────────────────────────────────────────────────────────── */

/** Inline SVG sparkline. No chart library, no external request. */
export function Sparkline({ data = [], width = 220, height = 44, color = "var(--primary)", fill = true }) {
  const path = useMemo(() => {
    const values = data.map((d) => (typeof d === "number" ? d : d.total || 0));
    if (values.length < 2) return null;
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const step = width / (values.length - 1);
    const pts = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 4) - 2]);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    return { line, area: `${line} L${width},${height} L0,${height} Z` };
  }, [data, width, height]);

  if (!path) {
    return <div style={{ height, display: "flex", alignItems: "center", fontSize: 11, color: "var(--fg-5)" }}>Not enough history to chart</div>;
  }
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }}>
      {fill && <path d={path.area} fill={color} opacity="0.09" />}
      <path d={path.line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Labelled monthly bars — used where the month matters as much as the shape. */
export function BarSeries({ data = [], height = 120, color = "var(--primary)", format = compactMoney }) {
  const max = Math.max(...data.map((d) => d.total || 0), 1);
  const empty = data.every((d) => !d.total);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height }}>
        {data.map((d) => (
          <div key={d.key} title={`${d.label}: ${format(d.total)}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
            <div
              style={{
                height: `${Math.max((d.total / max) * 100, d.total ? 3 : 1)}%`,
                background: d.total ? color : "var(--bg-muted)",
                borderRadius: "4px 4px 2px 2px",
                transition: "height var(--duration-base, 200ms) var(--ease-out, ease)",
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
        {data.map((d) => (
          <div key={d.key} style={{ flex: 1, textAlign: "center", fontSize: 9.5, color: "var(--fg-5)" }}>{d.label}</div>
        ))}
      </div>
      {empty && (
        <div style={{ fontSize: 11, color: "var(--fg-5)", marginTop: 8, textAlign: "center" }}>
          No payments recorded in this window
        </div>
      )}
    </div>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────────── */

export function SocietyMark({ name, size = 34 }) {
  const initials = (name || "?").split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const hue = (name || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      aria-hidden
      style={{
        width: size, height: size, borderRadius: size / 4, flexShrink: 0,
        background: `linear-gradient(135deg, hsl(${hue} 42% 48%), hsl(${(hue + 34) % 360} 46% 38%))`,
        color: "#fff", fontWeight: 700, fontSize: size * 0.36,
        display: "flex", alignItems: "center", justifyContent: "center", letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}

export function Metric({ label, value, sub, tone, hint }) {
  return (
    <div title={hint}>
      <div style={{ fontSize: 10.5, color: "var(--fg-4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone || "var(--fg-1)", marginTop: 5, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/** The "we cannot compute this yet" state, used wherever prices are unset. */
export function NotConfigured({ what, action, href }) {
  return (
    <div style={{ fontSize: 12, color: "var(--fg-4)", lineHeight: 1.5 }}>
      {what}
      {href && (
        <>
          {" "}
          <a href={href} style={{ color: "var(--primary)", fontWeight: 600 }}>{action}</a>
        </>
      )}
    </div>
  );
}

export function Empty({ title, sub }) {
  return (
    <div style={{ textAlign: "center", padding: "44px 20px", color: "var(--fg-4)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>{title}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

export function Btn({ children, variant = "secondary", size = "md", ...rest }) {
  const pad = size === "sm" ? "5px 10px" : "8px 14px";
  const variants = {
    primary: { background: "var(--primary)", color: "var(--on-solid)", border: "1px solid var(--primary)" },
    secondary: { background: "var(--bg-surface)", color: "var(--fg-1)", border: "1px solid var(--border-strong)" },
    danger: { background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger)" },
    ghost: { background: "transparent", color: "var(--fg-3)", border: "1px solid transparent" },
  };
  return (
    <button
      {...rest}
      style={{
        padding: pad, borderRadius: 8, fontSize: size === "sm" ? 12 : 13,
        fontWeight: 600, cursor: rest.disabled ? "not-allowed" : "pointer",
        opacity: rest.disabled ? 0.55 : 1, fontFamily: "inherit", whiteSpace: "nowrap",
        ...variants[variant], ...rest.style,
      }}
    >
      {children}
    </button>
  );
}
