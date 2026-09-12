"use client";
/**
 * HelpButton — fixed-position (bottom-right) trigger for HelpPanel. One
 * instance per shell, always visible, mounted by DashboardLayout.js.
 * See docs/ux-overhaul/2026-09-01-contextual-help-design.md.
 */
import { useState } from "react";
import { Icon } from "@/components/revamp";
import HelpPanel from "./HelpPanel";

export default function HelpButton({ role }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Help"
        title="Help"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 150,
          width: 48, height: 48, borderRadius: 999, border: "none",
          background: "var(--r-brand)", color: "var(--r-brand-ink)",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", boxShadow: "var(--r-shadow-pop)",
        }}
      >
        <Icon name="help-circle" size={22} color="var(--r-brand-ink)" />
      </button>
      <HelpPanel open={open} onClose={() => setOpen(false)} role={role} />
    </>
  );
}
