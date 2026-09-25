"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "./Icon";

const toneColors = {
  success: { fg: "var(--success-fg)", bg: "var(--success-bg)" },
  warning: { fg: "var(--warning-fg)", bg: "var(--warning-bg)" },
  danger: { fg: "var(--danger-fg)", bg: "var(--danger-bg)" },
  info: { fg: "var(--info-fg)", bg: "var(--info-bg)" },
};

/** One expandable health-check row: label + Passed/Failed badge, expands to reason + fix + jump-to-fix link. */
export function AccordionItem({ label, passed, reason, fix, navigationTarget, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const router = useRouter();
  const tone = passed ? "success" : "danger";
  const colors = toneColors[tone];

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 0", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
      >
        <span style={{ width: 26, height: 26, borderRadius: 7, background: colors.bg, color: colors.fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icon name={passed ? "check-circle" : "alert-triangle"} size={14} />
        </span>
        <span style={{ flex: 1, fontSize: 13.5, color: "var(--fg-3)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: colors.fg, background: colors.bg, borderRadius: 999, padding: "3px 10px" }}>
          {passed ? "Passed" : "Failed"}
        </span>
        <span style={{ color: "var(--fg-5)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "flex" }}>▸</span>
      </button>
      {open && (
        <div style={{ padding: "0 0 14px 38px", fontSize: 12.5, color: "var(--fg-3)" }}>
          {reason && <div style={{ marginBottom: fix ? 8 : 0 }}>{reason}</div>}
          {!passed && fix && (
            <div style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: 8, padding: "8px 10px", color: "var(--warning-fg)", display: "flex", flexDirection: "column", gap: 8 }}>
              <span><strong>How to fix:</strong> {fix}</span>
              {navigationTarget && (
                <button
                  onClick={() => router.push(navigationTarget)}
                  style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 6, background: "var(--primary)", border: "none", borderRadius: 7, padding: "5px 12px", fontSize: 12, fontWeight: 600, color: "var(--on-solid)", cursor: "pointer", fontFamily: "inherit" }}
                >
                  Go fix it
                </button>
              )}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
