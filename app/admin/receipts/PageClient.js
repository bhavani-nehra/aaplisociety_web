"use client";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import ReceiptsBand from "@/components/money/ReceiptsBand";
// ── helpers ────────────────────────────────────────────────────────────────
const fmt = (n) =>
  "₹" +
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
const fmtDateFull = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "—";
const fmtDateTime = (d) =>
  d
    ? new Date(d).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const currentFY = () => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
};
// ── Print receipt component ─────────────────────────────────────────────────
function BillReceiptPrint({ receipt, society, member, bill, customDate }) {
  const date = customDate || receipt?.paidAt || new Date();
  return (
    <div
      style={{
        fontFamily: "Georgia, serif",
        maxWidth: 520,
        margin: "0 auto",
        padding: "2rem",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
      }}
    >
      {/* Header */}
      <div
        style={{
          textAlign: "center",
          borderBottom: "2px solid var(--fg-2)",
          paddingBottom: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--fg-2)" }}>
          {society?.name || "Society"}
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--fg-4)", marginTop: 4 }}>
          {society?.address}
        </div>
        <div
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            marginTop: "0.75rem",
            textDecoration: "underline",
            letterSpacing: "0.05em",
          }}
        >
          PAYMENT RECEIPT
        </div>
      </div>
      {/* Receipt meta */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.8rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <strong>Receipt No:</strong> {receipt?.receiptNo || "—"}
        </div>
        <div>
          <strong>Date:</strong> {fmtDateFull(date)}
        </div>
      </div>
      {/* Member details */}
      <div
        style={{
          background: "var(--bg-canvas)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          fontSize: "0.82rem",
        }}
      >
        <div>
          <strong>Member:</strong> {member?.ownerName || "—"}
        </div>
        <div>
          <strong>Flat:</strong> {member?.wing}-{member?.flatNo}
        </div>
        <div>
          <strong>Bill Period:</strong>{" "}
          {receipt?.billPeriodId || bill?.billPeriodId || "—"}
        </div>
      </div>
      {/* Amount table */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.82rem",
          marginBottom: "1rem",
        }}
      >
        <tbody>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <td style={{ padding: "0.5rem 0", color: "var(--fg-4)" }}>
              Bill Amount
            </td>
            <td
              style={{
                padding: "0.5rem 0",
                textAlign: "right",
                fontWeight: 600,
              }}
            >
              {fmt(bill?.totalAmount)}
            </td>
          </tr>
          {(receipt?.previousBalanceSnapshot || 0) > 0 && (
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "0.5rem 0", color: "var(--fg-4)" }}>
                Previous Balance
              </td>
              <td
                style={{
                  padding: "0.5rem 0",
                  textAlign: "right",
                  color: "var(--danger)",
                }}
              >
                {fmt(receipt?.previousBalanceSnapshot)}
              </td>
            </tr>
          )}
          <tr style={{ borderTop: "2px solid var(--fg-2)" }}>
            <td
              style={{
                padding: "0.6rem 0",
                fontWeight: 800,
                fontSize: "0.95rem",
              }}
            >
              Amount Paid
            </td>
            <td
              style={{
                padding: "0.6rem 0",
                textAlign: "right",
                fontWeight: 800,
                fontSize: "0.95rem",
                color: "var(--success)",
              }}
            >
              {fmt(receipt?.amount)}
            </td>
          </tr>
        </tbody>
      </table>
      <div
        style={{
          fontSize: "0.78rem",
          color: "var(--fg-4)",
          marginBottom: "0.5rem",
        }}
      >
        <strong>Payment Mode:</strong> {receipt?.paymentMode || "—"}
      </div>
      {receipt?.notes && (
        <div
          style={{
            fontSize: "0.78rem",
            color: "var(--fg-4)",
            marginBottom: "0.5rem",
          }}
        >
          <strong>Notes:</strong> {receipt?.notes}
        </div>
      )}
      <div
        style={{
          borderTop: "1px dashed var(--fg-5)",
          marginTop: "1.5rem",
          paddingTop: "1rem",
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.75rem",
          color: "var(--fg-5)",
        }}
      >
        <span>Generated: {fmtDateTime(new Date())}</span>
        <span>Authorised Signatory</span>
      </div>
    </div>
  );
}
function TransactionalReceiptPrint({ entry, society, customDate }) {
  const date = customDate || entry?.date || new Date();
  const isIncome = entry?.entryKind === "income";
  const fyYear = entry?.fy;
  return (
    <div
      style={{
        fontFamily: "Georgia, serif",
        maxWidth: 520,
        margin: "0 auto",
        padding: "2rem",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
      }}
    >
      {/* Header */}
      <div
        style={{
          textAlign: "center",
          borderBottom: "2px solid var(--fg-2)",
          paddingBottom: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--fg-2)" }}>
          {society?.name || "Society"}
        </div>
        <div style={{ fontSize: "0.8rem", color: "var(--fg-4)", marginTop: 4 }}>
          {society?.address}
        </div>
        <div
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            marginTop: "0.75rem",
            textDecoration: "underline",
            letterSpacing: "0.05em",
          }}
        >
          {isIncome ? "INCOME RECEIPT" : "EXPENDITURE BILL"}
        </div>
      </div>
      {/* Meta */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.8rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <strong>Date:</strong> {fmtDateFull(date)}
        </div>
        <div>
          <strong>FY:</strong> {fyYear}–{fyYear ? fyYear + 1 : ""}
        </div>
      </div>
      {/* Details */}
      <div
        style={{
          background: "var(--bg-canvas)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "0.75rem 1rem",
          marginBottom: "1rem",
          fontSize: "0.82rem",
        }}
      >
        <div>
          <strong>Description:</strong> {entry?.name}
        </div>
        <div style={{ marginTop: 4 }}>
          <strong>Category:</strong> {entry?.type}
        </div>
        <div style={{ marginTop: 4 }}>
          <strong>Kind:</strong>{" "}
          <span
            style={{ color: isIncome ? "var(--success)" : "var(--danger)", fontWeight: 700 }}
          >
            {isIncome ? "Income" : "Expenditure"}
          </span>
        </div>
        {entry?.notes && (
          <div style={{ marginTop: 4 }}>
            <strong>Notes:</strong> {entry.notes}
          </div>
        )}
      </div>
      {/* Amount */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.82rem",
          marginBottom: "1rem",
        }}
      >
        <tbody>
          <tr style={{ borderTop: "2px solid var(--fg-2)" }}>
            <td
              style={{
                padding: "0.6rem 0",
                fontWeight: 800,
                fontSize: "0.95rem",
              }}
            >
              {isIncome ? "Amount Received" : "Amount Paid"}
            </td>
            <td
              style={{
                padding: "0.6rem 0",
                textAlign: "right",
                fontWeight: 800,
                fontSize: "0.95rem",
                color: isIncome ? "var(--success)" : "var(--danger)",
              }}
            >
              {fmt(entry?.amount)}
            </td>
          </tr>
        </tbody>
      </table>
      <div
        style={{
          borderTop: "1px dashed var(--fg-5)",
          marginTop: "1.5rem",
          paddingTop: "1rem",
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.75rem",
          color: "var(--fg-5)",
        }}
      >
        <span>Generated: {fmtDateTime(new Date())}</span>
        <span>Authorised Signatory</span>
      </div>
    </div>
  );
}
// ── Row action button ───────────────────────────────────────────────────────
function ReceiptActions({ onPrint }) {
  return (
    <button
      onClick={onPrint}
      style={{
        padding: "4px 14px",
        borderRadius: 5,
        border: "1px solid var(--accent)",
        background: "var(--accent-tint)",
        color: "var(--primary-hover)",
        fontSize: "0.75rem",
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      View &amp; Print
    </button>
  );
}
// ── Main Page ───────────────────────────────────────────────────────────────
// A payment can be recorded without a Receipt if the write silently fails
// (2026-08-30: two payment routes were found doing exactly that) — this bar
// makes that condition visible instead of a member just never getting one.
function MissingReceiptsBar() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["receipt-gaps"],
    queryFn: async () => {
      const res = await fetch("/api/admin/receipts/gaps", { credentials: "include" });
      if (!res.ok) throw new Error("Could not check for missing receipts");
      return res.json();
    },
    staleTime: 60_000,
  });
  const fixMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/receipts/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Could not generate the missing receipts");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receipt-gaps"] });
      queryClient.invalidateQueries({ queryKey: ["bill-receipts"] });
      queryClient.invalidateQueries({ queryKey: ["money-insights"] });
    },
  });
  if (isLoading || !data?.count) return null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        flexWrap: "wrap",
        marginBottom: "1.25rem",
        padding: "0.75rem 1rem",
        borderRadius: 8,
        border: "1px solid var(--danger)",
        background: "var(--danger-bg)",
        color: "var(--danger-fg)",
      }}
    >
      <div style={{ fontSize: "0.85rem" }}>
        <strong>{data.count} payment{data.count === 1 ? "" : "s"} have no receipt.</strong>{" "}
        The money was received and recorded, but the receipt was never generated.
        {fixMutation.isError && (
          <div style={{ marginTop: 4, fontWeight: 700 }}>{fixMutation.error.message}</div>
        )}
        {fixMutation.data && !fixMutation.isError && (
          <div style={{ marginTop: 4, fontWeight: 700 }}>
            Generated {fixMutation.data.created} receipt{fixMutation.data.created === 1 ? "" : "s"}.
          </div>
        )}
      </div>
      <button
        onClick={() => fixMutation.mutate()}
        disabled={fixMutation.isPending}
        style={{
          padding: "0.5rem 1.1rem",
          borderRadius: 6,
          border: "none",
          background: "var(--danger)",
          color: "var(--on-solid)",
          fontWeight: 700,
          fontSize: "0.82rem",
          cursor: fixMutation.isPending ? "default" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {fixMutation.isPending ? "Generating…" : "Generate missing receipts"}
      </button>
    </div>
  );
}
export default function ReceiptsPage() {
  // The print modal below is position:fixed; DashboardLayout.js's
  // .contentFrame sets backdrop-filter, which becomes the containing block
  // for fixed descendants — so without a portal the modal was fixed to that
  // scrolled content box, not the real viewport. `mounted` keeps the portal
  // call out of the SSR pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [tab, setTab] = useState("bills"); // "bills" | "transactional"
  const [selectedFY, setSelectedFY] = useState(currentFY());
  // For bill receipts: member filter
  const [billMemberSearch, setBillMemberSearch] = useState("");
  const [billMemberId, setBillMemberId] = useState("");
  const [billMemberLabel, setBillMemberLabel] = useState("");
  const [showMemberDrop, setShowMemberDrop] = useState(false);
  // Print target
  const printRef = useRef();
  const [printing, setPrinting] = useState(null);
  const [customDate, setCustomDate] = useState("");
  const [dateMode, setDateMode] = useState("current");
  // Society info
  const { data: societyData } = useQuery({
    queryKey: ["society-config-receipts"],
    queryFn: async () => {
      const res = await fetch("/api/society/config", {
        credentials: "include",
      });
      return res.json();
    },
    staleTime: 300_000,
  });
  const society = societyData?.society || null;
  // Members list for search
  const { data: membersData } = useQuery({
    queryKey: ["members-list-receipts"],
    queryFn: async () => {
      const res = await fetch("/api/members/list?limit=2000", {
        credentials: "include",
      });
      return res.json();
    },
    staleTime: 300_000,
  });
  const allMembers = membersData?.members || [];
  const filteredMembers = billMemberSearch
    ? allMembers.filter(
        (m) =>
          m.ownerName?.toLowerCase().includes(billMemberSearch.toLowerCase()) ||
          m.flatNo?.toLowerCase().includes(billMemberSearch.toLowerCase()) ||
          m.wing?.toLowerCase().includes(billMemberSearch.toLowerCase()),
      )
    : allMembers.slice(0, 10);
  // Bill receipts
  const { data: billReceiptsData, isLoading: billLoading } = useQuery({
    queryKey: ["bill-receipts", billMemberId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (billMemberId) params.set("memberId", billMemberId);
      const res = await fetch(`/api/receipts?${params}`, {
        credentials: "include",
      });
      return res.json();
    },
    staleTime: 60_000,
    enabled: tab === "bills",
  });
  // Bills for context (when printing)
  const { data: billsData } = useQuery({
    queryKey: ["all-bills-receipts", billMemberId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (billMemberId) params.set("memberId", billMemberId);
      const res = await fetch(`/api/billing/list?${params}`, {
        credentials: "include",
      });
      return res.json();
    },
    staleTime: 60_000,
    enabled: tab === "bills",
  });
  // Transactional entries
  const { data: entriesData, isLoading: entriesLoading } = useQuery({
    queryKey: ["society-entries-receipts", selectedFY],
    queryFn: async () => {
      const res = await fetch(`/api/society-entries?fy=${selectedFY}`, {
        credentials: "include",
      });
      return res.json();
    },
    staleTime: 60_000,
    enabled: tab === "transactional",
  });
  const billReceipts = billReceiptsData?.receipts || [];
  const entries = entriesData?.entries || [];
  const getBillForReceipt = (r) =>
    billsData?.bills?.find(
      (b) => b._id === r.billId?.toString?.() || b._id === r.billId,
    ) || null;
  const getMemberForReceipt = (r) => {
    const mid = r.memberId?.toString?.() || r.memberId;
    return allMembers.find((m) => m._id?.toString() === mid) || null;
  };
  const handlePrint = () => {
    const content = printRef.current;
    if (!content) return;
    // Inject a print-only style that hides everything except printRef
    const styleEl = document.createElement("style");
    styleEl.id = "__receipt-print-style__";
    styleEl.textContent = `
      @media print {
        body > * { display: none !important; }
        #__receipt-print-root__ { display: block !important; }
      }
    `;
    document.head.appendChild(styleEl);
    // Wrap content in a top-level div
    const root = document.createElement("div");
    root.id = "__receipt-print-root__";
    root.style.cssText = "display:none; font-family: Georgia, serif;";
    root.appendChild(content.cloneNode(true));
    document.body.appendChild(root);
    window.print();
    // Cleanup after print dialog closes
    document.body.removeChild(root);
    document.head.removeChild(styleEl);
  };
  const triggerPrint = (type, data) => {
    setPrinting({ type, data });
    setDateMode("current");
    setCustomDate("");
  };
  const getEffectiveDate = () => {
    if (dateMode === "current") return new Date();
    if (dateMode === "original") {
      if (printing?.type === "bill") return printing?.data?.paidAt;
      if (printing?.type === "entry") return printing?.data?.date;
    }
    if (dateMode === "manual" && customDate) return new Date(customDate);
    return new Date();
  };
  const cardStyle = {
    background: "var(--bg-surface)",
    borderRadius: 10,
    border: "1px solid var(--border)",
    overflow: "hidden",
  };
  const thStyle = {
    padding: "8px 12px",
    textAlign: "left",
    fontSize: "11px",
    color: "var(--fg-4)",
    fontWeight: 700,
    
    letterSpacing: "0.04em",
    background: "var(--bg-canvas)",
    borderBottom: "1px solid var(--border)",
  };
  const tdStyle = {
    padding: "10px 12px",
    fontSize: "13px",
    borderBottom: "1px solid var(--bg-muted)",
    verticalAlign: "middle",
  };
  // FY options: simple range
  const fyOptions = [];
  for (let y = currentFY() - 3; y <= currentFY(); y++) fyOptions.push(y);
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.25rem",
              fontWeight: 800,
              color: "var(--fg-1)",
            }}
          >
            Receipts
          </h1>
          <p
            style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "var(--fg-4)" }}
          >
            Generate &amp; print payment receipts and expenditure/income
            vouchers
          </p>
        </div>
      </div>
      <ReceiptsBand fy={selectedFY} />
      <MissingReceiptsBar />
      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: 0,
          marginBottom: "1.5rem",
          background: "var(--bg-muted)",
          borderRadius: 8,
          padding: 4,
          width: "fit-content",
        }}
      >
        {[
          { key: "bills", label: "Bill Receipts" },
          { key: "transactional", label: "Transactional Entries" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "0.4rem 1.25rem",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "0.85rem",
              background: tab === t.key ? "var(--bg-surface)" : "transparent",
              color: tab === t.key ? "var(--fg-2)" : "var(--fg-4)",
              boxShadow: tab === t.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* ── BILL RECEIPTS TAB ── */}
      {tab === "bills" && (
        <div>
          {/* Member filter */}
          <div
            style={{
              marginBottom: "1rem",
              position: "relative",
              maxWidth: 360,
            }}
          >
            <input
              value={billMemberLabel || billMemberSearch}
              onChange={(e) => {
                setBillMemberSearch(e.target.value);
                setBillMemberId("");
                setBillMemberLabel("");
                setShowMemberDrop(true);
              }}
              onFocus={() => setShowMemberDrop(true)}
              placeholder="Search member by name / flat..."
              style={{
                width: "100%",
                padding: "0.5rem 0.75rem",
                borderRadius: 7,
                border: "1px solid var(--border-strong)",
                fontSize: "0.85rem",
                boxSizing: "border-box",
              }}
            />
            {billMemberId && (
              <button
                onClick={() => {
                  setBillMemberId("");
                  setBillMemberLabel("");
                  setBillMemberSearch("");
                }}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--fg-5)",
                  cursor: "pointer",
                  fontSize: "1rem",
                }}
              >
                ✕
              </button>
            )}
            {showMemberDrop && !billMemberId && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  zIndex: 100,
                  maxHeight: 240,
                  overflowY: "auto",
                }}
              >
                {filteredMembers.length === 0 && (
                  <div
                    style={{
                      padding: "0.75rem",
                      color: "var(--fg-5)",
                      fontSize: "0.82rem",
                    }}
                  >
                    No members found
                  </div>
                )}
                {filteredMembers.map((m) => (
                  <div
                    key={m._id}
                    onClick={() => {
                      setBillMemberId(m._id);
                      setBillMemberLabel(
                        `${m.wing}-${m.flatNo} — ${m.ownerName}`,
                      );
                      setBillMemberSearch("");
                      setShowMemberDrop(false);
                    }}
                    style={{
                      padding: "0.5rem 0.75rem",
                      cursor: "pointer",
                      fontSize: "0.82rem",
                      borderBottom: "1px solid var(--bg-muted)",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--bg-canvas)")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "")
                    }
                  >
                    <strong>
                      {m.wing}-{m.flatNo}
                    </strong>{" "}
                    — {m.ownerName}
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Receipts table */}
          <div style={cardStyle}>
            {billLoading ? (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "var(--fg-5)",
                }}
              >
                Loading...
              </div>
            ) : billReceipts.length === 0 ? (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "var(--fg-5)",
                }}
              >
                {billMemberId
                  ? "No receipts for this member"
                  : "Select a member or all receipts will show here"}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[
                        "Receipt No",
                        "Member",
                        "Unit Class",
                        "Bill Period",
                        "Amount",
                        "Mode",
                        "Paid On",
                        "Action",
                      ].map((h) => (
                        <th key={h} style={thStyle}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {billReceipts.map((r) => {
                      const member = getMemberForReceipt(r);
                      const bill = getBillForReceipt(r);
                      return (
                        <tr key={r._id}>
                          <td
                            style={{
                              ...tdStyle,
                              fontFamily: "monospace",
                              fontSize: "11px",
                              color: "var(--fg-4)",
                            }}
                          >
                            {r.receiptNo}
                          </td>
                          <td style={tdStyle}>
                            <div style={{ fontWeight: 600 }}>
                              {member?.wing}-{member?.flatNo}
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--fg-5)" }}>
                              {member?.ownerName}
                            </div>
                          </td>
                          <td style={{ ...tdStyle, color: "var(--fg-4)" }}>
                            {r.unitClass || "—"}
                          </td>
                          <td style={{ ...tdStyle, color: "var(--fg-4)" }}>
                            {r.billPeriodId || "—"}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              fontWeight: 700,
                              color: "var(--success)",
                            }}
                          >
                            {fmt(r.amount)}
                          </td>
                          <td style={tdStyle}>
                            <span
                              style={{
                                background: "var(--info-bg)",
                                color: "var(--info-fg)",
                                padding: "2px 8px",
                                borderRadius: 10,
                                fontSize: "11px",
                                fontWeight: 700,
                              }}
                            >
                              {r.paymentMode || "—"}
                            </span>
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              color: "var(--fg-4)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {fmtDate(r.paidAt)}
                          </td>
                          <td style={tdStyle}>
                            <ReceiptActions
                              onPrint={() =>
                                triggerPrint("bill", { receipt: r, member, bill })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {/* ── TRANSACTIONAL TAB ── */}
      {tab === "transactional" && (
        <div>
          {/* FY filter */}
          <div
            style={{
              marginBottom: "1rem",
              display: "flex",
              gap: "0.75rem",
              alignItems: "center",
            }}
          >
            <span
              style={{ fontSize: "0.82rem", color: "var(--fg-4)", fontWeight: 600 }}
            >
              Financial Year:
            </span>
            <select
              value={selectedFY}
              onChange={(e) => setSelectedFY(Number(e.target.value))}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: 6,
                border: "1px solid var(--border-strong)",
                fontSize: "0.85rem",
              }}
            >
              {fyOptions.map((y) => (
                <option key={y} value={y}>
                  FY {y}–{y + 1}
                </option>
              ))}
            </select>
            <span style={{ fontSize: "0.78rem", color: "var(--fg-5)" }}>
              Showing custom income/expenditure entries from Balance Sheet
            </span>
          </div>
          <div style={cardStyle}>
            {entriesLoading ? (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "var(--fg-5)",
                }}
              >
                Loading...
              </div>
            ) : entries.length === 0 ? (
              <div
                style={{
                  padding: "2rem",
                  textAlign: "center",
                  color: "var(--fg-5)",
                }}
              >
                No entries for FY {selectedFY}–{selectedFY + 1}.{" "}
                <a href="/admin/accounting/statements?tab=print" style={{ color: "var(--accent)" }}>
                  Open the year-end sheets →
                </a>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[
                        "Description",
                        "Type",
                        "Kind",
                        "Amount",
                        "Date",
                        "FY",
                        "Action",
                      ].map((h) => (
                        <th key={h} style={thStyle}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const isIncome = e.entryKind === "income";
                      return (
                        <tr key={e._id}>
                          <td
                            style={{
                              ...tdStyle,
                              fontWeight: 600,
                              color: "var(--fg-2)",
                            }}
                          >
                            {e.name}
                          </td>
                          <td style={{ ...tdStyle, color: "var(--fg-4)" }}>
                            {e.type}
                          </td>
                          <td style={tdStyle}>
                            <span
                              style={{
                                background: isIncome ? "var(--success-bg)" : "var(--danger-bg)",
                                color: isIncome ? "var(--success-fg)" : "var(--danger-fg)",
                                padding: "2px 8px",
                                borderRadius: 10,
                                fontSize: "11px",
                                fontWeight: 700,
                              }}
                            >
                              {isIncome ? "Income" : "Expenditure"}
                            </span>
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              fontWeight: 700,
                              color: isIncome ? "var(--success)" : "var(--danger)",
                            }}
                          >
                            {fmt(e.amount)}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              color: "var(--fg-4)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {fmtDate(e.date)}
                          </td>
                          <td style={{ ...tdStyle, color: "var(--fg-4)" }}>
                            FY {e.fy}–{e.fy + 1}
                          </td>
                          <td style={tdStyle}>
                            <ReceiptActions
                              onPrint={() => triggerPrint("entry", e)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {/* ── PRINT MODAL ── */}
      {printing && mounted && createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "var(--bg-surface)",
              borderRadius: 12,
              padding: "1.5rem",
              maxWidth: 640,
              width: "95vw",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            {/* Date mode selector */}
            <div
              style={{
                marginBottom: "1rem",
                padding: "0.75rem",
                background: "var(--bg-canvas)",
                borderRadius: 8,
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  fontSize: "0.78rem",
                  fontWeight: 700,
                  color: "var(--fg-4)",
                  marginBottom: "0.5rem",
                }}
              >
                Receipt Date
              </div>
              <div
                style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}
              >
                {[
                  { key: "current", label: "Current timestamp" },
                  { key: "original", label: "Original entry date" },
                  { key: "manual", label: "Custom date" },
                ].map((opt) => (
                  <label
                    key={opt.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.82rem",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="dateMode"
                      value={opt.key}
                      checked={dateMode === opt.key}
                      onChange={() => setDateMode(opt.key)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              {dateMode === "manual" && (
                <input
                  type="datetime-local"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.4rem 0.6rem",
                    borderRadius: 5,
                    border: "1px solid var(--border-strong)",
                    fontSize: "0.82rem",
                  }}
                />
              )}
            </div>
            {/* Hidden print area */}
            <div ref={printRef} style={{ padding: "0.5rem" }}>
              {printing.type === "bill" && (
                <BillReceiptPrint
                  receipt={printing.data.receipt}
                  society={society}
                  member={printing.data.member}
                  bill={printing.data.bill}
                  customDate={getEffectiveDate()}
                />
              )}
              {printing.type === "entry" && (
                <TransactionalReceiptPrint
                  entry={printing.data}
                  society={society}
                  customDate={getEffectiveDate()}
                />
              )}
            </div>
            {/* Actions */}
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                justifyContent: "flex-end",
                marginTop: "1rem",
              }}
            >
              <button
                onClick={() => setPrinting(null)}
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg-surface)",
                  cursor: "pointer",
                  fontWeight: 600,
                  color: "var(--fg-4)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handlePrint}
                style={{
                  padding: "0.5rem 1.5rem",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--fg-2)",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Print / Download PDF
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
