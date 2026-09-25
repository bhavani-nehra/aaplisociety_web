"use client";
import { useState, useEffect, useMemo } from "react";
import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/ViewBills.module.css";
import notify from "@/lib/notify";
import {
  PageHeader, Card, Pill, Btn, Progress, Segmented, SearchInput, Select, Icon,
  Avatar, SummaryStat, EmptyState, RevampSkeleton, useIsDark,
} from "@/components/revamp";
const STATUS_COLOR = {
  Paid: { bg: "var(--success-bg)", text: "var(--success-fg)", border: "var(--success)" },
  Partial: { bg: "var(--warning-bg)", text: "var(--warning-fg)", border: "var(--warning)" },
  Unpaid: { bg: "var(--danger-bg)", text: "var(--danger-fg)", border: "var(--danger)" },
  /* TODO: unmapped color, needs design review — purple status has no purple family token */
  Overdue: { bg: "var(--accent-tint)", text: "#7c3aed", border: "var(--border-strong)" },
  Scheduled: { bg: "var(--bg-muted)", text: "var(--fg-3)", border: "var(--border-strong)" },
};
/** Bill status → revamp Pill tone. */
const STATUS_TONE = {
  Paid: "paid",
  Partial: "partial",
  Unpaid: "unpaid",
  Overdue: "overdue",
  Scheduled: "scheduled",
};
function fmt(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function chargesTotal(bill) {
  // Current-month charges ONLY. Prefer the per-head charge map (exactly what the
  // Charge Breakdown table renders) and the Ledger V2 canonical currentCharges.
  // currentBillTotal / subtotal are legacy and on some rows were stored as the
  // grand total (incl. carry-forward), which made "Current Bill" and
  // "Current Month Total" show ₹3,580 instead of ₹2,362.50.
  if (bill.charges && typeof bill.charges === "object") {
    const keys = Object.keys(bill.charges);
    if (keys.length) {
      return Object.values(bill.charges).reduce((s, v) => s + Number(v || 0), 0);
    }
  }
  if (bill.currentCharges != null) return bill.currentCharges;
  if (bill.currentBillTotal != null) return bill.currentBillTotal;
  if (bill.subtotal != null) return bill.subtotal;
  return 0;
}
function prevBalance(bill) {
  // Previous *principal* carried in, DERIVED so the summary cards always
  // reconcile:  Total Due = Current Bill + Prev Balance + Interest.
  // (openingPrincipal isn't returned by the bills-list API, which made this
  // show "Clear" even when ₹1,000 was carried forward.)
  const v =
    Number(bill.totalAmount || 0) - chargesTotal(bill) - Number(bill.interestAmount || 0);
  return Math.max(0, parseFloat(v.toFixed(2)));
}
function flatLabel(member) {
  const wing = String(member?.wing || "").trim();
  const flat = String(member?.flatNo || "").trim();
  if (!wing) return flat;
  // flatNo sometimes already carries the wing (e.g. "A-101"), which produced
  // the doubled "A-A-101". Don't prepend the wing again in that case.
  if (flat.toUpperCase().startsWith(wing.toUpperCase())) return flat;
  return `${wing}-${flat}`;
}
function interestParts(bill) {
  // Split the interest line so the summary is transparent AND reconciles:
  //   carried   = interest brought forward from prior unpaid months (openingInterest)
  //   thisMonth = interest accrued on this bill (currentInterest)
  // Falls back to deriving from interestAmount for older bills missing the split.
  const round = (n) => parseFloat((Number(n) || 0).toFixed(2));
  const total = round(bill.interestAmount);
  const thisMonth =
    bill.currentInterest != null
      ? round(bill.currentInterest)
      : Math.max(0, round(total - (bill.openingInterest || 0)));
  const carried =
    bill.openingInterest != null
      ? round(bill.openingInterest)
      : Math.max(0, round(total - thisMonth));
  return { carried, thisMonth, total };
}
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function BillPdfTab({ bill }) {
  // Always fetch from the server so the CURRENT saved template is applied
  // (the server re-renders live for non-locked bills). Stored billHtml is only
  // used as an offline fallback if the request fails.
  //
  // /api/bills/download returns text/html for the default renderer but a raw
  // application/pdf whenever the society has a custom uploaded PDF/image bill
  // template configured (see Case 1/1b in that route) — previously this tab
  // only knew how to inline HTML and threw on the PDF response, always
  // showing the "use Print button" placeholder for any society running a
  // custom template. A PDF blob renders fine in an <iframe>, so branch on
  // content-type instead of assuming HTML.
  const [html, setHtml] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    setLoading(true);
    setPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    fetch(`/api/bills/download?id=${bill._id}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load bill");
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text/html")) return { kind: "html", value: await res.text() };
        if (ct.includes("application/pdf")) return { kind: "pdf", value: await res.blob() };
        throw new Error("Unrecognized bill content — use Print button to download");
      })
      .then((result) => {
        if (result.kind === "html") { setHtml(result.value); setLoading(false); return; }
        setPdfUrl(URL.createObjectURL(result.value));
        setLoading(false);
      })
      .catch((e) => {
        if (bill.billHtml) { setHtml(bill.billHtml); setLoading(false); return; }
        setError(e.message); setLoading(false);
      });
    return () => setPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return prev; });
  }, [bill._id]);
  // Must run unconditionally, before any early return below - a hook called
  // only on some renders (e.g. skipped while `loading` is true on first
  // render, then reached once `html` resolves) violates the Rules of Hooks
  // and crashes with "Rendered more hooks than during the previous render."
  const safeHtml = useMemo(
    () => (html && typeof window !== "undefined" ? DOMPurify.sanitize(html) : ""),
    [html],
  );
  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "var(--fg-4)" }}>Loading bill...</div>;
  if (error) return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 32 }}></div>
      <p style={{ color: "var(--fg-4)", marginTop: 8 }}>{error}</p>
    </div>
  );
  if (pdfUrl) return (
    <iframe src={pdfUrl} title="Bill PDF" style={{ width: "100%", height: "80vh", border: "none" }} />
  );
  if (!html) return (
    <div style={{ padding: 60, textAlign: "center" }}>
      <div style={{ fontSize: 32 }}></div>
      <p style={{ color: "var(--fg-4)", marginTop: 8 }}>No bill content. Click Print to regenerate.</p>
    </div>
  );
  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
    </div>
  );
}
/**
 * Compact bill card — the design kit's Bills grid item
 * (ui_kits/revamp/AdminViews.jsx → BillCard). Status is the coloured rule
 * along the top edge as well as the pill, so a cycle can be scanned for
 * trouble without reading a single number.
 */
function BillCard({ bill, isDark, onOpen }) {
  const [h, setH] = useState(false);
  const statusColor =
    bill.status === "Paid" ? "var(--r-success)"
      : bill.status === "Partial" ? "var(--r-warning)"
        : bill.status === "Scheduled" ? "var(--r-fg-5)"
          : "var(--r-danger)";
  const name = bill.memberId?.ownerName || flatLabel(bill.memberId) || "—";
  const balance = Number(bill.balanceAmount || 0);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: "var(--r-surface)",
        border: `1px solid ${h ? "var(--r-border-strong)" : "var(--r-border)"}`,
        borderRadius: "var(--r-radius-lg)", padding: 14, cursor: "pointer",
        boxShadow: h ? (isDark ? "var(--r-shadow-pop), var(--r-glow-brand)" : "var(--r-shadow-pop)") : "var(--r-shadow-card)",
        transform: h ? "translateY(-2px)" : "none",
        transition: "box-shadow 0.16s, transform 0.16s, border-color 0.16s",
        position: "relative", overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: statusColor, opacity: 0.85 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Avatar name={name} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
          <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>{flatLabel(bill.memberId)} · {bill.billPeriodId}</div>
        </div>
      </div>
      <div className="revamp-num" style={{ fontSize: 20, fontWeight: 700, color: "var(--r-fg-1)", letterSpacing: "-0.02em", marginBottom: 2 }}>
        ₹{fmt(bill.totalAmount)}
      </div>
      <div className="revamp-num" style={{ fontSize: 11, color: "var(--r-fg-4)", marginBottom: 10 }}>
        Paid ₹{fmt(bill.amountPaid)} ·{" "}
        <span style={{ color: balance > 0.005 ? "var(--r-danger)" : "var(--r-success)", fontWeight: 600 }}>
          {balance > 0.005 ? `₹${fmt(balance)} due` : "Settled"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Pill tone={STATUS_TONE[bill.status] || "neutral"}>{bill.status}</Pill>
        <span style={{ fontSize: 10.5, color: "var(--r-fg-4)" }}>
          {balance > 0.005 ? fmtDate(bill.dueDate) : "Settled"}
        </span>
      </div>
    </div>
  );
}
export default function ViewBillsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [viewingBill, setViewingBill] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [downloadingId, setDownloadingId] = useState(null);
  const [seriesFilter, setSeriesFilter] = useState("All"); // "All" | "Residential" | "Commercial"
  // Cards is the default per the design kit; the dense table stays one click
  // away because it is the only view that shows the full charge breakdown.
  const [viewMode, setViewMode] = useState("cards");
  const isDark = useIsDark();
  const { data: billsData, isLoading } = useQuery({
    queryKey: ["view-bills", selectedPeriod, filterStatus],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPeriod !== "all") params.append("period", selectedPeriod);
      if (filterStatus !== "all") params.append("status", filterStatus);
      const qs = params.toString();
      return apiClient.get(`/api/billing/generated${qs ? "?" + qs : ""}`);
    },
  });
  const { data: receiptsData, isLoading: receiptsLoading } = useQuery({
    queryKey: ["bill-receipts", viewingBill?.memberId?._id],
    queryFn: () => apiClient.get(`/api/receipts?memberId=${viewingBill.memberId._id}`),
    enabled: !!viewingBill?.memberId?._id && activeTab === "receipts",
  });
  const bills = billsData?.bills || [];
  const periods = [...new Set(bills.map((b) => b.billPeriodId))].filter(Boolean).sort().reverse();
  const filteredBills = bills.filter((b) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      b.memberId?.flatNo?.toLowerCase().includes(q) ||
      b.memberId?.ownerName?.toLowerCase().includes(q) ||
      b.memberId?.wing?.toLowerCase().includes(q);
    const matchesSeries =
      seriesFilter === "All" || (b.billSeries || "RESIDENTIAL") === seriesFilter.toUpperCase();
    return matchesSearch && matchesSeries;
  });
  const openBill = (bill) => { setViewingBill(bill); setActiveTab("summary"); };
  const downloadBill = async (bill) => {
    setDownloadingId(bill._id?.toString());
    try {
      let html = bill.billHtml;
      if (!html) {
        const res = await fetch(`/api/bills/download?id=${bill._id}`, { credentials: "include" });
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("text/html")) {
          html = await res.text();
        } else {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = Object.assign(document.createElement("a"), { href: url, download: `Bill-${bill.memberId?.wing}-${bill.memberId?.flatNo}-${bill.billPeriodId}.pdf` });
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
        }
      }
      if (!html) { notify.warning("No bill data. Please regenerate."); return; }
      const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>body{font-family:Arial,sans-serif;padding:20px;}@media print{body{padding:0;}@page{margin:8mm;size:A4;}}</style></head><body>${html}<script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script></body></html>`], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank");
      if (!w) notify.warning("Popup blocked. Please allow popups for this site.");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      notify.error("Download failed: " + e.message);
    } finally {
      setDownloadingId(null);
    }
  };
  const exportToExcel = async () => {
    try {
      const res = await fetch("/api/billing/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ period: selectedPeriod !== "all" ? selectedPeriod : null }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: `Bills-${selectedPeriod}.xlsx` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { notify.error("Export failed"); }
  };
  const sc = viewingBill ? (STATUS_COLOR[viewingBill.status] || STATUS_COLOR.Scheduled) : null;
  // ── Summary strip figures, over the rows currently in view ──────────
  // (filteredBills already has the period/status server filter plus the
  // client-side search and Residential/Commercial series filter applied.)
  const totalExpected = filteredBills.reduce((s, b) => s + Number(b.totalAmount || 0), 0);
  const totalCollected = filteredBills.reduce((s, b) => s + Number(b.amountPaid || 0), 0);
  const totalOutstanding = filteredBills.reduce((s, b) => s + Number(b.balanceAmount || 0), 0);
  const collectedPct = totalExpected > 0 ? Math.round((totalCollected / totalExpected) * 100) : 0;
  // The status filter is applied server-side, so `bills` only ever holds the
  // selected status once one is picked — counting the other tabs from it would
  // report 0. Show per-tab counts only on the unfiltered set.
  const statusCount = (s) => (filterStatus === "all" ? bills.filter((b) => b.status === s).length : undefined);

  return (
    <div className={styles.container}>
      <PageHeader
        eyebrow={<><Icon name="file-text" size={11} /> {selectedPeriod !== "all" ? selectedPeriod : "All periods"}</>}
        title="Bills"
        sub={`${filteredBills.length} bill${filteredBills.length !== 1 ? "s" : ""} in view · maintenance, water, parking & sinking fund`}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn variant="secondary" icon="download" onClick={exportToExcel}>Export Excel</Btn>
          </div>
        }
      />

      {/* ── Summary strip ─────────────────────────────────────────── */}
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", gap: 28, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--r-fg-4)", marginBottom: 6 }}>
              Total due in view
            </div>
            <div className="revamp-num" style={{ fontSize: 26, fontWeight: 700, color: "var(--r-fg-1)", letterSpacing: "-0.02em", marginBottom: 8 }}>
              ₹{fmt(totalExpected)}
            </div>
            <Progress value={collectedPct} total={100} color={collectedPct >= 80 ? "var(--r-success)" : collectedPct >= 50 ? "var(--r-warning)" : "var(--r-danger)"} height={5} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--r-fg-4)", marginTop: 6 }}>
              <span>{collectedPct}% collected</span><span>{100 - collectedPct}% to go</span>
            </div>
          </div>
          <SummaryStat label="Collected" value={`₹${fmt(totalCollected)}`} tone="paid" />
          <SummaryStat label="Outstanding" value={`₹${fmt(totalOutstanding)}`} tone="overdue" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <Segmented
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "cards", label: "Cards", icon: "layout-grid" },
                { value: "table", label: "Table", icon: "table" },
              ]}
            />
          </div>
        </div>
      </Card>

      {/* ── Filters ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <Segmented
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: "all", label: "All", count: filterStatus === "all" ? bills.length : undefined },
            { value: "Paid", label: "Paid", count: statusCount("Paid") },
            { value: "Unpaid", label: "Unpaid", count: statusCount("Unpaid") },
            { value: "Partial", label: "Partial", count: statusCount("Partial") },
            { value: "Overdue", label: "Overdue", count: statusCount("Overdue") },
          ]}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 260 }}>
            <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search flat, name, wing…" size="sm" />
          </div>
          <Select value={selectedPeriod} onChange={setSelectedPeriod} title="Bill period">
            <option value="all">All periods</option>
            {periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Select value={seriesFilter} onChange={setSeriesFilter} title="Bill series">
            <option value="All">Residential + Commercial</option>
            <option value="Residential">Residential</option>
            <option value="Commercial">Commercial</option>
          </Select>
        </div>
      </div>

      {/* ── Results ───────────────────────────────────────────────── */}
      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => <RevampSkeleton key={i} h={140} />)}
        </div>
      ) : filteredBills.length === 0 ? (
        <Card><EmptyState icon="inbox" title="No bills found" sub="Adjust the filters, or generate a bill cycle first." /></Card>
      ) : viewMode === "cards" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
          {filteredBills.map((bill) => (
            <BillCard key={bill._id} bill={bill} isDark={isDark} onOpen={() => openBill(bill)} />
          ))}
        </div>
      ) : (
        /* Dense table — every column the old view carried, restyled. Kept as
           a toggle because the card grid deliberately shows only the headline
           figures, and reconciling a cycle needs the full breakdown. */
        <Card padded={false} style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }} className="revamp-scroll">
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
              <thead>
                <tr>
                  {["Flat", "Member", "Unit Class", "Period", "Current Bill", "Prev Balance", "Interest", "Total Due", "Paid", "Balance", "Due Date", "Status", ""].map((h, i) => (
                    <th key={i} style={{
                      textAlign: i >= 4 && i <= 9 ? "right" : "left", padding: "8px 12px",
                      fontSize: 10, fontWeight: 600, color: "var(--r-fg-4)",
                      whiteSpace: "nowrap",
                      borderBottom: "1px solid var(--r-border)", background: "var(--r-surface-2)",
                      position: "sticky", top: 0, zIndex: 1,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredBills.map((bill) => {
                  const isHistorical = bill.isHistoricalArchive || bill.importedFrom === "BulkImport" || bill.isLocked;
                  const td = { padding: "10px 12px", borderBottom: "1px solid var(--r-hairline)", color: "var(--r-fg-2)", whiteSpace: "nowrap" };
                  const tdNum = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
                  return (
                    <tr key={bill._id} className="revamp-row"
                      style={{ cursor: "pointer", background: isHistorical ? "var(--r-surface-2)" : undefined }}
                      onClick={() => openBill(bill)}>
                      <td style={{ ...td, fontWeight: 600, color: "var(--r-fg-1)" }}>
                        {flatLabel(bill.memberId)}
                        {isHistorical && (
                          <span title="Historical imported record — immutable" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, background: "var(--r-brand-soft)", color: "var(--r-brand)", borderRadius: 4, padding: "1px 5px", verticalAlign: "middle" }}>
                            HIST
                          </span>
                        )}
                      </td>
                      <td style={td}>{bill.memberId?.ownerName}</td>
                      <td style={{ ...td, color: "var(--r-fg-3)" }}>{bill.unitClass ?? "—"}</td>
                      <td style={td}><Pill tone="neutral" dot={false}>{bill.billPeriodId}</Pill></td>
                      <td style={tdNum}>₹{fmt(chargesTotal(bill))}</td>
                      <td style={{ ...tdNum, color: prevBalance(bill) > 0 ? "var(--r-danger)" : "var(--r-success)" }}>
                        {prevBalance(bill) > 0 ? `₹${fmt(prevBalance(bill))}` : "Clear"}
                      </td>
                      <td style={{ ...tdNum, color: (bill.interestAmount || 0) > 0 ? "var(--r-warning)" : "var(--r-fg-5)" }}>
                        {(bill.interestAmount || 0) > 0 ? `₹${fmt(bill.interestAmount)}` : "—"}
                      </td>
                      <td style={{ ...tdNum, fontWeight: 700, color: "var(--r-fg-1)" }}>₹{fmt(bill.totalAmount)}</td>
                      <td style={{ ...tdNum, color: "var(--r-success)" }}>
                        {(bill.amountPaid || 0) > 0 ? `₹${fmt(bill.amountPaid)}` : "—"}
                      </td>
                      <td style={{ ...tdNum, fontWeight: 700, color: (bill.balanceAmount || 0) > 0 ? "var(--r-danger)" : "var(--r-success)" }}>
                        {(bill.balanceAmount || 0) > 0.005 ? `₹${fmt(bill.balanceAmount)}` : "Paid"}
                      </td>
                      <td style={{ ...td, color: "var(--r-fg-3)" }}>{fmtDate(bill.dueDate)}</td>
                      <td style={td}>
                        <Pill tone={STATUS_TONE[bill.status] || "neutral"}>{bill.status}</Pill>
                        {isHistorical && <span title="Locked — immutable audit record" style={{ marginLeft: 4, fontSize: 12 }}></span>}
                      </td>
                      <td style={td} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <Btn size="sm" onClick={() => openBill(bill)}>View</Btn>
                          <Btn size="sm" variant="ghost" icon="printer" onClick={() => downloadBill(bill)} disabled={downloadingId === bill._id?.toString()}>
                            {downloadingId === bill._id?.toString() ? "…" : "Print"}
                          </Btn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {/* Modal */}
      {viewingBill && (
        <div className={styles.modal} onClick={() => setViewingBill(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className={styles.modalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ background: "var(--accent)", color: "var(--on-solid)", borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>
{flatLabel(viewingBill.memberId)}                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: "var(--fg-1)" }}>{viewingBill.memberId?.ownerName}</div>
                  <div style={{ color: "var(--fg-4)", fontSize: 13 }}>
                    Period: {viewingBill.billPeriodId}
                    {viewingBill.importedFinancialYear && <> · FY: {viewingBill.importedFinancialYear}</>}
                    {!(viewingBill.isHistoricalArchive || viewingBill.importedFrom === "BulkImport") && <> · Generated: {fmtDate(viewingBill.generatedAt || viewingBill.createdAt)}</>}
                  </div>
                </div>
              </div>
              <button onClick={() => setViewingBill(null)} className={styles.closeBtn}>✕</button>
            </div>
            {/* Historical bill notice */}
            {(viewingBill.isHistoricalArchive || viewingBill.importedFrom === "BulkImport" || viewingBill.isLocked) && (
              <div style={{ margin: "0 2rem", padding: "10px 16px", background: "var(--primary-tint)", border: "1px solid var(--primary-tint)", borderRadius: 8, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--primary)" }}>
                <span></span>
                <span><strong>Historical Record</strong> — This bill was imported as an audit record and is immutable. It cannot be edited, deleted, or regenerated.</span>
              </div>
            )}
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "2px solid var(--border)", padding: "0 2rem" }}>
              {[["summary", "Summary"], ["bill", "Bill PDF"], ["receipts", "Receipts"]].map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: "12px 20px", border: "none", background: "none", cursor: "pointer", fontWeight: activeTab === tab ? 700 : 400, color: activeTab === tab ? "var(--accent)" : "var(--fg-4)", borderBottom: activeTab === tab ? "3px solid var(--accent)" : "3px solid transparent", marginBottom: -2, fontSize: 14 }}>
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.modalBody}>
              {/* SUMMARY TAB */}
              {activeTab === "summary" && (
                <div>
                  {/* Status + due date */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: sc.bg, border: `1px solid ${sc.border}`, borderRadius: 10, padding: "12px 18px", marginBottom: 20 }}>
                    <span style={{ fontWeight: 700, color: sc.text, fontSize: 15 }}>{viewingBill.status}</span>
                    <span style={{ color: "var(--fg-4)", fontSize: 13 }}>Due: {fmtDate(viewingBill.dueDate)}</span>
                  </div>
                  {/* Amount cards */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 24 }}>
                    {[
                      { label: "Current Bill", value: `₹${fmt(chargesTotal(viewingBill))}`, color: "var(--fg-2)" },
                      // Prev Balance = previous *principal* only. Carried-forward
// interest is already shown in the separate "Interest" cards,
// so using previousBalance (principal + interest) here
// double-counted the ₹200 and broke parts → total.
                      { label: "Prev Balance", value: prevBalance(viewingBill) > 0 ? `₹${fmt(prevBalance(viewingBill))}` : "Clear", color: prevBalance(viewingBill) > 0 ? "var(--danger-fg)" : "var(--success-fg)" },
                      { label: "Interest (carried)", value: interestParts(viewingBill).carried > 0 ? `₹${fmt(interestParts(viewingBill).carried)}` : "—", color: interestParts(viewingBill).carried > 0 ? "var(--warning-fg)" : "var(--fg-5)" },
                      { label: "Interest (this month)", value: interestParts(viewingBill).thisMonth > 0 ? `₹${fmt(interestParts(viewingBill).thisMonth)}` : "—", color: interestParts(viewingBill).thisMonth > 0 ? "var(--warning-fg)" : "var(--fg-5)" },
                      { label: "Total Due", value: `₹${fmt(viewingBill.totalAmount)}`, color: "var(--accent)", large: true },
                      ...(viewingBill.amountPaid > 0 ? [{ label: "Paid", value: `₹${fmt(viewingBill.amountPaid)}`, color: "var(--success-fg)" }] : []),
                      ...((viewingBill.balanceAmount || 0) > 0.005 ? [{ label: "Balance Due", value: `₹${fmt(viewingBill.balanceAmount)}`, color: "var(--danger-fg)", large: true }] : []),
                    ].map((c) => (
                      <div key={c.label} style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: "var(--fg-5)", marginBottom: 6 }}>{c.label}</div>
                        <div style={{ fontSize: c.large ? 20 : 15, fontWeight: 700, color: c.color }}>{c.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* Charges table */}
                  <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                    <div style={{ padding: "12px 16px", background: "var(--bg-sunken)", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>Charge Breakdown</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        {viewingBill.charges && Object.entries(viewingBill.charges).map(([name, amt], i) => (
                          <tr key={name} style={{ borderBottom: "1px solid var(--bg-muted)" }}>
                            <td style={{ padding: "10px 16px", color: "var(--fg-4)", width: 32 }}>{i + 1}</td>
                            <td style={{ padding: "10px 16px" }}>{name}</td>
                            <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600 }}>₹{fmt(amt)}</td>
                          </tr>
                        ))}
                        <tr style={{ background: "var(--success-bg)" }}>
                          <td colSpan={2} style={{ padding: "12px 16px", fontWeight: 700 }}>Current Month Total</td>
                          <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--success-fg)" }}>₹{fmt(chargesTotal(viewingBill))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* BILL PDF TAB */}
              {activeTab === "bill" && (
                <BillPdfTab bill={viewingBill} />
              )}
              {/* RECEIPTS TAB */}
              {activeTab === "receipts" && (
                <div>
                  {receiptsLoading ? (
                    <div className={styles.loading}><div className={styles.spinner} /><p>Loading receipts...</p></div>
                  ) : receiptsData?.receipts?.length > 0 ? (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                      <div style={{ padding: "12px 16px", background: "var(--bg-sunken)", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 14 }}>
                        {receiptsData.receipts.length} Payment{receiptsData.receipts.length !== 1 ? "s" : ""} — {viewingBill.memberId?.ownerName}
                      </div>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "var(--bg-sunken)" }}>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "var(--fg-4)", fontWeight: 600 }}>Receipt No</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "var(--fg-4)", fontWeight: 600 }}>Period</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "var(--fg-4)", fontWeight: 600 }}>Date</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 13, color: "var(--fg-4)", fontWeight: 600 }}>Amount</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "var(--fg-4)", fontWeight: 600 }}>Mode</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 13, color: "var(--fg-4)", fontWeight: 600 }}>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {receiptsData.receipts.map((r) => (
                            <tr key={r._id} style={{ borderTop: "1px solid var(--bg-muted)" }}>
                              <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 13, color: "var(--accent)" }}>{r.receiptNo}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13 }}>{r.billPeriodId || "—"}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13 }}>{fmtDate(r.paidAt || r.createdAt)}</td>
                              <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--success-fg)" }}>₹{fmt(r.amount)}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13 }}>{r.paymentMode}</td>
                              <td style={{ padding: "12px 16px", fontSize: 13, color: "var(--fg-4)" }}>{r.notes || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className={styles.emptyState} style={{ padding: 60 }}>
                      <div className={styles.emptyIcon}></div>
                      <h3>No payments recorded</h3>
                      <p>No receipts for this bill yet</p>
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* Modal Footer */}
            <div className={styles.modalFooter}>
              <button onClick={() => setViewingBill(null)} className="btn btn-secondary">Close</button>
              <button onClick={() => downloadBill(viewingBill)} className="btn btn-primary" disabled={downloadingId === viewingBill._id?.toString()}>
                {downloadingId === viewingBill._id?.toString() ? "Opening..." : "Print / Download Bill"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}