"use client";
/**
 * Revamp ("Pulse") primitives — ported from the design system kit at
 * ui_kits/revamp/RevampPrimitives.jsx.
 *
 * The kit ships as browser-global JSX (window.Primitives, window.Icon); this
 * is the same component set rewritten as real ES modules with lucide-react
 * for icons. Every colour reads a --r-* CSS var, which styles/globals.css
 * defines for both themes — so these render correctly in light and dark
 * without any per-component theme branching.
 */
import { useEffect, useRef, useState } from "react";
import * as Lucide from "lucide-react";

/* ------------------------------------------------------------------ *
 * Icon — thin wrapper so call sites can pass kebab-case kit icon names
 * ("alert-triangle") instead of importing each lucide component.
 * ------------------------------------------------------------------ */
export function Icon({ name, size = 16, stroke = 1.75, color, style }) {
  const pascal = String(name || "")
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
  const C = Lucide[pascal] || Lucide.Circle;
  return <C size={size} strokeWidth={stroke} color={color} style={{ flexShrink: 0, ...style }} />;
}

/* ------------------------------------------------------------------ *
 * Btn
 * ------------------------------------------------------------------ */
const BTN_SIZES = {
  sm: { padding: "5px 9px", fontSize: 12, gap: 5, h: 26 },
  md: { padding: "7px 12px", fontSize: 13, gap: 6, h: 32 },
  lg: { padding: "10px 16px", fontSize: 14, gap: 8, h: 40 },
};
const BTN_VARIANTS = {
  primary: { background: "var(--r-brand)", color: "var(--r-brand-ink)", border: "1px solid var(--r-brand)" },
  secondary: { background: "var(--r-surface)", color: "var(--r-fg-2)", border: "1px solid var(--r-border)" },
  ghost: { background: "transparent", color: "var(--r-fg-2)", border: "1px solid transparent" },
  danger: { background: "var(--r-surface)", color: "var(--r-danger)", border: "1px solid var(--r-border)" },
  dangerSolid: { background: "var(--r-danger)", color: "#fff", border: "1px solid var(--r-danger)" },
};

export function Btn({ variant = "secondary", size = "md", icon, iconR, children, onClick, disabled, style, type, title }) {
  const s = BTN_SIZES[size] || BTN_SIZES.md;
  return (
    <button
      type={type || "button"}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        gap: s.gap, padding: s.padding, fontSize: s.fontSize, fontWeight: 500,
        height: s.h, borderRadius: 8, fontFamily: "inherit",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s, border-color 0.15s, transform 0.06s",
        whiteSpace: "nowrap", lineHeight: 1,
        ...(BTN_VARIANTS[variant] || BTN_VARIANTS.secondary), ...style,
      }}
      onMouseEnter={(e) => { if (!disabled && variant === "ghost") e.currentTarget.style.background = "var(--r-surface-3)"; }}
      onMouseLeave={(e) => { if (!disabled && variant === "ghost") e.currentTarget.style.background = "transparent"; }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.97)"; }}
      onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      {icon && <Icon name={icon} size={size === "lg" ? 16 : 14} />}
      {children}
      {iconR && <Icon name={iconR} size={size === "lg" ? 16 : 14} />}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Pill
 * ------------------------------------------------------------------ */
const PILL_TONES = {
  paid: { bg: "var(--r-success-soft)", fg: "var(--r-success)" },
  unpaid: { bg: "var(--r-danger-soft)", fg: "var(--r-danger)" },
  partial: { bg: "var(--r-warning-soft)", fg: "var(--r-warning)" },
  overdue: { bg: "var(--r-danger-soft)", fg: "var(--r-danger)" },
  active: { bg: "var(--r-success-soft)", fg: "var(--r-success)" },
  trial: { bg: "var(--r-brand-soft)", fg: "var(--r-brand)" },
  suspended: { bg: "var(--r-danger-soft)", fg: "var(--r-danger)" },
  expired: { bg: "var(--r-surface-3)", fg: "var(--r-fg-3)" },
  scheduled: { bg: "var(--r-surface-3)", fg: "var(--r-fg-3)" },
  info: { bg: "var(--r-brand-soft)", fg: "var(--r-brand)" },
  warning: { bg: "var(--r-warning-soft)", fg: "var(--r-warning)" },
  neutral: { bg: "var(--r-surface-3)", fg: "var(--r-fg-3)" },
};

