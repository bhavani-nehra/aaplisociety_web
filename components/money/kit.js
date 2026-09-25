"use client";
/**
 * Money kit — formatting, the insights hook and small SVG charts shared by
 * the Money overview board and the band above each Money list. Every chart
 * draws what it is given and shows an empty state when there is nothing,
 * so no screen ever shows made-up numbers.
 */
import { useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import "./money.css";

// ── formatting ──────────────────────────────────────────────────────────────
export const inr = (n, dp = 0) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const compact = (n) => {
  const v = Number(n || 0);
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}k`;
  return `${s}₹${Math.round(a)}`;
};
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const fmtDate = (v, opts = { day: "2-digit", month: "short" }) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", opts);
};
export const ago = (v) => {
  if (!v) return "";
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 0) return fmtDate(v);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return fmtDate(v);
};
export const flatOf = (m) => (m && m.flatNo ? `${m.wing ? `${m.wing}-` : ""}${m.flatNo}` : "");
export const initials = (name) =>
  String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
export const currentFy = () => {
  const d = new Date();
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
};

// ── data ────────────────────────────────────────────────────────────────────
/** One request per screen; cached 5 minutes, no polling, no refetch on focus. */
export function useMoneyInsights(view, params = {}) {
  const qs = new URLSearchParams({ view, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")) });
  return useQuery({
    queryKey: ["money-insights", qs.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/admin/money/insights?${qs}`, { credentials: "include" });
      let body = null;
      try { body = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error((body && body.error) || "Could not load these figures");
      return body;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ── shells ──────────────────────────────────────────────────────────────────
export function Skeleton({ h = 160, span = "mn-s12" }) {
  return <div className={`mn-skel ${span}`} style={{ height: h }} aria-hidden="true" />;
}

export function BandError({ error, onRetry }) {
  return (
    <div className="mn mn-band">
      <div className="mn-card tight mn-h">
        <span className="mn-sub">{error?.message || "Could not load these figures."} The list below still works.</span>
        {onRetry && <button className="mn-btn" onClick={onRetry}>Try again</button>}
      </div>
    </div>
  );
}

export function Empty({ children, h }) {
  return <div className="mn-empty" style={h ? { minHeight: h } : undefined}>{children}</div>;
}

export function Delta({ now, before, invert = false, label }) {
  if (!before) return null;
  const d = ((now - before) / before) * 100;
  const good = invert ? d <= 0 : d >= 0;
  return (
    <span className={`mn-chip ${good ? "" : "bad"}`} title={label}>
      {d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}%
    </span>
  );
}

// ── charts ──────────────────────────────────────────────────────────────────
function useTip() {
  const [tip, setTip] = useState(null);
  const node = tip ? <div className="mn-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div> : null;
  return [node, setTip];
}

/** Line with soft fill; hover shows each point's value. */
export function AreaTrend({ points, h = 150, color = "var(--mn-accent)", onDark = false, format = compact, mark = "last" }) {
  const gid = useId().replace(/:/g, "");
  const [tipNode, setTip] = useTip();
  const w = 520;
  const has = points.some((p) => p.v > 0);
  if (!has) return <Empty h={h}>No entries in this period yet.</Empty>;
  const max = Math.max(...points.map((p) => p.v), 1);
  const x = (i) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => h - 22 - (v / max) * (h - 44);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const markIdx = mark === "max" ? points.findIndex((p) => p.v === max) : points.reduce((last, p, i) => (p.v > 0 ? i : last), 0);
  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="mn-svg" preserveAspectRatio="none" style={{ height: h }} role="img" aria-label="Trend">
        <defs>
          <linearGradient id={`a${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={onDark ? "#93b0f5" : "#6b8eef"} stopOpacity=".36" />
            <stop offset="1" stopColor={onDark ? "#93b0f5" : "#6b8eef"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${d} L${x(points.length - 1)},${h - 22} L${x(0)},${h - 22} Z`} fill={`url(#a${gid})`} />
        <path d={d} fill="none" stroke={onDark ? "#b9c8f3" : color} strokeWidth="2.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => (
          <rect key={i} x={x(i) - w / points.length / 2} y="0" width={w / points.length} height={h} fill="transparent"
            onMouseEnter={(e) => {
              const box = e.currentTarget.ownerSVGElement.getBoundingClientRect();
              setTip({ x: (x(i) / w) * box.width, y: (y(p.v) / h) * box.height, text: `${p.label} · ${format(p.v)}` });
            }} />
        ))}
        <circle cx={x(markIdx)} cy={y(points[markIdx].v)} r="4.5" fill={onDark ? "#f5f8ff" : "var(--mn-navy)"} stroke={onDark ? "#6b8eef" : "var(--mn-card)"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: -14 }} className={onDark ? "" : "mn-faint"}>
        {points.map((p, i) => <span key={i} style={{ opacity: onDark ? 0.7 : 1 }}>{points.length > 8 && i % 2 ? "" : p.label}</span>)}
      </div>
      {tipNode}
    </div>
  );
}

