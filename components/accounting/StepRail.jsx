"use client";
/**
 * <StepRail> — the 6-page cross-linking guide requested for the accounting
 * revamp: "every page must be aware of steps if missed one step before the
 * curr then guide or highlight and a btn to redirect." Ported from the
 * design import's StepGuideBanner (AapliSociety_Design_System/ui_kits/
 * revamp/AccountingShared.jsx) but wired to REAL data — /api/accounting/
 * setup-state, the same endpoint the old Overview checklist and every
 * setup-state consumer in this app already reads. No mock state.
 *
 * The 6 pages, in the order they were specified:
 *   Configuration → Account Heads → Assets & Liabilities →
 *   Cash Flow Setup → Balance Sheet Format → Generate Balance Sheet
 *
 * Two of the six (Assets & Liabilities, Cash Flow Setup) aren't part of the
 * one-time setup checklist — they're ongoing registers, not prerequisites —
 * so they carry no blocking check here; they're always reachable, same as
 * the real Overview never blocked "Funds" or "Bank Accounts" behind a step.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/revamp";

export const STEP_RAIL_PAGES = [
  { key: "configuration", label: "Configuration", icon: "settings", href: "/admin/accounting", checkKey: "financialYear" },
  { key: "heads", label: "Account Heads", icon: "book-open", href: "/admin/accounting/chart-of-accounts", checkKey: "chartOfAccounts" },
  { key: "assets", label: "Assets & Liabilities", icon: "wallet", href: "/admin/accounting/registers", checkKey: null },
  { key: "cashflow", label: "Cash Flow Setup", icon: "banknote", href: "/admin/accounting/cash-flow", checkKey: null },
  { key: "format", label: "Balance Sheet Format", icon: "layers", href: "/admin/accounting/format", checkKey: "schedules" },
  { key: "generate", label: "Generate Balance Sheet", icon: "zap", href: "/admin/accounting/statements", checkKey: null },
];

export default function StepRail({ currentKey }) {
  const router = useRouter();
  const [steps, setSteps] = useState(null); // raw setup-state steps, or null while loading

  useEffect(() => {
    let alive = true;
    fetch("/api/accounting/setup-state", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setSteps(d?.steps || []); })
      .catch(() => { if (alive) setSteps([]); });
    return () => { alive = false; };
  }, []);

  const isDone = (page) => {
    if (!page.checkKey) return true; // ongoing register, not a blocking prerequisite
    if (!steps) return true; // still loading — don't flash a false "incomplete"
    const s = steps.find((x) => x.key === page.checkKey);
    return s ? s.status === "done" : true;
  };

  const currentIdx = STEP_RAIL_PAGES.findIndex((p) => p.key === currentKey);
  let blocker = null;
  for (let i = 0; i < currentIdx; i++) {
    if (!isDone(STEP_RAIL_PAGES[i])) { blocker = STEP_RAIL_PAGES[i]; break; }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 6 }}>
        {STEP_RAIL_PAGES.map((p) => {
          const done = isDone(p);
          const active = p.key === currentKey;
          return (
            <button
              key={p.key}
              type="button"
              title={p.label}
              onClick={() => router.push(p.href)}
              style={{
                width: 30, height: 30, borderRadius: 8, cursor: "pointer", padding: 0,
                border: "1px solid " + (active ? "var(--r-brand)" : "var(--r-hairline)"),
                background: active ? "var(--r-brand-soft, var(--r-surface-2))" : done ? "var(--r-success-soft, var(--r-surface-2))" : "var(--r-surface)",
                color: active ? "var(--r-brand)" : done ? "var(--r-success)" : "var(--r-fg-4)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Icon name={p.icon} size={14} />
            </button>
          );
        })}
      </div>
      {blocker ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 260,
          background: "var(--r-warning-bg, #fff8e6)", border: "1px solid var(--r-warning, #f0c36d)",
          borderRadius: 10, padding: "7px 8px 7px 12px",
        }}>
          <Icon name="alert-triangle" size={15} color="var(--r-warning)" />
          <span style={{ fontSize: 12.5, color: "var(--r-fg-2)", flex: 1 }}>
            <strong>{blocker.label}</strong> isn&apos;t finished yet — do that first, then come back here.
          </span>
          <button
            type="button"
            onClick={() => router.push(blocker.href)}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7, fontSize: 12, fontWeight: 600,
              background: "var(--r-brand)", color: "var(--r-brand-ink)", border: "1px solid var(--r-brand)", cursor: "pointer",
            }}
          >
            Go there
          </button>
        </div>
      ) : steps && currentIdx !== -1 ? (
        <span style={{ fontSize: 12, color: "var(--r-success)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Icon name="check-circle" size={13} /> Every step before this one is complete.
        </span>
      ) : null}
    </div>
  );
}
