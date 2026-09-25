"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

// Right-side slide-over. The list stays mounted and visible behind a dimmed
// backdrop instead of navigating away or replacing the page with a form —
// closing the drawer (Escape, backdrop click, or the X) always returns to
// exactly the scroll position and filter state the list was in.
//
// Portaled to document.body: DashboardLayout.js wraps every page in
// .contentFrame, which sets backdrop-filter — a CSS containing block for
// position:fixed descendants — so rendered inline this drawer was fixed to
// that scrolled content box, not the real viewport.
export default function Drawer({ open, onClose, title, sub, right, children, footer, width = 560 }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(10,10,15,0.32)",
          animation: "cx-fade 0.15s ease-out",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: `min(${width}px, 100vw)`,
          background: "var(--cx-canvas)",
          borderLeft: "1px solid var(--cx-border)",
          boxShadow: "var(--cx-shadow-pop)",
          display: "flex",
          flexDirection: "column",
          animation: "cx-drawer-in 0.2s ease-out",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            padding: "16px 18px",
            borderBottom: "1px solid var(--cx-border)",
            background: "var(--cx-surface)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cx-fg-1)" }}>{title}</div>
            {sub && <div style={{ fontSize: 12, color: "var(--cx-fg-4)", marginTop: 2 }}>{sub}</div>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            {right}
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 30,
                height: 30,
                borderRadius: 8,
                border: "1px solid var(--cx-border)",
                background: "var(--cx-surface)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "var(--cx-fg-3)",
              }}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 18 }}>{children}</div>

        {footer && (
          <div
            style={{
              padding: "12px 18px",
              borderTop: "1px solid var(--cx-border)",
              background: "var(--cx-surface)",
              display: "flex",
              gap: 8,
              justifyContent: "space-between",
            }}
          >
            {footer}
          </div>
        )}
      </div>
      <style jsx>{`
        @keyframes cx-drawer-in {
          from {
            transform: translateX(24px);
            opacity: 0.6;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
