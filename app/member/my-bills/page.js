"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import notify from "@/lib/notify";
import {
  PageHeader, Btn, Icon, Pill, Segmented, DataTable, SmallStat, RevampSkeleton,
} from "@/components/revamp";

const STATUS_TONE = { Paid: "paid", Unpaid: "unpaid", Partial: "partial", Overdue: "overdue" };

const STATUS_TABS = [
  { value: "all", label: "All" },
  { value: "Unpaid", label: "Unpaid" },
  { value: "Overdue", label: "Overdue" },
  { value: "Paid", label: "Paid" },
];

export default function MyBillsPage() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["my-bills", filterStatus, page],
    queryFn: () =>
      apiClient.get(
        `/api/member/bills?status=${filterStatus}&page=${page}&limit=20`,
      ),
  });
  const bills = data?.bills || [];
  const summary = data?.summary || {};
  const pagination = data?.pagination || {};

  const downloadBill = async (bill) => {
    try {
      const res = await fetch(`/api/bills/download?id=${bill._id}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        notify.error("Failed to load bill: " + (err.error || res.statusText));
        return;
      }
      const contentType = res.headers.get("content-type") || "";
      const blob = await res.blob();
      const blobWithType = new Blob([blob], {
        type: contentType.includes("pdf") ? "application/pdf" : "text/html",
      });
      const url = URL.createObjectURL(blobWithType);
      const w = window.open(url, "_blank");
      if (!w) notify.warning("Popup blocked. Please allow popups.");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      notify.error("Download failed: " + e.message);
    }
  };

  // rowKey needs a stable field; some legacy records only carry `id`.
  const rows = bills.map((b) => ({ ...b, _id: b._id || b.id }));

  const cols = [
    {
      key: "period",
      label: "Bill period",
      render: (bill) => (
        <div>
          <div style={{ fontWeight: 700, color: "var(--r-fg-1)" }}>{bill.billPeriodId}</div>
          <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 2 }}>
            Due: {new Date(bill.dueDate).toLocaleDateString("en-IN", {
              day: "2-digit", month: "short", year: "numeric",
            })}
          </div>
          {bill.previousBalance > 0 && (
            <div style={{ fontSize: 11.5, color: "var(--r-danger)", marginTop: 2 }}>
              Includes prev balance: ₹{bill.previousBalance.toLocaleString("en-IN")}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      align: "right",
      render: (bill) => (
        <div>
          <div className="revamp-num" style={{ fontWeight: 700, fontSize: 14, color: "var(--r-fg-1)" }}>
            ₹{bill.totalAmount?.toLocaleString("en-IN")}
          </div>
          {bill.amountPaid > 0 && (
            <div className="revamp-num" style={{ fontSize: 11.5, color: "var(--r-success)" }}>
              Paid: ₹{bill.amountPaid.toLocaleString("en-IN")}
            </div>
          )}
          {bill.totalAmount > 0 && bill.status !== "Paid" && (
            <div className="revamp-num" style={{ fontSize: 11.5, color: "var(--r-danger)" }}>
              Due: ₹{bill.balanceAmount.toLocaleString("en-IN")}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (bill) => (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
          <Pill tone={STATUS_TONE[bill.status] || "unpaid"}>{bill.status}</Pill>
          {bill.isHistoricalArchive === true && (
            <Pill tone="neutral" dot={false}>Historical</Pill>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (bill) => (
        !bill.isHistoricalArchive ? (
          <Btn size="sm" variant="secondary" icon="download" onClick={() => downloadBill(bill)}>Bill</Btn>
        ) : null
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1160, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="file-text" size={11} /> Billing</>}
        title="My Bills"
        sub="View your maintenance bills"
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
        <SmallStat icon="list" label="Total Bills" value={pagination.total || 0} />
        <SmallStat icon="alert-circle" label="Outstanding" value={`₹${(summary.totalOutstanding || 0).toLocaleString("en-IN")}`} tone="danger" />
        <SmallStat icon="check-circle-2" label="Total Paid" value={`₹${(summary.totalPaid || 0).toLocaleString("en-IN")}`} tone="success" />
      </div>

      {/* Partial isn't a separate tab — "Unpaid" already covers it
          server-side (see api/member/bills/route.js); each bill still
          shows its own Partial badge with the remaining amount. */}
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={filterStatus}
          onChange={(v) => { setFilterStatus(v); setPage(1); }}
          options={STATUS_TABS}
        />
      </div>

      {isLoading ? (
        <RevampSkeleton h={320} />
      ) : (
        <DataTable
          cols={cols}
          rows={rows}
          rowKey="_id"
          emptyIcon="inbox"
          emptyTitle="No bills found"
        />
      )}

      {pagination.pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 16 }}>
          <Btn size="sm" variant="ghost" icon="chevron-left" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Btn>
          <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Page {page} of {pagination.pages}</span>
          <Btn size="sm" variant="ghost" iconR="chevron-right" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
        </div>
      )}
    </div>
  );
}
