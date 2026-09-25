"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import RSelect from "react-select";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import notify from "@/lib/notify";
import {
  PageHeader, Card, CardHead, Btn, Pill, Icon, Avatar, SearchInput, Select,
  Tabs, DataTable, EmptyState, Modal, RevampSkeleton, Toast,
} from "@/components/revamp";
import PaymentsBand from "@/components/money/PaymentsBand";
import LateBand from "@/components/money/LateBand";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const MODES = ["", "Cash", "Cheque", "Online", "UPI", "NEFT", "RTGS", "System"];
const RECORD_MODES = ["Cash", "Cheque", "Online", "UPI", "NEFT", "RTGS"];
const DASH = "—";
const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (v) => {
  if (!v) return DASH;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const MODE_ICON = { Cash: "banknote", Cheque: "file-text", Online: "globe", UPI: "smartphone", NEFT: "landmark", RTGS: "landmark", System: "cog" };

// Themed to match the --r-* token system rather than react-select's default
// palette, so the member picker actually repaints in dark mode instead of
// staying a light-mode-only control on a dark page.
const rselectTheme = {
  control: (base, state) => ({
    ...base, minHeight: 36, background: "var(--r-surface)",
    borderColor: state.isFocused ? "var(--r-brand)" : "var(--r-border)",
    boxShadow: state.isFocused ? "0 0 0 3px var(--r-brand-soft)" : "none",
    borderRadius: 8, fontSize: 13,
  }),
  valueContainer: (base) => ({ ...base, padding: "2px 10px" }),
  input: (base) => ({ ...base, color: "var(--r-fg-1)" }),
  singleValue: (base) => ({ ...base, color: "var(--r-fg-1)" }),
  placeholder: (base) => ({ ...base, color: "var(--r-fg-4)" }),
  menu: (base) => ({ ...base, zIndex: 9999, background: "var(--r-surface)", border: "1px solid var(--r-hairline)", boxShadow: "var(--r-shadow-pop)" }),
  option: (base, state) => ({
    ...base, fontSize: 13,
    background: state.isSelected ? "var(--r-brand)" : state.isFocused ? "var(--r-surface-2)" : "transparent",
    color: state.isSelected ? "var(--r-brand-ink)" : "var(--r-fg-1)",
  }),
  indicatorSeparator: (base) => ({ ...base, background: "var(--r-border)" }),
  dropdownIndicator: (base) => ({ ...base, color: "var(--r-fg-4)" }),
  clearIndicator: (base) => ({ ...base, color: "var(--r-fg-4)" }),
};

const EMPTY_FILTERS = { paymentMode: "", from: "", to: "", includeReversed: false };

/** Label + `.input`/`.label` (styles/globals.css) form field — payments has
 * no form fields of its own in the revamp kit, so this reuses the app-wide
 * token-driven input styling instead of inventing a third one. */
function Field({ label, required, children }) {
  return (
    <div>
      <label className="label">{label}{required ? " *" : ""}</label>
      {children}
    </div>
  );
}

export default function PaymentsPage() {
  const [tab, setTab] = useState("received"); // received | pending
  const qc = useQueryClient();
  // The bands above the lists cache their figures; refresh them after any change.
  const refreshBands = useCallback(() => qc.invalidateQueries({ queryKey: ["money-insights"] }), [qc]);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Received list state (folded in from the old payments-received page) ──
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [edit, setEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ page: String(page), limit: "50" });
      if (filters.paymentMode) p.set("paymentMode", filters.paymentMode);
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
      if (filters.includeReversed) p.set("includeReversed", "1");
      setData(await api(`/api/admin/payments/received?${p.toString()}`));
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { if (tab === "received") load(); }, [load, tab]);

  const rows = useMemo(() => {
    const list = (data && data.payments) || [];
    const term = q.trim().toLowerCase();
    if (!term) return list;
    return list.filter((r) =>
      [r.transactionId, r.description, r.notes, r.transactionRef, r.chequeNo,
        r.member && r.member.flatNo, r.member && r.member.ownerName]
        .filter(Boolean).join(" ").toLowerCase().includes(term),
    );
  }, [data, q]);

  const summary = (data && data.summary) || { count: 0, amount: 0, interest: 0, principal: 0, advance: 0 };

  async function saveEdit() {
    setSaving(true);
    try {
      await api(`/api/admin/payments/received/${edit._id}`, {
        method: "PATCH",
        body: JSON.stringify({
          paymentMode: edit.paymentMode || "",
          transactionRef: edit.transactionRef || "",
          chequeNo: edit.chequeNo || "",
          bankName: edit.bankName || "",
          upiId: edit.upiId || "",
          notes: edit.notes || "",
          date: edit.date,
        }),
      });
      setToast({ type: "success", message: "Payment updated" });
      refreshBands();
      setEdit(null);
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function reverse(row) {
    const reason = await notify.prompt(
      `Reverse ${row.transactionId} (${money(row.amount)})?\n\nThe original stays in the ledger flagged as reversed and a mirror entry cancels it. Reason:`,
      "",
    );
    if (reason === null) return;
    try {
      const res = await api(`/api/admin/payments/received/${row._id}`, {
        method: "POST",
        body: JSON.stringify({ action: "reverse", reason }),
      });
      setToast({ type: "success", message: res.warning || "Payment reversed" });
      refreshBands();
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    }
  }

  function exportCsv() {
    const head = ["Txn ID", "Date", "Flat", "Owner", "Amount", "Mode", "Interest", "Principal", "Advance", "Reversed", "Notes"];
    const lines = rows.map((r) => [
      r.transactionId, fmtDate(r.date),
      r.member ? `${r.member.wing || ""}${r.member.wing ? "-" : ""}${r.member.flatNo}` : "",
      r.member ? r.member.ownerName : "",
      r.amount, r.paymentMode || "",
      (r.breakdown && r.breakdown.interestCleared) || 0,
      (r.breakdown && r.breakdown.principalCleared) || 0,
      (r.breakdown && r.breakdown.advanceCredit) || 0,
      r.isReversed ? "YES" : "", (r.notes || "").replace(/"/g, "'"),
    ]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${c === undefined || c === null ? "" : c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments-received-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Pending / outstanding tab (late-list is the authoritative list of
  // members whose oldest unpaid bill is past the payment deadline; see gap
  // note in report — it does not include members who are outstanding but
  // still within the payment window) ──
  const [pending, setPending] = useState(null);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingDone, setPendingDone] = useState(null);

  const loadPending = useCallback(async () => {
    setPendingLoading(true);
    try {
      const [late, done] = await Promise.all([
        api("/api/payments/late-list"),
        api("/api/payments/pending-done").catch(() => null),
      ]);
      setPending(late);
      setPendingDone(done);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setPendingLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === "pending") loadPending(); }, [tab, loadPending]);

  // ── Record-payment modal (ported CREATE flow from the old advanced
  // payments page — posts to the same /api/payments/record + mark-done
  // routes) ──
  const [recordOpen, setRecordOpen] = useState(false);
  const [members, setMembers] = useState(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [outstanding, setOutstanding] = useState(null);
  const [outstandingLoading, setOutstandingLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("Cash");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [transactionRef, setTransactionRef] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);

  function resetRecordForm() {
    setSelectedMemberId("");
    setOutstanding(null);
    setAmount("");
    setMode("Cash");
    setPayDate(new Date().toISOString().split("T")[0]);
    setChequeNo("");
    setBankName("");
    setUpiId("");
    setTransactionRef("");
    setNotes("");
  }

  function openRecordModal(prefillMemberId) {
    resetRecordForm();
    if (prefillMemberId) setSelectedMemberId(prefillMemberId);
    setRecordOpen(true);
    if (!members) {
      setMembersLoading(true);
      api("/api/members/list")
        .then((d) => setMembers(d.members || []))
        .catch((err) => setToast({ type: "error", message: err.message }))
        .finally(() => setMembersLoading(false));
    }
  }

  useEffect(() => {
    if (!recordOpen || !selectedMemberId) { setOutstanding(null); return; }
    let cancelled = false;
    setOutstandingLoading(true);
    api(`/api/payments/outstanding?memberId=${selectedMemberId}`)
      .then((d) => { if (!cancelled) setOutstanding(d); })
      .catch((err) => { if (!cancelled) setToast({ type: "error", message: err.message }); })
      .finally(() => { if (!cancelled) setOutstandingLoading(false); });
    return () => { cancelled = true; };
  }, [recordOpen, selectedMemberId]);

  const memberOptions = useMemo(() => (
    (members || [])
      .slice()
      .sort((a, b) => {
        const wingCompare = (a.wing || "").localeCompare(b.wing || "");
        if (wingCompare !== 0) return wingCompare;
        return (parseInt(a.roomNo) || 0) - (parseInt(b.roomNo) || 0);
      })
      .map((m) => ({
        value: m._id,
        label: `${m.wing || ""}-${m.roomNo} | ${m.ownerName} | ${m.areaSqFt} sq.ft`,
      }))
  ), [members]);

  const selectedMember = useMemo(
    () => (members || []).find((m) => m._id === selectedMemberId),
    [members, selectedMemberId],
  );

  function quickPay(pct) {
    if (outstanding?.totalOutstanding) {
      setAmount(String(Math.round((outstanding.totalOutstanding * pct) / 100)));
    }
  }

  async function submitPayment(e) {
    e.preventDefault();
    if (!selectedMemberId || !amount || parseFloat(amount) <= 0) {
      setToast({ type: "error", message: "Select a member and enter a valid amount" });
      return;
    }
    if (outstanding?.billPayFinalDate) {
      const finalDate = new Date(outstanding.billPayFinalDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (today > finalDate) {
        setToast({ type: "error", message: `Payment window closed on ${finalDate.toLocaleDateString("en-IN")}. Use the Pending tab to record late payments.` });
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await api("/api/payments/record", {
        method: "POST",
        body: JSON.stringify({
          memberId: selectedMemberId,
          amount: parseFloat(amount),
          paymentMode: mode,
          paymentDate: payDate,
          chequeNo: mode === "Cheque" ? chequeNo : undefined,
          bankName: mode === "Cheque" ? bankName : undefined,
          upiId: mode === "UPI" ? upiId : undefined,
          transactionRef: ["Online", "NEFT", "RTGS"].includes(mode) ? transactionRef : undefined,
          notes,
        }),
      });
      setToast({ type: "success", message: `Payment ${res?.transaction?.transactionId || ""} recorded` });
      setRecordOpen(false);
      refreshBands();
      resetRecordForm();
      if (tab === "received") load();
      if (tab === "pending") loadPending();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function markDone() {
    if (!selectedMemberId || !amount || parseFloat(amount) <= 0) {
      setToast({ type: "error", message: "Select a member and enter a valid amount" });
      return;
    }
    setMarkingDone(true);
    try {
      await api("/api/payments/mark-done", {
        method: "POST",
        body: JSON.stringify({
          memberId: selectedMemberId,
          amount: parseFloat(amount),
          paymentMode: mode,
          paymentDate: payDate,
          notes,
        }),
      });
      setToast({ type: "success", message: "Marked as Payment Done (pending Excel confirmation)" });
      setRecordOpen(false);
      refreshBands();
      resetRecordForm();
      if (tab === "pending") loadPending();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setMarkingDone(false);
    }
  }

  // ── DataTable column sets ────────────────────────────────────────────
  const receivedCols = [
    {
      key: "txn", label: "Transaction", render: (r) => (
        <div>
          <div style={{ fontWeight: 700, color: "var(--r-fg-1)", display: "flex", alignItems: "center", gap: 6 }}>
            {r.transactionId}
            {r.isReversed && <Pill tone="unpaid" dot={false}>Reversed</Pill>}
          </div>
          {r.billPeriodId && <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 2 }}>{r.billPeriodId}</div>}
        </div>
      ),
    },
    { key: "date", label: "Date", render: (r) => <span style={{ color: "var(--r-fg-3)" }}>{fmtDate(r.date)}</span> },
    {
      key: "member", label: "Flat / owner", render: (r) => {
        const flat = r.member ? `${r.member.wing ? `${r.member.wing}-` : ""}${r.member.flatNo || DASH}` : DASH;
        const name = r.member ? r.member.ownerName : "";
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Avatar name={name || flat} size={28} />
            <div>
              <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{flat}</div>
              <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>{name}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: "amount", label: "Amount", align: "right", render: (r) => (
        <span className="revamp-num" style={{ fontWeight: 800, color: r.isReversed ? "var(--r-fg-4)" : "var(--r-success)" }}>
          {money(r.amount)}
        </span>
      ),
    },
    {
      key: "mode", label: "Mode", render: (r) => (
        <div>
          <Pill tone="info" dot={false}><Icon name={MODE_ICON[r.paymentMode] || "credit-card"} size={11} /> {r.paymentMode || DASH}</Pill>
          {(r.transactionRef || r.chequeNo) && (
            <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 4 }}>{r.chequeNo || r.transactionRef}</div>
          )}
        </div>
      ),
    },
    {
      key: "alloc", label: "Allocation", render: (r) => {
        const b = r.breakdown || {};
        return (
          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
            <div>Interest {money(b.interestCleared)}</div>
            <div>Principal {money(b.principalCleared)}</div>
            {b.advanceCredit ? <div style={{ color: "var(--r-accent)", fontWeight: 700 }}>Advance {money(b.advanceCredit)}</div> : null}
          </div>
        );
      },
    },
    {
      key: "actions", label: "", render: (r) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Btn size="sm" variant="ghost" icon="pencil" disabled={r.isReversed}
            onClick={() => setEdit({ ...r, date: r.date ? String(r.date).slice(0, 10) : "" })}>Edit</Btn>
          <Btn size="sm" variant="ghost" icon="rotate-ccw" disabled={r.isReversed} onClick={() => reverse(r)}>Reverse</Btn>
        </div>
      ),
    },
  ];

  const pendingCols = [
    { key: "flat", label: "Flat", render: (m) => <span style={{ fontWeight: 600 }}>{m.wing}-{m.flatNo}</span> },
    { key: "member", label: "Member", render: (m) => m.ownerName },
    { key: "period", label: "Oldest period", render: (m) => <span style={{ color: "var(--r-fg-3)" }}>{m.oldestPeriod}</span> },
    { key: "deadline", label: "Deadline", render: (m) => <span style={{ color: "var(--r-danger)", fontWeight: 700 }}>{fmtDate(m.deadline)}</span> },
    { key: "principal", label: "Principal", align: "right", render: (m) => <span className="revamp-num">{money(m.principalOutstanding)}</span> },
    { key: "interest", label: "Interest", align: "right", render: (m) => <span className="revamp-num" style={{ color: "var(--r-danger)" }}>{money(m.interestOutstanding)}</span> },
    { key: "total", label: "Total due", align: "right", render: (m) => <span className="revamp-num" style={{ fontWeight: 800 }}>{money(m.totalOutstanding)}</span> },
    { key: "actions", label: "", render: (m) => <Btn size="sm" variant="primary" icon="plus" onClick={() => openRecordModal(m.memberId)}>Record</Btn> },
  ];

  const pendingDoneCols = [
    { key: "flat", label: "Flat" },
    { key: "memberName", label: "Member" },
    { key: "billPeriodId", label: "Period" },
    { key: "amount", label: "Amount", align: "right", render: (b) => <span className="revamp-num" style={{ fontWeight: 700 }}>{money(b.amount)}</span> },
    { key: "paymentMode", label: "Mode" },
    { key: "paymentDate", label: "Date", render: (b) => fmtDate(b.paymentDate) },
    { key: "notes", label: "Notes", render: (b) => <span style={{ color: "var(--r-fg-4)", fontSize: 12 }}>{b.notes || DASH}</span> },
  ];

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="wallet" size={11} /> Money · Payments</>}
        title="Payments"
        sub="Record payments, review what's been received, and track members who are pending or overdue."
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="primary" icon="plus" onClick={() => openRecordModal()}>Record payment</Btn>
            {tab === "received" && <Btn variant="secondary" icon="download" onClick={exportCsv}>Export</Btn>}
            <Btn variant="ghost" icon="refresh-cw" onClick={() => (tab === "received" ? load() : loadPending())} title="Refresh" />
          </div>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "received", label: "Received", icon: "arrow-down-circle" },
          { key: "pending", label: "Pending / Outstanding", icon: "alarm-clock", badge: pending?.totalMembers || undefined },
        ]}
      />

      {tab === "received" && (
        <>
          <PaymentsBand />
          <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", margin: "-4px 0 10px" }}>
            Showing {summary.count} payment{summary.count === 1 ? "" : "s"} · {money(summary.amount)} for these filters
          </div>

          <Card style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>From</div>
                <input type="date" className="input" style={{ padding: "7px 10px", width: "auto" }} value={filters.from}
                  onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, from: e.target.value })); }} />
              </div>
              <div>
                <div className="label" style={{ marginBottom: 4 }}>To</div>
                <input type="date" className="input" style={{ padding: "7px 10px", width: "auto" }} value={filters.to}
                  onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, to: e.target.value })); }} />
              </div>
              <div style={{ width: 160 }}>
                <div className="label" style={{ marginBottom: 4 }}>Mode</div>
                <Select value={filters.paymentMode} size="md"
                  onChange={(v) => { setPage(1); setFilters((f) => ({ ...f, paymentMode: v })); }}>
                  {MODES.map((m) => <option key={m} value={m}>{m || "All modes"}</option>)}
                </Select>
              </div>
              <label style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 9, fontSize: 12.5, color: "var(--r-fg-3)" }}>
                <input type="checkbox" checked={filters.includeReversed}
                  onChange={(e) => { setPage(1); setFilters((f) => ({ ...f, includeReversed: e.target.checked })); }} />
                Show reversed
              </label>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="label" style={{ marginBottom: 4 }}>Search</div>
                <SearchInput value={q} onChange={setQ} placeholder="Txn id, flat, owner, ref..." size="md" />
              </div>
              <Btn variant="ghost" onClick={() => { setQ(""); setPage(1); setFilters(EMPTY_FILTERS); }}>Clear</Btn>
            </div>
          </Card>

          {loading ? (
            <RevampSkeleton h={320} />
          ) : (
            <DataTable
              cols={receivedCols}
              rows={rows}
              rowKey="_id"
              emptyIcon="inbox"
              emptyTitle="No payments"
              emptySub="Nothing matches these filters."
            />
          )}

          {data && data.pages > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 14 }}>
              <Btn size="sm" variant="ghost" icon="chevron-left" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
              <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Page {data.page} of {data.pages}</span>
              <Btn size="sm" variant="ghost" iconR="chevron-right" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          )}
        </>
      )}

      {tab === "pending" && (
        <>
          {pendingDone?.bills?.length > 0 && (
            <Card style={{ marginBottom: 18 }} padded={false}>
              <div style={{ padding: "14px 18px 4px", display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="clock" size={16} color="var(--r-warning)" />
                <div style={{ fontWeight: 700, color: "var(--r-fg-1)" }}>
                  Payment Done — awaiting Excel confirmation
                </div>
                <Pill tone="warning" dot={false}>{pendingDone.bills.length}</Pill>
              </div>
              <div style={{ overflowX: "auto", padding: "0 0 4px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {pendingDoneCols.map((c) => (
                        <th key={c.key} style={{ textAlign: c.align || "left", padding: "8px 18px", fontSize: 11, fontWeight: 700, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: 0.3, borderBottom: "1px solid var(--r-hairline)" }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pendingDone.bills.map((b) => (
                      <tr key={b.billId}>
                        {pendingDoneCols.map((c) => (
                          <td key={c.key} style={{ padding: "10px 18px", textAlign: c.align || "left", color: "var(--r-fg-2)" }}>
                            {c.render ? c.render(b) : b[c.key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "4px 18px 14px", fontSize: 11.5, color: "var(--r-fg-4)" }}>
                Acknowledged cash/manual payments. Upload the payment Excel to allocate them and mark the bills Paid.
              </div>
            </Card>
          )}

          <LateBand onRecord={(m) => openRecordModal(m.memberId)} />

          <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginBottom: 12, lineHeight: 1.6 }}>
            Members whose oldest unpaid bill is past the payment deadline (payment window closed for them).
            Members with dues still inside the payment window are not listed here — see the "Received" tab
            totals or record a payment directly for any member via "Record payment".
          </div>

          {pendingLoading ? (
            <RevampSkeleton h={320} />
          ) : (
            <DataTable
              cols={pendingCols}
              rows={pending?.members || []}
              rowKey="memberId"
              emptyIcon="check-circle-2"
              emptyTitle="No overdue members"
              emptySub="Nobody is past their payment deadline."
            />
          )}
        </>
      )}

      {/* EDIT MODAL — metadata only, amount is intentionally immutable */}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit ? `Edit ${edit.transactionId}` : ""} width={520}>
        {edit && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ padding: 12, borderRadius: 8, background: "var(--r-surface-2)", fontSize: 12.5, color: "var(--r-fg-4)", display: "flex", gap: 8 }}>
              <Icon name="info" size={15} color="var(--r-fg-4)" style={{ marginTop: 1, flexShrink: 0 }} />
              <span>Amount ({money(edit.amount)}) cannot be edited here — changing it would desynchronise
                bill allocation and receipts. Reverse this payment and record a corrected one instead.</span>
            </div>
            <Field label="Value date">
              <input type="date" className="input" value={edit.date || ""}
                onChange={(e) => setEdit((s) => ({ ...s, date: e.target.value }))} />
            </Field>
            <Field label="Payment mode">
              <select className="input" value={edit.paymentMode || ""}
                onChange={(e) => setEdit((s) => ({ ...s, paymentMode: e.target.value }))}>
                {MODES.filter(Boolean).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Reference / UTR">
              <input className="input" value={edit.transactionRef || ""}
                onChange={(e) => setEdit((s) => ({ ...s, transactionRef: e.target.value }))} />
            </Field>
            <Field label="Cheque no.">
              <input className="input" value={edit.chequeNo || ""}
                onChange={(e) => setEdit((s) => ({ ...s, chequeNo: e.target.value }))} />
            </Field>
            <Field label="Bank">
              <input className="input" value={edit.bankName || ""}
                onChange={(e) => setEdit((s) => ({ ...s, bankName: e.target.value }))} />
            </Field>
            <Field label="UPI id">
              <input className="input" value={edit.upiId || ""}
                onChange={(e) => setEdit((s) => ({ ...s, upiId: e.target.value }))} />
            </Field>
            <Field label="Notes">
              <textarea rows={3} className="input" value={edit.notes || ""}
                onChange={(e) => setEdit((s) => ({ ...s, notes: e.target.value }))} />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" disabled={saving} onClick={saveEdit}>{saving ? "Saving..." : "Save changes"}</Btn>
              <Btn variant="ghost" onClick={() => setEdit(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* RECORD PAYMENT MODAL — ported CREATE flow */}
      <Modal open={recordOpen} onClose={() => { setRecordOpen(false); resetRecordForm(); }} title="Record a payment" width={640}>
        <form onSubmit={submitPayment} style={{ display: "grid", gap: 16 }}>
          <Field label="Member" required>
            <RSelect
              options={memberOptions}
              value={memberOptions.find((o) => o.value === selectedMemberId) || null}
              onChange={(opt) => setSelectedMemberId(opt?.value || "")}
              placeholder={membersLoading ? "Loading members..." : "Search by room, name or wing..."}
              isClearable
              isSearchable
              isLoading={membersLoading}
              styles={rselectTheme}
            />
          </Field>

          {outstandingLoading && (
            <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
              <span className="pulse-loader" style={{ width: 28, height: 28 }} />
            </div>
          )}

          <AnimatePresence>
            {outstanding && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                style={{ overflow: "hidden" }}
              >
                <Card
                  style={{
                    background: outstanding.isPaymentBlocked ? "var(--r-danger-soft)" : "var(--r-brand-soft)",
                    border: "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "var(--r-fg-1)" }}>{selectedMember?.wing}-{selectedMember?.roomNo}</div>
                      <div style={{ fontSize: 12, color: "var(--r-fg-4)" }}>{selectedMember?.ownerName}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>Total outstanding</div>
                      <div className="revamp-num" style={{ fontWeight: 800, fontSize: 19, color: "var(--r-danger)" }}>{money(outstanding.totalOutstanding)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--r-fg-3)" }}>
                    Principal {money(outstanding.principalAmount)} · Interest {money(outstanding.interestAmount)}
                  </div>
                  {outstanding.isPaymentBlocked && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--r-danger)", fontWeight: 600, display: "flex", gap: 6 }}>
                      <Icon name="alert-triangle" size={14} />
                      {outstanding.blockMessage || "Payment window closed for this member."}
                    </div>
                  )}
                  {outstanding.totalOutstanding > 0 && (
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {[25, 50, 75, 100].map((pct) => (
                        <Btn key={pct} type="button" size="sm" variant="secondary" onClick={() => quickPay(pct)}>
                          {pct}% ({money((outstanding.totalOutstanding * pct) / 100)})
                        </Btn>
                      ))}
                    </div>
                  )}
                </Card>
              </motion.div>
            )}
          </AnimatePresence>

          <Field label="Payment amount (₹)" required>
            <input type="number" min="1" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" />
          </Field>

          <Field label="Payment mode" required>
            <Select value={mode} size="md" onChange={setMode}>
              {RECORD_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </Field>

          {mode === "Cheque" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Cheque no."><input className="input" value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></Field>
              <Field label="Bank"><input className="input" value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field>
            </div>
          )}
          {mode === "UPI" && (
            <Field label="UPI id"><input className="input" value={upiId} onChange={(e) => setUpiId(e.target.value)} /></Field>
          )}
          {["Online", "NEFT", "RTGS"].includes(mode) && (
            <Field label="Reference / UTR"><input className="input" value={transactionRef} onChange={(e) => setTransactionRef(e.target.value)} /></Field>
          )}

          <Field label="Payment date" required>
            <input type="date" className="input" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </Field>

          <Field label="Notes">
            <textarea rows={3} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
          </Field>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn type="submit" variant="primary" disabled={!selectedMemberId || !amount || submitting}>
              {submitting ? "Recording..." : "Record payment"}
            </Btn>
            <Btn type="button" variant="secondary" disabled={!selectedMemberId || !amount || markingDone} onClick={markDone}>
              {markingDone ? "Marking..." : "Mark done (cash, confirm via Excel)"}
            </Btn>
            <Btn type="button" variant="ghost" onClick={() => { setRecordOpen(false); resetRecordForm(); }}>Cancel</Btn>
          </div>
        </form>
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
