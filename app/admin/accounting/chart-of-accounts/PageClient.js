"use client";
/**
 * Account heads — the named pockets money moves between.
 *
 * ## The translation this page has to do
 *
 * "Chart of Accounts" means nothing to a society secretary. "The list of heads
 * your auditor's statement prints" means everything, because he has held that
 * statement in his hands. So the page is titled for the thing he recognises
 * and the accounting term appears once, as an aside.
 *
 * The five accounting TYPES get the same treatment: Asset / Liability /
 * Equity / Income / Expense are shown with a plain-language gloss each, since
 * "Equity" in a housing society means the funds — Share Capital, Sinking Fund,
 * Repair Fund — and nobody would guess that from the word.
 *
 * ## Why missing heads are the loudest thing on the page
 *
 * A society part-way through setup has some heads and not others, and the
 * missing ones are invisible by nature — you cannot see an absence in a list.
 * So they are counted at the top with a button that creates them, rather than
 * left for someone to notice by comparing against a statement.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSetupState } from "@/lib/accounting/setupStateClient";
import { useRouter } from "next/navigation";
import notify from "@/lib/notify";
import {
  PageHeader, SectionLabel, Card, Pill, Btn, Icon, SearchInput,
  Segmented, EmptyState, RevampSkeleton, GuardedAction,
} from "@/components/revamp";
import Term from "@/components/accounting/Term";
import { pushRecent } from "@/lib/accounting/recents";
import { useCan } from "@/lib/accounting/useCan";

const SCHEDULES = [
  { code: "A", label: "Share Capital" }, { code: "B", label: "Reserve Fund" },
  { code: "C", label: "Other Funds" }, { code: "D", label: "Current Liabilities & Provisions" },
  { code: "E", label: "Fixed Assets" }, { code: "F", label: "Investments" },
  { code: "G", label: "Member Outstanding (Receivables)" }, { code: "H", label: "Cash & Bank Balances" },
  { code: "I", label: "Income" }, { code: "J", label: "Expenditure" },
];

/** The five types, in statement order, each with the words he'd actually use. */
const TYPES = [
  { key: "Asset", label: "Assets", gloss: "What the society owns or is owed — cash, bank, dues from members, the building." },
  { key: "Liability", label: "Liabilities", gloss: "What the society owes — bills not yet paid, deposits held, advances from members." },
  { key: "Equity", label: "Funds", gloss: "The society's own money — Share Capital, Reserve, Sinking and Repair funds." },
  { key: "Income", label: "Income", gloss: "Money coming in — members' contributions, interest, scrap sale." },
  { key: "Expense", label: "Expenses", gloss: "Money going out — repairs, water, electricity, salaries, audit fee." },
];

