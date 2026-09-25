"use client";

export function PageHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
      <div>
        <h1 style={{ margin: "0 0 4px", fontSize: 28, fontWeight: 700, color: "var(--fg-2)" }}>{title}</h1>
        {subtitle && <p style={{ margin: 0, fontSize: 14, color: "var(--fg-4)" }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function FySelect({ years, value, onChange }) {
  if (!years.length) return null;
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, background: "var(--bg-surface)", color: "var(--fg-1)", fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}
    >
      {years.map((y) => (
        <option key={y._id} value={y._id}>{y.label}</option>
      ))}
    </select>
  );
}

export function Btn({ variant = "primary", size = "md", children, onClick, disabled, style }) {
  const base = { fontFamily: "inherit", fontWeight: 500, borderRadius: 8, border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 8, transition: "all 0.2s ease", opacity: disabled ? 0.6 : 1, whiteSpace: "nowrap" };
  const sizes = { sm: { padding: "6px 12px", fontSize: 12 }, md: { padding: "10px 18px", fontSize: 14 }, lg: { padding: "12px 22px", fontSize: 15 } };
  const variants = {
    primary: { background: "var(--primary)", color: "var(--on-solid)" },
    secondary: { background: "var(--bg-muted)", color: "var(--fg-2)", border: "1px solid var(--border)" },
    ghost: { background: "transparent", color: "var(--primary)" },
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...base, ...sizes[size], ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

export function EmptyState({ text, hint }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--fg-5)" }}>
      <p style={{ margin: 0, fontSize: 14 }}>{text}</p>
      {hint && <p style={{ margin: "6px 0 0", fontSize: 13 }}>{hint}</p>}
    </div>
  );
}
