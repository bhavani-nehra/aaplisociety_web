"use client";
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import ExcelJS from "exceljs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Admin.module.css";
import {
  Card, StatusPill, PlanChip, SocietyMark, Btn, Empty,
  money, shortDate,
} from "../_components/PlatformUI";
import DropZone from "../../../components/DropZone";
import BulkImportWizard from "./BulkImportWizard";
import DeleteWizard from "./DeleteWizard";
import notify from "@/lib/notify";

// exceljs for all reading and writing — not `xlsx`/SheetJS, which has an
// unfixed prototype-pollution + ReDoS CVE in its parser (GHSA-4r6h-8v6p-xvw6,
// GHSA-5pgg-2g8v-p4x9). `xlsx` is not used anywhere in this codebase.
function cellVal(cell) {
  let val = cell?.value;
  if (val && typeof val === "object" && !(val instanceof Date)) {
    if (Array.isArray(val.richText)) val = val.richText.map((t) => t.text).join("");
    else if (val.text !== undefined) val = val.text;
    else if (val.result !== undefined) val = val.result;
  }
  return val;
}
function sheetToRows(worksheet, { defval = "" } = {}) {
  if (!worksheet) return [];
  const headers = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cellVal(cell) ?? "").trim();
  });
  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    let hasValue = false;
    headers.forEach((header, idx) => {
      if (!header) return;
      const raw = cellVal(row.getCell(idx + 1));
      const blank = raw === null || raw === undefined || raw === "";
      obj[header] = blank ? defval : raw;
      if (!blank) hasValue = true;
    });
    if (hasValue) rows.push(obj);
  });
  return rows;
}
async function loadWorkbookFromArrayBuffer(arrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);
  return workbook;
}
// ── Bill History Validation Engine ───────────────────────────────────────────
const PAYMENT_METHODS_OK = new Set(["Cash", "Cheque", "Online", "NEFT", "UPI"]);
const TOLERANCE = 0.05; // ₹ rounding tolerance
function validateBillHistorySheet(rows, periodId, prevState, interestRate) {
  // prevState: Map of wingFlat → { closingPrincipal, closingInterest }
  // Returns { ok, errors, warnings, closingState }
  const errors = [];
  const warnings = [];
  const closingState = new Map();
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = i + 2;
    const wingFlat = String(row["Wing-FlatNo"] || "").trim();
    if (!wingFlat || wingFlat.startsWith("⚠")) continue;
    const rowPeriod = String(row["Period"] || "").trim();
    if (rowPeriod && rowPeriod !== periodId) {
      errors.push(`Row ${r} [${wingFlat}]: Period "${rowPeriod}" should be "${periodId}"`);
    }
    if (seen.has(wingFlat.toLowerCase())) {
      errors.push(`Row ${r} [${wingFlat}]: Duplicate flat — appears more than once in this sheet`);
      continue;
    }
    seen.add(wingFlat.toLowerCase());
    const n = (k) => parseFloat(row[k] || 0);
    const openingPrincipal = n("OpeningPrincipal");
    const openingInterest = n("OpeningInterest");
    const currentCharges = n("CurrentCharges");
    const currentInterest = n("CurrentInterest");
    const billPrincipal = n("BillPrincipal");
    const billInterest = n("BillInterest");
    const totalBillDue = n("TotalBillDue");
    const alreadyPaid = n("AlreadyPaid");
    const advanceCredit = n("AdvanceCredit");
    const remainingDue = n("RemainingDue");
    const amountPaid = n("AmountPaid");
    // 1. Opening balances vs previous closing — warn only (admin paper books are source of truth)
    if (prevState && prevState.has(wingFlat.toLowerCase())) {
      const prev = prevState.get(wingFlat.toLowerCase());
      const expectedOP = parseFloat(prev.closingPrincipal.toFixed(2));
      const expectedOI = parseFloat(prev.closingInterest.toFixed(2));
      if (Math.abs(openingPrincipal - expectedOP) > TOLERANCE) {
        warnings.push(`Row ${r} [${wingFlat}]: OpeningPrincipal ₹${openingPrincipal} differs from computed prev closing ₹${expectedOP} — using your value.`);
      }
      if (Math.abs(openingInterest - expectedOI) > TOLERANCE) {
        warnings.push(`Row ${r} [${wingFlat}]: OpeningInterest ₹${openingInterest} differs from computed prev closing ₹${expectedOI} — using your value.`);
      }
    }
    // 2. CurrentInterest check — warn only (admin may use different rate or rounding)
    const expectedInterest = parseFloat(((openingPrincipal * interestRate) / 1200).toFixed(2));
    if (openingPrincipal > 0 && Math.abs(currentInterest - expectedInterest) > TOLERANCE) {
      warnings.push(`Row ${r} [${wingFlat}]: CurrentInterest ₹${currentInterest} differs from computed ₹${expectedInterest} (${openingPrincipal} × ${interestRate}% / 12) — using your value.`);
    }
    // 3. BillPrincipal = openingPrincipal + currentCharges
    const expectedBP = parseFloat((openingPrincipal + currentCharges).toFixed(2));
    if (Math.abs(billPrincipal - expectedBP) > TOLERANCE) {
      errors.push(`Row ${r} [${wingFlat}]: BillPrincipal ₹${billPrincipal} ≠ OpeningPrincipal+CurrentCharges (${openingPrincipal}+${currentCharges}=${expectedBP})`);
    }
    // 4. BillInterest = openingInterest + currentInterest
    const expectedBI = parseFloat((openingInterest + currentInterest).toFixed(2));
    if (Math.abs(billInterest - expectedBI) > TOLERANCE) {
      errors.push(`Row ${r} [${wingFlat}]: BillInterest ₹${billInterest} ≠ OpeningInterest+CurrentInterest (${openingInterest}+${currentInterest}=${expectedBI})`);
    }
    // 5. TotalBillDue = billPrincipal + billInterest
    const expectedTBD = parseFloat((billPrincipal + billInterest).toFixed(2));
    if (Math.abs(totalBillDue - expectedTBD) > TOLERANCE) {
      errors.push(`Row ${r} [${wingFlat}]: TotalBillDue ₹${totalBillDue} ≠ BillPrincipal+BillInterest (${billPrincipal}+${billInterest}=${expectedTBD})`);
    }
    // 6. RemainingDue — auto-compute, don't validate against cell value
    // Admin may fill the pre-payment amount; system always derives closing from formula
    const totalPaidThisRow = alreadyPaid + amountPaid + advanceCredit;
    const expectedRD = parseFloat(Math.max(0, totalBillDue - totalPaidThisRow).toFixed(2));
    // 7. PaymentMethod validation
    const pm = String(row["PaymentMethod"] || "").trim();
    if (amountPaid > 0 && pm && !PAYMENT_METHODS_OK.has(pm)) {
      warnings.push(`Row ${r} [${wingFlat}]: PaymentMethod "${pm}" is non-standard. Accepted: Cash/Cheque/Online/NEFT/UPI`);
    }
    // 8. Negative check
    [["OpeningPrincipal", openingPrincipal], ["OpeningInterest", openingInterest],
     ["CurrentCharges", currentCharges], ["AmountPaid", amountPaid]].forEach(([k, v]) => {
      if (v < 0) errors.push(`Row ${r} [${wingFlat}]: ${k} cannot be negative (got ${v})`);
    });
    // Compute closing state for next sheet
    // Payment allocation: interest first, then principal; advance reduces principal
    const totalPayment = alreadyPaid + amountPaid;
    const interestPaid = Math.min(totalPayment, billInterest);
    const principalPaid = Math.max(0, totalPayment - interestPaid);
    const cI = parseFloat(Math.max(0, billInterest - interestPaid).toFixed(2));
    const cP = parseFloat(Math.max(0, billPrincipal - principalPaid - advanceCredit).toFixed(2));
    closingState.set(wingFlat.toLowerCase(), { closingPrincipal: cP, closingInterest: cI });
  }
  return { ok: errors.length === 0, errors, warnings, closingState };
}
// ── BillHistoryStep Component ─────────────────────────────────────────────────
function BillHistoryStep({ societyId, societyName, joinPeriodId, interestRate, onComplete, onSkip }) {
  const [bhFile, setBhFile] = useState(null);
  const [bhStep, setBhStep] = useState("idle"); // idle | validating | saving | done | error
  const [sheetResults, setSheetResults] = useState([]); // per sheet: { periodId, ok, errors, warnings, rowCount }
  const [validationDone, setValidationDone] = useState(false);
  const [allValid, setAllValid] = useState(false);
  const [validatedBills, setValidatedBills] = useState(null); // flat array of bill objects
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [activeSheetIdx, setActiveSheetIdx] = useState(null);
  const handleFileChange = (file) => {
    if (!file) return;
    setBhFile(file);
    setBhStep("validating");
    setSheetResults([]);
    setValidationDone(false);
    setAllValid(false);
    setValidatedBills(null);
    setActiveSheetIdx(null);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb = await loadWorkbookFromArrayBuffer(evt.target.result);
        // Skip "Instructions" sheet, process period sheets (named YYYY-MM)
        const periodSheets = wb.worksheets
          .map((ws) => ws.name)
          .filter((n) => /^\d{4}-\d{2}$/.test(n))
          .sort();
        if (!periodSheets.length) {
          setSheetResults([{ periodId: "?", ok: false, errors: ["No period sheets found (expected sheets named YYYY-MM like 2026-04)"], warnings: [], rowCount: 0 }]);
          setValidationDone(true);
          setAllValid(false);
          setBhStep("idle");
          return;
        }
        const results = [];
        const allBills = [];
        let prevState = null; // Map of wingFlat → closing state
        let allOk = true;
        for (let si = 0; si < periodSheets.length; si++) {
          const sheetName = periodSheets[si];
          const rows = sheetToRows(wb.getWorksheet(sheetName));
          const result = validateBillHistorySheet(rows, sheetName, prevState, interestRate || 21);
          results.push({ periodId: sheetName, ...result, rowCount: rows.length });
          prevState = result.closingState;
          if (!result.ok) allOk = false;
          // Collect bills from this sheet
          for (const row of rows) {
            const wingFlat = String(row["Wing-FlatNo"] || "").trim();
            if (!wingFlat || wingFlat.startsWith("⚠")) continue;
            allBills.push({ periodId: sheetName, wingFlat, ...row });
          }
        }
        setSheetResults(results);
        setValidationDone(true);
        setAllValid(allOk);
        setValidatedBills(allOk ? allBills : null);
        setBhStep("idle");
      } catch (err) {
        setSheetResults([{ periodId: "?", ok: false, errors: [`Could not parse file: ${err.message}`], warnings: [], rowCount: 0 }]);
        setValidationDone(true);
        setAllValid(false);
        setBhStep("idle");
      }
    };
    reader.readAsArrayBuffer(file);
  };
  const handleSave = async () => {
    if (!validatedBills?.length) return;
    setBhStep("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/superadmin/bill-history-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ societyId, bills: validatedBills, joinPeriodId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaveResult(data);
      setBhStep("done");
      if (onComplete) onComplete(data);
    } catch (err) {
      setSaveError(err.message);
      setBhStep("error");
    }
  };
  const totalErrors = sheetResults.reduce((s, r) => s + r.errors.length, 0);
  const totalWarnings = sheetResults.reduce((s, r) => s + r.warnings.length, 0);
  return (
    <div style={{ padding: "0.5rem 0" }}>
      <h3 style={{ margin: "0 0 0.4rem", color: "var(--accent)", fontSize: "1rem" }}>
        Step 4: Bill History Import
      </h3>
      <p style={{ color: "var(--fg-5)", fontSize: "0.82rem", margin: "0 0 1.25rem" }}>
        Import all historical bills from prev April to the month before they joined. Required for accurate opening balance and audit trail.
      </p>
      {/* Template download */}
      {bhStep !== "done" && (
        <div style={{ background: "var(--primary)", borderRadius: 8, padding: "1rem", marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.82rem", color: "var(--primary-tint)", marginBottom: "0.5rem" }}>
            First, download the pre-filled template for <strong>{societyName}</strong> (all members, all months from prev April to {joinPeriodId}):
          </div>
          <button
            onClick={async () => {
              const res = await fetch(
                `/api/superadmin/bill-history-template?societyId=${societyId}&joinPeriod=${joinPeriodId}`,
                { credentials: "include" }
              );
              if (!res.ok) { notify.error("Template download failed"); return; }
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `BillHistory_${societyName.replace(/\s/g, "_")}.xlsx`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{ background: "var(--accent)", color: "var(--on-solid)", border: "none", padding: "0.5rem 1.2rem", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
          >
            ⬇️ Download Bill History Template
          </button>
        </div>
      )}
      {bhStep === "done" && saveResult ? (
        <div style={{ background: "var(--success-fg)", borderRadius: 8, padding: "1.25rem" }}>
          <div style={{ color: "var(--success)", fontWeight: 700, fontSize: "1rem", marginBottom: "0.5rem" }}>✅ Bill History Saved</div>
          <div style={{ fontSize: "0.85rem", color: "var(--success-bg)", lineHeight: 1.8 }}>
            <div><strong>Bills created:</strong> {saveResult.created}</div>
            <div><strong>Periods covered:</strong> {saveResult.periods?.join(", ")}</div>
            {saveResult.errors > 0 && <div style={{ color: "var(--warning)" }}><strong>Errors:</strong> {saveResult.errors} rows failed — check data</div>}
          </div>
          <button
            onClick={() => onComplete && onComplete(saveResult)}
            style={{ marginTop: "1rem", background: "var(--success)", color: "var(--on-solid)", border: "none", padding: "0.6rem 1.5rem", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}
          >
            Continue →
          </button>
        </div>
      ) : (
        <>
          {/* Upload */}
          {bhStep !== "saving" && (
            <DropZone
              accept=".xlsx,.xls"
              file={bhFile}
              onFile={handleFileChange}
              onClear={() => { setBhFile(null); setSheetResults([]); setValidationDone(false); setAllValid(false); setValidatedBills(null); }}
              label="Upload filled Bill History Excel"
              hint=".xlsx — must have sheets named YYYY-MM"
              style={{ marginBottom: "1.25rem" }}
            />
          )}
          {bhStep === "validating" && (
            <div style={{ padding: "1rem", textAlign: "center", color: "var(--accent)" }}>Validating all sheets...</div>
          )}
          {bhStep === "saving" && (
            <div style={{ padding: "1rem", textAlign: "center", color: "var(--accent)" }}>Saving to database...</div>
          )}
          {bhStep === "error" && saveError && (
            <div style={{ background: "var(--danger-bg)", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
              <div style={{ color: "var(--danger-bg)", fontWeight: 600 }}>Save Failed</div>
              <div style={{ color: "var(--danger-bg)", fontSize: "0.82rem", marginTop: 4 }}>{saveError}</div>
            </div>
          )}
          {/* Sheet results */}
          {validationDone && sheetResults.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--fg-5)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.6rem" }}>
                Validation Results — {sheetResults.length} months
              </div>
              {/* Summary bar */}
              <div style={{ display: "flex", gap: "1rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                <span style={{ background: "var(--success-fg)", border: "1px solid var(--success)", borderRadius: 6, padding: "3px 10px", fontSize: "0.75rem", color: "var(--success)", fontWeight: 700 }}>
                  ✓ {sheetResults.filter(r => r.ok).length} passed
                </span>
                {totalErrors > 0 && (
                  <span style={{ background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: 6, padding: "3px 10px", fontSize: "0.75rem", color: "var(--danger)", fontWeight: 700 }}>
                    ✕ {sheetResults.filter(r => !r.ok).length} failed · {totalErrors} errors
                  </span>
                )}
                {totalWarnings > 0 && (
                  <span style={{ background: "var(--warning-bg)", border: "1px solid var(--warning)", borderRadius: 6, padding: "3px 10px", fontSize: "0.75rem", color: "var(--warning)", fontWeight: 700 }}>
                    ⚠ {totalWarnings} warnings
                  </span>
                )}
              </div>
              {/* Sheet list — timeline style */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {sheetResults.map((r, i) => (
                  <div key={r.periodId}>
                    <div
                      onClick={() => setActiveSheetIdx(activeSheetIdx === i ? null : i)}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.75rem",
                        padding: "0.5rem 0.75rem", borderRadius: 6, cursor: "pointer",
                        background: r.ok ? "#064e3b22" : "#450a0a22",
                        border: `1px solid ${r.ok ? "var(--success)" : "var(--danger)"}`,
                        transition: "all 0.2s",
                      }}
                    >
                      <div style={{ fontSize: "1.1rem" }}>{r.ok ? "✓" : "✕"}</div>
                      <div style={{ flex: 1 }}>
                        <span style={{ color: r.ok ? "var(--success)" : "var(--danger)", fontWeight: 700, fontSize: "0.85rem" }}>{r.periodId}</span>
                        <span style={{ color: "var(--fg-4)", fontSize: "0.72rem", marginLeft: 8 }}>{r.rowCount} rows</span>
                      </div>
                      {r.errors.length > 0 && (
                        <span style={{ color: "var(--danger)", fontSize: "0.72rem" }}>{r.errors.length} error{r.errors.length > 1 ? "s" : ""}</span>
                      )}
                      {r.warnings.length > 0 && (
                        <span style={{ color: "var(--warning)", fontSize: "0.72rem" }}>{r.warnings.length} warning{r.warnings.length > 1 ? "s" : ""}</span>
                      )}
                      <span style={{ color: "var(--fg-3)", fontSize: "0.7rem" }}>{activeSheetIdx === i ? "▲" : "▼"}</span>
                    </div>
                    {/* Expanded error detail */}
                    {activeSheetIdx === i && (r.errors.length > 0 || r.warnings.length > 0) && (
                      <div style={{ background: "var(--fg-1)", borderRadius: "0 0 6px 6px", padding: "0.75rem", marginTop: -1, border: "1px solid var(--fg-3)", borderTop: "none" }}>
                        {r.errors.map((e, ei) => (
                          <div key={ei} style={{ fontSize: "0.75rem", color: "var(--danger)", marginBottom: 4, display: "flex", gap: "0.4rem" }}>
                            <span>✕</span><span>{e}</span>
                          </div>
                        ))}
                        {r.warnings.map((w, wi) => (
                          <div key={wi} style={{ fontSize: "0.75rem", color: "var(--warning)", marginBottom: 4, display: "flex", gap: "0.4rem" }}>
                            <span>⚠</span><span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Actions */}
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.75rem" }}>
            {allValid && validatedBills && bhStep !== "saving" && (
              <button
                onClick={handleSave}
                style={{ flex: 1, background: "var(--success)", color: "var(--on-solid)", border: "none", padding: "0.75rem", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: "0.9rem" }}
              >
                ✅ All Valid — Save {validatedBills.length} Bill Records
              </button>
            )}
            <button
              onClick={onSkip}
              style={{ background: "var(--fg-3)", color: "var(--fg-5)", border: "none", padding: "0.75rem 1.25rem", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem" }}
            >
              Skip (do later)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
// Auto-detects joinPeriodId from first bill, then renders BillHistoryStep
function BhModal({ society, onClose }) {
  const [joinPeriodId, setJoinPeriodId] = useState(society.onboarding?.joinPeriodId || null);
  const [loading, setLoading] = useState(!society.onboarding?.joinPeriodId);
  const [noBills, setNoBills] = useState(false);
  // Auto-fetch if not already stored
  useEffect(() => {
    if (joinPeriodId) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(
          `/api/superadmin/bill-history-import?societyId=${society._id}`,
          { credentials: "include" }
        );
        const data = await res.json();
        if (data.joinPeriodId) {
          setJoinPeriodId(data.joinPeriodId);
        } else {
          setNoBills(true);
        }
      } catch {
        setNoBills(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: 12, padding: "2rem", width: 640, maxHeight: "90vh", overflowY: "auto", color: "var(--fg-1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <div>
            <h2 style={{ margin: 0, color: "var(--accent)", fontSize: "1.1rem" }}>📜 Bill History Import</h2>
            <div style={{ color: "var(--fg-4)", fontSize: "0.82rem", marginTop: 2 }}>{society.name}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--fg-5)", fontSize: "1.3rem", cursor: "pointer" }}>✕</button>
        </div>
        {loading && (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)", fontSize: "0.85rem" }}>
            Detecting join period from bills...
          </div>
        )}
        {!loading && noBills && (
          <div style={{ background: "var(--warning-bg)", border: "1px solid var(--warning-fg)", borderRadius: 8, padding: "1rem" }}>
            <div style={{ color: "var(--warning)", fontWeight: 600, marginBottom: "0.4rem" }}>No bills found</div>
            <div style={{ color: "var(--warning-bg)", fontSize: "0.82rem" }}>
              This society has no bills generated yet. Generate at least one bill first — the system uses the first bill's period as the join month.
            </div>
          </div>
        )}
        {!loading && joinPeriodId && (
          <>
            <div style={{ background: "var(--primary-tint)", border: "1px solid var(--primary)", borderRadius: 6, padding: "0.6rem 1rem", marginBottom: "1.25rem", fontSize: "0.8rem", color: "var(--accent)" }}>
              Join period auto-detected: <strong>{joinPeriodId}</strong> (first bill month)
            </div>
            <BillHistoryStep
              societyId={society._id}
              societyName={society.name}
              joinPeriodId={joinPeriodId}
              interestRate={society.config?.interestRate || 21}
              onComplete={onClose}
              onSkip={onClose}
            />
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
export default function AdminSocietiesPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const queryClient = useQueryClient();
  // View Credentials dialog
  const [viewCredsTarget, setViewCredsTarget] = useState(null); // { societyId, name }
  const [viewCreds, setViewCreds] = useState(null); // [{ flatNo, wing, ownerName, username, email }]
  const [viewCredsLoading, setViewCredsLoading] = useState(false);
  // Delete society
  const [deleteTarget, setDeleteTarget] = useState(null); // society object
  // Bulk import modal state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkStep, setBulkStep] = useState("idle"); // idle | uploading | validation-failed | done | error
  const [bulkAnimStep, setBulkAnimStep] = useState(0); // 0=waiting,1=society,2=members,3=done
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkValidation, setBulkValidation] = useState(null); // { phase, errors, warnings }
  const [bulkError, setBulkError] = useState(null);
  // Bill history step state (bulk import flow)
  const [showBillHistory, setShowBillHistory] = useState(false);
  const [billHistoryDone, setBillHistoryDone] = useState(false);
  // Standalone bill history modal (from societies table)
  const [bhModalSociety, setBhModalSociety] = useState(null); // society object
  const { data: societiesData, isLoading } = useQuery({
    queryKey: ["admin-societies"],
    queryFn: () => apiClient.get("/api/admin/societies"),
  });
  const societies = societiesData?.societies || [];
  const filteredSocieties = societies.filter((s) => {
    const matchesSearch = s.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      filterStatus === "All" || s.subscription?.status === filterStatus;
    return matchesSearch && matchesStatus && !s.isDeleted;
  });
  const updateSubscriptionMutation = useMutation({
    mutationFn: ({ societyId, updates }) =>
      apiClient.put("/api/admin/societies", { societyId, updates }),
    onSuccess: () => {
      notify.success("Subscription updated");
      queryClient.invalidateQueries(["admin-societies"]);
    },
  });
  const handlePaymentRecord = async (society) => {
    const amount = parseFloat(await notify.prompt(`Enter payment amount for "${society.name}":`));
    if (!amount || isNaN(amount)) return;
    const method = (await notify.prompt("Payment method (UPI/Bank/Cash):")) || "UPI";
    const nextDateStr = await notify.prompt("Next payment due date (YYYY-MM-DD), leave blank to skip:");
    const nextDate = nextDateStr?.trim() ? new Date(nextDateStr.trim()) : null;
    const currentTotal = society.subscription?.amountPaid || 0;
    const updates = {
      "subscription.lastPaymentDate": new Date(),
      "subscription.amountPaid": currentTotal + amount,
      "subscription.status": "Active",
      $push: {
        "subscription.paymentHistory": {
          date: new Date(),
          amount,
          method,
          transactionId: `TXN-${Date.now()}`,
        },
      },
    };
    if (nextDate && !isNaN(nextDate.getTime())) {
      updates["subscription.nextPaymentDate"] = nextDate;
    }
    updateSubscriptionMutation.mutate({ societyId: society._id, updates });
  };
  const suspendSociety = async (societyId) => {
    if (!(await notify.confirm("Suspend this society? They will lose access.", { tone: "warning" }))) return;
    updateSubscriptionMutation.mutate({
      societyId,
      updates: { "subscription.status": "Suspended" },
    });
  };
  const activateSociety = (societyId) => {
    updateSubscriptionMutation.mutate({
      societyId,
      updates: { "subscription.status": "Active" },
    });
  };
  // Real, server-backed progress → animation step index. Replaces the old
  // fake fixed-duration setTimeout chain, which advanced only after the
  // whole import had already finished (so it never reflected what was
  // actually happening during the 2-4 minute wait).
  const stageToAnimStep = (status) => {
    switch (status) {
      case "VALIDATING":
        return 1;
      case "IMPORTING":
        return 3;
      case "FINALIZING":
        return 4;
      case "COMMITTED":
      case "EMAIL_QUEUED":
      case "COMPLETED":
        return 5;
      default:
        return 0;
    }
  };
  const pollImportStatus = (importRunId, stopRef) => {
    const tick = async () => {
      if (stopRef.stopped) return;
      try {
        const res = await fetch(
          `/api/admin/bulk-import/status?importRunId=${encodeURIComponent(importRunId)}`,
          { credentials: "include" },
        );
        if (res.ok) {
          const data = await res.json();
          setBulkAnimStep(stageToAnimStep(data.status));
        }
      } catch {
        // transient poll failure — the POST response below is still authoritative
      }
      if (!stopRef.stopped) stopRef.timer = setTimeout(tick, 1500);
    };
    tick();
  };
  const handleBulkImport = async () => {
    if (!bulkFile) return;
    // Stable key across a refresh/retry so a duplicate click or a re-submit
    // after a dropped connection replays the same server-side run instead of
    // starting a second import.
    let importRunId = sessionStorage.getItem("bulkImportRunId");
    if (!importRunId) {
      importRunId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem("bulkImportRunId", importRunId);
    }
    setBulkStep("uploading");
    setBulkAnimStep(0);
    setBulkError(null);
    setBulkResult(null);
    setBulkValidation(null);
    const stopRef = { stopped: false, timer: null };
    pollImportStatus(importRunId, stopRef);
    try {
      const fd = new FormData();
      fd.append("file", bulkFile);
      fd.append("importRunId", importRunId);
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      stopRef.stopped = true;
      clearTimeout(stopRef.timer);
      // Validation failed or rollback — show errors immediately, no animation.
      // The key is cleared so the admin can fix the sheet and retry cleanly.
      if (data.validationFailed || res.status === 409) {
        sessionStorage.removeItem("bulkImportRunId");
        setBulkValidation(data);
        setBulkStep("validation-failed");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Import failed");
      setBulkAnimStep(5);
      setBulkResult(data);
      setBulkStep("done");
      sessionStorage.removeItem("bulkImportRunId");
      queryClient.invalidateQueries(["admin-societies"]);
    } catch (err) {
      stopRef.stopped = true;
      clearTimeout(stopRef.timer);
      sessionStorage.removeItem("bulkImportRunId");
      setBulkError(err.message);
      setBulkStep("error");
    }
  };
  const resetBulkModal = () => {
  setShowBulkModal(false);
};
  return (
    <div style={{ maxWidth: 1560, margin: "0 auto", color: "var(--fg-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "var(--fg-1)" }}>Societies</h1>
          <p style={{ color: "var(--fg-4)", fontSize: 13, marginTop: 4 }}>
            {societies.length} on the platform · onboarding, credentials and lifecycle
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="primary" onClick={() => setShowBulkModal(true)}>Add Society</Btn>
        </div>
      </div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search name, registration no, email…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            flex: 1, minWidth: 240, padding: "8px 12px", borderRadius: 8, fontSize: 13,
            border: "1px solid var(--border-strong)", background: "var(--bg-input, var(--bg-surface))",
            color: "var(--fg-2)", outline: "none",
          }}
        />
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {["All", "Active", "Trial", "Suspended", "Expired"].map((st) => (
            <Btn
              key={st}
              size="sm"
              variant={filterStatus === st ? "primary" : "secondary"}
              onClick={() => setFilterStatus(st)}
            >
              {st}
            </Btn>
          ))}
        </div>
      </div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 11, marginBottom: 16 }}>
        {[
          { label: "Active", value: societies.filter((s) => s.subscription?.status === "Active").length, tone: "var(--success)" },
          { label: "Trial", value: societies.filter((s) => s.subscription?.status === "Trial").length, tone: "var(--info)" },
          { label: "Suspended", value: societies.filter((s) => s.subscription?.status === "Suspended").length, tone: "var(--danger)" },
          { label: "Expired", value: societies.filter((s) => s.subscription?.status === "Expired").length, tone: "var(--fg-4)" },
          { label: "Recorded revenue", value: money(societies.reduce((sum, s) => sum + (s.subscription?.amountPaid || 0), 0)), tone: "var(--fg-2)" },
        ].map((c) => (
          <Card key={c.label} style={{ padding: "13px 15px" }}>
            <div style={{ fontSize: 10, color: "var(--fg-4)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>{c.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 5, color: c.tone, lineHeight: 1.1 }}>{c.value}</div>
          </Card>
        ))}
      </div>
      {/* ── SUBSCRIPTION OVERVIEW ── */}
      {!isLoading && (() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const in7 = new Date(today); in7.setDate(today.getDate() + 7);
        const in30 = new Date(today); in30.setDate(today.getDate() + 30);
        const overdue = societies.filter((s) => {
          const d = s.subscription?.nextPaymentDate ? new Date(s.subscription.nextPaymentDate) : null;
          return d && d < today && s.subscription?.status !== "Suspended";
        });
        const dueSoon = societies.filter((s) => {
          const d = s.subscription?.nextPaymentDate ? new Date(s.subscription.nextPaymentDate) : null;
          return d && d >= today && d <= in7;
        });
        const dueIn30 = societies.filter((s) => {
          const d = s.subscription?.nextPaymentDate ? new Date(s.subscription.nextPaymentDate) : null;
          return d && d > in7 && d <= in30;
        });
        const noPayment = societies.filter((s) => !s.subscription?.nextPaymentDate && !s.isDeleted);
        const totalRevenue = societies.reduce((sum, s) => sum + (s.subscription?.amountPaid || 0), 0);
        return (
          <div style={{ marginBottom: "1.5rem" }}>
            {/* Alert rows */}
            {overdue.length > 0 && (
              <div style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-fg)", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ color: "var(--danger)", fontWeight: 700, fontSize: "0.9rem" }}>🔴 {overdue.length} Overdue Payment{overdue.length > 1 ? "s" : ""}</span>
                  <span style={{ color: "var(--danger)", fontSize: "0.8rem", fontWeight: 600 }}>Action required</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {overdue.map((s) => (
                    <span key={s._id} style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-fg)", borderRadius: 4, padding: "3px 8px", fontSize: "0.75rem", color: "var(--danger)" }}>
                      {s.name}
                      {s.subscription?.nextPaymentDate && (
                        <span style={{ color: "var(--danger)", marginLeft: 4 }}>
                          (due {new Date(s.subscription.nextPaymentDate).toLocaleDateString("en-IN")})
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {dueSoon.length > 0 && (
              <div style={{ background: "var(--warning-bg)", border: "1px solid var(--warning-fg)", borderRadius: 8, padding: "1rem 1.25rem", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span style={{ color: "var(--warning)", fontWeight: 700, fontSize: "0.9rem" }}>🟡 {dueSoon.length} Due within 7 days</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {dueSoon.map((s) => (
                    <span key={s._id} style={{ background: "var(--warning-bg)", border: "1px solid var(--warning-fg)", borderRadius: 4, padding: "3px 8px", fontSize: "0.75rem", color: "var(--warning)" }}>
                      {s.name} ({new Date(s.subscription.nextPaymentDate).toLocaleDateString("en-IN")})
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Summary row. These were four cards with hardcoded #fff numbers
                sitting on tinted backgrounds — legible on the dark canvas they
                were designed against, invisible in light mode. Token-painted
                now, so they follow the theme like everything else. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 11 }}>
              {[
                { label: "Due in 30 days", value: dueIn30.length, sub: "societies", tone: "var(--accent)" },
                { label: "Recorded revenue", value: money(totalRevenue), sub: "all time", tone: "var(--success)" },
                { label: "Trial societies", value: societies.filter((s) => s.subscription?.status === "Trial").length, sub: "not converted", tone: "var(--info)" },
                { label: "No pay date set", value: noPayment.length, sub: "societies", tone: "var(--warning)" },
              ].map((c) => (
                <div key={c.label} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ color: c.tone, fontSize: 11, fontWeight: 700, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.5px" }}>{c.label}</div>
                  <div style={{ color: "var(--fg-2)", fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>{c.value}</div>
                  <div style={{ color: "var(--fg-4)", fontSize: 11, marginTop: 3 }}>{c.sub}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      {/* Table */}
      {isLoading ? (
        <div className={styles.loading}>Loading societies...</div>
      ) : (
        <Card padded={false}>
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {["Society", "Admin credentials", "Plan", "Status", "Last paid", "Next due", "Total paid", "Actions"].map((h, i) => (
                  <th key={h} style={{
                    padding: "9px 12px", fontSize: 10, fontWeight: 700, color: "var(--fg-4)",
                    textTransform: "uppercase", letterSpacing: "0.6px", background: "var(--bg-sunken)",
                    borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                    textAlign: i === 6 ? "right" : "left",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredSocieties.map((society) => (
                <tr key={society._id}>
                  <td style={SOC_TD}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <SocietyMark name={society.name} size={30} />
                      <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {society.name}
                      {society.isTestSociety && (
                        <span style={{ color: "var(--warning)", fontWeight: 700, marginLeft: 6 }}> (test)</span>
                      )}
                      {society.lifecycleStatus === "Paused" && (
                        <span style={{ color: "var(--danger)", fontWeight: 700, marginLeft: 6 }}>
                          {society.isDeleted ? " (pending delete)" : " (paused)"}
                          {!society.isDeleted && (
                            <button
                              style={{ ...ACTION_BTN, ...ACTION_TONES.success, marginLeft: 6 }}
                              onClick={async () => {
                                const res = await fetch(`/api/superadmin/societies/${society._id}/lifecycle`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  credentials: "include",
                                  body: JSON.stringify({ action: "resume" }),
                                });
                                if (!res.ok) { notify.error("Resume failed"); return; }
                                queryClient.invalidateQueries(["admin-societies"]);
                              }}
                            >
                              ▶ resume
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--fg-5)", fontFamily: "monospace" }}>
                      {society.registrationNo || "no reg no"} · {society._id.slice(-8)}
                    </div>
                    {society.isDeleted && (
                      <a
                        href="/superadmin/lifecycle"
                        style={{
                          display: "inline-block", marginTop: 4, textDecoration: "none",
                          background: "var(--danger-bg)", color: "var(--danger)",
                          borderRadius: 999, padding: "1px 8px", fontSize: 9.5,
                          fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.4px",
                        }}
                      >
                        being erased{society.purgeScheduledFor ? ` · ${shortDate(society.purgeScheduledFor)}` : ""}
                      </a>
                    )}
                      </div>
                    </div>
                  </td>
                  <td style={SOC_TD}>
                    <CredentialsCell credentials={society.credentials} />
                  </td>
                  <td style={SOC_TD}><PlanChip plan={society.subscription?.planType || "Free"} /></td>
                  <td style={SOC_TD}><StatusPill status={society.subscription?.status || "Trial"} /></td>
                  <td style={{ ...SOC_TD, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
                    {society.subscription?.lastPaymentDate ? shortDate(society.subscription.lastPaymentDate) : "Never"}
                  </td>
                  <td style={{ ...SOC_TD, whiteSpace: "nowrap", color: OVERDUE(society) ? "var(--danger)" : "var(--fg-3)", fontWeight: OVERDUE(society) ? 700 : 400 }}>
                    {society.subscription?.nextPaymentDate ? shortDate(society.subscription.nextPaymentDate) : "Not set"}
                  </td>
                  <td style={{ ...SOC_TD, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                    {money(society.subscription?.amountPaid || 0)}
                  </td>
                  <td style={SOC_TD}>
                    <RowActions>
                      <button
                        onClick={() => handlePaymentRecord(society)}
                        style={{ ...ACTION_BTN, ...ACTION_TONES.success }}
                      >
                        💰 Payment
                      </button>
                      {society.subscription?.status === "Active" ? (
                        <button
                          onClick={() => suspendSociety(society._id)}
                          style={{ ...ACTION_BTN, ...ACTION_TONES.danger }}
                        >
                          🚫 Suspend
                        </button>
                      ) : (
                        <button
                          onClick={() => activateSociety(society._id)}
                          style={{ ...ACTION_BTN, ...ACTION_TONES.success }}
                        >
                          ✅ Activate
                        </button>
                      )}
                      <button
                        onClick={() =>
                          window.open(
                            `/superadmin/societies/${society._id}`,
                            "_blank",
                          )
                        }
                        style={{ ...ACTION_BTN, ...ACTION_TONES.accent }}
                      >
                        📊 Details
                      </button>
                      <button
                        style={{ ...ACTION_BTN, ...ACTION_TONES.neutral }}
                        onClick={async () => {
                          if (!(await notify.confirm(`Reset passwords for ALL members of "${society.name}"? They will need new credentials to login.`, { tone: "danger" }))) return;
                          const res = await fetch("/api/superadmin/reset-member-passwords", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ societyId: society._id }),
                          });
                          const data = await res.json();
                          if (!res.ok) { notify.error(data.error || "Failed"); return; }
                          if (!data.credentials?.length) { notify.info("No member accounts found."); return; }
                          const dlRes = await fetch("/api/members/download-credentials", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ credentials: data.credentials }),
                          });
                          if (!dlRes.ok) { notify.error("Reset done but download failed"); return; }
                          const blob = await dlRes.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `Member_Credentials_${society.name}_${Date.now()}.xlsx`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                      >
                        🔑 Reset Creds
                      </button>
                      <button
                        style={{ ...ACTION_BTN, ...ACTION_TONES.warning }}
                        onClick={async () => {
                          // SEC-19: this used to prompt for a password, then
                          // print the new one in a toast. Support's procedure
                          // was "reset it and read it out", which is why
                          // plaintext admin passwords existed at all. Now the
                          // admin sets their own via an expiring setup link and
                          // nobody here ever sees a password.
                          const ok = await notify.confirm(
                            `Send a setup link to the admin of "${society.name}"?\n\n` +
                            `• Their current password stops working immediately\n` +
                            `• Any session they have open is signed out\n` +
                            `• They choose a new password themselves via an emailed link (valid 7 days)\n\n` +
                            `You will not see their password — nobody will.`
                          );
                          if (!ok) return;
                          const res = await fetch("/api/superadmin/reset-admin-password", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ societyId: society._id }),
                          });
                          const data = await res.json();
                          if (!res.ok) { notify.error(data.error || "Failed"); return; }
                          if (data.emailSent) {
                            notify.success(
                              `Setup link sent to ${data.adminEmail}.\n` +
                              `Valid for ${data.expiresInDays} days.` +
                              (data.sessionsInvalidated ? "" : "\n\nNote: existing sessions could not be signed out — check Redis.")
                            );
                          } else {
                            // Email delivery failed. Hand the link over rather
                            // than leaving support with no path — it expires and
                            // can only set credentials.
                            await notify.prompt(
                              `Password rotated, but the email could not be sent.\n\n` +
                              `Send this link to ${data.adminEmail} yourself (valid ${data.expiresInDays} days):`,
                              data.setCredentialsUrl
                            );
                          }
                          queryClient.invalidateQueries(["admin-societies"]);
                        }}
                      >
                        🔐 Send Admin Setup Link
                      </button>
                      <button
                        style={{ ...ACTION_BTN, ...ACTION_TONES.info }}
                        onClick={async () => {
                          setViewCredsTarget({ societyId: society._id, name: society.name });
                          setViewCreds(null);
                          setViewCredsLoading(true);
                          try {
                            const res = await fetch(`/api/superadmin/member-credentials?societyId=${society._id}`, {
                              credentials: "include",
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error || "Failed");
                            setViewCreds(data.credentials || []);
                          } catch (e) {
                            notify.error("Failed to load credentials: " + e.message);
                            setViewCredsTarget(null);
                          } finally {
                            setViewCredsLoading(false);
                          }
                        }}
                      >
                        👁 View Creds
                      </button>
                      {!society.onboarding?.billHistoryImported ? (
                        <button
                          style={{ ...ACTION_BTN, ...ACTION_TONES.neutral }}
                          onClick={() => setBhModalSociety(society)}
                        >
                          📜 Bill History
                        </button>
                      ) : (
                        <button
                          style={{ ...ACTION_BTN, ...ACTION_TONES.success }}
                          disabled
                        >
                          ✓ History Done
                        </button>
                      )}
                      <button
                        style={{ ...ACTION_BTN, ...ACTION_TONES.warning }}
                        onClick={async () => {
                          const joinPeriod = society.onboarding?.joinPeriodId;
                          const confirmMsg = joinPeriod
                            ? `Fix historical bill balances for "${society.name}"?\n\nWill zero out all bills before join period ${joinPeriod} AND all BulkImport bills.\n\nSafe to run multiple times.`
                            : `Fix historical bill balances for "${society.name}"?\n\nNo join period detected — will only fix bills with importedFrom=BulkImport.\n\nTo fix by period too, set joinPeriodId first via Bill History Import.`;
                          if (!(await notify.confirm(confirmMsg, { tone: "warning" }))) return;
                          const body = { societyId: society._id };
                          if (joinPeriod) body.beforePeriodId = joinPeriod;
                          const res = await fetch("/api/superadmin/fix-history-bills", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify(body),
                          });
                          const data = await res.json();
                          if (!res.ok) { notify.error(data.error || "Failed"); return; }
                          notify.success(data.message);
                        }}
                      >
                        🔧 Fix History Bills
                      </button>
                      <button
                        style={{ ...ACTION_BTN, ...ACTION_TONES.neutral }}
                        title={society.isTestSociety ? "Unmark as test society" : "Mark as test society (enables quick delete)"}
                        onClick={async () => {
                          const res = await fetch(`/api/superadmin/societies/${society._id}/mark-test`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            credentials: "include",
                            body: JSON.stringify({ isTestSociety: !society.isTestSociety }),
                          });
                          if (!res.ok) { notify.error("Failed to update test flag"); return; }
                          queryClient.invalidateQueries(["admin-societies"]);
                        }}
                      >
                        {society.isTestSociety ? "★ (test)" : "☆ mark test"}
                      </button>
                      {society.isTestSociety ? (
                        <button
                          style={{ ...ACTION_BTN, ...ACTION_TONES.danger }}
                          title="Quick-delete this test society (no export/verify wizard)"
                          onClick={async () => {
                            if (!(await notify.confirm(`Quick-delete TEST society "${society.name}"? Skips the export/verify wizard. Only works because it's marked (test).`, { tone: "danger" }))) return;
                            const res = await fetch(`/api/superadmin/societies/${society._id}/quick-delete-test`, {
                              method: "POST",
                              credentials: "include",
                            });
                            const data = await res.json();
                            if (!res.ok) { notify.error(data.error || "Failed"); return; }
                            notify.success(`Test society "${data.societyName}" deleted.`);
                            queryClient.invalidateQueries(["admin-societies"]);
                          }}
                        >
                          🗑 Delete (test)
                        </button>
                      ) : (
                        <button
                          style={{ ...ACTION_BTN, ...ACTION_TONES.danger }}
                          onClick={() => setDeleteTarget(society)}
                        >
                          🗑 Delete
                        </button>
                      )}
                    </RowActions>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {filteredSocieties.length === 0 && (
            <Empty title="No societies match" sub="Try a different status filter or search term." />
          )}
        </Card>
      )}
      {/* ── BULK IMPORT WIZARD (upload a filled .xlsx template) ── */}
<BulkImportWizard
  open={showBulkModal}
  onClose={resetBulkModal}
  onImported={() => queryClient.invalidateQueries({ queryKey: ["admin-societies"] })}
  BillHistoryStep={BillHistoryStep}
/>
      {/* ── VIEW CREDENTIALS DIALOG ── */}
      {viewCredsTarget && mounted && createPortal(
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => { setViewCredsTarget(null); setViewCreds(null); }}
        >
          <div
            style={{ background: "var(--bg-surface)", border: "1px solid var(--info)", borderRadius: 12, padding: "2rem", width: 680, maxHeight: "85vh", display: "flex", flexDirection: "column", color: "var(--fg-1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <div>
                <h2 style={{ margin: 0, color: "var(--accent)", fontSize: "1.1rem" }}>👁 Member Credentials</h2>
                <div style={{ color: "var(--fg-4)", fontSize: "0.82rem", marginTop: 2 }}>{viewCredsTarget.name}</div>
              </div>
              <button onClick={() => { setViewCredsTarget(null); setViewCreds(null); }} style={{ background: "none", border: "none", color: "var(--fg-5)", fontSize: "1.3rem", cursor: "pointer" }}>✕</button>
            </div>
            {viewCredsLoading ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--fg-4)" }}>Loading credentials...</div>
            ) : viewCreds?.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "var(--fg-4)" }}>No member accounts found for this society.</div>
            ) : (
              <div style={{ overflowY: "auto", flex: 1 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead style={{ position: "sticky", top: 0, background: "var(--bg-sunken)" }}>
                    <tr>
                      {["Flat", "Wing", "Owner", "Username", "Email", "Status"].map((h) => (
                        <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: "var(--fg-3)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(viewCreds || []).map((c, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-sunken)" }}>
                        <td style={{ padding: "7px 10px", color: "var(--fg-1)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{c.flatNo}</td>
                        <td style={{ padding: "7px 10px", color: "var(--fg-3)", borderBottom: "1px solid var(--border)" }}>{c.wing || "—"}</td>
                        <td style={{ padding: "7px 10px", color: "var(--fg-2)", borderBottom: "1px solid var(--border)" }}>{c.ownerName}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "monospace", color: c.username ? "#a78bfa" /* TODO: unmapped color, needs design review */ : "var(--fg-3)", borderBottom: "1px solid var(--border)" }}>
                          {c.username ? c.username.toUpperCase() : "—"}
                        </td>
                        <td style={{ padding: "7px 10px", color: "var(--fg-5)", borderBottom: "1px solid var(--border)" }}>{c.email}</td>
                        <td style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)" }}>
                          {!c.hasAccount ? (
                            <span style={{ color: "var(--fg-4)", fontSize: "0.75rem" }}>No account</span>
                          ) : c.isActive ? (
                            <span style={{ color: "var(--success)", fontSize: "0.75rem" }}>● Active</span>
                          ) : (
                            <span style={{ color: "var(--warning)", fontSize: "0.75rem" }}>○ Inactive</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem", justifyContent: "flex-end" }}>
              {viewCreds?.length > 0 && (
                <button
                  onClick={async () => {
                    const dlRes = await fetch("/api/members/download-credentials", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ credentials: viewCreds.map((c) => ({ ...c, password: "(not reset)", isNewUser: false })) }),
                    });
                    if (!dlRes.ok) { notify.error("Download failed"); return; }
                    const blob = await dlRes.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `Member_Credentials_${viewCredsTarget.name}_${Date.now()}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  style={{ background: "var(--primary-hover)", color: "#fff", border: "none", padding: "0.5rem 1.2rem", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.85rem" }}
                >
                  ⬇️ Export as Excel
                </button>
              )}
              <button
                onClick={() => { setViewCredsTarget(null); setViewCreds(null); }}
                style={{ background: "var(--fg-3)", color: "#fff", border: "none", padding: "0.5rem 1.2rem", borderRadius: 6, cursor: "pointer" }}
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* ── DELETE / MANAGE SOCIETY WIZARD (LOOP-05) ── */}
      {deleteTarget && (
        <DeleteWizard
          society={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={(action, data) => {
            const messages = {
              pause: "Society paused.",
              "pause-until": `Society paused until ${data.pausedUntil}.`,
              "delete-until": `Society soft-deleted; scheduled to purge on ${data.purgeScheduledFor}. Restorable until then.`,
              "delete-permanently": `"${data.societyName}" permanently deleted.\nMembers: ${data.deleted?.members}, Bills: ${data.deleted?.bills}, Receipts: ${data.deleted?.receipts}`,
            };
            notify.success(messages[action] || "Done.");
            setDeleteTarget(null);
            queryClient.invalidateQueries(["admin-societies"]);
          }}
        />
      )}
      {/* ── STANDALONE BILL HISTORY MODAL (from table button) ── */}
      {bhModalSociety && (
        <BhModal
          society={bhModalSociety}
          onClose={() => { setBhModalSociety(null); queryClient.invalidateQueries(["admin-societies"]); }}
        />
      )}
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════
   Row presentation
   ══════════════════════════════════════════════════════════════════════ */

const SOC_TD = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "middle",
};

/** Is this society's next payment date in the past while still Active? */
const OVERDUE = (society) =>
  society.subscription?.status === "Active" &&
  society.subscription?.nextPaymentDate &&
  new Date(society.subscription.nextPaymentDate) < new Date();

const ACTION_TONES = {
  success: { background: "var(--success-bg)", color: "var(--success)", border: "1px solid var(--success)" },
  danger: { background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger)" },
  warning: { background: "var(--warning-bg)", color: "var(--warning)", border: "1px solid var(--warning)" },
  info: { background: "var(--info-bg)", color: "var(--info)", border: "1px solid var(--info)" },
  accent: { background: "var(--accent-tint)", color: "var(--accent)", border: "1px solid var(--accent)" },
  neutral: { background: "var(--bg-tertiary)", color: "var(--fg-2)", border: "1px solid var(--border-strong)" },
};

/**
 * Shared shape for a row action. Tinted rather than filled: ten saturated
 * buttons in one cell read as ten equally urgent things, which is how the old
 * grid made "Delete" look no louder than "Details". The tint carries the
 * meaning; the border carries the weight.
 */
const ACTION_BTN = {
  padding: "4px 9px",
  borderRadius: 7,
  fontSize: 11.5,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/**
 * The first three actions stay visible; everything else lives behind "More".
 *
 * Ten buttons per row was the actual complaint about this page — every row was
 * a wall of colour, and the destructive ones sat in it unremarkably. Payment,
 * suspend/activate and details cover almost every visit; credential resets,
 * bill-history repair and deletion are deliberate trips.
 */
function RowActions({ children }) {
  const [open, setOpen] = useState(false);
  const items = React.Children.toArray(children).filter(Boolean);
  const primary = items.slice(0, 3);
  const rest = items.slice(3);

  return (
    <div style={{ display: "grid", gap: 6, minWidth: 210 }}>
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
        {primary}
        {rest.length > 0 && (
          <button
            style={{ ...ACTION_BTN, ...ACTION_TONES.neutral }}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Less ▲" : `More ${rest.length} ▾`}
          </button>
        )}
      </div>
      {/* Expands INSIDE the cell rather than floating above it.
          As an absolutely-positioned dropdown this sat on top of whatever
          card happened to be underneath — and in the last row it escaped the
          table entirely. Growing the row costs a little height and covers
          nothing. */}
      {open && rest.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 5,
            padding: 8,
            borderRadius: 9,
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
          }}
        >
          {rest}
        </div>
      )}
    </div>
  );
}

/**
 * Admin contact for the society. No password, because there is no longer a
 * password to show.
 *
 * SEC-19 history: this cell rendered `credentials.plainPassword` — first inline
 * on every row, then behind a Reveal/Copy pair. Hiding it behind a click made
 * the screenshot problem smaller and the underlying one no smaller at all: the
 * password was still stored in plaintext in Mongo, still shipped to this page
 * in an API response, and still one Copy button from a WhatsApp message.
 *
 * Nobody needs to read an admin's password. The thing support actually needs is
 * "get this admin back into their account", and that is the
 * "Send Admin Setup Link" action in the row above — it rotates the password to
 * a value no human ever sees, signs out their existing sessions, and emails
 * them a 7-day link to choose a new one.
 */
function CredentialsCell({ credentials }) {
  if (!credentials?.adminEmail) return <span style={{ color: "var(--fg-5)" }}>—</span>;
  return (
    <div style={{ display: "grid", gap: 3, minWidth: 180 }}>
      <div style={{ fontSize: 12, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis" }}>
        {credentials.adminEmail}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(credentials.adminEmail);
            notify.success("Email copied");
          }}
          style={credBtn}
          title="Copy admin email"
        >
          Copy email
        </button>
      </div>
    </div>
  );
}

const credBtn = {
  background: "transparent",
  border: "1px solid var(--border-strong)",
  color: "var(--fg-4)",
  borderRadius: 6,
  fontSize: 10.5,
  fontWeight: 600,
  padding: "2px 7px",
  cursor: "pointer",
  fontFamily: "inherit",
};
