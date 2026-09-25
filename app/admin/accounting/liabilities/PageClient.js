"use client";

/**
 * Liabilities — outstanding vendors, loans, deposits, advance collections,
 * statutory taxes. LiabilityService already had full incur/pay logic (each
 * posts a real journal entry) — this is its first admin page. See
 * accounting-system-ARD.md §3, §8.
 */

import { useCallback, useEffect, useState } from "react";
import notify from "@/lib/notify";
import AccountLedgerInline from "@/components/accounting/AccountLedgerInline";

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const TYPES = ["VendorPayable", "Loan", "Deposit", "AdvanceCollection", "StatutoryTax", "Other"];

export default function PageClient() {
  const [liabilities, setLiabilities] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState("Open");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    liabilityCode: "", name: "", type: "VendorPayable", description: "",
    incurredDate: "", principalAmount: "", interestRate: "", dueDate: "",
    linkedLiabilityAccountId: "", contraAccountId: "", narration: "",
  });
  // §7.18 progressive disclosure — code/dates/interest/description hidden until asked for.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ledgerOpenId, setLedgerOpenId] = useState(null); // §7.22/§7.12 — view postings, reach the voucher to reverse if needed
  const [payFor, setPayFor] = useState(null);
  const [payDraft, setPayDraft] = useState({ amount: "", payingAccountId: "", date: "", note: "" });
  const [paying, setPaying] = useState(false);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const [lRes, aRes] = await Promise.all([
        fetch(`/api/accounting/liabilities${statusFilter ? `?status=${statusFilter}` : ""}`, { credentials: "include", signal }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include", signal }),
      ]);
      const lJson = await lRes.json().catch(() => ({}));
      if (!lRes.ok) throw new Error(lJson.error || "Could not load liabilities");
      const aJson = await aRes.json().catch(() => ({}));
      setLiabilities(lJson.liabilities || []);
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
  }, [statusFilter]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const liabilityAccounts = accounts.filter((a) => a.type === "Liability" && a.isActive !== false);
  const contraAccounts = accounts.filter((a) => a.isActive !== false);

  const createLiability = async () => {
    if (!draft.liabilityCode.trim() || !draft.name.trim() || !draft.linkedLiabilityAccountId || !draft.contraAccountId || !(Number(draft.principalAmount) > 0)) {
      notify.error("Code, name, both accounts and a principal amount are required");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/accounting/liabilities", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, principalAmount: Number(draft.principalAmount), interestRate: draft.interestRate ? Number(draft.interestRate) : undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not record the liability");
      notify.success(`Liability "${json.liability.name}" recorded`);
      setDraft({ liabilityCode: "", name: "", type: "VendorPayable", description: "", incurredDate: "", principalAmount: "", interestRate: "", dueDate: "", linkedLiabilityAccountId: "", contraAccountId: "", narration: "" });
      setShowCreate(false);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const runPay = async () => {
    if (!payFor || !payDraft.payingAccountId || !(Number(payDraft.amount) > 0)) {
      notify.error("Choose the paying account and an amount greater than zero");
      return;
    }
    setPaying(true);
    try {
      const res = await fetch(`/api/accounting/liabilities/${payFor._id}/pay`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payDraft, amount: Number(payDraft.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not record the payment");
      notify.success("Payment posted.");
      setPayFor(null);
      setPayDraft({ amount: "", payingAccountId: "", date: "", note: "" });
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setPaying(false);
    }
  };

  // No own <main>/<h1>/back-link — this only ever renders embedded inside
  // an Accordion section on Assets & Liabilities now; the accordion header
  // already says "Liabilities".
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginTop: 4, alignItems: "center" }}>
        <button type="button" onClick={() => setShowCreate((v) => !v)} style={SECONDARY}>{showCreate ? "Never mind" : "+ Record a liability"}</button>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...INPUT, width: "auto" }}>
          <option value="Open">Open</option>
          <option value="Closed">Closed</option>
          <option value="">All</option>
        </select>
      </div>

      {showCreate ? (
        <section style={CARD}>
          <h2 style={H2}>Record a liability</h2>
          <div style={GRID2}>
            <Field label="Name"><input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} style={INPUT} /></Field>
            <Field label="Type">
              <select value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))} style={INPUT}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Principal amount"><input type="number" value={draft.principalAmount} onChange={(e) => setDraft((d) => ({ ...d, principalAmount: e.target.value }))} style={INPUT} /></Field>
            <Field label="Liability account (must be Liability type)">
              <select value={draft.linkedLiabilityAccountId} onChange={(e) => setDraft((d) => ({ ...d, linkedLiabilityAccountId: e.target.value }))} style={INPUT}>
                <option value="">Choose…</option>
                {liabilityAccounts.map((a) => <option key={a._id} value={a._id}>{a.code} — {a.name}</option>)}
              </select>
            </Field>
            <Field label="Debited account (expense/asset/bank)">
              <select value={draft.contraAccountId} onChange={(e) => setDraft((d) => ({ ...d, contraAccountId: e.target.value }))} style={INPUT}>
                <option value="">Choose…</option>
                {contraAccounts.map((a) => <option key={a._id} value={a._id}>{a.code} — {a.name}</option>)}
              </select>
            </Field>
          </div>
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} style={{ ...MUTED, background: "none", border: "none", cursor: "pointer", marginTop: 10, padding: 0, textDecoration: "underline" }}>
            {showAdvanced ? "Hide advanced details" : "Advanced accounting details"}
          </button>
          {showAdvanced ? (
          <div style={GRID2}>
            <Field label="Code"><input value={draft.liabilityCode} onChange={(e) => setDraft((d) => ({ ...d, liabilityCode: e.target.value }))} style={INPUT} /></Field>
            <Field label="Incurred date (optional)"><input type="date" value={draft.incurredDate} onChange={(e) => setDraft((d) => ({ ...d, incurredDate: e.target.value }))} style={INPUT} /></Field>
            <Field label="Due date (optional)"><input type="date" value={draft.dueDate} onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))} style={INPUT} /></Field>
            <Field label="Interest rate % (optional)"><input type="number" value={draft.interestRate} onChange={(e) => setDraft((d) => ({ ...d, interestRate: e.target.value }))} style={INPUT} /></Field>
          </div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <Field label="Description (optional)"><input value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} style={INPUT} /></Field>
          </div>
          <button type="button" disabled={creating} onClick={createLiability} style={{ ...PRIMARY, marginTop: 14 }}>{creating ? "Recording…" : "Record & post"}</button>
        </section>
      ) : null}

      <section style={{ marginTop: 18 }}>
        {loading ? (
          <p style={MUTED}>Loading…</p>
        ) : error ? (
          <p style={{ ...MUTED, color: "var(--danger, #b91c1c)" }}>{error}</p>
        ) : liabilities.length === 0 ? (
          <div style={{ padding: "28px 20px", textAlign: "center", maxWidth: 460, margin: "0 auto" }}>
            <p style={{ ...MUTED, fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>No liabilities recorded yet</p>
            <p style={{ ...MUTED, marginTop: 6, lineHeight: 1.6 }}>
              A vendor bill not yet paid, a loan, a deposit held for someone —
              anything the society owes goes here, and posts a real entry when
              you record it.
            </p>
            <button type="button" onClick={() => setShowCreate(true)} style={{ ...PRIMARY, marginTop: 12 }}>Record a liability</button>
          </div>
        ) : (
          // Card grid instead of a full-width row list — same adoption as
          // Funds/PageClient.js, from the Pulse design-kit import.
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {liabilities.map((l) => (
              <div key={l._id} style={{ ...LIAB_CARD, gridColumn: ledgerOpenId === l._id ? "1 / -1" : "auto" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600 }}>{l.name}</div>
                  <span style={{ ...PILL, flexShrink: 0, background: l.status === "Closed" ? "#e5e7eb" : "#dcfce7", color: l.status === "Closed" ? "#374151" : "#166534" }}>{l.status}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 2 }}>{l.liabilityCode} · {l.type}</div>
                <div className="revamp-num" style={{ fontSize: 16, fontWeight: 700, marginTop: 10 }}>{fmtINR(l.outstandingAmount)}</div>
                <div style={{ fontSize: 11.5, color: "var(--fg-5)" }}>outstanding of {fmtINR(l.principalAmount)}</div>
                {l.dueDate ? <div style={{ fontSize: 11.5, color: "var(--fg-5)", marginTop: 2 }}>Due {new Date(l.dueDate).toLocaleDateString("en-IN")}</div> : null}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                  <button type="button" style={SMALLBTN} onClick={() => setLedgerOpenId((cur) => (cur === l._id ? null : l._id))}>{ledgerOpenId === l._id ? "Hide ledger" : "View ledger"}</button>
                  {l.status === "Open" ? (
                    <button type="button" style={SMALLBTN} onClick={() => { setPayFor(l); setPayDraft({ amount: "", payingAccountId: "", date: "", note: "" }); }}>Pay</button>
                  ) : null}
                </div>
                {ledgerOpenId === l._id ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                    <AccountLedgerInline accountId={l.linkedLiabilityAccountId} accountLabel={l.name} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {payFor ? (
        <section style={CARD}>
          <h2 style={H2}>Pay against {payFor.name}</h2>
          <p style={{ ...MUTED, margin: "0 0 10px" }}>Outstanding: {fmtINR(payFor.outstandingAmount)}</p>
          <div style={GRID2}>
            <Field label="Amount"><input type="number" value={payDraft.amount} onChange={(e) => setPayDraft((d) => ({ ...d, amount: e.target.value }))} style={INPUT} /></Field>
            <Field label="Paying account">
              <select value={payDraft.payingAccountId} onChange={(e) => setPayDraft((d) => ({ ...d, payingAccountId: e.target.value }))} style={INPUT}>
                <option value="">Choose…</option>
                {contraAccounts.map((a) => <option key={a._id} value={a._id}>{a.code} — {a.name}</option>)}
              </select>
            </Field>
            <Field label="Date (optional)"><input type="date" value={payDraft.date} onChange={(e) => setPayDraft((d) => ({ ...d, date: e.target.value }))} style={INPUT} /></Field>
            <Field label="Note (optional)"><input value={payDraft.note} onChange={(e) => setPayDraft((d) => ({ ...d, note: e.target.value }))} style={INPUT} /></Field>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button type="button" disabled={paying} onClick={runPay} style={PRIMARY}>{paying ? "Posting…" : "Post payment"}</button>
            <button type="button" onClick={() => setPayFor(null)} style={SECONDARY}>Cancel</button>
          </div>
        </section>
      ) : null}
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
const LIAB_CARD = { border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--bg-surface)" };
const INPUT = { width: "100%", padding: "8px 11px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))", color: "var(--fg-2)", outline: "none", fontFamily: "inherit" };
const PRIMARY = { padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--on-solid)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const SECONDARY = { padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-2)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const SMALLBTN = { padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-2)", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const PILL = { display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, flexShrink: 0 };
