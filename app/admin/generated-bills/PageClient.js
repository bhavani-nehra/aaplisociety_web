"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import notify from "@/lib/notify";
import {
  PageHeader, Card, Btn, Pill, Icon, SearchInput, Select, DataTable,
  RevampSkeleton, Modal,
} from "@/components/revamp";

export default function GeneratedBillsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewingBill, setViewingBill] = useState(null);

  const { data: billsData, isLoading } = useQuery({
    queryKey: ["generated-bills"],
    queryFn: () => apiClient.get("/api/billing/generated"),
  });
  const bills = billsData?.bills || [];

  const periods = [...new Set(bills.map((b) => b.billPeriodId))].sort().reverse();

  const filteredBills = bills.filter((bill) => {
    const matchesPeriod = selectedPeriod === "all" || bill.billPeriodId === selectedPeriod;
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      searchTerm === "" ||
      bill.memberId?.roomNo?.toLowerCase().includes(term) ||
      bill.memberId?.ownerName?.toLowerCase().includes(term) ||
      bill.memberId?.wing?.toLowerCase().includes(term);
    return matchesPeriod && matchesSearch;
  });

  const handlePrint = (bill) => {
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Bill - ${bill.memberId?.wing}-${bill.memberId?.roomNo}</title>
          <style>
            body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
            @media print { body { margin: 0; padding: 0; } }
          </style>
        </head>
        <body>
          ${bill.billHtml || "No bill data available"}
          <script>window.onload = function() { window.print(); };</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadAll = () => {
    if (filteredBills.length === 0) {
      notify.info("No bills to download");
      return;
    }
    const printWindow = window.open("", "_blank");
    const allBillsHtml = filteredBills
      .map((bill, idx) => `
        ${bill.billHtml || ""}
        ${idx < filteredBills.length - 1 ? '<div style="page-break-after: always;"></div>' : ""}
      `)
      .join("");
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>All Bills - ${selectedPeriod}</title>
          <style>
            body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
            @media print { body { margin: 0; padding: 0; } }
          </style>
        </head>
        <body>
          ${allBillsHtml}
          <script>window.onload = function() { window.print(); };</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const cols = [
    { key: "period", label: "Bill period", render: (b) => <strong style={{ color: "var(--r-fg-1)" }}>{b.billPeriodId}</strong> },
    {
      key: "member", label: "Member", render: (b) => (
        <div>
          <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{b.memberId?.wing}-{b.memberId?.roomNo}</div>
          <div style={{ fontSize: 12, color: "var(--r-fg-4)" }}>{b.memberId?.ownerName}</div>
        </div>
      ),
    },
    { key: "amount", label: "Amount", align: "right", render: (b) => <span className="revamp-num" style={{ fontWeight: 700 }}>₹{b.amount?.toLocaleString("en-IN")}</span> },
    {
      key: "status", label: "Status", align: "center", render: (b) => (
        <Pill tone={b.balanceAfterTransaction < 0 ? "unpaid" : "paid"} dot={false}>
          {b.balanceAfterTransaction < 0 ? "Pending" : "Paid"}
        </Pill>
      ),
    },
    { key: "generated", label: "Generated on", align: "center", render: (b) => <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>{new Date(b.date).toLocaleDateString("en-IN")}</span> },
    {
      key: "actions", label: "", render: (b) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
          <Btn size="sm" variant="secondary" icon="eye" onClick={() => setViewingBill(b)}>View</Btn>
          <Btn size="sm" variant="primary" icon="printer" onClick={() => handlePrint(b)}>Print</Btn>
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="file-text" size={11} /> Money · Generated bills</>}
        title="Generated bills"
        sub="View and print all generated bills."
        right={<Btn variant="primary" icon="printer" onClick={handleDownloadAll}>Print all ({filteredBills.length})</Btn>}
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search by room, name, or wing..." />
          </div>
          <Select value={selectedPeriod} onChange={setSelectedPeriod} size="md" title="Bill period">
            <option value="all">All periods</option>
            {periods.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
          <Pill tone="info" dot={false}>{filteredBills.length} bills</Pill>
        </div>
      </Card>

      {isLoading ? (
        <RevampSkeleton h={320} />
      ) : (
        <DataTable cols={cols} rows={filteredBills} rowKey="_id" emptyIcon="file-text" emptyTitle="No bills found" />
      )}

      <Modal
        open={Boolean(viewingBill)}
        onClose={() => setViewingBill(null)}
        title={viewingBill ? `Bill: ${viewingBill.memberId?.wing}-${viewingBill.memberId?.roomNo}` : ""}
        width={900}
      >
        {viewingBill && (
          <>
            <div dangerouslySetInnerHTML={{ __html: viewingBill.billHtml || "No bill data" }} />
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--r-hairline)", textAlign: "center" }}>
              <Btn variant="primary" icon="printer" onClick={() => handlePrint(viewingBill)} style={{ minWidth: 200 }}>
                Print this bill
              </Btn>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
