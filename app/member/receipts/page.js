"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useState } from "react";
import { PageHeader, Card, Btn, Pill, Icon, EmptyState, RevampSkeleton } from "@/components/revamp";
import notify from "@/lib/notify";

export default function ReceiptsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["my-receipts", page],
    queryFn: () => apiClient.get(`/api/member/receipts?page=${page}&limit=20`),
  });
  const receipts = data?.receipts || [];
  const pagination = data?.pagination || {};

  const downloadReceipt = async (receiptId) => {
    const response = await fetch(`/api/member/receipts/${receiptId}/download`, {
      credentials: "include",
    });
    if (!response.ok) {
      notify.error("Download failed");
      return;
    }
    const html = await response.text();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (!w) notify.warning("Popup blocked");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="receipt" size={11} /> My Account</>}
        title="My Receipts"
        sub="All payment receipts for your account"
      />

      {isLoading ? (
        <div style={{ display: "grid", gap: 12 }}>
          {[1, 2, 3].map((i) => <RevampSkeleton key={i} h={88} />)}
        </div>
      ) : receipts.length === 0 ? (
        <Card>
          <EmptyState icon="receipt" title="No receipts yet" sub="Receipts will appear here after you make payments" />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {receipts.map((receipt) => (
            <Card key={receipt._id} hover>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center", minWidth: 0 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: "var(--r-success-soft)", color: "var(--r-success)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon name="receipt" size={18} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: "var(--r-fg-1)", fontSize: 14 }}>{receipt.receiptNo}</div>
                    <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 3 }}>
                      {receipt.billPeriodId} · {receipt.paymentMode} ·{" "}
                      {new Date(receipt.paidAt).toLocaleDateString("en-IN", {
                        day: "2-digit", month: "short", year: "numeric",
                      })}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--r-fg-5)", marginTop: 2, fontFamily: "monospace" }}>
                      {receipt.filename}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ textAlign: "right" }}>
                    <div className="revamp-num" style={{ fontSize: 18, fontWeight: 700, color: "var(--r-success)" }}>
                      ₹{receipt.amount.toLocaleString("en-IN")}
                    </div>
                    <Pill tone={receipt.status === "Downloaded" ? "info" : "paid"} style={{ marginTop: 4 }}>
                      {receipt.status}
                    </Pill>
                  </div>
                  <Btn variant="primary" size="sm" icon="download" onClick={() => downloadReceipt(receipt._id)}>
                    Download
                  </Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {pagination.pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 20 }}>
          <Btn variant="secondary" size="sm" icon="chevron-left" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Prev
          </Btn>
          <span style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>
            Page {page} of {pagination.pages}
          </span>
          <Btn variant="secondary" size="sm" iconR="chevron-right" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Btn>
        </div>
      )}
    </div>
  );
}
