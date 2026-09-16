"use client";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import ledgerStyles from "@/styles/Ledger.module.css";
import Select from "react-select";
import notify from "@/lib/notify";
import {
  PageHeader, Card, CardHead, SectionLabel, Icon, Pill, Btn, MiniMetric,
  RevampSkeleton, Donut, Avatar, Drawer, Modal,
} from "@/components/revamp";

const CATEGORY_ICON = {
  Maintenance: "wrench", Payment: "banknote", Interest: "percent",
  Adjustment: "sliders-horizontal", "Opening Balance": "flag", Refund: "undo-2", Fine: "gavel",
};
export default function UltraAdvancedLedgerPage() {
  const queryClient = useQueryClient();
  // docs/ANIMATION_GUIDE.md §2 — distance-based transforms must respect
  // prefers-reduced-motion; opacity-only fades are left as-is.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = (e) => setReduceMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
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
    const mid = new URLSearchParams(window.location.search).get("memberId");
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
  const saveCurrentView = () => {
    if (!newViewName.trim()) {
      notify.warning("Please enter a view name");
      return;
    }
    const view = {
      name: newViewName,
      filters: { ...filters },
      sortBy,
      sortOrder,
      groupBy,
      visibleColumns: { ...visibleColumns },
    };
    setSavedViews([...savedViews, view]);
    setNewViewName("");
    notify.success(`View "${newViewName}" saved!`);
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
    const newViews = savedViews.filter((_, i) => i !== index);
    setSavedViews(newViews);
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
    { value: "all", label: "All Members" },
    ...(membersData?.members || [])
      .sort((a, b) => {
        const wingCompare = (a.wing || "").localeCompare(b.wing || "");
        if (wingCompare !== 0) return wingCompare;
        return (parseInt(a.flatNo) || 0) - (parseInt(b.flatNo) || 0);
      })
      .map((member) => ({
        value: member._id,
        label: `${member.wing || ""}-${member.flatNo} | ${member.ownerName}`,
        member,
      })),
  ];
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

  // ========== RENDER ==========
  return (
    <div>
      {/* ========== PAGE HEADER ========== */}
      <PageHeader
        eyebrow={<><Icon name="book-open" size={11} /> Accounting</>}
        title="Ledger"
        sub="Every transaction, with interest and payment-mode analytics behind it."
        right={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn icon="file-spreadsheet" onClick={() => exportData("xlsx")}>Export Excel</Btn>
            <Btn icon="file-text" onClick={() => exportData("pdf")}>Export PDF</Btn>
            <Btn variant="primary" icon="refresh-cw" onClick={() => refetch()}>Refresh</Btn>
          </div>
        }
      />
      {/* ========== ANALYTICS DASHBOARD ========== */}
      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
          <RevampSkeleton h={92} /><RevampSkeleton h={92} /><RevampSkeleton h={92} /><RevampSkeleton h={92} />
        </div>
      ) : (
        <>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <MiniMetric
          icon="list"
          label="Total transactions"
          value={analytics.totalTransactions}
          extra={
            <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 6 }}>
              {ledgerData?.transactions?.filter((t) => t.type === "Debit").length || 0} debit ·{" "}
              {ledgerData?.transactions?.filter((t) => t.type === "Credit").length || 0} credit
            </div>
          }
        />
        <MiniMetric
          icon="arrow-up-circle"
          label="Total debit"
          value={`₹${analytics.totalDebit.toLocaleString("en-IN")}`}
          delta="Money owed by members"
        />
        <MiniMetric
          icon="arrow-down-circle"
          label="Total credit"
          value={`₹${analytics.totalCredit.toLocaleString("en-IN")}`}
          tone="paid"
          delta="Payments received"
        />
        <MiniMetric
          icon="scale"
          label="Net balance"
          value={`₹${Math.abs(analytics.netBalance).toLocaleString("en-IN")} ${analytics.netBalance < 0 ? "DR" : "CR"}`}
          tone={analytics.netBalance < 0 ? "danger" : "paid"}
          delta={analytics.netBalance < 0 ? "Outstanding dues" : "Credit balance"}
        />
      </motion.div>
      {/* ========== INTEREST ANALYTICS + PAYMENT MIX ==========
          One shared Card, not two side-by-side ones — a "2fr 1fr" grid of
          two independent cards left the shorter one (whichever had less to
          show, e.g. Payment mix, or Interest analytics in a month with no
          interest charged) stretched to match the taller one's height by
          CSS Grid's default stretch, with nothing of its own to fill that
          space. One container sized to its own tallest column can't do
          that — there's no second box left over to be emptier than. */}
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
          {/* Interest Summary */}
          <div>
            <CardHead title="Interest analytics" sub="Charged on overdue balances" />
            <div style={{ display: "flex", borderTop: "1px solid var(--r-hairline)", paddingTop: 14 }}>
              {[
                { label: "Total charged", value: `₹${interestAnalytics.totalInterest.toLocaleString("en-IN")}`, sub: `${interestAnalytics.interestCount} transactions` },
                { label: "Average", value: `₹${Math.round(interestAnalytics.avgInterest).toLocaleString("en-IN")}`, sub: "per transaction" },
                { label: "Highest single charge", value: `₹${interestAnalytics.maxInterest.toLocaleString("en-IN")}`, sub: "in this view" },
              ].map((s, i) => (
                <div key={s.label} style={{
                  flex: 1, paddingLeft: i ? 16 : 0,
                  borderLeft: i ? "1px solid var(--r-hairline)" : "none",
                }}>
                  <div style={{ fontSize: 11, color: "var(--r-fg-4)", fontWeight: 600 }}>{s.label}</div>
                  <div className="revamp-num" style={{ fontSize: 22, fontWeight: 700, color: "var(--r-fg-1)", marginTop: 6, letterSpacing: "-0.02em" }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 3 }}>{s.sub}</div>
                </div>
              ))}
            </div>
            {/* Interest Trend Chart */}
            {interestAnalytics.interestTrend.length > 0 ? (
              <div style={{ marginTop: 20 }}>
                <SectionLabel icon="trending-up">Last 6 months</SectionLabel>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 12, height: 130 }}>
                  {interestAnalytics.interestTrend.map((item, idx) => {
                    const maxValue = Math.max(...interestAnalytics.interestTrend.map((i) => i.total));
                    const heightPercent = (item.total / maxValue) * 100;
                    return (
                      <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" }}>
                        <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--r-fg-3)", marginBottom: 4 }}>
                          ₹{Math.round(item.total).toLocaleString("en-IN")}
                        </div>
                        <div style={{
                          width: "100%", height: `${Math.max(heightPercent, 4)}%`,
                          background: "var(--r-warning)", borderRadius: 5,
                        }} />
                        <div style={{ fontSize: 10.5, color: "var(--r-fg-4)", marginTop: 6, textAlign: "center", lineHeight: 1.4 }}>
                          {item.month.split("-")[1]}/{item.month.split("-")[0].slice(2)}
                          <br />({item.count})
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 14, fontSize: 12, color: "var(--r-fg-4)" }}>
                No interest charged in the last 6 months.
              </div>
            )}
          </div>
          {/* Payment Mode Distribution — donut, not a stacked bar list:
              4 fixed-order categories, each small enough to direct-label,
              so a legend box would be pure repetition (dataviz skill,
              "assign categorical hues in fixed order" + "<=4 series get
              direct labels, no separate legend needed"). */}
          <div style={{ borderLeft: "1px solid var(--r-hairline)", paddingLeft: 24 }}>
            <CardHead title="Payment mix" />
            {(() => {
              const modes = [
                { mode: "Cash", amount: paymentAnalytics.cashPayments, color: "var(--r-success)", icon: "banknote" },
                { mode: "Online", amount: paymentAnalytics.onlinePayments, color: "var(--r-brand)", icon: "globe" },
                { mode: "UPI", amount: paymentAnalytics.upiPayments, color: "#9333ea", icon: "smartphone" },
                { mode: "Cheque", amount: paymentAnalytics.chequePayments, color: "var(--r-warning)", icon: "file-text" },
              ];
              const total = paymentAnalytics.totalPayments;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 4 }}>
                  <Donut
                    segments={modes.map((m) => ({ label: m.mode, value: m.amount, color: m.color }))}
                    size={104}
                    thickness={15}
                    centerLabel={total > 0 ? `₹${Math.round(total / 1000)}k` : "₹0"}
                    centerSub="total"
                  />
                  <div style={{ display: "grid", gap: 8, flex: 1, minWidth: 0 }}>
                    {modes.map((m) => {
                      const pct = total > 0 ? (m.amount / total) * 100 : 0;
                      return (
                        <div key={m.mode} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 999, background: m.color, flexShrink: 0 }} />
                          <span style={{ color: "var(--r-fg-2)", fontWeight: 500 }}>{m.mode}</span>
                          <span style={{ marginLeft: "auto", color: "var(--r-fg-4)" }}>{pct.toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </Card>
      {/* ========== TOP INTEREST PAYERS ========== */}
      {interestAnalytics.topInterestPayers.length > 0 && (
        <Card padded={false} style={{ marginBottom: 18 }}>
          <div style={{ padding: "16px 18px 4px" }}>
            <CardHead title="Top interest payers" sub="Click a row to filter the ledger to that member" />
          </div>
          <div>
            {interestAnalytics.topInterestPayers.map((item, idx) => (
              <div
                key={item.member?._id || idx}
                onClick={() => handleFilterChange("memberId", item.member?._id)}
                style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "12px 18px", cursor: "pointer",
                  borderTop: "1px solid var(--r-hairline)",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--r-surface-2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{
                  width: 26, height: 26, borderRadius: 999, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11.5, fontWeight: 700,
                  background: idx === 0 ? "var(--r-danger-soft)" : "var(--r-surface-3)",
                  color: idx === 0 ? "var(--r-danger)" : "var(--r-fg-3)",
                }}>{idx + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>
                    {item.member?.wing}-{item.member?.flatNo}
                    <span style={{ fontWeight: 400, color: "var(--r-fg-4)" }}> · {item.member?.ownerName}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 2 }}>
                    {item.count} charges · avg ₹{Math.round(item.totalInterest / item.count).toLocaleString("en-IN")}
                  </div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--r-danger)", flexShrink: 0 }}>
                  ₹{item.totalInterest.toLocaleString("en-IN")}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
        </>
      )}
      {/* ========== SAVED VIEWS ========== */}
      {savedViews.length > 0 && (
        <Card style={{ marginBottom: 18 }}>
          <SectionLabel icon="bookmark">Saved views</SectionLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {savedViews.map((view, idx) => (
              <span key={idx} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 6px 5px 12px", borderRadius: 999,
                background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)",
                fontSize: 12.5, fontWeight: 500, color: "var(--r-fg-2)",
              }}>
                <span onClick={() => loadSavedView(view)} style={{ cursor: "pointer" }}>{view.name}</span>
                <button
                  onClick={() => deleteSavedView(idx)}
                  aria-label={`Delete saved view ${view.name}`}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 18, height: 18, borderRadius: 999, border: "none",
                    background: "transparent", color: "var(--r-fg-4)", cursor: "pointer",
                  }}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        </Card>
      )}
      {/* ========== FILTERS — one dense toolbar row ==========
          Used to be: a 6-field label-over-input grid, a separate "Show
          Advanced Filters" block that pushed the whole page down when
          opened, a Reset/Save button row, and a THIRD row below that for
          search/group/sort — four stacked blocks, 300px+ before a single
          transaction was visible. Collapsed into one row: the filters
          people actually reach for stay inline as compact controls; the six
          rarely-touched ones (payment mode, wing, date range, amount range,
          group-by) move into a slide-over Drawer instead of permanently
          reserving page height for them. */}
      <div style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
        padding: "10px 12px", marginBottom: 14, borderRadius: 10,
        background: "var(--r-surface)", border: "1px solid var(--r-border)",
      }}>
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 180 }}>
          <Icon name="search" size={14} color="var(--r-fg-4)" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          <input
            type="text"
            placeholder="Search transactions…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: "100%", padding: "7px 10px 7px 30px", borderRadius: 7, fontSize: 12.5,
              border: "1px solid var(--r-border)", background: "var(--r-surface-2)", color: "var(--r-fg-1)",
            }}
          />
        </div>
        <div style={{ width: 190 }}>
          <Select
            options={memberOptions}
            value={memberOptions.find((opt) => opt.value === filters.memberId)}
            onChange={(option) => handleFilterChange("memberId", option?.value || "all")}
            placeholder="Member"
            isClearable
            isSearchable
            styles={{
              control: (base) => ({ ...base, minHeight: 32, fontSize: 12.5 }),
              valueContainer: (base) => ({ ...base, padding: "0 8px" }),
              indicatorsContainer: (base) => ({ ...base, height: 32 }),
              menu: (base) => ({ ...base, zIndex: 9999, fontSize: 12.5 }),
            }}
          />
        </div>
        {[
          { value: filters.category, onChange: (v) => handleFilterChange("category", v), options: [["all", "All Categories"], ["Maintenance", "Maintenance"], ["Payment", "Payment"], ["Interest", "Interest"], ["Adjustment", "Adjustment"], ["Opening Balance", "Opening Balance"], ["Refund", "Refund"], ["Fine", "Fine"]] },
          { value: filters.type, onChange: (v) => handleFilterChange("type", v), options: [["all", "All Types"], ["Debit", "Debit"], ["Credit", "Credit"]] },
          { value: filters.balanceStatus, onChange: (v) => handleFilterChange("balanceStatus", v), options: [["all", "Any Balance"], ["arrears", "Arrears (DR)"], ["credit", "Credit (CR)"], ["zero", "Zero Balance"]] },
        ].map((f, i) => (
          <select
            key={i}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            style={{
              padding: "7px 8px", borderRadius: 7, fontSize: 12.5,
              border: "1px solid var(--r-border)", background: "var(--r-surface-2)", color: "var(--r-fg-1)",
            }}
          >
            {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        ))}
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          <Btn size="sm" icon="filter" onClick={() => setShowAdvancedFilters(true)}>
            More filters{advancedFilterCount ? ` (${advancedFilterCount})` : ""}
          </Btn>
          <Btn size="sm" icon="rotate-ccw" title="Reset all filters" onClick={resetFilters} />
          <Btn
            size="sm"
            icon="bookmark-plus"
            title="Save current view"
            onClick={async () => {
              const name = await notify.prompt("Enter a name for this view:");
              if (name) { setNewViewName(name); saveCurrentView(); }
            }}
          />
        </div>
      </div>

      <Drawer
        open={showAdvancedFilters}
        onClose={() => setShowAdvancedFilters(false)}
        title="More filters"
        sub="Payment mode, wing, date range, amount range, sorting"
        width={380}
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <SectionLabel icon="credit-card">Payment mode</SectionLabel>
            <select value={filters.paymentMode} onChange={(e) => handleFilterChange("paymentMode", e.target.value)} className="input" style={{ width: "100%" }}>
              <option value="all">All Modes</option>
              <option value="Cash">Cash</option>
              <option value="Cheque">Cheque</option>
              <option value="Online">Online</option>
              <option value="UPI">UPI</option>
              <option value="NEFT">NEFT</option>
              <option value="RTGS">RTGS</option>
              <option value="System">System</option>
            </select>
          </div>
          <div>
            <SectionLabel icon="building-2">Wing</SectionLabel>
            <select value={filters.wing} onChange={(e) => handleFilterChange("wing", e.target.value)} className="input" style={{ width: "100%" }}>
              <option value="all">All Wings</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
          </div>
          <div>
            <SectionLabel icon="calendar">Month / year</SectionLabel>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={filters.month} onChange={(e) => handleFilterChange("month", e.target.value)} className="input" style={{ flex: 1 }}>
                <option value="">All Months</option>
                {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m, idx) => (
                  <option key={idx} value={idx + 1}>{m}</option>
                ))}
              </select>
              <select value={filters.year} onChange={(e) => handleFilterChange("year", e.target.value)} className="input" style={{ flex: 1 }}>
                <option value="">All Years</option>
                {[2025, 2024, 2023, 2022, 2021].map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
          </div>
          <div>
            <SectionLabel icon="calendar-range">Date range</SectionLabel>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="date" value={filters.startDate} onChange={(e) => handleFilterChange("startDate", e.target.value)} className="input" style={{ flex: 1 }} />
              <input type="date" value={filters.endDate} onChange={(e) => handleFilterChange("endDate", e.target.value)} className="input" style={{ flex: 1 }} />
            </div>
          </div>
          <div>
            <SectionLabel icon="indian-rupee">Amount range</SectionLabel>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" value={filters.minAmount} onChange={(e) => handleFilterChange("minAmount", e.target.value)} placeholder="Min" className="input" style={{ flex: 1 }} />
              <input type="number" value={filters.maxAmount} onChange={(e) => handleFilterChange("maxAmount", e.target.value)} placeholder="Max" className="input" style={{ flex: 1 }} />
            </div>
          </div>
          <div>
            <SectionLabel icon="layers">Group by</SectionLabel>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="input" style={{ width: "100%" }}>
              <option value="">None</option>
              <option value="member">Member</option>
              <option value="category">Category</option>
              <option value="date">Month</option>
            </select>
          </div>
          <div>
            <SectionLabel icon="arrow-up-down">Sort by</SectionLabel>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="input" style={{ flex: 1 }}>
                <option value="date">Date</option>
                <option value="amount">Amount</option>
                <option value="member">Member</option>
              </select>
              <Btn
                icon={sortOrder === "asc" ? "arrow-up" : "arrow-down"}
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
              />
            </div>
          </div>
          <Btn variant="primary" onClick={() => setShowAdvancedFilters(false)}>Apply</Btn>
        </div>
      </Drawer>
      {/* ========== LEDGER TRANSACTIONS — card grid ==========
          A 12-column table used to be the only view: fine for precision,
          brutal for 80+ rows of vertical scroll. Cards match the
          view-members/view-bills pattern elsewhere in the app — each one
          still opens the same full transaction-detail modal on click, so
          nothing that lived in the table's extra columns (recorded by,
          bill period, FY, audit trail) is gone, just one tap deeper. */}
      <div className={styles.contentCard}>
        {isLoading ? (
          // Skeleton cards in the exact grid the real cards render in — a
          // small spinner centered in an otherwise blank 4rem-padded box
          // read as "there's nothing here," not "this is loading," for the
          // 1-2s a fetch takes. Shape-matched skeletons don't have that gap.
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
            {Array.from({ length: 12 }).map((_, i) => <RevampSkeleton key={i} h={132} />)}
          </div>
        ) : !filteredTransactions || filteredTransactions.length === 0 ? (
          <div className={ledgerStyles.noData} style={{ padding: "4rem" }}>
            <Icon name="inbox" size={40} color="var(--r-fg-5)" style={{ display: "block", margin: "0 auto 1rem" }} />
            <p
              style={{
                fontSize: "1.25rem",
                fontWeight: "600",
                color: "var(--fg-3)",
                marginBottom: "0.5rem",
              }}
            >
              No transactions found
            </p>
            <p style={{ fontSize: "0.875rem", color: "var(--fg-4)" }}>
              Try adjusting your filters or search term
            </p>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                gap: 12,
              }}
            >
              {filteredTransactions.map((txn) => {
                const catColor =
                  txn.category === "Interest" ? "var(--r-danger)"
                  : txn.category === "Payment" ? "var(--r-success)"
                  : txn.category === "Maintenance" ? "var(--r-brand)"
                  : "var(--r-fg-5)";
                const flatLabel = txn.memberId
                  ? [txn.memberId.wing, txn.memberId.flatNo].filter(Boolean).join("-") || "Flat —"
                  : null;
                return (
                  <div
                    key={txn._id}
                    onClick={() => fetchTransactionDetails(txn._id)}
                    title={txn.category}
                    style={{
                      display: "flex", flexDirection: "column", gap: 8,
                      padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                      background: "var(--r-surface)", border: "1px solid var(--r-border)",
                      // Category reads as a slim color strip on the card, not
                      // a repeated icon or word — with 84 cards mostly the
                      // same category, drawing "Maintenance" (or an icon
                      // standing in for it) on every single one was noise;
                      // a color still tells them apart at a glance, and the
                      // full word is one click away in the detail modal.
                      borderTop: `3px solid ${catColor}`,
                      transition: "border-color 0.15s, transform 0.15s, box-shadow 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "var(--r-shadow-pop)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow = "none";
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      {txn.memberId ? (
                        <>
                          <Avatar name={txn.memberId.ownerName} size={30} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>{flatLabel}</div>
                            <div style={{
                              fontSize: 11.5, color: "var(--r-fg-4)",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{txn.memberId.ownerName}</div>
                          </div>
                        </>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 9, flex: 1 }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: 999, flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "var(--r-surface-3)", color: "var(--r-fg-4)",
                          }}>
                            <Icon name="building-2" size={14} />
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-2)" }}>Society-level</div>
                        </div>
                      )}
                      <span style={{ fontSize: 11, color: "var(--r-fg-4)", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {new Date(txn.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 11.5, color: "var(--r-fg-3)", lineHeight: 1.4,
                      display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                    }}>
                      {txn.description || "—"}
                    </div>
                    <div style={{
                      display: "flex", justifyContent: "flex-end", alignItems: "baseline", gap: 6,
                      marginTop: 2, paddingTop: 8, borderTop: "1px solid var(--r-hairline)",
                    }}>
                      <div style={{
                        fontSize: 14, fontWeight: 700,
                        color: txn.type === "Debit" ? "var(--r-danger)" : "var(--r-success)",
                      }}>
                        {txn.type === "Debit" ? "−" : "+"}₹{txn.amount.toLocaleString("en-IN")}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--r-fg-4)" }}>
                        · bal ₹{Math.abs(txn.balanceAfterTransaction).toLocaleString("en-IN")}{" "}
                        {txn.balanceAfterTransaction < 0 ? "DR" : "CR"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Pagination */}
            <div className={ledgerStyles.pagination}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ← Previous
              </button>
              <span>
                Page {page} of {ledgerData?.summary?.totalPages || 1} (
                {filteredTransactions.length} transactions)
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= (ledgerData?.summary?.totalPages || 1)}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
      {/* ========== TRANSACTION DETAIL MODAL ========== */}
      {(() => {
        const t = selectedTransaction?.transaction;
        if (!t) return null;
        const isDebit = t.type === "Debit";
        const amountColor = isDebit ? "var(--r-danger)" : "var(--r-success)";
        const catTone =
          t.category === "Interest" ? { bg: "var(--danger-bg)", fg: "var(--danger-fg)" }
          : t.category === "Payment" ? { bg: "var(--success-bg)", fg: "var(--success-fg)" }
          : { bg: "var(--info-bg)", fg: "var(--info)" };
        const field = (label, value) => value ? (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: "var(--r-fg-4)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
            <div style={{ fontSize: 13, color: "var(--r-fg-1)", marginTop: 3 }}>{value}</div>
          </div>
        ) : null;
        return (
          <Modal open={showDetailModal} onClose={() => setShowDetailModal(false)} title="Transaction Details" width={560}>
            {/* Receipt-style header: the number that matters, first and biggest */}
            <div style={{ textAlign: "center", paddingBottom: 18, borderBottom: "1px solid var(--r-hairline)" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700,
                padding: "3px 10px", borderRadius: 999, background: catTone.bg, color: catTone.fg, marginBottom: 10,
              }}>
                <Icon name={CATEGORY_ICON[t.category] || "circle"} size={11} /> {t.category}
              </span>
              <div className="revamp-num" style={{ fontSize: 34, fontWeight: 700, color: amountColor, letterSpacing: "-0.02em" }}>
                {isDebit ? "−" : "+"}₹{t.amount.toLocaleString("en-IN")}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginTop: 4 }}>
                Balance after: ₹{Math.abs(t.balanceAfterTransaction).toLocaleString("en-IN")}{" "}
                {t.balanceAfterTransaction < 0 ? "DR" : "CR"}
              </div>
            </div>

            {t.memberId ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", borderBottom: "1px solid var(--r-hairline)" }}>
                <Avatar name={t.memberId.ownerName} size={36} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)" }}>{t.memberId.wing}-{t.memberId.flatNo}</div>
                  <div style={{ fontSize: 12, color: "var(--r-fg-4)" }}>
                    {(() => {
                      const area = t.memberId.carpetAreaSqft ?? t.memberId.builtUpAreaSqft;
                      return <>{t.memberId.ownerName}{area ? ` · ${area} sq.ft` : ""}{t.memberId.contactNumber ? ` · ${t.memberId.contactNumber}` : ""}</>;
                    })()}
                  </div>
                </div>
              </div>
            ) : null}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, padding: "16px 0", borderBottom: "1px solid var(--r-hairline)" }}>
              {field("Transaction ID", <span style={{ fontFamily: "ui-monospace, monospace" }}>{t.transactionId}</span>)}
              {field("Date & time", new Date(t.date).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }))}
              {field("Payment mode", t.paymentMode)}
              {field("Bill period", t.billPeriodId)}
              {field("Financial year", t.financialYear)}
              {field("Recorded by", t.createdBy ? `${t.createdBy.name} (${t.createdBy.role})` : null)}
            </div>

            {t.description ? (
              <div style={{ padding: "14px 0", borderBottom: "1px solid var(--r-hairline)", fontSize: 13, color: "var(--r-fg-2)", lineHeight: 1.6 }}>
                {t.description}
              </div>
            ) : null}

            {/* Billing Breakdown */}
            {selectedTransaction.breakdown?.length > 0 && (
              <div style={{ paddingTop: 16 }}>
                <SectionLabel icon="receipt">Billing breakdown</SectionLabel>
                <div style={{ display: "grid", gap: 1, borderRadius: 10, overflow: "hidden", border: "1px solid var(--r-hairline)" }}>
                  {selectedTransaction.breakdown.map((item, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", background: "var(--r-surface-2)" }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-1)" }}>{item.headName}</div>
                        <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>{item.calculationType}</div>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-2)" }}>₹{item.amount.toLocaleString("en-IN")}</div>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--r-surface)" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--r-fg-1)" }}>Total</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--r-fg-1)" }}>
                      ₹{selectedTransaction.breakdown.reduce((sum, item) => sum + item.amount, 0).toLocaleString("en-IN")}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Audit Trail */}
            {selectedTransaction.auditTrail?.length > 0 && (
              <div style={{ paddingTop: 16 }}>
                <SectionLabel icon="history">Audit trail</SectionLabel>
                <div style={{ display: "grid", gap: 10 }}>
                  {selectedTransaction.auditTrail.map((log, idx) => (
                    <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-2)" }}>{log.action}</div>
                        <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 1 }}>by {log.user?.name} ({log.user?.role})</div>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--r-fg-5)", whiteSpace: "nowrap" }}>{new Date(log.timestamp).toLocaleString("en-IN")}</div>
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
