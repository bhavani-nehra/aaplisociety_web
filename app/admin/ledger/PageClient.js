"use client";
/**
 * Ledger — makeover plan §7.3. "What's the complete money history of a flat
 * or the society?" A real ledger table (Date · Voucher · Flat · Particulars ·
 * Debit · Credit · Balance), read from the society's books: a positive
 * balance is a receivable and prints as Dr, an advance prints as Cr — no
 * minus signs, no red/green on the figure itself. Every total above the
 * table follows the active filter. Pick a flat and the page reads as its
 * statement (opening, charged, paid, closing).
 */
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import Select from "react-select";
import notify from "@/lib/notify";
import {
  PageHeader, Icon, Btn, SearchInput, DataTable, RevampSkeleton, Drawer, Modal,
} from "@/components/revamp";
import PassbookBand from "@/components/money/PassbookBand";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fullMoney = (n) =>
  typeof n === "number"
    ? n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
    : "₹0";
const formatBalance = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) < 0.005) return "Settled";
  return `${fullMoney(Math.abs(n))} ${n > 0 ? "Dr" : "Cr"}`;
};
const formatDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
const formatDateTime = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const formatPeriod = (m, y) => `${MONTHS[(m || 1) - 1]?.slice(0, 3) || ""} ${y || ""}`.trim();
const flatLabel = (wing, flatNo) => `${wing ? `${wing}-` : ""}${flatNo || ""}`;
const properName = (n) => n || "";
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <Btn variant="secondary" icon="more-vertical" onClick={() => setOpen((v) => !v)} />
      {open ? (
        <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 4, background: "var(--r-surface)", border: "1px solid var(--r-border)", borderRadius: 8, boxShadow: "var(--r-shadow-pop)", zIndex: 20, minWidth: 160 }}>
          {items.map((it) => (
            <button key={it.label} type="button" onClick={() => { setOpen(false); it.onClick(); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", border: "none", background: "none", fontSize: 13, textAlign: "left", cursor: "pointer", color: "var(--r-fg-1)" }}>
              <Icon name={it.icon} size={14} />{it.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const selectTheme = {
  control: (base, state) => ({
    ...base, minHeight: 32, height: 32, fontSize: 13, background: "var(--r-surface-3)",
    borderColor: state.isFocused ? "var(--r-brand)" : "var(--r-border-strong)", borderRadius: 8,
    boxShadow: state.isFocused ? "0 0 0 3px var(--r-brand-soft)" : "none",
  }),
  valueContainer: (base) => ({ ...base, padding: "0 8px" }),
  indicatorsContainer: (base) => ({ ...base, height: 30 }),
  input: (base) => ({ ...base, color: "var(--r-fg-1)" }),
  singleValue: (base) => ({ ...base, color: "var(--r-fg-1)" }),
  placeholder: (base) => ({ ...base, color: "var(--r-fg-4)" }),
  menu: (base) => ({ ...base, zIndex: 50, fontSize: 13, background: "var(--r-surface)", border: "1px solid var(--r-border)", boxShadow: "var(--r-shadow-pop)" }),
  option: (base, state) => ({
    ...base,
    background: state.isSelected ? "var(--r-brand)" : state.isFocused ? "var(--r-surface-3)" : "transparent",
    color: state.isSelected ? "var(--r-brand-ink)" : "var(--r-fg-1)",
  }),
  indicatorSeparator: () => ({ display: "none" }),
};
const VIEWS_KEY = "ledger-saved-views";

export default function UltraAdvancedLedgerPage() {
  const queryClient = useQueryClient();
  // ========== STATE MANAGEMENT ==========
  const [filters, setFilters] = useState({
    memberId: "all",
    category: "all",
    type: "all",
    month: "",
    year: "",
    paymentMode: "all",
    wing: "all",
    startDate: "",
    endDate: "",
    minAmount: "",
    maxAmount: "",
    balanceStatus: "all",
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [groupBy, setGroupBy] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(100);
  const [savedViews, setSavedViews] = useState([]);
  const [newViewName, setNewViewName] = useState("");
  const [showColumnToggle, setShowColumnToggle] = useState(false);
  // Deep-link support: a universal-search "View Ledger" result opens this
  // page pre-filtered to the member it was searched for, e.g.
  // /admin/ledger?memberId=<id> — read once on mount via window.location so
  // this doesn't need a Suspense boundary just for one query param.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const mid = sp.get("memberId") || sp.get("member");
    if (mid) setFilters((f) => ({ ...f, memberId: mid }));
  }, []);
  const [visibleColumns, setVisibleColumns] = useState({
    date: true,
    txnId: true,
    member: true,
    category: true,
    description: true,
    paymentMode: true,
    debit: true,
    credit: true,
    balance: true,
    recordedBy: true,
    billPeriod: true,
    financialYear: false,
  });
  // ========== DATA FETCHING ==========
  const { data: membersData } = useQuery({
    queryKey: ["members"],
    queryFn: () => apiClient.get("/api/members/list?limit=1000"),
  });
  const buildQueryString = () => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== "all") {
        params.append(key, value);
      }
    });
    if (sortBy) params.append("sortBy", sortBy);
    if (sortOrder) params.append("sortOrder", sortOrder);
    if (groupBy) params.append("groupBy", groupBy);
    params.append("page", page);
    params.append("limit", limit);
    return params.toString();
  };
  const {
    data: ledgerData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["ledger", filters, sortBy, sortOrder, groupBy, page, limit],
    queryFn: () => apiClient.get(`/api/ledger/fetch?${buildQueryString()}`),
  });
  // ========== ANALYTICS CALCULATIONS ==========
  const analytics = {
    totalTransactions: ledgerData?.transactions?.length || 0,
    totalDebit: ledgerData?.summary?.totalDebit || 0,
    totalCredit: ledgerData?.summary?.totalCredit || 0,
    netBalance: ledgerData?.summary?.netBalance || 0,
    openingBalance: ledgerData?.summary?.openingBalance || 0,
  };
  // Interest-specific analytics
  const interestAnalytics = {
    totalInterest: 0,
    interestCount: 0,
    avgInterest: 0,
    maxInterest: 0,
    minInterest: 0,
    interestByMonth: {},
    topInterestPayers: [],
    interestTrend: [],
  };
  if (ledgerData?.transactions) {
    const interestTransactions = ledgerData.transactions.filter(
      (t) => t.category === "Interest"
    );
    interestAnalytics.totalInterest = interestTransactions.reduce(
      (sum, t) => sum + t.amount,
      0
    );
    interestAnalytics.interestCount = interestTransactions.length;
    if (interestTransactions.length > 0) {
      interestAnalytics.avgInterest =
        interestAnalytics.totalInterest / interestTransactions.length;
      interestAnalytics.maxInterest = Math.max(
        ...interestTransactions.map((t) => t.amount)
      );
      interestAnalytics.minInterest = Math.min(
        ...interestTransactions.map((t) => t.amount)
      );
      // Group by month
      interestTransactions.forEach((t) => {
        const date = new Date(t.date);
        const monthKey = `${date.getFullYear()}-${String(
          date.getMonth() + 1
        ).padStart(2, "0")}`;
        if (!interestAnalytics.interestByMonth[monthKey]) {
          interestAnalytics.interestByMonth[monthKey] = {
            count: 0,
            total: 0,
          };
        }
        interestAnalytics.interestByMonth[monthKey].count += 1;
        interestAnalytics.interestByMonth[monthKey].total += t.amount;
      });
      // Top interest payers
      const interestByMember = {};
      interestTransactions.forEach((t) => {
        const key = t.memberId?._id || "Unknown";
        if (!interestByMember[key]) {
          interestByMember[key] = {
            member: t.memberId,
            totalInterest: 0,
            count: 0,
            transactions: [],
          };
        }
        interestByMember[key].totalInterest += t.amount;
        interestByMember[key].count += 1;
        interestByMember[key].transactions.push(t);
      });
      interestAnalytics.topInterestPayers = Object.values(interestByMember)
        .sort((a, b) => b.totalInterest - a.totalInterest)
        .slice(0, 10);
      // Interest trend (last 6 months)
      const months = Object.keys(interestAnalytics.interestByMonth)
        .sort()
        .slice(-6);
      interestAnalytics.interestTrend = months.map((month) => ({
        month,
        ...interestAnalytics.interestByMonth[month],
      }));
    }
  }
  // Payment analytics
  const paymentAnalytics = {
    cashPayments: 0,
    onlinePayments: 0,
    chequePayments: 0,
    upiPayments: 0,
    totalPayments: 0,
  };
  if (ledgerData?.transactions) {
    const payments = ledgerData.transactions.filter(
      (t) => t.category === "Payment"
    );
    paymentAnalytics.totalPayments = payments.reduce(
      (sum, t) => sum + t.amount,
      0
    );
    payments.forEach((t) => {
      switch (t.paymentMode) {
        case "Cash":
          paymentAnalytics.cashPayments += t.amount;
          break;
        case "Online":
          paymentAnalytics.onlinePayments += t.amount;
          break;
        case "Cheque":
          paymentAnalytics.chequePayments += t.amount;
          break;
        case "UPI":
          paymentAnalytics.upiPayments += t.amount;
          break;
      }
    });
  }
  // ========== HANDLERS ==========
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset to first page
  };
  const resetFilters = () => {
    setFilters({
      memberId: "all",
      category: "all",
      type: "all",
      month: "",
      year: "",
      paymentMode: "all",
      wing: "all",
      startDate: "",
      endDate: "",
      minAmount: "",
      maxAmount: "",
      balanceStatus: "all",
    });
    setSearchTerm("");
    setPage(1);
  };
  const fetchTransactionDetails = async (transactionId) => {
    try {
      const data = await apiClient.get(
        `/api/ledger/transaction/${transactionId}`
      );
      setSelectedTransaction(data);
      setShowDetailModal(true);
    } catch (error) {
      console.error("Transaction detail error:", error);
      notify.error("Failed to fetch transaction details");
    }
  };
  const exportData = (format) => {
    const queryString = buildQueryString();
    window.open(`/api/ledger/export?${queryString}&format=${format}`, "_blank");
  };
  // Saved views live in this browser (a per-viewer convenience).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VIEWS_KEY);
      if (raw) setSavedViews(JSON.parse(raw));
    } catch (_) {}
  }, []);
  const persistViews = (views) => {
    setSavedViews(views);
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(views)); } catch (_) {}
  };
  const saveCurrentView = (nameArg) => {
    const name = String(nameArg ?? newViewName).trim();
    if (!name) {
      notify.warning("Give the view a name");
      return;
    }
    const view = {
      name,
      filters: { ...filters },
      sortBy,
      sortOrder,
      groupBy,
      visibleColumns: { ...visibleColumns },
    };
    persistViews([...savedViews.filter((v) => v.name !== name), view]);
    setNewViewName("");
    notify.success(`View “${name}” saved`);
  };
  const loadSavedView = (view) => {
    setFilters(view.filters);
    setSortBy(view.sortBy);
    setSortOrder(view.sortOrder);
    setGroupBy(view.groupBy);
    setVisibleColumns(view.visibleColumns);
    setPage(1);
  };
  const deleteSavedView = (index) => {
    persistViews(savedViews.filter((_, i) => i !== index));
  };
  // Filter transactions by search term
  const filteredTransactions = ledgerData?.transactions?.filter((txn) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      txn.transactionId?.toLowerCase().includes(search) ||
      txn.description?.toLowerCase().includes(search) ||
      txn.memberId?.ownerName?.toLowerCase().includes(search) ||
      txn.memberId?.flatNo?.toString().includes(search) ||
      txn.category?.toLowerCase().includes(search)
    );
  });
  // ========== MEMBER OPTIONS FOR SELECT ==========
  const memberOptions = [
    { value: "all", label: "All flats" },
    ...(membersData?.members || [])
      .sort((a, b) => {
        const wingCompare = (a.wing || "").localeCompare(b.wing || "");
        if (wingCompare !== 0) return wingCompare;
        return (parseInt(a.flatNo) || 0) - (parseInt(b.flatNo) || 0);
      })
      .map((member) => ({
        value: member._id,
        label: `${flatLabel(member.wing, member.flatNo)}  ${properName(member.ownerName)}`,
        member,
      })),
  ];
  const wings = useMemo(() => [...new Set((membersData?.members || []).map((m) => m.wing).filter(Boolean))].sort(), [membersData]);
  const yearsBack = useMemo(() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2, y - 3, y - 4]; }, []);
  // How many of the "More filters" drawer's fields are actually set, shown
  // as a badge on its trigger button so it's not a mystery black box.
  const advancedFilterCount = [
    filters.paymentMode !== "all",
    filters.wing !== "all",
    !!filters.month,
    !!filters.year,
    !!filters.startDate,
    !!filters.endDate,
    !!filters.minAmount,
    !!filters.maxAmount,
    !!groupBy,
  ].filter(Boolean).length;

  // ========== DERIVED, FOLLOWS THE FILTER (plan §5.6 / S8) ==========
  const shown = filteredTransactions || [];
  const shownDebit = shown.filter((t) => t.type === "Debit").reduce((s, t) => s + (t.amount || 0), 0);
  const shownCredit = shown.filter((t) => t.type === "Credit").reduce((s, t) => s + (t.amount || 0), 0);
  const totalEntries = ledgerData?.summary?.totalTransactions ?? ledgerData?.transactions?.length ?? 0;
  const selectedMember = filters.memberId !== "all" ? memberOptions.find((o) => o.value === filters.memberId)?.member : null;
  const categoryCounts = (ledgerData?.transactions || []).reduce((acc, t) => { acc[t.category] = (acc[t.category] || 0) + 1; return acc; }, {});
  const totalPages = ledgerData?.summary?.totalPages || 1;
  const anyFilter = Boolean(searchTerm) || Object.entries(filters).some(([k, v]) => v && v !== "all" && k !== "memberId") || !!groupBy;

  const balanceCell = (bal) => {
    const v = Number(bal || 0);
    if (Math.abs(v) < 0.005) return <span style={{ color: "var(--r-fg-4)" }}>{fullMoney(0)}</span>;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: v > 0 ? "var(--r-danger)" : "var(--r-success)", flexShrink: 0 }} />
        {formatBalance(v)}
      </span>
    );
  };

  const cols = [
    { key: "date", label: "Date", render: (t) => <span style={{ whiteSpace: "nowrap", color: "var(--r-fg-3)" }}>{formatDate(t.date)}</span> },
    { key: "voucher", label: "Voucher", render: (t) => <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--r-fg-3)", whiteSpace: "nowrap" }}>{t.transactionId || "—"}</span> },
    ...(selectedMember ? [] : [{
      key: "flat", label: "Flat", render: (t) => (t.memberId ? (
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--r-fg-1)", fontWeight: 500, whiteSpace: "nowrap" }}>{flatLabel(t.memberId.wing, t.memberId.flatNo)}</div>
          <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{properName(t.memberId.ownerName)}</div>
        </div>
      ) : <span style={{ color: "var(--r-fg-4)" }}>Society</span>),
    }]),
    {
      key: "particulars", label: "Particulars", render: (t) => (
        <div style={{ minWidth: 180, maxWidth: 360 }}>
          <div style={{ color: "var(--r-fg-1)" }}>{t.category}{t.billPeriodId ? <span style={{ color: "var(--r-fg-4)" }}> · {t.billPeriodId}</span> : null}</div>
          {t.description && <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.description}>{t.description}</div>}
        </div>
      ),
    },
    { key: "debit", label: "Debit", align: "right", render: (t) => (t.type === "Debit" ? fullMoney(t.amount) : "") },
    { key: "credit", label: "Credit", align: "right", render: (t) => (t.type === "Credit" ? fullMoney(t.amount) : "") },
    { key: "balance", label: selectedMember ? "Balance" : "Flat balance", align: "right", render: (t) => balanceCell(t.balanceAfterTransaction) },
  ];

  const interestRows = interestAnalytics.interestTrend.map((i) => {
    const [y, m] = i.month.split("-").map(Number);
    return { label: formatPeriod(m, y), value: i.total, note: `${i.count} ${i.count === 1 ? "entry" : "entries"}` };
  });
  const modeSegments = [
    { label: "UPI", value: paymentAnalytics.upiPayments },
    { label: "Online", value: paymentAnalytics.onlinePayments },
    { label: "Cash", value: paymentAnalytics.cashPayments },
    { label: "Cheque", value: paymentAnalytics.chequePayments },
  ];

  // ========== RENDER ==========
  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        title={selectedMember ? `Ledger · ${flatLabel(selectedMember.wing, selectedMember.flatNo)}` : "Ledger"}
        sub={selectedMember
          ? `${properName(selectedMember.ownerName)}. Debits are charges to the flat, credits are payments; the balance is from the society's books (Dr = owes).`
          : "Every entry in the members' books. Pick a flat to read it as a statement."}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {selectedMember && <Btn variant="secondary" icon="x" onClick={() => handleFilterChange("memberId", "all")}>All flats</Btn>}
            <OverflowMenu items={[
              { label: "Export Excel", icon: "file-spreadsheet", onClick: () => exportData("xlsx") },
              { label: "Export PDF", icon: "file-text", onClick: () => exportData("pdf") },
              { label: "Print", icon: "printer", onClick: () => window.print() },
            ]} />
          </div>
        }
      />

      {/* Passbook band: the whole society, or one flat's year once a flat is picked */}
      <div>
        <PassbookBand memberId={filters.memberId} />
        {selectedMember && !isLoading && (
          <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginTop: -6 }}>
            Rows below: opening {formatBalance(analytics.openingBalance)} · charged {fullMoney(shownDebit)} · paid {fullMoney(shownCredit)} · closing {formatBalance(analytics.netBalance)}
          </div>
        )}
      </div>

      {/* Filters — one row */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <div style={{ flex: "1 1 220px", maxWidth: 320 }}>
          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search voucher, flat, owner, particulars" size="sm" />
        </div>
        <div style={{ width: 240 }}>
          <Select
            inputId="ledger-member"
            aria-label="Flat"
            options={memberOptions}
            value={memberOptions.find((opt) => opt.value === filters.memberId)}
            onChange={(option) => handleFilterChange("memberId", option?.value || "all")}
            placeholder="All flats"
            isClearable
            isSearchable
            styles={selectTheme}
          />
        </div>
        <RSelectNative value={filters.type} onChange={(v) => handleFilterChange("type", v)} options={[["all", "Debits and credits"], ["Debit", "Debits only"], ["Credit", "Credits only"]]} label="Entry type" />
        <RSelectNative value={filters.balanceStatus} onChange={(v) => handleFilterChange("balanceStatus", v)} options={[["all", "Any balance"], ["arrears", "Owes (Dr)"], ["credit", "In advance (Cr)"], ["zero", "Settled"]]} label="Balance" />
        <Btn size="sm" variant="secondary" icon="sliders-horizontal" onClick={() => setShowAdvancedFilters(true)}>
          More filters{advancedFilterCount ? ` (${advancedFilterCount})` : ""}
        </Btn>
        {anyFilter && <Btn size="sm" variant="ghost" onClick={resetFilters}>Clear filters</Btn>}
        <Btn
          size="sm"
          variant="ghost"
          icon="bookmark-plus"
          onClick={async () => {
            const name = await notify.prompt("Name this view", "", { title: "Save view" });
            if (name) saveCurrentView(name);
          }}
        >
          Save view
        </Btn>
      </div>

      {savedViews.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--r-fg-4)", marginRight: 4 }}>Saved views</span>
          {savedViews.map((view, idx) => (
            <span key={`${view.name}-${idx}`} style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--r-border)", borderRadius: "8px", background: "var(--r-surface)", overflow: "hidden" }}>
              <button type="button" onClick={() => loadSavedView(view)} style={{ border: "none", background: "none", padding: "5px 10px", fontSize: 13, color: "var(--r-fg-1)", cursor: "pointer", fontFamily: "inherit" }}>{view.name}</button>
              <button type="button" onClick={() => deleteSavedView(idx)} aria-label={`Delete saved view ${view.name}`} style={{ border: "none", borderLeft: "1px solid var(--r-border)", background: "none", padding: "5px 7px", color: "var(--r-fg-4)", cursor: "pointer", display: "flex" }}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {[
          { value: "all", label: "All entries", count: filters.category === "all" ? (ledgerData?.transactions?.length || 0) : undefined },
          ...["Maintenance", "Payment", "Interest", "Adjustment", "Opening Balance", "Refund", "Fine"]
            .filter((c) => filters.category === c || categoryCounts[c])
            .map((c) => ({ value: c, label: c === "Opening Balance" ? "Opening balance" : c, count: filters.category === "all" ? categoryCounts[c] || 0 : undefined })),
        ].map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => handleFilterChange("category", c.value)}
            style={{
              padding: "5px 10px", borderRadius: 999, fontSize: 12.5, cursor: "pointer",
              border: filters.category === c.value ? "1px solid var(--r-brand)" : "1px solid var(--r-border)",
              background: filters.category === c.value ? "var(--r-brand-soft, var(--r-surface-3))" : "var(--r-surface)",
              color: "var(--r-fg-1)",
            }}
          >
            {c.label}{c.count != null ? ` (${c.count})` : ""}
          </button>
        ))}
      </div>

      {!isLoading && (
        <div style={{ fontSize: 13, color: "var(--r-fg-4)" }}>
          {searchTerm || anyFilter || selectedMember
            ? <>Showing <strong>{shown.length}</strong> of {plural(totalEntries, "entry", "entries")}{searchTerm ? <> matching "{searchTerm}"</> : null}</>
            : <><strong>{plural(totalEntries, "entry", "entries")}</strong>{totalPages > 1 ? `, ${shown.length} on this page` : ""}</>}
          {shown.length > 0 && <> · <strong>{fullMoney(shownDebit)}</strong> debited · <strong>{fullMoney(shownCredit)}</strong> credited</>}
        </div>
      )}

      {isLoading ? (
        <RevampSkeleton h={420} />
      ) : shown.length === 0 ? (
        <div style={{ padding: "36px 24px", textAlign: "center", border: "1px solid var(--r-border)", borderRadius: 12 }}>
          <p style={{ fontSize: 13.5, color: "var(--r-fg-4)" }}>
            {anyFilter || searchTerm
              ? <>No entries match {searchTerm ? <>"{searchTerm}"</> : "these filters"}.</>
              : selectedMember ? "This flat has no entries yet." : "No ledger entries yet. They appear as bills are generated and payments recorded."}
          </p>
          {anyFilter || selectedMember ? <Btn variant="secondary" onClick={resetFilters} style={{ marginTop: 10 }}>Clear filters</Btn> : null}
        </div>
      ) : (
        <>
          <DataTable cols={cols} rows={shown} rowKey="_id" tableId="ledger" hotkeys onRowClick={(t) => fetchTransactionDetails(t._id)} />
          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
              <Btn size="sm" variant="secondary" icon="chevron-left" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Btn>
              <span style={{ fontSize: 13, color: "var(--r-fg-4)" }}>Page {page} of {totalPages}</span>
              <Btn size="sm" variant="secondary" iconR="chevron-right" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          )}
        </>
      )}

      {/* Analysis — only what has data */}
      {!isLoading && (interestAnalytics.totalInterest > 0 || paymentAnalytics.totalPayments > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
          {interestAnalytics.totalInterest > 0 && (
            <div style={{ border: "1px solid var(--r-border)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)" }}>Interest entries</div>
              <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginBottom: 12 }}>
                {fullMoney(interestAnalytics.totalInterest)} across {plural(interestAnalytics.interestCount, "entry", "entries")} in this view
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {interestRows.map((r) => (
                  <div key={r.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--r-fg-3)" }}>{r.label}</span>
                    <span className="revamp-num">{fullMoney(r.value)}</span>
                  </div>
                ))}
              </div>
              {interestAnalytics.topInterestPayers.length > 1 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--r-fg-4)", marginBottom: 10 }}>Most interest, by flat</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {interestAnalytics.topInterestPayers.slice(0, 5).map((it) => (
                      <div key={it.member?._id || Math.random()} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <span style={{ color: "var(--r-fg-3)" }}>{`${flatLabel(it.member?.wing, it.member?.flatNo)} ${properName(it.member?.ownerName || "")}`.trim()}</span>
                        <span className="revamp-num">{fullMoney(it.totalInterest)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {paymentAnalytics.totalPayments > 0 && (
            <div style={{ border: "1px solid var(--r-border)", borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)" }}>How members paid</div>
              <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginBottom: 12 }}>
                {fullMoney(paymentAnalytics.totalPayments)} of payments in this view
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {modeSegments.filter((s) => s.value > 0).map((s) => (
                  <div key={s.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "var(--r-fg-3)" }}>{s.label}</span>
                    <span className="revamp-num">{fullMoney(s.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Drawer
        open={showAdvancedFilters}
        onClose={() => setShowAdvancedFilters(false)}
        title="More filters"
        sub="Payment mode, wing, dates, amounts and sorting"
        width={380}
      >
        <div style={{ display: "grid", gap: 16 }}>
          <FilterField label="Payment mode">
            <select value={filters.paymentMode} onChange={(e) => handleFilterChange("paymentMode", e.target.value)} className="input">
              <option value="all">All modes</option>
              {["Cash", "Cheque", "Online", "UPI", "NEFT", "RTGS", "System"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </FilterField>
          <FilterField label="Wing">
            <select value={filters.wing} onChange={(e) => handleFilterChange("wing", e.target.value)} className="input">
              <option value="all">All wings</option>
              {wings.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </FilterField>
          <FilterField label="Bill month">
            <div style={{ display: "flex", gap: 8 }}>
              <select value={filters.month} onChange={(e) => handleFilterChange("month", e.target.value)} className="input" style={{ flex: 1 }}>
                <option value="">Any month</option>
                {MONTHS.map((m, idx) => <option key={m} value={idx + 1}>{m}</option>)}
              </select>
              <select value={filters.year} onChange={(e) => handleFilterChange("year", e.target.value)} className="input" style={{ flex: 1 }}>
                <option value="">Any year</option>
                {yearsBack.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
          </FilterField>
          <FilterField label="Date range">
            <div style={{ display: "flex", gap: 8 }}>
              <input type="date" aria-label="From" value={filters.startDate} onChange={(e) => handleFilterChange("startDate", e.target.value)} className="input" style={{ flex: 1 }} />
              <input type="date" aria-label="To" value={filters.endDate} onChange={(e) => handleFilterChange("endDate", e.target.value)} className="input" style={{ flex: 1 }} />
            </div>
          </FilterField>
          <FilterField label="Amount range">
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" value={filters.minAmount} onChange={(e) => handleFilterChange("minAmount", e.target.value)} placeholder="Minimum" className="input" style={{ flex: 1 }} />
              <input type="number" value={filters.maxAmount} onChange={(e) => handleFilterChange("maxAmount", e.target.value)} placeholder="Maximum" className="input" style={{ flex: 1 }} />
            </div>
          </FilterField>
          <FilterField label="Sort by">
            <div style={{ display: "flex", gap: 8 }}>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="input" style={{ flex: 1 }}>
                <option value="date">Date</option>
                <option value="amount">Amount</option>
                <option value="member">Flat</option>
              </select>
              <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="input" style={{ flex: 1 }}>
                <option value="desc">Newest / largest first</option>
                <option value="asc">Oldest / smallest first</option>
              </select>
            </div>
          </FilterField>
          <Btn variant="primary" onClick={() => setShowAdvancedFilters(false)}>Show entries</Btn>
        </div>
      </Drawer>

      {/* ========== ENTRY DETAIL ========== */}
      {(() => {
        const t = selectedTransaction?.transaction;
        if (!t) return null;
        const isDebit = t.type === "Debit";
        const field = (label, value) => value ? (
          <div>
            <div style={{ fontSize: 13, color: "var(--r-fg-4)" }}>{label}</div>
            <div style={{ fontSize: 14, color: "var(--r-fg-1)", marginTop: 2 }}>{value}</div>
          </div>
        ) : null;
        return (
          <Modal open={showDetailModal} onClose={() => setShowDetailModal(false)} title={`${t.category} · ${t.transactionId || ""}`} width={560}>
            <div style={{ paddingBottom: 18, borderBottom: "1px solid var(--r-border)" }}>
              <div style={{ fontSize: 13, color: "var(--r-fg-4)" }}>{isDebit ? "Charged to the flat (debit)" : "Paid by the member (credit)"}</div>
              <div className="revamp-num" style={{ fontSize: 32, fontWeight: 600, color: "var(--r-fg-1)", letterSpacing: "-0.02em", marginTop: 2 }}>
                {fullMoney(t.amount)} <span style={{ fontSize: 16, color: "var(--r-fg-4)", fontWeight: 500 }}>{isDebit ? "Dr" : "Cr"}</span>
              </div>
              <div style={{ fontSize: 13.5, color: "var(--r-fg-3)", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
                Flat balance after this entry: {balanceCell(t.balanceAfterTransaction)}
              </div>
            </div>

            {t.memberId ? (
              <div style={{ padding: "14px 0", borderBottom: "1px solid var(--r-border)" }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--r-fg-1)" }}>{flatLabel(t.memberId.wing, t.memberId.flatNo)}</div>
                <div style={{ fontSize: 13, color: "var(--r-fg-4)" }}>
                  {properName(t.memberId.ownerName)}
                  {(t.memberId.carpetAreaSqft ?? t.memberId.builtUpAreaSqft) ? `, ${t.memberId.carpetAreaSqft ?? t.memberId.builtUpAreaSqft} sq ft` : ""}
                  {t.memberId.contactNumber ? `, ${t.memberId.contactNumber}` : ""}
                </div>
              </div>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, padding: "16px 0", borderBottom: "1px solid var(--r-border)" }}>
              {field("Date", formatDateTime(t.date))}
              {field("Payment mode", t.paymentMode)}
              {field("Bill period", t.billPeriodId)}
              {field("Financial year", t.financialYear)}
              {field("Recorded by", t.createdBy ? `${t.createdBy.name}${t.createdBy.role ? `, ${t.createdBy.role}` : ""}` : null)}
            </div>

            {t.description ? (
              <p style={{ padding: "14px 0", borderBottom: "1px solid var(--r-border)", fontSize: 14, color: "var(--r-fg-3)", lineHeight: 1.6, margin: 0 }}>{t.description}</p>
            ) : null}

            {selectedTransaction.breakdown?.length > 0 && (
              <div style={{ paddingTop: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)", marginBottom: 8 }}>Charges on this bill</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <tbody>
                    {selectedTransaction.breakdown.map((item, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid var(--r-border)" }}>
                        <td style={{ padding: "8px 0" }}>
                          <div style={{ color: "var(--r-fg-1)" }}>{item.headName}</div>
                          {item.calculationType && <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>{item.calculationType}</div>}
                        </td>
                        <td style={{ padding: "8px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fullMoney(item.amount)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={{ padding: "10px 0", fontWeight: 600 }}>Total</td>
                      <td style={{ padding: "10px 0", textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {fullMoney(selectedTransaction.breakdown.reduce((sum, item) => sum + item.amount, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {selectedTransaction.auditTrail?.length > 0 && (
              <div style={{ paddingTop: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)", marginBottom: 8 }}>History</div>
                <div style={{ display: "grid", gap: 10 }}>
                  {selectedTransaction.auditTrail.map((log, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, fontSize: 13.5 }}>
                      <div>
                        <div style={{ color: "var(--r-fg-1)" }}>{log.action}</div>
                        <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>by {log.user?.name}{log.user?.role ? `, ${log.user.role}` : ""}</div>
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", whiteSpace: "nowrap" }}>{formatDateTime(log.timestamp)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Modal>
        );
      })()}
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--r-fg-3)", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function RSelectNative({ value, onChange, options, label }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        height: 32, padding: "0 10px", borderRadius: 8, fontSize: 13, fontFamily: "inherit",
        border: "1px solid var(--r-border-strong)", background: "var(--r-surface-3)", color: "var(--r-fg-1)",
      }}
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
