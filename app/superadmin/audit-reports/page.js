"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";
const MONTH_NAMES = [
  "",
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
const STATUS_COLOR = {
  Pending: "var(--warning)",
  Approved: "var(--success)",
  Rejected: "var(--danger)",
};
async function adminFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return res.json();
}
export default function SuperAdminAuditReportsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [reviewNotes, setReviewNotes] = useState("");
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-audit-reports"],
    queryFn: () => adminFetch("/api/superadmin/audit-reports"),
  });
  const reviewMutation = useMutation({
    mutationFn: ({ reportId, status, reviewNotes }) =>
      adminFetch("/api/superadmin/audit-reports", {
        method: "PUT",
        body: JSON.stringify({ reportId, status, reviewNotes }),
      }),
    onSuccess: () => {
      qc.invalidateQueries(["superadmin-audit-reports"]);
      setSelected(null);
    },
  });
  const handleDownload = async (societyId, societyName) => {
    const res = await fetch(
      `/api/superadmin/audit-reports?societyId=${societyId}&download=true`,
      {
        credentials: "include",
        headers: {},
      },
    );
    if (!res.ok) return notify.error("Download failed");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AuditReport-${societyName}.xlsx`;
    a.click();
  };
  const reports = (data?.reports || []).filter(
    (r) =>
      (filterStatus === "all" || r.status === filterStatus) &&
      r.societyName?.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1
        style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}
      >
        Audit Reports
      </h1>
      <p style={{ color: "var(--fg-4)", marginBottom: "2rem" }}>
        All society audit submissions. Review, approve, or reject each report.
      </p>
      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginBottom: "1.5rem",
          flexWrap: "wrap",
        }}
      >
        <input
          placeholder="Search society..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "0.5rem",
            borderRadius: 6,
            border: "1px solid var(--border)",
            flex: 1,
            minWidth: 180,
          }}
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{
            padding: "0.5rem",
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          <option value="all">All Status</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
        </select>
        <span
          style={{
            padding: "0.5rem 1rem",
            background: "var(--info-bg)",
            borderRadius: 20,
            fontWeight: 600,
            color: "var(--info)",
          }}
        >
          {reports.length} Reports
        </span>
      </div>
      {isLoading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>
          Loading reports...
        </div>
      ) : reports.length === 0 ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>
          No audit reports found.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.875rem",
            }}
          >
            <thead>
              <tr
                style={{
                  background: "var(--bg-sunken)",
                  borderBottom: "2px solid var(--border)",
                }}
              >
                {[
                  "Society",
                  "Join Date",
                  "Audit Window",
                  "Months",
                  "Rows",
                  "Submitted",
                  "Status",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 12px",
                      textAlign: "left",
                      fontWeight: 700,
                      color: "var(--fg-3)",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r._id} style={{ borderBottom: "1px solid var(--bg-muted)" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                    {r.societyName}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {MONTH_NAMES[r.joinMonth]} {r.joinYear}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {MONTH_NAMES[r.auditFromMonth]} {r.auditFromYear} →{" "}
                    {MONTH_NAMES[r.auditToMonth]} {r.auditToYear}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    {r.totalMonthsRequired}
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "center" }}>
                    {r.validation?.totalRowsFound}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {new Date(r.submittedAt).toLocaleDateString("en-IN")}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: 12,
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        background: STATUS_COLOR[r.status] + "22",
                        color: STATUS_COLOR[r.status],
                      }}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div
                      style={{
                        display: "flex",
                        gap: "0.5rem",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        onClick={() => {
                          setSelected(r);
                          setReviewNotes(r.reviewNotes || "");
                        }}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "1px solid var(--info)",
                          color: "var(--info)",
                          background: "var(--bg-surface)",
                          cursor: "pointer",
                          fontSize: "0.8rem",
                        }}
                      >
                        View
                      </button>
                      <button
                        onClick={() =>
                          handleDownload(r.societyId, r.societyName)
                        }
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "1px solid var(--success)",
                          color: "var(--success)",
                          background: "var(--bg-surface)",
                          cursor: "pointer",
                          fontSize: "0.8rem",
                        }}
                      >
                        Export
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Detail modal */}
      {selected && mounted && createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
          onClick={() => setSelected(null)}
        >
          <div
            style={{
              background: "var(--bg-surface)",
              borderRadius: 12,
              maxWidth: 700,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: "2rem",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: "1rem", fontWeight: 700 }}>
              {selected.societyName} — Audit Report
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0.75rem",
                marginBottom: "1.25rem",
                fontSize: "0.875rem",
              }}
            >
              {[
                ["Status", selected.status],
                [
                  "Submitted",
                  new Date(selected.submittedAt).toLocaleString("en-IN"),
                ],
                [
                  "Join Date",
                  `${MONTH_NAMES[selected.joinMonth]} ${selected.joinYear}`,
                ],
                [
                  "Audit Window",
                  `${MONTH_NAMES[selected.auditFromMonth]} ${selected.auditFromYear} → ${MONTH_NAMES[selected.auditToMonth]} ${selected.auditToYear}`,
                ],
                ["Total Months", selected.totalMonthsRequired],
                ["Total Rows", selected.validation?.totalRowsFound],
                ["Members Found", selected.validation?.totalMembersFound],
                ["Amount Mismatches", selected.validation?.amountChecks],
              ].map(([l, v]) => (
                <div
                  key={l}
                  style={{
                    background: "var(--bg-sunken)",
                    padding: "0.6rem 0.75rem",
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontSize: "0.75rem", color: "var(--fg-4)" }}>
                    {l}
                  </div>
                  <div style={{ fontWeight: 600 }}>{v}</div>
                </div>
              ))}
            </div>
            {selected.validation?.warnings?.length > 0 && (
              <div
                style={{
                  background: "var(--warning-bg)",
                  borderRadius: 6,
                  padding: "0.75rem",
                  marginBottom: "1rem",
                  fontSize: "0.85rem",
                }}
              >
                <strong>Warnings:</strong>
                <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
                  {selected.validation.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ marginBottom: "1rem" }}>
              <label
                style={{
                  display: "block",
                  fontWeight: 600,
                  marginBottom: "0.4rem",
                }}
              >
                Review Notes
              </label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={3}
                style={{
                  width: "100%",
                  padding: "0.6rem",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  resize: "vertical",
                }}
                placeholder="Optional notes for the society admin..."
              />
            </div>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={() =>
                  reviewMutation.mutate({
                    reportId: selected._id,
                    status: "Approved",
                    reviewNotes,
                  })
                }
                disabled={reviewMutation.isPending}
                style={{
                  padding: "0.6rem 1.5rem",
                  background: "var(--success)",
                  color: "var(--on-solid)",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Approve
              </button>
              <button
                onClick={() =>
                  reviewMutation.mutate({
                    reportId: selected._id,
                    status: "Rejected",
                    reviewNotes,
                  })
                }
                disabled={reviewMutation.isPending}
                style={{
                  padding: "0.6rem 1.5rem",
                  background: "var(--danger)",
                  color: "var(--on-solid)",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Reject
              </button>
              <button
                onClick={() =>
                  handleDownload(selected.societyId, selected.societyName)
                }
                style={{
                  padding: "0.6rem 1.5rem",
                  background: "var(--info)",
                  color: "#fff",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Download Excel
              </button>
              <button
                onClick={() => setSelected(null)}
                style={{
                  padding: "0.6rem 1.25rem",
                  background: "var(--bg-muted)",
                  color: "var(--fg-3)",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
