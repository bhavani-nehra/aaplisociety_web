"use client";

/**
 * Bank Accounts & Reconciliation. BankAccountService + BankReconciliationService
 * already had the full match/suggest/confirm/undo logic and statement import
 * (Excel) — this is their first admin page. See accounting-system-ARD.md §6.4.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import notify from "@/lib/notify";
import FirstRunHint from "@/components/accounting/FirstRunHint";

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function PageClient() {
  const [bankAccounts, setBankAccounts] = useState([]);
  const [coa, setCoa] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ bankName: "", accountNumber: "", ifscCode: "", branch: "", linkedAccountId: "" });
  // §7.18 progressive disclosure — the two optional fields stay hidden until asked for.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selected, setSelected] = useState(null); // bankAccount

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const [bRes, aRes] = await Promise.all([
        fetch("/api/accounting/bank-accounts", { credentials: "include", signal }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include", signal }),
      ]);
      const bJson = await bRes.json().catch(() => ({}));
      if (!bRes.ok) throw new Error(bJson.error || "Could not load bank accounts");
      const aJson = await aRes.json().catch(() => ({}));
      setBankAccounts(bJson.bankAccounts || []);
      setCoa(aJson.accounts || []);
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

  const bankTypeAccounts = coa.filter((a) => a.subType === "Bank" && a.isActive !== false);

  const createBankAccount = async () => {
    if (!draft.bankName.trim() || !draft.accountNumber.trim() || !draft.linkedAccountId) {
      notify.error("Bank name, account number and linked account are required");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/accounting/bank-accounts", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add the bank account");
      notify.success(`"${json.bankAccount.bankName}" added`);
      setDraft({ bankName: "", accountNumber: "", ifscCode: "", branch: "", linkedAccountId: "" });
      setShowCreate(false);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  // No own <main>/<h1>/back-link — this now renders directly on Cash Flow
  // Setup (app/admin/accounting/cash-flow/PageClient.js), which already
  // carries the page title.
  return (
    <div>
      {loading ? (
        <p style={MUTED}>Loading…</p>
      ) : error ? (
        <p style={{ ...MUTED, color: "var(--danger, #b91c1c)" }}>{error}</p>
      ) : (
        <>
          <button type="button" onClick={() => setShowCreate((v) => !v)} style={{ ...SECONDARY, marginTop: 18 }}>
            {showCreate ? "Never mind" : "+ Add a bank account"}
          </button>

          {showCreate ? (
            <section style={CARD}>
              <h2 style={H2}>Add a bank account</h2>
              <div style={GRID2}>
                <Field label="Bank name"><input value={draft.bankName} onChange={(e) => setDraft((d) => ({ ...d, bankName: e.target.value }))} style={INPUT} /></Field>
                <Field label="Account number"><input value={draft.accountNumber} onChange={(e) => setDraft((d) => ({ ...d, accountNumber: e.target.value }))} style={INPUT} /></Field>
                <Field label="Linked account (must be Bank subtype)">
                  <select value={draft.linkedAccountId} onChange={(e) => setDraft((d) => ({ ...d, linkedAccountId: e.target.value }))} style={INPUT}>
                    <option value="">Choose…</option>
                    {bankTypeAccounts.map((a) => <option key={a._id} value={a._id}>{a.code} — {a.name}</option>)}
                  </select>
                </Field>
              </div>
              <button type="button" onClick={() => setShowAdvanced((v) => !v)} style={{ ...MUTED, background: "none", border: "none", cursor: "pointer", marginTop: 10, padding: 0, textDecoration: "underline" }}>
                {showAdvanced ? "Hide advanced details" : "Advanced accounting details"}
              </button>
              {showAdvanced ? (
                <div style={GRID2}>
                  <Field label="IFSC (optional)"><input value={draft.ifscCode} onChange={(e) => setDraft((d) => ({ ...d, ifscCode: e.target.value }))} style={INPUT} /></Field>
                  <Field label="Branch (optional)"><input value={draft.branch} onChange={(e) => setDraft((d) => ({ ...d, branch: e.target.value }))} style={INPUT} /></Field>
                </div>
              ) : null}
              <button type="button" disabled={creating} onClick={createBankAccount} style={{ ...PRIMARY, marginTop: 14 }}>{creating ? "Adding…" : "Add"}</button>
            </section>
          ) : null}

          <section style={{ marginTop: 18 }}>
            {bankAccounts.length === 0 ? (
              <div style={{ padding: "28px 20px", textAlign: "center", maxWidth: 460, margin: "0 auto" }}>
                <p style={{ ...MUTED, fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>No bank accounts yet</p>
                <p style={{ ...MUTED, marginTop: 6, lineHeight: 1.6 }}>
                  Add the society&apos;s bank account here to start reconciling —
                  matching your bank statement against the books, line by line.
                </p>
                <button type="button" onClick={() => setShowCreate(true)} style={{ ...PRIMARY, marginTop: 12 }}>Add Bank Account</button>
              </div>
            ) : (
              // Card grid — same adoption as Funds/Liabilities, from the
              // Pulse design-kit import.
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                {bankAccounts.map((b) => (
                  <button
                    type="button"
                    key={b._id}
                    onClick={() => setSelected(selected?._id === b._id ? null : b)}
                    style={{
                      textAlign: "left", cursor: "pointer", border: "1px solid " + (selected?._id === b._id ? "var(--accent)" : "var(--border)"),
                      borderRadius: 12, padding: 16, background: "var(--bg-surface)", fontFamily: "inherit",
                    }}
                  >
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{b.bankName}</div>
                    <div style={{ fontSize: 12.5, color: "var(--fg-4)", marginTop: 2 }}>{b.accountNumber} {b.branch ? `· ${b.branch}` : ""}</div>
                    <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 10, fontWeight: 600 }}>{selected?._id === b._id ? "Hide ▲" : "Reconcile ▼"}</div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {selected ? <ReconcilePanel bankAccount={selected} onChanged={load} /> : null}
        </>
      )}
    </div>
  );
}

function ReconcilePanel({ bankAccount, onChanged }) {
  const [summary, setSummary] = useState(null);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [acting, setActing] = useState(null); // matchId being confirmed/undone
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkPreview, setBulkPreview] = useState(false); // §7.19/§7.21: bulk confirm gets its own Preview → Confirm, not a silent loop
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, mRes] = await Promise.all([
        fetch(`/api/accounting/bank-accounts/${bankAccount._id}/reconciliation`, { credentials: "include" }),
        fetch(`/api/accounting/bank-accounts/${bankAccount._id}/reconciliation/matches?status=Pending`, { credentials: "include" }),
      ]);
      const sJson = await sRes.json().catch(() => ({}));
      const mJson = await mRes.json().catch(() => ({}));
      setSummary(sJson.summary || null);
      setPending(mJson.matches || []);
    } catch (e) {
      notify.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [bankAccount._id]);

  useEffect(() => { load(); }, [load]);

  const uploadStatement = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/accounting/bank-accounts/${bankAccount._id}/statement`, {
        method: "POST", credentials: "include", body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not import the statement");
      notify.success(`Imported ${json.imported ?? json.lines?.length ?? "the"} statement lines.`);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const res = await fetch(`/api/accounting/bank-accounts/${bankAccount._id}/reconciliation/suggest`, { method: "POST", credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not suggest matches");
      notify.success(`${json.suggested} match(es) suggested.`);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setSuggesting(false);
    }
  };

  const confirm = async (matchId) => {
    setActing(matchId);
    try {
      const res = await fetch(`/api/accounting/reconciliation-matches/${matchId}/confirm`, { method: "POST", credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not confirm");
      notify.success("Match confirmed.");
      await load();
      onChanged?.();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setActing(null);
    }
  };

  const confirmAllPending = async () => {
    setBulkConfirming(true);
    try {
      for (const m of pending) {
        const res = await fetch(`/api/accounting/reconciliation-matches/${m._id}/confirm`, { method: "POST", credentials: "include" });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error || `Could not confirm one match — stopped after some succeeded, reload to see where it got to.`);
        }
      }
      notify.success(`${pending.length} match(es) confirmed.`);
      setBulkPreview(false);
      await load();
      onChanged?.();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setBulkConfirming(false);
    }
  };

  const undo = async (matchId) => {
    setActing(matchId);
    try {
      const res = await fetch(`/api/accounting/reconciliation-matches/${matchId}`, { method: "DELETE", credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not undo");
      notify.success("Match undone.");
      await load();
      onChanged?.();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setActing(null);
    }
  };

  return (
    <section style={CARD}>
      <h2 style={H2}>{bankAccount.bankName} — reconciliation</h2>

      <FirstRunHint
        featureKey="bank-reconciliation"
        title="Bank Reconciliation"
        body="We'll compare your bank statement against the books and suggest matches — you confirm each one, or all at once."
        meta="3 steps · Import statement → Suggest matches → Confirm"
      />

      {loading ? (
        <p style={MUTED}>Loading…</p>
      ) : summary ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 14 }}>
            <Stat label="Ledger balance" value={fmtINR(summary.ledgerBalance)} />
            <Stat label="Statement balance" value={fmtINR(summary.statementBalance)} />
            <Stat label="Difference" value={fmtINR(summary.difference)} tone={summary.isReconciled ? "ok" : "bad"} />
            <Stat label="Unmatched (statement)" value={summary.unmatchedStatementCount} />
            <Stat label="Unmatched (ledger)" value={summary.unmatchedJournalCount} />
          </div>
          <span style={{ ...PILL, background: summary.isReconciled ? "#dcfce7" : "#fef3c7", color: summary.isReconciled ? "#166534" : "#92400e" }}>
            {summary.isReconciled ? "Reconciled" : "Not reconciled"}
          </span>
        </>
      ) : null}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
        <label style={{ ...SECONDARY, display: "inline-block" }}>
          {uploading ? "Importing…" : "Import statement (.xlsx)"}
          <input ref={fileRef} type="file" accept=".xlsx" disabled={uploading} onChange={(e) => uploadStatement(e.target.files?.[0])} style={{ display: "none" }} />
        </label>
        <a href={`/api/accounting/bank-accounts/${bankAccount._id}/statement/template`} style={{ fontSize: 12.5, color: "var(--accent)" }}>Download import template</a>
        <button type="button" disabled={suggesting} onClick={suggest} style={SECONDARY}>{suggesting ? "Suggesting…" : "Suggest matches"}</button>
      </div>

      {pending.length ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-3)" }}>{pending.length} suggested match{pending.length === 1 ? "" : "es"} awaiting confirmation</div>
            {pending.length > 1 ? (
              <button type="button" style={SECONDARY} onClick={() => setBulkPreview(true)}>Confirm all {pending.length}</button>
            ) : null}
          </div>
          {bulkPreview ? (
            <div style={{ ...ROW, cursor: "default", flexDirection: "column", alignItems: "stretch", marginBottom: 8 }}>
              <div style={{ fontSize: 12.5, color: "var(--fg-2)" }}>
                This confirms all {pending.length} suggested matches at once — each becomes a real reconciled match, same as confirming them one by one.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" style={SECONDARY} disabled={bulkConfirming} onClick={() => setBulkPreview(false)}>Cancel</button>
                <button type="button" style={SMALLBTN} disabled={bulkConfirming} onClick={confirmAllPending}>{bulkConfirming ? "Confirming…" : "Confirm all"}</button>
              </div>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 8 }}>
            {pending.map((m) => (
              <div key={m._id} style={{ ...ROW, cursor: "default" }}>
                <div style={{ minWidth: 0, flex: 1, fontSize: 12.5 }}>
                  <div>{m.statementLine ? `${new Date(m.statementLine.date).toLocaleDateString("en-IN")} · ${m.statementLine.description || "—"} · ${fmtINR(m.statementLine.amount)}` : "—"}</div>
                  <div style={{ color: "var(--fg-4)", marginTop: 2 }}>↔ {m.journalLine ? `${m.journalLine.narration || "—"} · ${fmtINR(m.journalLine.amount)}` : "—"}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" disabled={acting === m._id} style={SMALLBTN} onClick={() => confirm(m._id)}>Confirm</button>
                  <button type="button" disabled={acting === m._id} style={SMALLBTN} onClick={() => undo(m._id)}>Undo</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg-subtle, #f8fafc)", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, color: "var(--fg-5)" }}>{label}</div>
      <div className="revamp-num" style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: tone === "bad" ? "var(--danger, #b91c1c)" : tone === "ok" ? "#166534" : "var(--fg-1)" }}>{value}</div>
    </div>
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
const H2 = { margin: "0 0 12px", fontSize: 15, fontWeight: 700 };
const MUTED = { margin: "12px 0 0", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.6 };
const GRID2 = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const ROW = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "13px 15px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-surface)" };
const INPUT = { width: "100%", padding: "8px 11px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))", color: "var(--fg-2)", outline: "none", fontFamily: "inherit" };
const PRIMARY = { padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--on-solid)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const SECONDARY = { padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-2)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const SMALLBTN = { padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-2)", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const PILL = { display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, flexShrink: 0 };
