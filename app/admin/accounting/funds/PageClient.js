"use client";

/**
 * Funds — Reserve/Sinking/Repair/Corpus fund register. FundService already
 * had full contribute/withdraw/transfer logic (each posts a real journal
 * entry, session-wrapped) — this is its first admin page. See design doc's
 * accounting-system-ARD.md §3, §8.
 */

import { useCallback, useEffect, useState } from "react";
import notify from "@/lib/notify";
import AccountLedgerInline from "@/components/accounting/AccountLedgerInline";

const fmtINR = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

export default function PageClient() {
  const [funds, setFunds] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ fundCode: "", name: "", fundType: "ReserveFund", linkedAccountId: "", purpose: "", targetAmount: "", minimumBalance: "" });
  const [actionFund, setActionFund] = useState(null); // {fund, mode: "contribute"|"withdraw"}
  const [actionDraft, setActionDraft] = useState({ contraAccountId: "", amount: "", date: "", note: "" });
  const [acting, setActing] = useState(false);
  const [transferDraft, setTransferDraft] = useState({ fromFundId: "", toFundId: "", amount: "", date: "", note: "" });
  const [transferring, setTransferring] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  // §7.18 progressive disclosure — target amount / minimum balance hidden until asked for.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [ledgerOpenId, setLedgerOpenId] = useState(null); // §7.22/§7.12 — view postings, reach the voucher to reverse if needed

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const [fRes, aRes] = await Promise.all([
        fetch("/api/accounting/funds", { credentials: "include", signal }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include", signal }),
      ]);
      const fJson = await fRes.json().catch(() => ({}));
      if (!fRes.ok) throw new Error(fJson.error || "Could not load funds");
      const aJson = await aRes.json().catch(() => ({}));
      setFunds(fJson.funds || []);
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

  const equityAccounts = accounts.filter((a) => a.type === "Equity" && a.isActive !== false);
  const contraAccounts = accounts.filter((a) => a.isActive !== false); // any account can be the other leg

  const createFund = async () => {
    if (!draft.fundCode.trim() || !draft.name.trim() || !draft.linkedAccountId) {
      notify.error("Fund code, name and linked account are required");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/accounting/funds", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          targetAmount: draft.targetAmount ? Number(draft.targetAmount) : undefined,
          minimumBalance: draft.minimumBalance ? Number(draft.minimumBalance) : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not create the fund");
      notify.success(`Fund "${json.fund.name}" created`);
      setDraft({ fundCode: "", name: "", fundType: "ReserveFund", linkedAccountId: "", purpose: "", targetAmount: "", minimumBalance: "" });
      setShowCreate(false);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const runAction = async () => {
    if (!actionFund || !actionDraft.contraAccountId || !(Number(actionDraft.amount) > 0)) {
      notify.error("Choose the other account and an amount greater than zero");
      return;
    }
    setActing(true);
    try {
      const res = await fetch(`/api/accounting/funds/${actionFund.fund._id}/${actionFund.mode}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...actionDraft, amount: Number(actionDraft.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Could not ${actionFund.mode}`);
      notify.success(actionFund.mode === "contribute" ? "Contribution posted." : "Withdrawal posted.");
      setActionFund(null);
      setActionDraft({ contraAccountId: "", amount: "", date: "", note: "" });
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setActing(false);
    }
  };

  const runTransfer = async () => {
    if (!transferDraft.fromFundId || !transferDraft.toFundId || !(Number(transferDraft.amount) > 0)) {
      notify.error("Choose both funds and an amount greater than zero");
      return;
    }
    setTransferring(true);
    try {
      const res = await fetch("/api/accounting/funds/transfer", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...transferDraft, amount: Number(transferDraft.amount) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not transfer");
      notify.success(`Transferred ${fmtINR(transferDraft.amount)}.`);
      setTransferDraft({ fromFundId: "", toFundId: "", amount: "", date: "", note: "" });
      setShowTransfer(false);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setTransferring(false);
    }
  };

  // No own <main>/<h1>/back-link — this only ever renders embedded inside
  // an Accordion section on Assets & Liabilities now (see
  // app/admin/accounting/registers/PageClient.js); its own page.js route
  // is a redirect there, not a render. The accordion header already says
  // "Funds", a second title here would just repeat it.
  return (
    <div>
      {loading ? (
        <p style={MUTED}>Loading…</p>
      ) : error ? (
        <p style={{ ...MUTED, color: "var(--danger, #b91c1c)" }}>{error}</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button type="button" onClick={() => setShowCreate((v) => !v)} style={SECONDARY}>
              {showCreate ? "Never mind" : "+ Register a fund"}
            </button>
            {funds.length >= 2 ? (
              <button type="button" onClick={() => setShowTransfer((v) => !v)} style={SECONDARY}>
                {showTransfer ? "Never mind" : "Transfer between funds"}
              </button>
            ) : null}
          </div>

          {showCreate ? (
            <section style={CARD}>
              <h2 style={H2}>Register a fund</h2>
              <div style={GRID2}>
                <Field label="Fund code"><input value={draft.fundCode} onChange={(e) => setDraft((d) => ({ ...d, fundCode: e.target.value }))} placeholder="e.g. RF-01" style={INPUT} /></Field>
                <Field label="Name"><input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Reserve Fund" style={INPUT} /></Field>
                <Field label="Type">
                  <select value={draft.fundType} onChange={(e) => setDraft((d) => ({ ...d, fundType: e.target.value }))} style={INPUT}>
                    {["ReserveFund", "SinkingFund", "RepairFund", "CorpusFund", "ShareCapital", "GeneralFund", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Linked account (must be Equity type)">
                  <select value={draft.linkedAccountId} onChange={(e) => setDraft((d) => ({ ...d, linkedAccountId: e.target.value }))} style={INPUT}>
                    <option value="">Choose…</option>
                    {equityAccounts.map((a) => <option key={a._id} value={a._id}>{a.code} — {a.name}</option>)}
                  </select>
                </Field>
              </div>
              <button type="button" onClick={() => setShowAdvanced((v) => !v)} style={{ ...MUTED, background: "none", border: "none", cursor: "pointer", marginTop: 10, padding: 0, textDecoration: "underline" }}>
                {showAdvanced ? "Hide advanced details" : "Advanced accounting details"}
              </button>
              {showAdvanced ? (
                <div style={GRID2}>
                  <Field label="Target amount (optional)"><input type="number" value={draft.targetAmount} onChange={(e) => setDraft((d) => ({ ...d, targetAmount: e.target.value }))} style={INPUT} /></Field>
                  <Field label="Minimum balance (optional)"><input type="number" value={draft.minimumBalance} onChange={(e) => setDraft((d) => ({ ...d, minimumBalance: e.target.value }))} style={INPUT} /></Field>
                </div>
              ) : null}
              <div style={{ marginTop: 10 }}>
                <Field label="Purpose (optional)"><input value={draft.purpose} onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))} style={INPUT} /></Field>
              </div>
              <button type="button" disabled={creating} onClick={createFund} style={{ ...PRIMARY, marginTop: 14 }}>{creating ? "Creating…" : "Create fund"}</button>
            </section>
          ) : null}

          {showTransfer ? (
            <section style={CARD}>
              <h2 style={H2}>Transfer between funds</h2>
              <div style={GRID2}>
                <Field label="From">
                  <select value={transferDraft.fromFundId} onChange={(e) => setTransferDraft((d) => ({ ...d, fromFundId: e.target.value }))} style={INPUT}>
                    <option value="">Choose…</option>
                    {funds.map((f) => <option key={f._id} value={f._id}>{f.name} ({fmtINR(f.balance)})</option>)}
                  </select>
                </Field>
                <Field label="To">
                  <select value={transferDraft.toFundId} onChange={(e) => setTransferDraft((d) => ({ ...d, toFundId: e.target.value }))} style={INPUT}>
                    <option value="">Choose…</option>
                    {funds.map((f) => <option key={f._id} value={f._id}>{f.name} ({fmtINR(f.balance)})</option>)}
                  </select>
                </Field>
                <Field label="Amount"><input type="number" value={transferDraft.amount} onChange={(e) => setTransferDraft((d) => ({ ...d, amount: e.target.value }))} style={INPUT} /></Field>
                <Field label="Date (optional)"><input type="date" value={transferDraft.date} onChange={(e) => setTransferDraft((d) => ({ ...d, date: e.target.value }))} style={INPUT} /></Field>
              </div>
              <div style={{ marginTop: 10 }}>
                <Field label="Note (optional)"><input value={transferDraft.note} onChange={(e) => setTransferDraft((d) => ({ ...d, note: e.target.value }))} style={INPUT} /></Field>
              </div>
              <button type="button" disabled={transferring} onClick={runTransfer} style={{ ...PRIMARY, marginTop: 14 }}>{transferring ? "Transferring…" : "Transfer"}</button>
            </section>
          ) : null}

          <section style={{ marginTop: 18 }}>
            {funds.length === 0 ? (
              <div style={{ padding: "28px 20px", textAlign: "center", maxWidth: 460, margin: "0 auto" }}>
                <p style={{ ...MUTED, fontWeight: 600, fontSize: 14, color: "var(--fg-1)" }}>No funds registered yet</p>
                <p style={{ ...MUTED, marginTop: 6, lineHeight: 1.6 }}>
                  Reserve, Sinking and Repair funds are the society&apos;s own set-aside
                  money — kept separate so year-end surplus can be appropriated
                  into them instead of sitting as plain surplus. Set up creates the
                  standard three; add your own here if you need another.
                </p>
                <button type="button" onClick={() => setShowCreate(true)} style={{ ...PRIMARY, marginTop: 12 }}>Add a fund</button>
              </div>
            ) : (
              // Card grid instead of a full-width row list — adopted from
              // the Pulse design-kit import (AapliSociety_Design_System/
              // ui_kits/revamp/AccountingAssetsCashViews.jsx): a fund's real
              // information (name, balance, purpose) is sparse and scans
              // better as a card than stretched across a full-width row.
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                {funds.map((f) => (
                  <div key={f._id} style={{ ...FUND_CARD, gridColumn: ledgerOpenId === f._id ? "1 / -1" : "auto" }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{f.name}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 2 }}>{f.fundCode} · {f.fundType}</div>
                    {f.purpose ? <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 4 }}>{f.purpose}</div> : null}
                    <div className="revamp-num" style={{ fontSize: 20, fontWeight: 700, marginTop: 10 }}>{fmtINR(f.balance)}</div>
                    {f.minimumBalance ? <div style={{ fontSize: 11.5, color: "var(--fg-5)" }}>Minimum: {fmtINR(f.minimumBalance)}</div> : null}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                      <button type="button" style={SMALLBTN} onClick={() => setLedgerOpenId((cur) => (cur === f._id ? null : f._id))}>{ledgerOpenId === f._id ? "Hide ledger" : "View ledger"}</button>
                      <button type="button" style={SMALLBTN} onClick={() => { setActionFund({ fund: f, mode: "contribute" }); setActionDraft({ contraAccountId: "", amount: "", date: "", note: "" }); }}>Contribute</button>
                      <button type="button" style={SMALLBTN} onClick={() => { setActionFund({ fund: f, mode: "withdraw" }); setActionDraft({ contraAccountId: "", amount: "", date: "", note: "" }); }}>Withdraw</button>
                    </div>
                    {ledgerOpenId === f._id ? (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                        <AccountLedgerInline accountId={f.linkedAccountId} accountLabel={f.name} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          {actionFund ? (
            <section style={CARD}>
              <h2 style={H2}>{actionFund.mode === "contribute" ? "Contribute to" : "Withdraw from"} {actionFund.fund.name}</h2>
              <div style={GRID2}>
                <Field label={actionFund.mode === "contribute" ? "Coming from account" : "Going to account"}>
                  <select value={actionDraft.contraAccountId} onChange={(e) => setActionDraft((d) => ({ ...d, contraAccountId: e.target.value }))} style={INPUT}>
                    <option value="">Choose…</option>
                    {contraAccounts.map((a) => <option key={a._id} value={a._id}>{a.code} — {a.name}</option>)}
                  </select>
                </Field>
                <Field label="Amount"><input type="number" value={actionDraft.amount} onChange={(e) => setActionDraft((d) => ({ ...d, amount: e.target.value }))} style={INPUT} /></Field>
                <Field label="Date (optional)"><input type="date" value={actionDraft.date} onChange={(e) => setActionDraft((d) => ({ ...d, date: e.target.value }))} style={INPUT} /></Field>
                <Field label="Note (optional)"><input value={actionDraft.note} onChange={(e) => setActionDraft((d) => ({ ...d, note: e.target.value }))} style={INPUT} /></Field>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button type="button" disabled={acting} onClick={runAction} style={PRIMARY}>{acting ? "Posting…" : "Post"}</button>
                <button type="button" onClick={() => setActionFund(null)} style={SECONDARY}>Cancel</button>
              </div>
            </section>
          ) : null}
        </>
      )}
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
const FUND_CARD = { border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--bg-surface)" };
const INPUT = { width: "100%", padding: "8px 11px", borderRadius: 8, fontSize: 13, border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))", color: "var(--fg-2)", outline: "none", fontFamily: "inherit" };
const PRIMARY = { padding: "9px 16px", borderRadius: 8, border: "none", background: "var(--accent)", color: "var(--on-solid)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const SECONDARY = { padding: "9px 16px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-2)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const SMALLBTN = { padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-2)", fontSize: 12, fontWeight: 600, cursor: "pointer" };
