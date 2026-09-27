"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import notify from "@/lib/notify";

async function adminFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    credentials: "include",
    headers: opts.body instanceof FormData ? undefined : { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Request failed");
    err.code = data.code;
    err.details = data.details;
    throw err;
  }
  return data;
}

const money = (n) => (n == null ? "—" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);

export default function BillHistoryV2Page() {
  const [societyId, setSocietyId] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [commitResult, setCommitResult] = useState(null);

  const { data: societiesData } = useQuery({
    queryKey: ["bill-history-v2-societies"],
    queryFn: () => adminFetch("/api/admin/societies"),
  });
  const societies = societiesData?.societies || [];

  const downloadTemplate = async () => {
    if (!societyId) return notify.error("Pick a society first");
    const res = await fetch(`/api/superadmin/bill-history-v2/template?societyId=${societyId}`, { credentials: "include" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return notify.error(data.error || "Template download failed");
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `BillHistory_${societyId}.xlsx`;
    a.click();
  };

  const runPreview = async () => {
    if (!societyId) return notify.error("Pick a society first");
    if (!file) return notify.error("Choose a filled workbook to upload first");
    setBusy(true);
    setPreview(null);
    setCommitResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("societyId", societyId);
      const data = await adminFetch("/api/superadmin/bill-history-v2/preview", { method: "POST", body: fd });
      setPreview(data);
    } catch (e) {
      notify.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    if (!file || !societyId) return;
    if (!window.confirm("This will write real history bills and generate the current live bill for every flat. Continue?")) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("societyId", societyId);
      const data = await adminFetch("/api/superadmin/bill-history-v2/commit", { method: "POST", body: fd });
      setCommitResult(data);
      notify.success("Bill history committed");
    } catch (e) {
      notify.error(`${e.code ? `[${e.code}] ` : ""}${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 1000, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Bill History (v2)</h1>
      <p style={{ color: "var(--fg-4)", marginBottom: "1.5rem" }}>
        Backend-tested, not yet the final UI. Download the template, fill it, upload it, preview, then Confirm.
      </p>

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <select
          value={societyId}
          onChange={(e) => { setSocietyId(e.target.value); setPreview(null); setCommitResult(null); }}
          style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border)", minWidth: 260 }}
        >
          <option value="">Select a society…</option>
          {societies.map((s) => (
            <option key={s._id} value={s._id}>{s.name}</option>
          ))}
        </select>
        <button onClick={downloadTemplate} disabled={!societyId} style={btnStyle("var(--info)")}>
          Download Template
        </button>
      </div>

      <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setCommitResult(null); }} />
        <button onClick={runPreview} disabled={busy || !file || !societyId} style={btnStyle("var(--warning)")}>
          {busy ? "Working…" : "Preview"}
        </button>
      </div>

      {preview && (
        <div style={{ background: "var(--bg-sunken)", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", gap: "2rem", marginBottom: "1rem", fontSize: "0.9rem" }}>
            <div><strong>Flats:</strong> {preview.flatCount}</div>
            <div><strong>Bills:</strong> {preview.billCount}</div>
            <div><strong>Window:</strong> {preview.window.fyStartPeriodId} → {preview.window.lastHistoryPeriodId}</div>
            <div><strong>Live period:</strong> {preview.window.firstLivePeriodId}</div>
          </div>

          {preview.errors.length > 0 && (
            <div style={{ background: "var(--danger-bg,#fee)", padding: "0.75rem", borderRadius: 6, marginBottom: "1rem" }}>
              <strong>Errors ({preview.errors.length}):</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", maxHeight: 200, overflowY: "auto" }}>
                {preview.errors.map((e, i) => (
                  <li key={i}>{e.flat} / {e.period || "-"}: [{e.code}] {e.message}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.warnings.length > 0 && (
            <div style={{ background: "var(--warning-bg,#ffe)", padding: "0.75rem", borderRadius: 6, marginBottom: "1rem" }}>
              <strong>Warnings ({preview.warnings.length}):</strong>
              <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", maxHeight: 150, overflowY: "auto" }}>
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w.flat}: [{w.code}] {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ maxHeight: 300, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ background: "var(--bg-surface)" }}>
                  {["Flat", "Period", "Opening P", "Opening I", "Charges", "Interest", "Total Due", "Paid", "Closing P", "Closing I", "Status"].map((h) => (
                    <th key={h} style={{ padding: "4px 8px", textAlign: "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(preview.billsByFlat).flatMap(([flat, bills]) =>
                  bills.map((b) => (
                    <tr key={`${flat}-${b.billPeriodId}`} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 8px" }}>{flat}</td>
                      <td style={{ padding: "4px 8px" }}>{b.billPeriodId}</td>
                      <td style={{ padding: "4px 8px" }}>{money(b.openingPrincipal)}</td>
                      <td style={{ padding: "4px 8px" }}>{money(b.openingInterest)}</td>
                      <td style={{ padding: "4px 8px" }}>{money(b.currentCharges)}</td>
                      <td style={{ padding: "4px 8px" }}>{money(b.currentInterest)}</td>
                      <td style={{ padding: "4px 8px" }}>{money(b.totalBillDue)}</td>
                      <td style={{ padding: "4px 8px" }}>{money(b.amountPaid)}</td>
                      <td style={{ padding: "4px 8px" }}>{money(b.closingPrincipal)}</td>
                      <td style={{ padding: "4px 8px" }}>{money(b.closingInterest)}</td>
                      <td style={{ padding: "4px 8px" }}>{b.status}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "1rem" }}>
            <button onClick={runCommit} disabled={busy || !preview.canCommit} style={btnStyle(preview.canCommit ? "var(--success)" : "var(--fg-4)")}>
              {busy ? "Committing…" : "Confirm & Commit"}
            </button>
            {!preview.canCommit && (
              <span style={{ marginLeft: "1rem", color: "var(--danger)", fontSize: "0.85rem" }}>
                Fix the errors above before this can be committed.
              </span>
            )}
          </div>
        </div>
      )}

      {commitResult && (
        <div style={{ background: "var(--success-bg,#efe)", borderRadius: 8, padding: "1rem" }}>
          <strong>Committed.</strong> {commitResult.historyBillCount} history bills written. Live bills:{" "}
          {commitResult.liveBillResults.generated.length} generated, {commitResult.liveBillResults.failed.length} failed.
          {commitResult.liveBillResults.failed.length > 0 && (
            <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
              {commitResult.liveBillResults.failed.map((f, i) => (
                <li key={i}>{f.memberId}: [{f.code}] {f.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function btnStyle(color) {
  return {
    padding: "0.5rem 1.25rem",
    background: color,
    color: "#fff",
    borderRadius: 6,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
  };
}