/** Small line, no axes. */
export function Sparkline({ values, w = 90, h = 26, color = "var(--mn-accent)" }) {
  if (!values.length || !values.some((v) => v)) return <svg width={w} height={h} aria-hidden="true" />;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(values.length - 1, 1)) * w).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`).join(" ");
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

/**
 * Rounded capsule bars. `series` = [{ label, values: [a, b?] }], `colors`
 * one per value. Hover shows the values.
 */
export function CapsuleBars({ series, colors = ["var(--mn-navy)", "var(--mn-accent-2)"], names = [], h = 150, format = compact, onDark = false, highlight }) {
  const [tipNode, setTip] = useTip();
  const all = series.flatMap((s) => s.values);
  if (!all.some((v) => v > 0)) return <Empty h={h}>Nothing recorded in this period yet.</Empty>;
  const max = Math.max(...all, 1);
  const n = series.length;
  const per = series[0]?.values.length || 1;
  const w = 520;
  const slot = w / n;
  const bw = Math.min(16, (slot * 0.62) / per);
  const base = h - 20;
  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="mn-svg" style={{ height: h }} role="img" aria-label="Bar chart">
        {series.map((s, i) => {
          const cx = i * slot + slot / 2;
          const start = cx - (bw * per + 3 * (per - 1)) / 2;
          const dim = highlight !== undefined && highlight !== i;
          return (
            <g key={i} opacity={dim ? 0.45 : 1}
              onMouseEnter={(e) => {
                const box = e.currentTarget.ownerSVGElement.getBoundingClientRect();
                const top = Math.max(...s.values);
                setTip({ x: (cx / w) * box.width, y: ((base - (top / max) * (base - 8)) / h) * box.height, text: `${s.label} · ${s.values.map((v, k) => `${names[k] ? `${names[k]} ` : ""}${format(v)}`).join(" · ")}` });
              }}>
              <rect x={cx - slot / 2} y="0" width={slot} height={h} fill="transparent" />
              {s.values.map((v, k) => {
                const bh = v > 0 ? Math.max((v / max) * (base - 8), bw) : 3;
                return <rect key={k} x={start + k * (bw + 3)} y={base - bh} width={bw} height={bh} rx={bw / 2} fill={v > 0 ? colors[k] : (onDark ? "rgba(245,248,255,.12)" : "var(--mn-line)")} />;
              })}
              <text x={cx} y={h - 4} textAnchor="middle" fontSize="10" fill={onDark ? "#b9c8f3" : "var(--mn-faint)"}>{s.label}</text>
            </g>
          );
        })}
      </svg>
      {tipNode}
    </div>
  );
}

export function Ring({ value, size = 112, stroke = 11, color = "var(--mn-accent)", track = "var(--mn-tint)", children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(Math.max(value || 0, 0), 100);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: "stroke-dashoffset .6s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{children}</div>
    </div>
  );
}

/** Donut from parts [{ label, value, color }]. */
export function Donut({ parts, size = 120, stroke = 16, center }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} role="img" aria-label="Share chart">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--mn-card-2)" strokeWidth={stroke} />
        {total > 0 && parts.map((p, i) => {
          const len = (p.value / total) * c;
          const el = <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke} strokeDasharray={`${Math.max(len - 2, 0)} ${c}`} strokeDashoffset={-off}><title>{`${p.label}: ${inr(p.value)}`}</title></circle>;
          off += len;
          return el;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{center}</div>
    </div>
  );
}

/** Horizontal stacked bar. */
export function StackBar({ parts, h = 22 }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <div className="mn-bar-h" style={{ height: h }} />;
  return (
    <div style={{ display: "flex", height: h, borderRadius: 10, overflow: "hidden", gap: 2 }}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.label} title={`${p.label} · ${Math.round((p.value / total) * 100)}%`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}

/** Calendar heatmap: `cells` = [{ date, dow, total, count }], oldest first. */
export function Heatmap({ cells, cell = 14, gap = 4, onDark = false }) {
  const weeks = useMemo(() => {
    const out = [];
    let col = [];
    cells.forEach((c, i) => {
      if (i === 0) for (let k = 0; k < (c.dow + 6) % 7; k += 1) col.push(null);
      col.push(c);
      if (col.length === 7) { out.push(col); col = []; }
    });
    if (col.length) out.push(col);
    return out;
  }, [cells]);
  const vals = cells.map((c) => c.total).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] || 0;
  const levels = [q(0.25), q(0.5), q(0.75)];
  const shade = (v) => {
    if (!v) return onDark ? "rgba(245,248,255,.08)" : "var(--mn-card-2)";
    if (v <= levels[0]) return "var(--mn-accent-3)";
    if (v <= levels[1]) return "var(--mn-accent-2)";
    if (v <= levels[2]) return "var(--mn-accent)";
    return "var(--mn-navy)";
  };
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateRows: `repeat(7, ${cell}px)`, gap, fontSize: 9, lineHeight: `${cell}px` }} className="mn-faint">
        {days.map((d, i) => <span key={i}>{i % 2 ? "" : d}</span>)}
      </div>
      {weeks.map((wk, i) => (
        <div key={i} style={{ display: "grid", gridTemplateRows: `repeat(7, ${cell}px)`, gap }}>
          {wk.map((c, k) => c
            ? <div key={k} title={`${fmtDate(c.date, { day: "2-digit", month: "short" })} · ${c.count} payment${c.count === 1 ? "" : "s"} · ${inr(c.total)}`} style={{ width: cell, height: cell, borderRadius: 4, background: shade(c.total) }} />
            : <div key={k} style={{ width: cell, height: cell }} />)}
        </div>
      ))}
    </div>
  );
}

/** Label + value + proportional bar rows. */
export function BarList({ rows, format = compact, max, color }) {
  if (!rows.length) return <Empty>Nothing to show yet.</Empty>;
  const top = max || Math.max(...rows.map((r) => r.value), 1);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mn-h" style={{ fontSize: 12, marginBottom: 5 }}>
            <span className="mn-ell" style={{ fontWeight: 600 }}>{r.label}{r.note ? <span className="mn-faint" style={{ fontWeight: 400 }}> · {r.note}</span> : null}</span>
            <span style={{ fontWeight: 600 }}>{format(r.value)}</span>
          </div>
          <div className="mn-bar-h"><i style={{ width: `${Math.max((r.value / top) * 100, r.value > 0 ? 3 : 0)}%`, background: r.color || color }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Half-circle gauge 0-100. */
export function Gauge({ value, size = 130, color = "var(--mn-on-navy)", track = "rgba(245,248,255,.14)" }) {
  const v = Math.min(Math.max(value || 0, 0), 100);
  const r = size / 2 - 10;
  const c = Math.PI * r;
  return (
    <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`} aria-hidden="true">
      <path d={`M10,${size / 2} A${r},${r} 0 0 1 ${size - 10},${size / 2}`} fill="none" stroke={track} strokeWidth="11" strokeLinecap="round" />
      <path d={`M10,${size / 2} A${r},${r} 0 0 1 ${size - 10},${size / 2}`} fill="none" stroke={color} strokeWidth="11" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
    </svg>
  );
}

export const PALETTE = ["var(--mn-navy)", "var(--mn-accent)", "var(--mn-accent-2)", "var(--mn-accent-3)", "var(--mn-ok)", "var(--mn-warn)"];
