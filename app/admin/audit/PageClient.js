"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import DropZone from "../../../components/DropZone";
import notify from "@/lib/notify";
// Helper: compute required audit window for display
function getAuditWindow(joinMonth, joinYear) {
  if (!joinMonth || !joinYear) return null;
  const joinFY = joinMonth >= 4 ? joinYear : joinYear - 1;
  const fromMonth = 4,
    fromYear = joinFY - 1;
  let toMonth = joinMonth - 1,
    toYear = joinYear;
  if (toMonth < 1) {
    toMonth = 12;
    toYear--;
  }
  const months = [];
  let m = fromMonth,
    y = fromYear;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return {
    fromMonth,
    fromYear,
    toMonth,
    toYear,
    totalMonths: months.length,
    months,
  };
}
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
export default function AuditPage() {
  const now = new Date();
  const [joinMonth, setJoinMonth] = useState(now.getMonth() + 1);
  const [joinYear, setJoinYear] = useState(now.getFullYear());
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const window = getAuditWindow(joinMonth, joinYear);
  const { data: reportData, refetch } = useQuery({
    queryKey: ["audit-report-status"],
    queryFn: () => apiClient.get("/api/admin/audit-report"),
  });
  const report = reportData?.report;
  const handleSubmit = async () => {
    if (!file) return notify.info("Please select the audit Excel file");
    setUploading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("joinMonth", joinMonth);
      fd.append("joinYear", joinYear);
      const res = await fetch("/api/admin/audit-report", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      setResult(data);
      if (data.passed) refetch();
    } catch (e) {
      setResult({ passed: false, errors: [e.message] });
    } finally {
      setUploading(false);
    }
  };
  const statusColor = {
    Pending: "var(--warning)",
    Approved: "var(--success)",
    Rejected: "var(--danger)",
  };
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 0 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: "var(--fg-1)", letterSpacing: "-0.01em" }}>
        Audit Report Submission
      </h1>
      <p style={{ color: "var(--fg-4)", fontSize: 13, marginBottom: "1.25rem" }}>
        Submit previous bills for audit as per Indian Financial Year
        requirement. Bills must cover from April of the previous FY up to the
        month before your society joined.
      </p>
      {/* Existing report status */}
      {report && (
        <div
          style={{
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "1.25rem",
            marginBottom: "2rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong>Previously Submitted Report</strong>
              <div
                style={{ fontSize: "0.85rem", color: "var(--fg-4)", marginTop: 4 }}
              >
                Submitted:{" "}
                {new Date(report.submittedAt).toLocaleString("en-IN")}{" "}
                &nbsp;|&nbsp; Period: {MONTH_NAMES[report.auditFromMonth]}{" "}
                {report.auditFromYear} → {MONTH_NAMES[report.auditToMonth]}{" "}
                {report.auditToYear} &nbsp;|&nbsp; Rows:{" "}
                {report.validation?.totalRowsFound}
              </div>
            </div>
            <span
              style={{
                padding: "0.35rem 1rem",
                borderRadius: 20,
                fontWeight: 700,
                fontSize: "0.85rem",
                background: `color-mix(in srgb, ${statusColor[report.status]} 13%, transparent)`,
                color: statusColor[report.status],
              }}
            >
              {report.status}
            </span>
          </div>
          {report.reviewNotes && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "var(--warning-bg)",
                borderRadius: 6,
              }}
            >
              <strong>Review Notes:</strong> {report.reviewNotes}
            </div>
          )}
        </div>
      )}
      {/* Step 1: Set join date */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>
          Step 1: When did your society join this platform?
        </h2>
        <div
          style={{
            display: "flex",
            gap: "1rem",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <select
            value={joinMonth}
            onChange={(e) => setJoinMonth(+e.target.value)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          >
            {MONTH_NAMES.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={joinYear}
            onChange={(e) => setJoinYear(+e.target.value)}
            min={2020}
            max={2035}
            style={{
              padding: "0.5rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
              width: 90,
            }}
          />
        </div>
        {window && (
          <div
            style={{
              marginTop: "1rem",
              padding: "0.75rem 1rem",
              background: "var(--primary-tint)",
              borderRadius: 6,
              fontSize: "0.9rem",
            }}
          >
            <strong>Required audit window:</strong>{" "}
            {MONTH_NAMES[window.fromMonth]} {window.fromYear} →{" "}
            {MONTH_NAMES[window.toMonth]} {window.toYear}{" "}
            <span style={{ color: "var(--info)", fontWeight: 600 }}>
              ({window.totalMonths} months)
            </span>
            <div
              style={{
                marginTop: "0.5rem",
                color: "var(--accent)",
                fontSize: "0.8rem",
              }}
            >
              Periods: {window.months.join(", ")}
            </div>
          </div>
        )}
      </div>
      {/* Step 2: Upload */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>
          Step 2: Upload Audit Excel File
        </h2>
        <p
          style={{
            color: "var(--fg-4)",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}
        >
          File must contain all member bills for the required window. Required
          columns: MemberId, Wing, FlatNo, OwnerName, Month, Year,
          PreviousBalance, InterestDue, GrandTotal, and all active billing head
          columns.
        </p>
        <DropZone
          accept=".xlsx"
          file={file}
          onFile={setFile}
          onClear={() => setFile(null)}
          label="Click or drag & drop Audit Excel here"
          hint=".xlsx only"
          style={{ marginBottom: "1rem" }}
        />
        {file && (
          <div
            style={{
              color: "var(--success)",
              fontSize: "0.875rem",
              marginBottom: "0.75rem",
            }}
          >
            Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={uploading || !file}
          style={{
            background: uploading ? "var(--fg-5)" : "var(--primary-hover)",
            color: "#fff",
            padding: "0.6rem 1.5rem",
            borderRadius: 6,
            border: "none",
            cursor: uploading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {uploading ? "Validating & Submitting..." : "Validate & Submit"}
        </button>
      </div>
      {/* Result */}
      {result && (
        <div
          style={{
            background: result.passed ? "var(--success-bg)" : "var(--danger-bg)",
            border: `1px solid ${result.passed ? "var(--success-bg)" : "var(--danger-bg)"}`,
            borderRadius: 8,
            padding: "1.5rem",
          }}
        >
          <h3
            style={{
              color: result.passed ? "var(--success-fg)" : "var(--danger-fg)",
              fontWeight: 700,
              marginBottom: "0.75rem",
            }}
          >
            {result.passed
              ? "Validation Passed — Report Submitted"
              : "Validation Failed"}
          </h3>
          {result.errors?.length > 0 && (
            <div>
              <strong style={{ color: "var(--danger-fg)" }}>
                Errors ({result.errors.length}):
              </strong>
              <ul
                style={{
                  margin: "0.5rem 0",
                  paddingLeft: "1.25rem",
                  color: "var(--danger-fg)",
                  fontSize: "0.875rem",
                }}
              >
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {result.errors.length > 20 && (
                  <li>...and {result.errors.length - 20} more errors</li>
                )}
              </ul>
            </div>
          )}
          {result.warnings?.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <strong style={{ color: "var(--warning-fg)" }}>
                Warnings ({result.warnings.length}):
              </strong>
              <ul
                style={{
                  margin: "0.5rem 0",
                  paddingLeft: "1.25rem",
                  color: "var(--warning-fg)",
                  fontSize: "0.875rem",
                }}
              >
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {result.passed && result.warnings?.length === 0 && (
            <p style={{ color: "var(--success-fg)" }}>
              All checks passed. Your audit report is pending SuperAdmin review.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