export function Pill({ tone = "neutral", children, dot = true, style }) {
  const t = PILL_TONES[tone] || PILL_TONES.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 8px", borderRadius: 999,
      fontSize: 11, fontWeight: 600, lineHeight: 1.4,
      background: t.bg, color: t.fg, whiteSpace: "nowrap", ...style,
    }}>
      {dot && <span className="revamp-dot" style={{ background: "currentColor" }} />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Card / CardHead
 * ------------------------------------------------------------------ */
export function Card({ children, padded = true, style, hover = false, onClick, className }) {
  const [h, setH] = useState(false);
  return (
    <div
      className={className}
      onClick={onClick}
      onMouseEnter={() => hover && setH(true)}
      onMouseLeave={() => hover && setH(false)}
      style={{
        background: "var(--r-surface)",
        border: "1px solid var(--r-border)",
        borderRadius: "var(--r-radius-lg)",
        padding: padded ? "var(--r-pad-card)" : 0,
        boxShadow: h ? "var(--r-shadow-pop)" : "var(--r-shadow-card)",
        transition: "box-shadow 0.18s, transform 0.18s",
        transform: h ? "translateY(-1px)" : "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHead({ title, sub, right, style }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, ...style }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-2)" }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 2 }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */
export function Progress({ value, total = 100, color = "var(--r-brand)", height = 6 }) {
  const pct = Math.min(100, Math.max(0, (value / (total || 1)) * 100));
  return (
    <div style={{ width: "100%", height, background: "var(--r-surface-3)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width 0.5s cubic-bezier(.16,1,.3,1)" }} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sparkline
 * ------------------------------------------------------------------ */
export function Sparkline({ data, w = 80, h = 24, color = "var(--r-brand)", fill = true, id = "sg" }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = w / (data.length - 1);
  const pts = data.map((v, i) => [i * stepX, h - ((v - min) / range) * (h - 4) - 2]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const gid = `spark-${id}`;
  return (
    <svg width={w} height={h} style={{ display: "block", maxWidth: "100%" }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${gid})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Donut — part-to-whole for a small (<=6) fixed-order categorical set.
 * Per dataviz skill: color assigned by identity in a fixed order (never
 * cycled/reassigned by rank), a 2px surface gap between segments, and
 * every slice direct-labeled since n<=4 needs no separate legend box.
 * `segments`: [{ label, value, color }], already in the order to draw.
 * ------------------------------------------------------------------ */
export function Donut({ segments = [], size = 120, thickness = 16, centerLabel, centerSub }) {
  const total = segments.reduce((s, seg) => s + (seg.value || 0), 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const gapDeg = total > 0 ? 2 : 0; // 2px-equivalent surface gap between slices
  let cursor = 0;
  const arcs = total > 0
    ? segments.filter((s) => s.value > 0).map((seg) => {
      const frac = seg.value / total;
      const dash = Math.max(circumference * frac - gapDeg, 0);
      const gap = circumference - dash;
      const rotation = (cursor / total) * 360 - 90;
      cursor += seg.value;
      return { ...seg, dash, gap, rotation, frac };
    })
    : [];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", flexShrink: 0 }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--r-surface-3)" strokeWidth={thickness} />
      {arcs.map((a, i) => (
        <circle
          key={a.label || i}
          cx={c} cy={c} r={r} fill="none"
          stroke={a.color} strokeWidth={thickness}
          strokeDasharray={`${a.dash} ${a.gap}`}
          strokeLinecap="butt"
          transform={`rotate(${a.rotation} ${c} ${c})`}
        />
      ))}
      {centerLabel ? (
        <text x={c} y={c - (centerSub ? 4 : 0)} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.13} fontWeight={700} fill="var(--r-fg-1)">
          {centerLabel}
        </text>
      ) : null}
      {centerSub ? (
        <text x={c} y={c + 14} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.07} fill="var(--r-fg-4)">
          {centerSub}
        </text>
      ) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Avatar — deterministic gradient from the name
 * ------------------------------------------------------------------ */
export function Avatar({ name = "?", size = 28, style }) {
  const label = String(name || "?");
  const letters = label.split(" ").filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "?";
  const seed = label.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = seed % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: 999, flexShrink: 0,
      background: `linear-gradient(135deg, hsl(${hue}, 45%, 55%), hsl(${(hue + 40) % 360}, 50%, 45%))`,
      color: "#fff", fontWeight: 700, fontSize: size * 0.38,
      display: "flex", alignItems: "center", justifyContent: "center",
      letterSpacing: "-0.02em", ...style,
    }}>{letters}</div>
  );
}

/* ------------------------------------------------------------------ *
 * SearchInput
 * ------------------------------------------------------------------ */
export function SearchInput({ value, onChange, placeholder, autoFocus, size = "md", style }) {
  const sizes = { sm: { p: "6px 10px 6px 30px", h: 30, fs: 12 }, md: { p: "8px 12px 8px 34px", h: 36, fs: 13 } };
  const s = sizes[size] || sizes.md;
  return (
    <div style={{ position: "relative", display: "inline-flex", width: "100%", ...style }}>
      <span style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--r-fg-4)", display: "flex", pointerEvents: "none" }}>
        <Icon name="search" size={size === "sm" ? 13 : 14} />
      </span>
      <input
        autoFocus={autoFocus}
        value={value || ""}
        onChange={(e) => onChange && onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: s.p, height: s.h, fontSize: s.fs,
          background: "var(--r-surface)", border: "1px solid var(--r-border)",
          borderRadius: 8, fontFamily: "inherit", color: "var(--r-fg-1)",
          outline: "none", transition: "border-color 0.12s, box-shadow 0.12s",
        }}
        onFocus={(e) => { e.target.style.borderColor = "var(--r-brand)"; e.target.style.boxShadow = "0 0 0 3px var(--r-brand-soft)"; }}
        onBlur={(e) => { e.target.style.borderColor = "var(--r-border)"; e.target.style.boxShadow = "none"; }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Select — native <select> dressed to match SearchInput
 * ------------------------------------------------------------------ */
export function Select({ value, onChange, children, size = "sm", style, title }) {
  const h = size === "sm" ? 30 : 36;
  return (
    <select
      value={value}
      title={title}
      onChange={(e) => onChange && onChange(e.target.value)}
      style={{
        height: h, padding: "0 26px 0 10px", fontSize: size === "sm" ? 12 : 13,
        background: "var(--r-surface)", color: "var(--r-fg-2)",
        border: "1px solid var(--r-border)", borderRadius: 8,
        fontFamily: "inherit", fontWeight: 500, cursor: "pointer", outline: "none",
        appearance: "none",
        backgroundImage: "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)",
        backgroundPosition: "calc(100% - 14px) center, calc(100% - 9px) center",
        backgroundSize: "5px 5px, 5px 5px",
        backgroundRepeat: "no-repeat",
        ...style,
      }}
    >
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ *
 * Accordion — inline expandable section. Built for the accounting revamp:
 * "all these small things must be in one configuration kind of page" — a
 * drawer opens an overlay away from the page; an accordion keeps the
 * content on the same page, just collapsed until asked for. Uncontrolled
 * (owns its own open state) so a page can stack several without wiring
 * open/close state for each one itself.
 * ------------------------------------------------------------------ */
export function Accordion({ icon, title, sub, defaultOpen = false, badge, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: "1px solid var(--r-hairline)", borderRadius: 12, background: "var(--r-surface)", marginBottom: 12, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "14px 16px",
          background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
        }}
      >
        {icon ? (
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--r-brand-soft, var(--r-surface-2))", color: "var(--r-brand)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon name={icon} size={15} />
          </div>
        ) : null}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--r-fg-1)" }}>{title}</div>
          {sub ? <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 2 }}>{sub}</div> : null}
        </div>
        {badge}
        <Icon name={open ? "chevron-up" : "chevron-down"} size={16} color="var(--r-fg-4)" />
      </button>
      {open ? (
        <div style={{ padding: "0 16px 16px" }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ToggleSwitch — real on/off pill, adopted from the Pulse design-kit
 * import (D:\projects\AapliSociety_Design_System\ui_kits\revamp\
 * AccountingShared.jsx). Replaces plain on/off Btns wherever a state is
 * genuinely binary (posting rule enabled, account mapped, etc.) — a
 * switch reads as "flip a setting", a button reads as "do a thing",
 * and conflating them was the mockup's one real UI fix worth adopting.
 * ------------------------------------------------------------------ */
export function ToggleSwitch({ on, onChange, disabled, title }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 36, height: 21, borderRadius: 999, border: "none", padding: 2,
        cursor: disabled ? "not-allowed" : "pointer",
        background: on ? "var(--r-brand)" : "var(--r-surface-3)",
        display: "flex", alignItems: "center", justifyContent: on ? "flex-end" : "flex-start",
        transition: "background 0.15s", flexShrink: 0, opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ width: 15, height: 15, borderRadius: 999, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Segmented
 * ------------------------------------------------------------------ */
export function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: "inline-flex", padding: 3, background: "var(--r-surface-3)", borderRadius: 9, gap: 2, flexWrap: "wrap" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} onClick={() => onChange(o.value)} style={{
            padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, fontFamily: "inherit",
            border: "none", cursor: "pointer", whiteSpace: "nowrap",
            background: active ? "var(--r-surface)" : "transparent",
            color: active ? "var(--r-fg-1)" : "var(--r-fg-3)",
            boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px var(--r-border)" : "none",
            transition: "background 0.12s, color 0.12s",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {o.icon && <Icon name={o.icon} size={12} />}
            {o.label}
            {o.count != null && <span style={{ opacity: 0.6, fontWeight: 500 }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * MiniTable
 * ------------------------------------------------------------------ */
export function MiniTable({ cols, rows, onRowClick }) {
  return (
    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={i} style={{
              textAlign: c.align || "left", padding: "8px 12px",
              fontSize: 10, fontWeight: 600, color: "var(--r-fg-4)",
              textTransform: "uppercase", letterSpacing: "0.6px",
              borderBottom: "1px solid var(--r-border)", background: "var(--r-surface-2)",
              whiteSpace: "nowrap",
            }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key ?? i} className="revamp-row" onClick={() => onRowClick && onRowClick(r, i)}
              style={{ cursor: onRowClick ? "pointer" : "default", transition: "background 0.1s" }}>
            {r.cells.map((cell, j) => (
              <td key={j} style={{
                padding: "10px 12px", borderBottom: "1px solid var(--r-hairline)",
                textAlign: cols[j].align || "left", color: "var(--r-fg-2)",
                fontVariantNumeric: cols[j].num ? "tabular-nums" : "normal",
              }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ *
 * PageHeader — the kit's Shell.PageHeader
 * ------------------------------------------------------------------ */
export function PageHeader({ eyebrow, title, sub, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 22, flexWrap: "wrap" }}>
      <div>
        {eyebrow && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 8 }}>
            {eyebrow}
          </div>
        )}
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--r-fg-1)", letterSpacing: "-0.025em", lineHeight: 1.15, margin: 0 }}>{title}</h1>
        {sub && <p style={{ fontSize: 13, color: "var(--r-fg-3)", margin: "6px 0 0" }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SectionLabel — the small uppercase group heading used above bentos
 * ------------------------------------------------------------------ */
export function SectionLabel({ icon, children, style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 11, fontWeight: 700, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: "0.7px", ...style }}>
      {icon && <Icon name={icon} size={12} />} {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ActionTile — "needs attention" row on the dashboard
 * ------------------------------------------------------------------ */
export function ActionTile({ tone = "info", icon, headline, sub, cta, onClick }) {
  const tones = {
    danger: { bg: "var(--r-danger-soft)", fg: "var(--r-danger)" },
    warning: { bg: "var(--r-warning-soft)", fg: "var(--r-warning)" },
    info: { bg: "var(--r-brand-soft)", fg: "var(--r-brand)" },
    success: { bg: "var(--r-success-soft)", fg: "var(--r-success)" },
  };
  const t = tones[tone] || tones.info;
  return (
    <button onClick={onClick} style={{
      textAlign: "left", display: "flex", gap: 14, alignItems: "flex-start",
      padding: 16, borderRadius: 14, fontFamily: "inherit",
      background: "var(--r-surface)", border: "1px solid var(--r-border)",
      boxShadow: "var(--r-shadow-card)",
      cursor: onClick ? "pointer" : "default",
      transition: "border-color 0.15s, box-shadow 0.15s, transform 0.15s",
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.fg; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "var(--r-shadow-pop)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--r-border)"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--r-shadow-card)"; }}
    >
      <div style={{ width: 38, height: 38, borderRadius: 10, background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon name={icon} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)", marginBottom: 2 }}>{headline}</div>
        <div style={{ fontSize: 12, color: "var(--r-fg-3)" }}>{sub}</div>
      </div>
      {cta && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: t.fg, whiteSpace: "nowrap" }}>
          {cta} <Icon name="arrow-right" size={13} />
        </div>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * MiniMetric — the bento tile
 * ------------------------------------------------------------------ */
export function MiniMetric({ label, value, delta, tone, icon, extra, onClick }) {
  return (
    <Card style={{ cursor: onClick ? "pointer" : "default" }} hover={!!onClick} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--r-fg-4)", fontWeight: 500 }}>
          <Icon name={icon} size={13} /> {label}
        </div>
        {onClick && <Icon name="arrow-up-right" size={13} color="var(--r-fg-5)" />}
      </div>
      <div className="revamp-num" style={{ fontSize: 28, fontWeight: 700, color: "var(--r-fg-1)", letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
      {delta && (
        <div style={{
          fontSize: 11, marginTop: 6, fontWeight: 500,
          color: tone === "paid" || tone === "success" ? "var(--r-success)"
            : tone === "danger" ? "var(--r-danger)" : "var(--r-fg-4)",
        }}>{delta}</div>
      )}
      {extra}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * SmallStat — compact 4-up stat card (Members screen)
 * ------------------------------------------------------------------ */
export function SmallStat({ icon, label, value, tone, onClick }) {
  return (
    <Card style={{ padding: 14, cursor: onClick ? "pointer" : "default" }} hover={!!onClick} onClick={onClick}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--r-fg-4)", fontWeight: 500, marginBottom: 6 }}>
        <Icon name={icon} size={12} /> {label}
      </div>
      <div className="revamp-num" style={{
        fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em",
        color: tone === "danger" ? "var(--r-danger)" : tone === "success" ? "var(--r-success)" : "var(--r-fg-1)",
      }}>{value}</div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * SummaryStat — label over a big coloured number (Bills summary strip)
 * ------------------------------------------------------------------ */
export function SummaryStat({ label, value, tone, sub }) {
  const c = tone === "paid" ? "var(--r-success)" : tone === "overdue" ? "var(--r-danger)" : tone === "warning" ? "var(--r-warning)" : "var(--r-fg-1)";
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>{label}</div>
      <div className="revamp-num" style={{ fontSize: 24, fontWeight: 700, color: c, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * EmptyState
 * ------------------------------------------------------------------ */
export function EmptyState({ icon = "inbox", title, sub }) {
  return (
    <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--r-fg-4)" }}>
      <Icon name={icon} size={32} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
      {title && <p style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: "var(--r-fg-2)" }}>{title}</p>}
      {sub && <p style={{ marginTop: 4, fontSize: 13 }}>{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Skeleton shimmer block, for the loading states of revamped screens
 * ------------------------------------------------------------------ */
export function RevampSkeleton({ h = 96, style }) {
  return <div className="skeleton" style={{ height: h, borderRadius: "var(--r-radius-lg)", ...style }} />;
}

/* ------------------------------------------------------------------ *
 * DiffPreview — the PLAN phase of Plan -> Stream -> Receipt (design doc
 * §6/§9). "will create 57 / skip 0 / change 0", expandable to the named
 * list. Pure display — the caller owns fetching the dryRun plan and the
 * Cancel/Confirm actions either side of it.
 * ------------------------------------------------------------------ */
export function DiffPreview({ willCreate = [], willSkip = [], willUpdate = [], expanded, onToggle }) {
  const counts = [
    willCreate.length ? { label: "create", n: willCreate.length, color: "var(--r-success)" } : null,
    willUpdate.length ? { label: "update", n: willUpdate.length, color: "var(--r-warning)" } : null,
    willSkip.length ? { label: "skip", n: willSkip.length, color: "var(--r-fg-4)" } : null,
  ].filter(Boolean);
  const nothingToDo = counts.length === 0;

  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8, background: "var(--r-surface-2)",
      border: "1px solid var(--r-hairline)", fontSize: 12.5, lineHeight: 1.6,
    }}>
      {nothingToDo ? (
        <span style={{ color: "var(--r-fg-3)" }}>Nothing to do — already up to date.</span>
      ) : (
        <>
          <span style={{ color: "var(--r-fg-1)", fontWeight: 600 }}>About to </span>
          {counts.map((c, i) => (
            <span key={c.label}>
              {i > 0 ? ", " : ""}
              <strong style={{ color: c.color }}>{c.n}</strong> {c.label}
            </span>
          ))}
          {onToggle && (willCreate.length || willUpdate.length || willSkip.length) ? (
            <button type="button" onClick={onToggle} style={{
              marginLeft: 8, border: "none", background: "none", cursor: "pointer",
              color: "var(--r-fg-4)", fontSize: 11.5, textDecoration: "underline",
            }}>
              {expanded ? "hide" : "see all"}
            </button>
          ) : null}
          {expanded ? (
            <div style={{ marginTop: 6 }}>
              {willCreate.length ? <div><strong style={{ color: "var(--r-success)" }}>Create:</strong> {willCreate.join(", ")}</div> : null}
              {willUpdate.length ? <div style={{ marginTop: 3 }}><strong style={{ color: "var(--r-warning)" }}>Update:</strong> {willUpdate.join(", ")}</div> : null}
              {willSkip.length ? <div style={{ marginTop: 3, color: "var(--r-fg-4)" }}><strong>Skip (already there):</strong> {willSkip.join(", ")}</div> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * RunLog — the STREAM phase. Consumes an array of SetupEvent (design doc
 * §6 event contract) already accumulated by the caller and renders them as
 * a plain activity list, newest at the bottom, auto-scrolling. The caller
 * owns the actual NDJSON fetch/reader loop (it differs per endpoint); this
 * only renders what's been received so far.
 *
 * Renders in the app's own type and surface colors, not a monospace
 * black-terminal costume — this is a list of what happened, not a console.
 * `aria-live="polite"` per the doc's accessibility primitive requirements.
 * ------------------------------------------------------------------ */
export function RunLog({ events = [], height = 180 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events.length]);

  const rowFor = (e, i) => {
    const t = e.at ? new Date(e.at).toLocaleTimeString("en-IN", { hour12: false }) : "";
    switch (e.t) {
      case "start":
        return { icon: "play", color: "var(--r-fg-4)", text: "Starting…" };
      case "item":
        return e.action === "skipped"
          ? { icon: "minus-circle", color: "var(--r-fg-4)", text: `${e.label} — already there` }
          : { icon: "check", color: "var(--r-success)", text: `${e.label} — ${e.action}` };
      case "verify":
        return e.ok
          ? { icon: "check-circle", color: "var(--r-success)", text: e.detail || e.check }
          : { icon: "x-circle", color: "var(--r-danger)", text: e.detail || e.check };
      case "done":
        return {
          icon: "check-circle", color: "var(--r-success)",
          text: `${e.created} created · ${e.skipped} skipped · ${e.updated} changed · ${((e.ms || 0) / 1000).toFixed(1)}s`,
        };
      case "error":
        return { icon: "x-circle", color: "var(--r-danger)", text: e.message };
      default:
        return { icon: "circle", color: "var(--r-fg-4)", text: e.t };
    }
  };

  return (
    <div
      ref={ref}
      role="log"
      aria-live="polite"
      style={{
        maxHeight: height, overflowY: "auto", padding: "4px 2px", borderRadius: 8,
        background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)",
      }}
    >
      {events.map((e, i) => {
        const row = rowFor(e, i);
        const t = e.at ? new Date(e.at).toLocaleTimeString("en-IN", { hour12: false }) : "";
        return (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "5px 10px", fontSize: 12.5, color: "var(--r-fg-2)",
            // Global @keyframes revamp-fade (styles/globals.css) — a plain
            // className animation, not <style jsx> (unverified in this
            // codebase, see docs/ANIMATION_GUIDE.md Pitfall #1).
            animation: "revamp-fade 0.18s ease",
          }}>
            <Icon name={row.icon} size={13} color={row.color} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{row.text}</span>
            {t ? <span style={{ fontSize: 11, color: "var(--r-fg-5)", flexShrink: 0 }}>{t}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Receipt — one-line collapsed result (timestamp + actor), expandable to
 * the created/skipped detail. The RECEIPT phase, factored out of the
 * setup wizard's StepCard so any Plan -> Stream -> Receipt screen can
 * reuse the same collapsed shape instead of re-inventing it.
 * ------------------------------------------------------------------ */
export function Receipt({ status = "ok", at, actorName, created = [], skipped = [], expanded, onToggle }) {
  const when = at ? new Date(at).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  }) : "";
  const failed = status === "failed";
  return (
    <div style={{ fontSize: 12.5 }}>
      <span style={{ color: failed ? "var(--r-danger)" : "var(--r-success)", fontWeight: 600 }}>
        {failed ? "Did not complete" : "Done"}
      </span>
      <span style={{ color: "var(--r-fg-4)", marginLeft: 6 }}>
        {when}{actorName ? ` by ${actorName}` : ""}
      </span>
      {(created.length || skipped.length) && onToggle ? (
        <button type="button" onClick={onToggle} style={{
          marginLeft: 8, border: "none", background: "none", cursor: "pointer",
          color: "var(--r-fg-4)", fontSize: 11.5, textDecoration: "underline",
        }}>
          {expanded ? "hide" : "receipt"}
        </button>
      ) : null}
      {expanded ? (
        <div style={{ marginTop: 6, color: "var(--r-fg-2)" }}>
          {created.length ? <div><strong style={{ color: "var(--r-success)" }}>Created:</strong> {created.join(", ")}</div> : null}
          {skipped.length ? <div style={{ marginTop: 3, color: "var(--r-fg-4)" }}><strong>Already there:</strong> {skipped.join(", ")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * GuardedAction — one prop (`tier`) picks the confirm UX (design doc §7,
 * §9). Renders as a trigger button; the actual T1/T2/T3 UI is an inline
 * popover anchored under it so it works inside a table row with no modal
 * plumbing.
 *
 *   T0  calls onConfirm() immediately, no UI
 *   T1  inline "Are you sure?" — one Confirm click
 *   T2  inline typed-name confirmation + mandatory reason, then Confirm
 *   T3  refuses outright — renders `refusal` (title/reason/remedy) instead
 *       of any control; onConfirm is never reachable
 *
 * Caller owns fetching whichever tier applies to this instance (the lock
 * matrix decides that server-side; the client mirrors it so a T3 renders as
 * a refusal instead of a button that would just 423 on click).
 * ------------------------------------------------------------------ */
export function GuardedAction({
  tier = "T0", label = "Delete", confirmLabel, typedName, refusal,
  onConfirm, disabled, size = "sm", danger = true,
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  // T3 — a disabled button, reason on hover. Used to render as a full
  // always-visible red card (title + reason + remedy text) repeated on
  // every locked row in a list; scanning 20 rows meant reading the same
  // block 20 times. Same information, now on hover instead of on the page.
  if (tier === "T3" && refusal) {
    const tip = [refusal.title, refusal.reason, refusal.remedy].filter(Boolean).join(" — ");
    return (
      <button
        type="button"
        disabled
        title={tip}
        style={{
          padding: size === "sm" ? "5px 10px" : "7px 12px", borderRadius: 7, fontSize: size === "sm" ? 12 : 13,
          border: "1px solid var(--r-hairline)", background: "var(--r-surface-2)", color: "var(--r-fg-5)",
          cursor: "not-allowed", fontWeight: 600,
        }}
      >
        {label}
      </button>
    );
  }

  const run = async () => {
    setBusy(true);
    try {
      await onConfirm(tier === "T2" ? { reason } : undefined);
      setOpen(false);
      setReason("");
      setTyped("");
    } finally {
      setBusy(false);
    }
  };

  if (tier === "T0") {
    return (
      <Btn size={size} variant={danger ? "danger" : "secondary"} disabled={disabled || busy} onClick={run}>
        {busy ? "…" : label}
      </Btn>
    );
  }

  if (!open) {
    return (
      <Btn size={size} variant={danger ? "danger" : "secondary"} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </Btn>
    );
  }

  const typedOk = tier !== "T2" || (typedName && typed.trim() === typedName && reason.trim().length > 0);

  return (
    <div style={{
      padding: "10px 12px", borderRadius: 8, background: "var(--r-surface-2)",
      border: "1px solid var(--r-hairline)", fontSize: 12, minWidth: 240,
    }}>
      {tier === "T2" ? (
        <>
          <div style={{ marginBottom: 6, color: "var(--r-fg-2)" }}>
            Type <strong>{typedName}</strong> to confirm, and say why:
          </div>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={typedName}
            style={{
              width: "100%", marginBottom: 6, padding: "6px 8px", borderRadius: 6,
              border: "1px solid var(--r-hairline)", background: "var(--r-surface-1)",
              color: "var(--r-fg-1)", fontSize: 12,
            }}
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            style={{
              width: "100%", marginBottom: 8, padding: "6px 8px", borderRadius: 6,
              border: "1px solid var(--r-hairline)", background: "var(--r-surface-1)",
              color: "var(--r-fg-1)", fontSize: 12,
            }}
          />
        </>
      ) : (
        <div style={{ marginBottom: 8, color: "var(--r-fg-2)" }}>Are you sure?</div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <Btn size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancel</Btn>
        <Btn size="sm" variant="danger" disabled={busy || !typedOk} onClick={run}>
          {busy ? "…" : (confirmLabel || label)}
        </Btn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Modal — centered dialog, not a side sheet. "Tap to open a dialog
 * container" for the Configuration page: click a card, its full content
 * opens centered over a dim backdrop, close returns to the card grid. A
 * Drawer answers "here's this section, off to one side while you keep
 * working" — a Modal answers "you're doing this one thing now," which is
 * what a one-time setup step (Financial Years, Posting Rules, Book Checks)
 * actually is.
 * ------------------------------------------------------------------ */
export function Modal({ open, onClose, title, sub, width = 720, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div
        onClick={onClose}
        className="revamp-modal-backdrop"
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="revamp-modal-panel"
        style={{
          position: "relative", width: `min(${width}px, 100%)`, maxHeight: "88vh",
          background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: 16,
          boxShadow: "0 24px 64px rgba(0,0,0,0.35)", display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: "18px 22px", borderBottom: "1px solid var(--r-hairline)", flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--r-fg-1)" }}>{title}</div>
            {sub ? <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginTop: 3 }}>{sub}</div> : null}
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            style={{
              border: "none", background: "var(--r-surface-2)", borderRadius: 8, width: 30, height: 30,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
            }}
          >
            <Icon name="x" size={16} color="var(--r-fg-3)" />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Drawer — right-side sheet, the thing design doc §9/§12 Phase 4 uses to
 * replace a standalone page: "financial-years", "posting-rules" etc. render
 * inside this instead of their own /admin/accounting/<x> route. URL-
 * addressable is the caller's job (read/write `?drawer=` in the parent page)
 * so old bookmarked links keep working as a redirect into the right drawer.
 * ------------------------------------------------------------------ */
export function Drawer({ open, onClose, title, sub, width = 560, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200 }}>
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="revamp-drawer-panel"
        style={{
          position: "absolute", top: 0, right: 0, bottom: 0, width: `min(${width}px, 100vw)`,
          background: "var(--r-surface)", borderLeft: "1px solid var(--r-hairline)",
          boxShadow: "-8px 0 24px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          padding: "16px 18px", borderBottom: "1px solid var(--r-hairline)", flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--r-fg-1)" }}>{title}</div>
            {sub ? <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 3 }}>{sub}</div> : null}
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            style={{
              border: "none", background: "var(--r-surface-2)", borderRadius: 8, width: 28, height: 28,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
            }}
          >
            <Icon name="x" size={15} color="var(--r-fg-3)" />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tabs — used everywhere Books / Statements / Money / Billing setup need
 * a switcher (design doc §9). Controlled: caller owns `value`.
 * ------------------------------------------------------------------ */
export function Tabs({ value, onChange, tabs, style }) {
  return (
    <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--r-hairline)", marginBottom: 16, ...style }}>
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(t.key)}
            style={{
              border: "none", background: "none", cursor: "pointer", fontFamily: "inherit",
              padding: "9px 14px", fontSize: 13, fontWeight: 600,
              color: active ? "var(--r-brand)" : "var(--r-fg-3)",
              borderBottom: active ? "2px solid var(--r-brand)" : "2px solid transparent",
              marginBottom: -1, display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {t.icon ? <Icon name={t.icon} size={14} /> : null}
            {t.label}
            {t.badge != null ? (
              <span style={{
                fontSize: 10.5, fontWeight: 700, color: active ? "var(--r-brand)" : "var(--r-fg-4)",
                background: "var(--r-surface-2)", borderRadius: 999, padding: "1px 6px",
              }}>{t.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * DataTable — sort, sticky header, empty state, row click. Not a
 * virtualized grid (the pages that need this kit are hundreds, not tens of
 * thousands, of rows) — sortable + sticky + a real empty state replaces most
 * of what the ~10 hand-rolled tables in the accounting pages do today.
 * `cols`: [{key, label, width, render?(row), align?}]
 * ------------------------------------------------------------------ */
export function DataTable({ cols, rows, rowKey = "_id", onRowClick, emptyIcon = "inbox", emptyTitle = "Nothing here", emptySub, sort, onSort }) {
  if (!rows?.length) {
    return <Card><EmptyState icon={emptyIcon} title={emptyTitle} sub={emptySub} /></Card>;
  }
  return (
    <Card padded={false} style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ position: "sticky", top: 0, background: "var(--r-surface)", zIndex: 1 }}>
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={() => onSort && onSort(c.key)}
                style={{
                  textAlign: c.align || "left", padding: "10px 14px", fontSize: 11.5, fontWeight: 700,
                  color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: 0.3,
                  borderBottom: "1px solid var(--r-hairline)", cursor: onSort ? "pointer" : "default",
                  width: c.width, whiteSpace: "nowrap",
                }}
              >
                {c.label}
                {sort?.key === c.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row[rowKey] ?? i}
              onClick={() => onRowClick?.(row)}
              style={{
                borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--r-hairline)",
                cursor: onRowClick ? "pointer" : "default",
              }}
              onMouseEnter={(e) => { if (onRowClick) e.currentTarget.style.background = "var(--r-surface-2)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {cols.map((c) => (
                <td key={c.key} style={{ padding: "10px 14px", textAlign: c.align || "left", color: "var(--r-fg-2)" }}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * useIsDark — mirrors the kit's useIsDarkAV, but reads the app's
 * data-theme attribute instead of the kit's .theme-dark class.
 * Used only for the extra hover glow that dark mode adds.
 * ------------------------------------------------------------------ */
export function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(document.documentElement.getAttribute("data-theme") === "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}
