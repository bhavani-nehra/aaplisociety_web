"use client";
// components/visitor/ui.js
// Shared, dependency-light UI primitives for the visitor/security module.
// NOTE: we deliberately use single-brace style references (style={obj}) with
// named style objects instead of inline style=... to keep JSX clean.
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/revamp";
import { STATUS_COLOR } from "@/lib/visitor-config";
export const tokens = {
  radius: 14,
  radiusSm: 10,
  border: "1px solid var(--border)",
  shadow: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)",
  shadowLg: "0 10px 30px rgba(16,24,40,.10)",
  bg: "var(--bg-canvas)",
  card: "var(--bg-surface)",
  text: "var(--fg-1)",
  sub: "var(--fg-4)",
  primary: "var(--accent)",
  primaryDark: "var(--primary)",
  danger: "var(--danger)",
  success: "var(--success)",
};
export function Card({ children, style, pad = 20, ...rest }) {
  const s = {
    background: tokens.card,
    border: tokens.border,
    borderRadius: tokens.radius,
    boxShadow: tokens.shadow,
    padding: pad,
    ...style,
  };
  return (
    <div style={s} {...rest}>
      {children}
    </div>
  );
}
export function PageHeader({ title, subtitle, actions }) {
  const wrap = {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 20,
    flexWrap: "wrap",
  };
  const h = { fontSize: 22, fontWeight: 700, color: tokens.text, margin: 0 };
  const sub = { color: tokens.sub, margin: "6px 0 0", fontSize: 14 };
  const act = { display: "flex", gap: 8 };
  return (
    <div style={wrap}>
      <div>
        <h1 style={h}>{title}</h1>
        {subtitle && <p style={sub}>{subtitle}</p>}
      </div>
      {actions && <div style={act}>{actions}</div>}
    </div>
  );
}
export function Button({
  children,
  variant = "primary",
  size = "md",
  full,
  style,
  disabled,
  ...rest
}) {
  const variants = {
    primary: {
      background: tokens.primary,
      color: "#fff",
      border: "1px solid transparent",
    },
    success: {
      background: tokens.success,
      color: "#fff",
      border: "1px solid transparent",
    },
    danger: {
      background: tokens.danger,
      color: "#fff",
      border: "1px solid transparent",
    },
    ghost: {
      background: "transparent",
      color: tokens.text,
      border: tokens.border,
    },
    subtle: {
      background: "var(--bg-muted)",
      color: tokens.text,
      border: "1px solid transparent",
    },
  };
  const sizes = {
    sm: { padding: "6px 10px", fontSize: 13 },
    md: { padding: "10px 16px", fontSize: 14 },
    lg: { padding: "13px 20px", fontSize: 15 },
  };
  const s = {
    ...variants[variant],
    ...sizes[size],
    width: full ? "100%" : undefined,
    borderRadius: tokens.radiusSm,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    transition: "filter .15s ease",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    ...style,
  };
  return (
    <button
      disabled={disabled}
      style={s}
      onMouseDown={(e) => (e.currentTarget.style.filter = "brightness(0.95)")}
      onMouseUp={(e) => (e.currentTarget.style.filter = "none")}
      onMouseLeave={(e) => (e.currentTarget.style.filter = "none")}
      {...rest}
    >
      {children}
    </button>
  );
}
export function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || "var(--fg-4)";
  const s = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    background: color + "1a",
    color,
    fontWeight: 600,
    fontSize: 12,
    padding: "3px 10px",
    borderRadius: 999,
  };
  const dot = { width: 6, height: 6, borderRadius: 999, background: color };
  return (
    <span style={s}>
      <span style={dot} />
      {status}
    </span>
  );
}
export function Badge({ children, color = "var(--fg-4)" }) {
  const s = {
    background: color + "1a",
    color,
    fontWeight: 600,
    fontSize: 12,
    padding: "3px 10px",
    borderRadius: 999,
  };
  return <span style={s}>{children}</span>;
}
export function PurposeTag({ purpose }) {
  const s = { fontSize: 13, color: tokens.text };
  return (
    <span style={s}>
      {purpose}
    </span>
  );
}
export function Field({ label, hint, children, required }) {
  const wrap = { display: "block" };
  const lab = {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: tokens.text,
    marginBottom: 6,
  };
  const req = { color: tokens.danger };
  const h = { display: "block", fontSize: 12, color: tokens.sub, marginTop: 4 };
  return (
    <label style={wrap}>
      <span style={lab}>
        {label} {required && <span style={req}>*</span>}
      </span>
      {children}
      {hint && <span style={h}>{hint}</span>}
    </label>
  );
}
const inputBase = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: tokens.radiusSm,
  border: tokens.border,
  fontSize: 14,
  color: tokens.text,
  outline: "none",
  background: "var(--bg-surface)",
  boxSizing: "border-box",
};
export function Input(props) {
  const { style, ...rest } = props;
  const s = { ...inputBase, ...(style || {}) };
  return (
    <input
      {...rest}
      style={s}
      onFocus={(e) => (e.target.style.borderColor = tokens.primary)}
      onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
    />
  );
}
export function Select({ children, style, ...props }) {
  const s = { ...inputBase, ...(style || {}) };
  return (
    <select {...props} style={s}>
      {children}
    </select>
  );
}
export function Textarea(props) {
  const { style, ...rest } = props;
  const s = {
    ...inputBase,
    minHeight: 76,
    resize: "vertical",
    ...(style || {}),
  };
  return <textarea {...rest} style={s} />;
}
export function StatCard({ label, value, color = tokens.primary, icon }) {
  const body = { display: "flex", flexDirection: "column", gap: 6 };
  const top = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };
  const lab = { fontSize: 13, color: tokens.sub, fontWeight: 600 };
  const ic = { fontSize: 18 };
  const val = { fontSize: 28, fontWeight: 700, color };
  return (
    <Card pad={16} style={body}>
      <div style={top}>
        <span style={lab}>{label}</span>
        {icon && <span style={ic}>{icon}</span>}
      </div>
      <span style={val}>{value}</span>
    </Card>
  );
}
export function Avatar({ src, name, size = 44 }) {
  if (src) {
    const s = {
      width: size,
      height: size,
      borderRadius: 10,
      objectFit: "cover",
      border: tokens.border,
    };
    return <img src={src} alt={name || ""} style={s} />;
  }
  const s = {
    width: size,
    height: size,
    borderRadius: 10,
    background: "var(--primary-tint)",
    color: tokens.primary,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: size / 2.4,
  };
  return <div style={s}>{(name || "?").charAt(0).toUpperCase()}</div>;
}
export function EmptyState({ icon = "", title, subtitle }) {
  const wrap = { textAlign: "center", padding: "48px 20px", color: tokens.sub };
  const ic = { fontSize: 40, marginBottom: 10 };
  const t = { fontWeight: 600, color: tokens.text, marginBottom: 4 };
  const sub = { fontSize: 14 };
  return (
    <div style={wrap}>
      {icon ? <div style={{ ...ic, display: "flex", justifyContent: "center" }}><Icon name={icon} size={30} color="var(--r-fg-5)" /></div> : null}
      <div style={t}>{title}</div>
      {subtitle && <div style={sub}>{subtitle}</div>}
    </div>
  );
}
export function Spinner({ size = 22 }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="pulse-loader"
      style={{ width: size, height: size }}
    />
  );
}
export function Toast({ message, type = "info", onClose, duration = 5000 }) {
  // Dismiss itself.
  //
  // It used to wait for a click and nothing else, so a "file saved" note sat
  // over the page indefinitely — the one kind of message nobody needs to
  // acknowledge was the one that demanded acknowledgement. Clicking still
  // works; the timer restarts whenever the message changes, so a second toast
  // gets its own full life rather than inheriting the tail of the first.
  useEffect(() => {
    if (!message || !onClose || duration === 0) return undefined;
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [message, duration, onClose]);

  if (!message) return null;
  const colors = {
    info: tokens.primary,
    success: tokens.success,
    error: tokens.danger,
  };
  const s = {
    position: "fixed",
    bottom: 24,
    left: "50%",
    transform: "translateX(-50%)",
    // Was `background: tokens.text` with white text on top. tokens.text is
    // var(--fg-1) — the strongest INK, which is near-black in light mode and
    // near-WHITE in dark mode. So in dark mode this painted white text on a
    // white panel and the message was invisible. A toast is a surface, so it
    // is painted with surface tokens like every other surface.
    background: "var(--bg-surface)",
    color: "var(--fg-1)",
    border: "1px solid var(--border)",
    padding: "12px 18px",
    borderRadius: tokens.radiusSm,
    boxShadow: tokens.shadowLg,
    zIndex: 1000,
    fontSize: 14,
    fontWeight: 500,
    borderLeft: "4px solid " + colors[type],
    cursor: "pointer",
    maxWidth: 420,
  };
  return (
    <div onClick={onClose} style={s} role="status">
      {message}
    </div>
  );
}
export function Modal({ open, title, onClose, children, footer, width = 480 }) {
  if (!open) return null;
  const overlay = {
    position: "fixed",
    inset: 0,
    background: "rgba(17,24,39,.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
    padding: 16,
  };
  const box = {
    background: "var(--bg-surface)",
    borderRadius: tokens.radius,
    boxShadow: tokens.shadowLg,
    width: "100%",
    maxWidth: width,
    maxHeight: "90vh",
    overflow: "auto",
  };
  const head = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: tokens.border,
    fontWeight: 700,
    fontSize: 16,
  };
  const close = { cursor: "pointer", color: tokens.sub, fontSize: 18 };
  const body = { padding: 20 };
  const foot = {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    padding: "14px 20px",
    borderTop: tokens.border,
  };
  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={box}>
        <div style={head}>
          <span>{title}</span>
          <span onClick={onClose} style={close}>
            ✕
          </span>
        </div>
        <div style={body}>{children}</div>
        {footer && <div style={foot}>{footer}</div>}
      </div>
    </div>
  );
}
export function grid(min = 220) {
  return {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(" + min + "px, 1fr))",
    gap: 14,
  };
}
export function timeAgo(date) {
  if (!date) return "";
  const d = new Date(date);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return d.toLocaleDateString();
}
export function fmtTime(date) {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
// ─── PhotoCapture ─────────────────────────────────────────────────────────────
// A guard-friendly photo field. On phones/tablets it opens the rear camera
// directly (capture="environment"); on desktop it opens the file picker.
// The image is downscaled + re-encoded client-side, then uploaded to
// /api/visitor/upload-photo, which returns a hosted path URL. No URL pasting.
export function PhotoCapture({
  value,
  onChange,
  label = "Visitor photo",
  hint = "Tap to snap with the gate camera, or pick a photo",
  required,
  disabled,
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const pick = () => {
    if (disabled || uploading) return;
    setError("");
    if (inputRef.current) {
      inputRef.current.value = ""; // allow re-selecting the same file
      inputRef.current.click();
    }
  };
  async function compress(file) {
    // Downscale to max 900px on the long edge and re-encode as JPEG (~0.8) so
    // uploads stay small on weak gate Wi-Fi. Falls back to the raw file if the
    // browser can't process it.
    try {
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(file);
      });
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = dataUrl;
      });
      const MAX = 900;
      let width = img.width;
      let height = img.height;
      if (width > MAX || height > MAX) {
        if (width >= height) {
          height = Math.round((height * MAX) / width);
          width = MAX;
        } else {
          width = Math.round((width * MAX) / height);
          height = MAX;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      const blob = await new Promise((res) =>
        canvas.toBlob(res, "image/jpeg", 0.8),
      );
      if (!blob) return file;
      return new File([blob], "visitor.jpg", { type: "image/jpeg" });
    } catch {
      return file;
    }
  }
  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type || !file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const compact = await compress(file);
      const fd = new FormData();
      fd.append("file", compact);
      const res = await fetch("/api/visitor/upload-photo", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed");
      onChange(data.url);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  const hiddenInput = { display: "none" };
  const previewRow = { display: "flex", alignItems: "center", gap: 14 };
  const previewActions = { display: "flex", gap: 8 };
  const dropBtn = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    flexDirection: "column",
    padding: "22px 16px",
    borderRadius: tokens.radiusSm,
    border: `1.5px dashed ${disabled ? "var(--border)" : "var(--border-strong)"}`,
    background: disabled ? "var(--bg-sunken)" : "var(--bg-canvas)",
    color: tokens.text,
    cursor: disabled || uploading ? "not-allowed" : "pointer",
    transition: "border-color .15s ease, background .15s ease",
  };
  const dropInner = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 4,
  };
  const camIcon = { fontSize: 26, lineHeight: 1 };
  const dropText = { fontWeight: 600, fontSize: 14 };
  const dropSub = { fontSize: 12, color: tokens.sub };
  const errStyle = { marginTop: 8, fontSize: 12.5, color: tokens.danger };
  const busyRow = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    color: tokens.sub,
  };
  return (
    <Field label={label} hint={hint} required={required}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={hiddenInput}
      />
      {value ? (
        <div style={previewRow}>
          <Avatar src={value} name="" size={64} />
          <div style={previewActions}>
            <Button
              type="button"
              variant="subtle"
              size="sm"
              onClick={pick}
              disabled={disabled || uploading}
            >
              {uploading ? "Uploading\u2026" : "Retake"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange("")}
              disabled={disabled || uploading}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          disabled={disabled || uploading}
          style={dropBtn}
        >
          {uploading ? (
            <span style={busyRow}>
              <Spinner size={18} /> Uploading&hellip;
            </span>
          ) : (
            <span style={dropInner}>
              <span style={camIcon}>{"\ud83d\udcf7"}</span>
              <span style={dropText}>Take or upload photo</span>
              <span style={dropSub}>
                Opens the camera on phones &amp; tablets
              </span>
            </span>
          )}
        </button>
      )}
      {error ? <div style={errStyle}>{error}</div> : null}
    </Field>
  );
}
// ─── ZoomableAvatar ──────────────────────────────────────────────────────────
// An Avatar that opens a full-screen lightbox when tapped (if it has a photo).
// Tap the image, the backdrop, or the × to close.
export function ZoomableAvatar({ src, name, size = 44 }) {
  const [open, setOpen] = useState(false);
  if (!src) return <Avatar src={src} name={name} size={size} />;
  const trigger = {
    cursor: "zoom-in",
    display: "inline-flex",
    border: "none",
    background: "transparent",
    padding: 0,
  };
  const overlay = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.82)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 1000,
    cursor: "zoom-out",
  };
  const bigImg = {
    maxWidth: "92vw",
    maxHeight: "86vh",
    objectFit: "contain",
    borderRadius: 12,
    boxShadow: tokens.shadowLg,
    cursor: "default",
  };
  const closeBtn = {
    position: "fixed",
    top: 14,
    right: 18,
    width: 40,
    height: 40,
    borderRadius: 999,
    fontSize: 24,
    lineHeight: "38px",
    textAlign: "center",
    color: "#fff",
    background: "rgba(255,255,255,.15)",
    border: "none",
    cursor: "pointer",
    zIndex: 1001,
  };
  const caption = {
    position: "fixed",
    bottom: 18,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "#fff",
    fontSize: 14,
  };
  return (
    <>
      <button
        type="button"
        style={trigger}
        onClick={() => setOpen(true)}
        title="Tap to zoom"
        aria-label="Zoom photo"
      >
        <Avatar src={src} name={name} size={size} />
      </button>
      {open ? (
        <div
          style={overlay}
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            style={closeBtn}
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            &times;
          </button>
          <img
            src={src}
            alt={name || ""}
            style={bigImg}
            onClick={(e) => e.stopPropagation()}
          />
          {name ? <div style={caption}>{name}</div> : null}
        </div>
      ) : null}
    </>
  );
}