export default function ChartOfAccountsPage() {
  const router = useRouter();
  // §7.15 role-aware gating — bulk switch-off is the same real permission
  // the single-row GuardedAction already enforces server-side; hiding the
  // checkbox column entirely for a role without it, rather than letting
  // them select and then refusing at Confirm.
  const can = useCan();
  const canBulkDeactivate = can("accounting.chartOfAccounts.deactivate");
  const [accounts, setAccounts] = useState([]);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [showInactive, setShowInactive] = useState(false);
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  // §7.19 bulk actions — select several active heads, switch them all off at once.
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [bulkPreviewOn, setBulkPreviewOn] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  // §7.29 saved views — per-viewer, localStorage only. Restored once on
  // mount if the admin previously turned "Remember this view" on; every
  // filter change after that re-saves silently.
  const [remember, setRemember] = useState(false);
  const VIEW_KEY = "accounting.chartOfAccounts.view.v1";

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEW_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      setRemember(true);
      if (saved.q) setQ(saved.q);
      if (saved.type) setType(saved.type);
      if (saved.showInactive) setShowInactive(true);
      if (saved.onlyUnassigned) setOnlyUnassigned(true);
    } catch { /* no saved view, or storage blocked — just use defaults */ }
  }, []);

  useEffect(() => {
    if (!remember) return;
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify({ q, type, showInactive, onlyUnassigned }));
    } catch { /* best-effort */ }
  }, [remember, q, type, showInactive, onlyUnassigned]);

  const toggleRemember = useCallback(() => {
    setRemember((v) => {
      const next = !v;
      try {
        if (next) window.localStorage.setItem(VIEW_KEY, JSON.stringify({ q, type, showInactive, onlyUnassigned }));
        else window.localStorage.removeItem(VIEW_KEY);
      } catch { /* best-effort */ }
      return next;
    });
  }, [q, type, showInactive, onlyUnassigned]);
  const [fixing, setFixing] = useState(false);
  const [available, setAvailable] = useState([]); // template heads not currently in the chart — includes deliberately-removed ones
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [balances, setBalances] = useState(null); // accountId -> current balance (₹, signed by normal side), or null while unavailable
  // Drill-down (§7.8/§7.12 of docs/accounting-module-audit-and-consolidation-
  // plan.md): "where did this number come from" — expand an account's own
  // ledger inline instead of sending the admin to a different page.
  const [ledgerOpenId, setLedgerOpenId] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerRows, setLedgerRows] = useState(null);
  const [ledgerSummary, setLedgerSummary] = useState(null); // {openingBalance, openingSide, totalDebit, totalCredit, closingBalance, closingSide}
  const [ledgerErr, setLedgerErr] = useState(null);

  const toggleLedger = useCallback((account) => {
    setLedgerOpenId((cur) => (cur === account._id ? null : account._id));
  }, []);

  // Fires whenever ledgerOpenId changes — from a row's "View ledger" click
  // (via toggleLedger above) or from the ?openLedger= deep link on mount —
  // one fetch path either way.
  useEffect(() => {
    if (!ledgerOpenId) return;
    setLedgerRows(null);
    setLedgerSummary(null);
    setLedgerErr(null);
    setLedgerLoading(true);
    const ac = new AbortController();
    const fyId = state?.financialYear?._id;
    const qs = fyId ? `?accountId=${ledgerOpenId}&financialYearId=${fyId}` : `?accountId=${ledgerOpenId}`;
    fetch(`/api/accounting/general-ledger${qs}`, { credentials: "include", signal: ac.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Could not load this account's ledger.");
        setLedgerRows(json.ledger?.lines || json.lines || []);
        setLedgerSummary(json.ledger || null);
      })
      .catch((e) => { if (e?.name !== "AbortError") setLedgerErr(e.message); })
      .finally(() => setLedgerLoading(false));
    return () => ac.abort();
  }, [ledgerOpenId, state?.financialYear?._id]);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const [accRes, state, tplRes] = await Promise.all([
        fetch("/api/accounting/chart-of-accounts?includeInactive=true&withLock=1", { credentials: "include", signal }),
        // Retries a cold-start 503 instead of silently dropping the banner.
        fetchSetupState({ signal }),
        fetch("/api/accounting/chart-of-accounts/template", { credentials: "include", signal }),
      ]);
      const accJson = await accRes.json().catch(() => ({}));
      if (!accRes.ok) throw new Error(accJson.error || "Could not load the account heads");
      const tplJson = await tplRes.json().catch(() => ({}));
      setAccounts(accJson.accounts || []);
      setState(state);
      setAvailable(tplJson.available || []);
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

  // Deep-link support: QuickBar's account-search result opens this page with
  // ?openLedger=<accountId> so the drill-down panel is already expanded —
  // read once on mount via window.location, no Suspense boundary needed.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("openLedger");
    if (id) setLedgerOpenId(id);
  }, []);

  // Running balance — an ease-of-access add-on, not new logic: it's the same
  // per-account debit/credit the Auditor's Position tab already gets from
  // /api/accounting/trial-balance, just folded into each row here so seeing
  // what's IN a head doesn't require a trip to another page. Waits on
  // `state` because the financial year id only exists once that's loaded.
  useEffect(() => {
    const fyId = state?.financialYear?._id;
    if (!fyId) return;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/accounting/trial-balance?financialYearId=${fyId}`, { credentials: "include", signal: ac.signal });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) return; // no permission, or nothing posted yet — the column just stays blank
        const byId = {};
        for (const r of json.trialBalance?.rows || []) byId[r.accountId] = { debit: r.debit || 0, credit: r.credit || 0 };
        setBalances(byId);
      } catch {
        // Blank column, not an error banner — this is a convenience, not the page's job.
      }
    })();
    return () => ac.abort();
  }, [state?.financialYear?._id]);

  /** Net balance on the account's own normal side — Assets/Expense run Dr, Liability/Equity/Income run Cr. */
  const balanceFor = useCallback((account) => {
    const b = balances?.[account._id];
    if (!b) return null;
    const net = ["Asset", "Expense"].includes(account.type) ? b.debit - b.credit : b.credit - b.debit;
    return net;
  }, [balances]);

  /** Create whatever standard heads are absent, via the guided-setup runner. */
  const createMissing = useCallback(async () => {
    setFixing(true);
    try {
      const res = await fetch("/api/accounting/setup/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "chartOfAccounts" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "Could not create the heads");
      notify.success(json.message || "Account heads created");
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setFixing(false);
    }
  }, [load]);

  /** Inline rename — T0 on the lock matrix for every row (design doc §7). */
  const saveRename = useCallback(async (id) => {
    const name = editName.trim();
    setEditingId(null);
    if (!name) return;
    try {
      const res = await fetch(`/api/accounting/chart-of-accounts/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not rename");
      setAccounts((list) => list.map((a) => (a._id === id ? { ...a, name: json.account.name } : a)));
    } catch (e) {
      notify.error(e.message);
    }
  }, [editName]);

  const setSchedule = useCallback(async (id, scheduleCode) => {
    try {
      const res = await fetch(`/api/accounting/chart-of-accounts/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleCode: scheduleCode || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not set the schedule");
      setAccounts((list) => list.map((a) => (a._id === id ? { ...a, scheduleCode: json.account.scheduleCode } : a)));
    } catch (e) {
      notify.error(e.message);
    }
  }, []);

  const toggleBulk = useCallback((id) => {
    setBulkSelected((s) => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  /** Bulk switch-off — same underlying call as the single GuardedAction below,
   *  looped, with its own Preview → Confirm gate first (§7.19/§7.21). Only
   *  ever offered on rows whose lock tier isn't T3 (see checkbox render). */
  const bulkDeactivate = useCallback(async () => {
    setBulkBusy(true);
    const ids = [...bulkSelected];
    let failed = 0;
    for (const id of ids) {
      const res = await fetch(`/api/accounting/chart-of-accounts/${id}/status`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false, reason: "Bulk switch-off" }),
      }).catch(() => null);
      if (!res || !res.ok) failed++;
    }
    setBulkBusy(false);
    setBulkPreviewOn(false);
    setBulkSelected(new Set());
    if (failed) notify.error(`${ids.length - failed} switched off, ${failed} refused (in use — switch those off individually to see why).`);
    else notify.success(`${ids.length} account${ids.length === 1 ? "" : "s"} switched off.`);
    await load();
  }, [bulkSelected, load]);

  /** Deactivate (reversible) — T0-T3 per the lock matrix, GuardedAction handles the UI. */
  const deactivateAccount = useCallback(async (account, { reason } = {}) => {
    setBusyId(account._id);
    try {
      const res = await fetch(`/api/accounting/chart-of-accounts/${account._id}/status`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false, reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(json.error || "Could not switch it off"), { refusal: json.refusal });
      notify.success(`"${account.name}" switched off.`);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setBusyId(null);
    }
  }, [load]);

  /** Delete — T2/T3 per the lock matrix; a removed standard code never
   *  reappears as "missing" (see lib/accounting/chartProfile.js). */
  const deleteAccount = useCallback(async (account) => {
    setBusyId(account._id);
    try {
      const res = await fetch(`/api/accounting/chart-of-accounts/${account._id}`, {
        method: "DELETE", credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(json.error || "Could not delete it"), { refusal: json.refusal });
      notify.success(`"${account.name}" deleted.`);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setBusyId(null);
    }
  }, [load]);

  /** Adopt a template head straight from "Available to add". */
  const adopt = useCallback(async (spec) => {
    setBusyId(spec.code);
    try {
      const res = await fetch("/api/accounting/chart-of-accounts", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not add it");
      notify.success(`"${spec.name}" added.`);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const missing = useMemo(() => {
    const step = (state?.steps || []).find((s) => s.key === "chartOfAccounts");
    return step?.missingItems || [];
  }, [state]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts.filter((a) => {
      if (!showInactive && a.isActive === false) return false;
      if (type !== "all" && a.type !== type) return false;
      if (onlyUnassigned && a.scheduleCode) return false;
      if (!needle) return true;
      return [a.name, a.code, a.subType, a.scheduleCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [accounts, q, type, showInactive, onlyUnassigned]);

  const byType = useMemo(() => {
    const m = new Map(TYPES.map((t) => [t.key, []]));
    for (const a of visible) {
      if (!m.has(a.type)) m.set(a.type, []);
      m.get(a.type).push(a);
    }
    // Unassigned-first (design doc §12 Phase 3): a head with no Schedule set
    // is the one that needs attention before the next statement prints, so
    // it sorts above heads that are already fully set up.
    for (const list of m.values()) {
      list.sort((x, y) => {
        const xu = x.scheduleCode ? 1 : 0;
        const yu = y.scheduleCode ? 1 : 0;
        if (xu !== yu) return xu - yu;
        return String(x.code).localeCompare(String(y.code));
      });
    }
    return m;
  }, [visible]);

  const activeCount = accounts.filter((a) => a.isActive !== false).length;
  const inactiveCount = accounts.length - activeCount;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="book-open" size={11} /> Also called the Chart of Accounts</>}
        title="Account heads"
        sub="The named pockets money moves between — the same heads your auditor's statement prints."
        right={
          missing.length ? (
            <Btn variant="primary" icon="plus" disabled={fixing} onClick={createMissing}>
              {fixing ? "Creating…" : `Create the ${missing.length} missing`}
            </Btn>
          ) : null
        }
      />
      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={80} /><RevampSkeleton h={220} />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon="alert-triangle" title="Could not load the account heads" sub={error} />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Btn variant="primary" onClick={() => load()}>Try again</Btn>
          </div>
        </Card>
      ) : accounts.length === 0 ? (
        <Card>
          <div style={{ padding: "36px 24px", textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
            <Icon name="book-open" size={30} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
            <p style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: "var(--r-fg-1)" }}>
              No account heads yet
            </p>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.65 }}>
              These are the pockets money moves between — Cash in Hand, Cash at
              Bank, Dues from Members, Repairs, Property Tax, and so on. The
              standard set for a Maharashtra housing society can be created for
              you, and you can add your own afterwards.
            </p>
            <Btn variant="primary" icon="plus" disabled={fixing} onClick={createMissing} style={{ marginTop: 16 }}>
              {fixing ? "Creating…" : "Create the standard set"}
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          {/* ── missing warning ─────────────────────────────────────── */}
          {missing.length ? (
            <Card style={{ marginBottom: 16, borderColor: "var(--r-warning)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Icon name="alert-triangle" size={18} color="var(--r-warning)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {missing.length} standard head{missing.length === 1 ? "" : "s"} still missing
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 3, lineHeight: 1.6 }}>
                    Statements print blank rows where a head is absent, and some
                    postings have nowhere to go.
                  </div>
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 11.5, color: "var(--r-fg-4)", cursor: "pointer" }}>
                      See which ones
                    </summary>
                    <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 5, lineHeight: 1.7 }}>
                      {missing.join(", ")}
                    </div>
                  </details>
                </div>
                <Btn variant="primary" size="sm" disabled={fixing} onClick={createMissing}>
                  {fixing ? "…" : "Create them"}
                </Btn>
              </div>
            </Card>
          ) : null}

          {/* Counts live on the type filter itself (plan §7.7), not in cards. */}
          {/* ── filters ─────────────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search by name or code…" style={{ maxWidth: 280 }} />
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: "all", label: "All heads in use", count: activeCount },
                ...TYPES.map((t) => ({ value: t.key, label: t.label, count: accounts.filter((a) => a.type === t.key && a.isActive !== false).length })),
              ]}
            />
            {inactiveCount ? (
              <Btn size="sm" variant={showInactive ? "primary" : "secondary"} onClick={() => setShowInactive((v) => !v)}>
                {showInactive ? "Hiding none" : `Show ${inactiveCount} switched off`}
              </Btn>
            ) : null}
            {/* §7.29 saved view: this preset is one of the doc's own examples
                — "accounts missing schedule mapping" — as a real one-click chip. */}
            <Btn size="sm" variant={onlyUnassigned ? "primary" : "secondary"} onClick={() => setOnlyUnassigned((v) => !v)}>
              {onlyUnassigned ? "Showing unassigned only" : "Only unassigned"}
            </Btn>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--r-fg-4)", cursor: "pointer" }} title="Keep this filter next time you open this page — saved only on this browser">
              <input type="checkbox" checked={remember} onChange={toggleRemember} />
              Remember this view
            </label>
            <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>
              <Term word="Schedule">Schedule?</Term>
            </span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--r-fg-4)" }}>
              {visible.length} shown
            </span>
          </div>

          {bulkSelected.size ? (
            <Card style={{ marginBottom: 14, border: "1px solid var(--r-brand)" }}>
              {!bulkPreviewOn ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 12.5, color: "var(--r-fg-2)" }}>{bulkSelected.size} account{bulkSelected.size === 1 ? "" : "s"} selected</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn size="sm" onClick={() => setBulkSelected(new Set())}>Clear</Btn>
                    <Btn size="sm" variant="primary" onClick={() => setBulkPreviewOn(true)}>Switch off selected</Btn>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--r-fg-2)", marginBottom: 8 }}>
                    This switches off {bulkSelected.size} account{bulkSelected.size === 1 ? "" : "s"} — reversible, they can be switched back on individually. Any account already in use (posted entries, mapped in fiscal config, referenced by a posting rule) will refuse and stay on; you&apos;ll see how many succeeded.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn size="sm" disabled={bulkBusy} onClick={() => setBulkPreviewOn(false)}>Cancel</Btn>
                    <Btn size="sm" variant="primary" disabled={bulkBusy} onClick={bulkDeactivate}>{bulkBusy ? "Switching off…" : "Confirm"}</Btn>
                  </div>
                </div>
              )}
            </Card>
          ) : null}

          {/* ── grouped list ────────────────────────────────────────── */}
          {visible.length === 0 ? (
            <Card><EmptyState icon="search" title="Nothing matches" sub="Try a different search or filter." /></Card>
          ) : (
            TYPES.filter((t) => (byType.get(t.key) || []).length).map((t) => (
              <div key={t.key} style={{ marginBottom: 20 }}>
                <SectionLabel icon="circle">{t.label}</SectionLabel>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.55 }}>
                  {t.gloss}
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                  {(byType.get(t.key) || []).map((a) => {
                    const lock = a.lock || {};
                    const editing = editingId === a._id;
                    const ledgerOpen = ledgerOpenId === a._id;
                    const bal = balances ? balanceFor(a) : null;
                    return (
                      <div
                        key={a._id}
                        style={{
                          border: "1px solid var(--r-hairline)", borderRadius: 12, padding: 14,
                          background: "var(--r-surface)", opacity: a.isActive === false ? 0.55 : 1,
                          gridColumn: ledgerOpen ? "1 / -1" : "auto",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            {canBulkDeactivate && a.isActive !== false && a.lock?.deactivate !== "T3" ? (
                              <input
                                type="checkbox"
                                checked={bulkSelected.has(a._id)}
                                onChange={() => toggleBulk(a._id)}
                                title="Select for bulk switch-off"
                                style={{ flexShrink: 0 }}
                              />
                            ) : null}
                            <span className="revamp-num" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--r-fg-4)", flexShrink: 0 }}>{a.code}</span>
                          </div>
                          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                            {a.isActive === false ? <Pill tone="expired">off</Pill> : null}
                            {a.isSystemAccount ? <Pill tone="info" dot={false}>standard</Pill> : null}
                          </div>
                        </div>

                        {/* Rename — T0, no confirm needed. */}
                        {editing ? (
                          <input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => saveRename(a._id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveRename(a._id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            style={{
                              width: "100%", marginTop: 8, fontSize: 14, fontWeight: 600, padding: "3px 6px", borderRadius: 6,
                              border: "1px solid var(--r-brand)", background: "var(--r-surface-1)", color: "var(--r-fg-1)",
                            }}
                          />
                        ) : (
                          <div
                            onClick={() => { setEditingId(a._id); setEditName(a.name); }}
                            title="Click to rename"
                            style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)", cursor: "pointer" }}
                          >
                            {a.name}
                          </div>
                        )}

                        {bal !== null ? (
                          <div className="revamp-num" style={{ fontSize: 18, fontWeight: 700, marginTop: 8, color: bal < 0 ? "var(--r-danger)" : "var(--r-fg-1)" }}>
                            {bal < 0 ? "-" : ""}₹{Math.abs(bal).toLocaleString("en-IN")}
                          </div>
                        ) : null}

                        {/* Schedule dropdown — which Balance Sheet heading this prints under. */}
                        <select
                          value={a.scheduleCode || ""}
                          onChange={(e) => setSchedule(a._id, e.target.value)}
                          title="Which heading this prints under on the Balance Sheet"
                          style={{
                            width: "100%", marginTop: 10, fontSize: 12, padding: "6px 8px", borderRadius: 7,
                            border: "1px solid var(--r-hairline)", background: "var(--r-surface-1)",
                            color: a.scheduleCode ? "var(--r-fg-2)" : "var(--r-warning)",
                          }}
                        >
                          <option value="">Unassigned</option>
                          {SCHEDULES.map((s) => (
                            <option key={s.code} value={s.code}>Sch. {s.code} — {s.label}</option>
                          ))}
                        </select>

                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                          <Btn size="sm" icon="book-open" onClick={() => toggleLedger(a)}>
                            {ledgerOpen ? "Hide ledger" : "View ledger"}
                          </Btn>
                          {a.isActive !== false ? (
                            <GuardedAction
                              tier={lock.deactivate || "T1"}
                              label="Switch off"
                              danger={false}
                              disabled={busyId === a._id}
                              refusal={lock.deactivate === "T3" ? { title: `"${a.name}" can't be switched off.`, reason: lock.reason, remedy: null } : null}
                              onConfirm={(extra) => deactivateAccount(a, extra)}
                            />
                          ) : null}
                          <GuardedAction
                            tier={lock.delete || "T2"}
                            label="Delete"
                            typedName={a.code}
                            confirmLabel="Delete"
                            disabled={busyId === a._id}
                            refusal={lock.delete === "T3" ? { title: `"${a.name}" can't be deleted.`, reason: lock.reason, remedy: lock.reason?.includes("mapped") ? "Change the fiscal mapping first." : "Switch it off instead." } : null}
                            onConfirm={() => deleteAccount(a)}
                          />
                        </div>

                        {/* Inline ledger drill-down — the account's own postings,
                            each one linking straight to its voucher (§7.12). Card
                            spans the full row width while open (set above). */}
                        {ledgerOpen ? (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--r-hairline)" }}>
                            {ledgerLoading ? (
                              <div style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Loading…</div>
                            ) : ledgerErr ? (
                              <div style={{ fontSize: 12, color: "var(--r-danger)" }}>{ledgerErr}</div>
                            ) : !ledgerRows?.length ? (
                              <div style={{ fontSize: 12, color: "var(--r-fg-4)" }}>No postings against this head this financial year.</div>
                            ) : (
                              <div style={{ display: "grid", gap: 8 }}>
                                {/* §7.30 "explain this number" — the movement that
                                    produced the balance, not just the list under it. */}
                                {ledgerSummary ? (
                                  <div style={{ fontSize: 11.5, color: "var(--r-fg-3)", paddingBottom: 6, borderBottom: "1px dashed var(--r-hairline)" }}>
                                    Opened at ₹{ledgerSummary.openingBalance.toLocaleString("en-IN")} {ledgerSummary.openingSide} · {" "}
                                    ₹{ledgerSummary.totalDebit.toLocaleString("en-IN")} debited, ₹{ledgerSummary.totalCredit.toLocaleString("en-IN")} credited this year · {" "}
                                    closes at ₹{ledgerSummary.closingBalance.toLocaleString("en-IN")} {ledgerSummary.closingSide}
                                  </div>
                                ) : null}
                                <div style={{ display: "grid", gap: 4 }}>
                                  {ledgerRows.map((l) => (
                                    <div key={l.lineId} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
                                      <span className="revamp-num" style={{ color: "var(--r-fg-4)", width: 84, flexShrink: 0 }}>
                                        {l.date ? new Date(l.date).toLocaleDateString("en-IN") : "—"}
                                      </span>
                                      <span style={{ flex: 1, minWidth: 140, color: "var(--r-fg-3)" }}>{l.narration || "—"}</span>
                                      <span className="revamp-num" style={{ minWidth: 90, textAlign: "right", color: l.debit ? "var(--r-fg-1)" : "var(--r-fg-5)" }}>
                                        {l.debit ? `Dr ₹${l.debit.toLocaleString("en-IN")}` : ""}
                                      </span>
                                      <span className="revamp-num" style={{ minWidth: 90, textAlign: "right", color: l.credit ? "var(--r-fg-1)" : "var(--r-fg-5)" }}>
                                        {l.credit ? `Cr ₹${l.credit.toLocaleString("en-IN")}` : ""}
                                      </span>
                                      {l.voucherNumber ? (
                                        <Btn
                                          size="sm"
                                          onClick={() => {
                                            pushRecent({ type: "voucher", id: l.voucherId, label: `${l.voucherNumber} — ${l.narration || a.name}`, href: `/admin/accounting/books?tab=entries&open=${l.voucherId}&q=${encodeURIComponent(l.voucherNumber)}` });
                                            router.push(`/admin/accounting/books?tab=entries&open=${l.voucherId}&q=${encodeURIComponent(l.voucherNumber)}`);
                                          }}
                                        >
                                          {l.voucherNumber}
                                        </Btn>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* ── available to add ───────────────────────────────────────
              Template heads not currently in the chart — includes heads
              deliberately removed earlier, one click from coming back
              (design doc §12 Phase 3 accept: "listed under Available to add"). */}
          {available.length ? (
            <div style={{ marginTop: 24 }}>
              <SectionLabel icon="plus-circle">Available to add</SectionLabel>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.55 }}>
                Standard heads not currently in your chart — some may have been switched off or removed on purpose.
              </p>
              <Card padded={false}>
                {available.map((spec, i, arr) => (
                  <div
                    key={spec.code}
                    style={{
                      display: "flex", gap: 12, padding: "9px 15px", alignItems: "center",
                      borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--r-hairline)",
                    }}
                  >
                    <span className="revamp-num" style={{ fontSize: 12, fontWeight: 700, color: "var(--r-fg-4)", width: 46, flexShrink: 0 }}>
                      {spec.code}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: "var(--r-fg-2)" }}>{spec.name}</span>
                    <Btn size="sm" icon="plus" disabled={busyId === spec.code} onClick={() => adopt(spec)}>
                      {busyId === spec.code ? "…" : "Add"}
                    </Btn>
                  </div>
                ))}
              </Card>
            </div>
          ) : null}

          <p style={{ fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.65, marginTop: 16 }}>
            What can be renamed, switched off, or deleted depends on whether a head is mapped in the fiscal
            configuration, referenced by a posting rule, or already has journal lines against it — an account with
            history is switched off, never deleted, so past entries keep pointing at it.
          </p>
        </>
      )}
    </div>
  );
}
