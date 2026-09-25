"use client";

/**
 * Fiscal Configuration — "the ERP's accounting control center" per
 * FiscalConfigService's own comment. Exposes the settings that actually
 * change behaviour elsewhere day to day: voucher number prefixes, the
 * default account mappings postings resolve against, and the rules the
 * Financial Years lock/unlock checklist checks. A few rarer nested settings
 * (health-score weights, custom schedule maps, depreciation/interest/
 * rounding policy) are left for a later pass — not needed to make this page
 * real and useful today.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import notify from "@/lib/notify";

const MAPPING_FIELDS = [
  { key: "maintenanceIncomeAccountId", label: "Maintenance income account" },
  { key: "interestIncomeAccountId", label: "Interest income account" },
  { key: "cashAccountId", label: "Cash account" },
  { key: "defaultBankAccountId", label: "Default bank account" },
  { key: "memberReceivableAccountId", label: "Member receivable account" },
  { key: "roundOffAccountId", label: "Round-off account" },
  { key: "memberAdvanceAccountId", label: "Member advance (overpayment) account" },
];

export default function PageClient() {
  const [config, setConfig] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, aRes] = await Promise.all([
        fetch("/api/accounting/fiscal-config", { credentials: "include", signal }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include", signal }),
      ]);
      const cJson = await cRes.json().catch(() => ({}));
      if (!cRes.ok) throw new Error(cJson.error || "Could not load fiscal configuration");
      const aJson = await aRes.json().catch(() => ({}));
      setConfig(cJson.accountingConfig);
      setAccounts(aJson.accounts || []);
    } catch (e) {
      if (e?.name !== "AbortError") setError(e.message);
    } finally {
      // A StrictMode double-mount (dev only) aborts the first of two calls to
      // this load() — without this guard its `finally` still clears loading
      // right away, flashing the empty state before the second, real fetch
      // resolves seconds later.
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const set = (path, value) => {
    setConfig((c) => {
      const next = structuredClone(c);
      let obj = next;
      for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
      obj[path[path.length - 1]] = value;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/accounting/fiscal-config", {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voucherPrefixes: config.voucherPrefixes,
          voucherNumberPadding: config.voucherNumberPadding,
          defaultAccountMappings: config.defaultAccountMappings,
          financialYearDefaults: config.financialYearDefaults,
          financialClosingRules: config.financialClosingRules,
          documentLockingRules: config.documentLockingRules,
          taxConfig: config.taxConfig,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not save");
      notify.success("Fiscal configuration saved.");
      setConfig(json.accountingConfig);
    } catch (e) {
      notify.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "24px 20px 56px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Fiscal Configuration</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--fg-4)" }}>
            The accounts and rules the rest of accounting quietly relies on. A wrong mapping here misdirects every posting that uses it.
          </p>
        </div>
        <Link href="/admin/accounting" style={{ fontSize: 13, color: "var(--accent)", flexShrink: 0 }}>← Accounting</Link>
      </div>

      {loading ? (
        <p style={MUTED}>Loading…</p>
      ) : error ? (
        <p style={{ ...MUTED, color: "var(--danger, #b91c1c)" }}>{error}</p>
      ) : config ? (
        <>
          <section style={CARD}>
            <h2 style={H2}>Voucher number prefixes</h2>
            <div style={GRID2}>
              {Object.entries(config.voucherPrefixes).map(([type, prefix]) => (
                <Field key={type} label={type}>
                  <input value={prefix} onChange={(e) => set(["voucherPrefixes", type], e.target.value)} style={INPUT} />
                </Field>
              ))}
            </div>
          </section>

          <section style={CARD}>
            <h2 style={H2}>Default account mappings</h2>
            <p style={{ ...MUTED, margin: "0 0 10px" }}>Used automatically wherever a posting rule needs one of these without you naming it each time.</p>
            <div style={GRID2}>
              {MAPPING_FIELDS.map((f) => (
                <Field key={f.key} label={f.label}>
                  <select value={config.defaultAccountMappings[f.key] || ""} onChange={(e) => set(["defaultAccountMappings", f.key], e.target.value || null)} style={INPUT}>
                    <option value="">Not set</option>
                    {accounts.map((a) => <option key={a._id} value={a._id}>{a.code} — {a.name}</option>)}
                  </select>
                </Field>
              ))}
            </div>
          </section>

          <section style={CARD}>
            <h2 style={H2}>Financial closing rules</h2>
            <p style={{ ...MUTED, margin: "0 0 10px" }}>What the year-lock checklist on the Financial Years page requires before Approved → Locked.</p>
            <Toggle label="Require Trial Balance to be balanced" checked={config.financialClosingRules.requireTrialBalanceMatch} onChange={(v) => set(["financialClosingRules", "requireTrialBalanceMatch"], v)} />
            <Toggle label="Require all depreciation posted" checked={config.financialClosingRules.requireAllDepreciationPosted} onChange={(v) => set(["financialClosingRules", "requireAllDepreciationPosted"], v)} />
            <Toggle label="Require bank reconciliation complete" checked={config.financialClosingRules.requireReconciliationComplete} onChange={(v) => set(["financialClosingRules", "requireReconciliationComplete"], v)} />
          </section>

          <section style={CARD}>
            <h2 style={H2}>Document locking</h2>
            <Toggle label="Lock a voucher once approved" checked={config.documentLockingRules.lockVouchersAfterApproval} onChange={(v) => set(["documentLockingRules", "lockVouchersAfterApproval"], v)} />
            <Toggle label="Allow backdated entries while the year is still Draft" checked={config.documentLockingRules.allowBackdatedEntriesInDraftFY} onChange={(v) => set(["documentLockingRules", "allowBackdatedEntriesInDraftFY"], v)} />
          </section>

          <section style={CARD}>
            <h2 style={H2}>Financial year defaults</h2>
            <div style={GRID2}>
              <Field label="Start month (0=Jan … 3=April)"><input type="number" min="0" max="11" value={config.financialYearDefaults.startMonth} onChange={(e) => set(["financialYearDefaults", "startMonth"], Number(e.target.value))} style={INPUT} /></Field>
              <Field label="Lock after N days (0 = no auto-lock)"><input type="number" min="0" value={config.financialYearDefaults.lockAfterDays} onChange={(e) => set(["financialYearDefaults", "lockAfterDays"], Number(e.target.value))} style={INPUT} /></Field>
            </div>
          </section>

          <section style={CARD}>
            <h2 style={H2}>Tax</h2>
            <Toggle label="GST enabled" checked={config.taxConfig.gstEnabled} onChange={(v) => set(["taxConfig", "gstEnabled"], v)} />
            <Toggle label="TDS enabled" checked={config.taxConfig.tdsEnabled} onChange={(v) => set(["taxConfig", "tdsEnabled"], v)} />
          </section>

          <button type="button" disabled={saving} onClick={save} style={{ ...PRIMARY, marginTop: 4 }}>{saving ? "Saving…" : "Save changes"}</button>
        </>
      ) : null}
    </main>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{label}</span>
    </label>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

const CARD = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginTop: 14 };
const H2 = { margin: "0 0 4px", fontSize: 15, fontWeight: 700 };
const MUTED = { margin: "12px 0 0", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.6 };
const GRID2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 };
const INPUT = { width: "100%", padding: "8px 11px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))", color: "var(--fg-2)", outline: "none", fontFamily: "inherit" };
const PRIMARY = { padding: "10px 18px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--on-solid)", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };
