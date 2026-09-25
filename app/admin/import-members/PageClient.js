"use client";
import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import styles from "@/styles/ImportMembers.module.css";
import notify from "@/lib/notify";
export default function ImportMembersPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [importResults, setImportResults] = useState(null);
  const [currentFile, setCurrentFile] = useState(null); // ← STORE FILE
  // PREVIEW MUTATION (confirmImport=false)
  const previewMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("confirmImport", "false"); // ← KEY CHANGE
      setUploadProgress({ stage: "analyzing", percent: 30 });
      const response = await fetch("/api/members/import", {
        // ← SAME API
        method: "POST",
        credentials: "include",
        body: formData,
      });
      setUploadProgress({ stage: "validating", percent: 60 });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Preview failed");
      }
      const data = await response.json();
      console.log("🔥 VALIDATION RESPONSE:", data.validation); // ← ADD THIS
      console.log("🔥 ISSUES COUNT:", data.validation.issues.length); // ← ADD THIS
      return data;
    },
    onSuccess: (data) => {
      setUploadProgress({ stage: "complete", percent: 100 });
      setPreviewData(data);
      setTimeout(() => setUploadProgress(null), 1000);
    },
    onError: (error) => {
      setUploadProgress(null);
      notify.error(`Preview failed: ${error.message}`);
    },
  });
  // CONFIRM MUTATION (confirmImport=true)
  const confirmMutation = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("confirmImport", "true"); // ← KEY CHANGE
      setUploadProgress({ stage: "importing", percent: 20 });
      const response = await fetch("/api/members/import", {
        // ← SAME API
        method: "POST",
        credentials: "include",
        body: formData,
      });
      setUploadProgress({ stage: "processing", percent: 70 });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Import failed");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setUploadProgress({ stage: "complete", percent: 100 });
      setImportResults(data);
      setPreviewData(null);
      setCurrentFile(null);
      queryClient.invalidateQueries(["members-list"]);
      setTimeout(() => setUploadProgress(null), 2000);
    },
    onError: (error) => {
      setUploadProgress(null);
      notify.error(`Import failed: ${error.message}`);
    },
  });
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };
  const handleFile = async (file) => {
    if (!file.name.endsWith(".xlsx")) {
      notify.warning("Please upload a valid .xlsx file");
      return;
    }
    setCurrentFile(file); // ← STORE FOR LATER
    previewMutation.mutate(file);
  };
  const handleConfirm = () => {
    if (!currentFile) {
      notify.warning("File not found. Please re-upload.");
      return;
    }
    confirmMutation.mutate(currentFile); // ← USE STORED FILE
  };
  const downloadTemplate = () => {
    const link = document.createElement("a");
    link.href = "/api/members/template";
    link.download = "member_import_template_detailed.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const downloadCredentials = async () => {
    if (!importResults?.userCredentials) return;
    try {
      const response = await fetch("/api/members/download-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ credentials: importResults.userCredentials }),
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `member_credentials_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download error:", error);
      notify.error("Failed to download credentials");
    }
  };
  const getCellStyle = (sheetName, rowIndex, colIndex) => {
    if (!previewData?.validation?.issues || rowIndex === 0) {
      if (rowIndex === 0)
        return { backgroundColor: "var(--bg-muted)", fontWeight: 700 };
      return { backgroundColor: "var(--success-bg)" };
    }
    const issue = previewData.validation.issues.find(
      (i) => i.sheet === sheetName && i.row === rowIndex + 1,
    );
    if (!issue) return { backgroundColor: "var(--success-bg)" };
    const headers = previewData.sheets[sheetName][0];
    const header = headers[colIndex]?.value;
    // ✅ STEP 1: If THIS SPECIFIC CELL has an issue, show STRONG styling
    if (header && issue.cellIssues[header]) {
      const issueType = issue.cellIssues[header].type;
      switch (issueType) {
        case "ERROR":
          return {
            backgroundColor: "var(--danger-bg)",
            color: "var(--danger-fg)",
            fontWeight: 600,
          };
        case "DUPLICATE_DB":
        case "DUPLICATE_FILE":
          return {
            backgroundColor: "var(--bg-surface)",
            border: "2px solid var(--danger)",
            color: "var(--danger)",
            fontWeight: 600,
          };
        case "WARNING":
          return { backgroundColor: "var(--warning-bg)", color: "var(--warning-fg)" };
        default:
          return {};
      }
    }
    // ✅ STEP 2: If THIS ROW has ANY issues, make whole row LIGHT RED/YELLOW
    const issueTypes = Object.values(issue.cellIssues).map((ci) => ci.type);
    if (issueTypes.includes("ERROR")) {
      return { backgroundColor: "var(--danger-bg)", fontStyle: "italic" }; // Light pink for error rows
    }
    if (
      issueTypes.includes("DUPLICATE_DB") ||
      issueTypes.includes("DUPLICATE_FILE")
    ) {
      return { backgroundColor: "var(--danger-bg)", fontStyle: "italic" }; // Very light red for duplicate rows
    }
    if (issueTypes.includes("WARNING")) {
      return { backgroundColor: "var(--warning-bg)", fontStyle: "italic" }; // Very light yellow for warning rows
    }
    return {};
  };
  const getCellTooltip = (sheetName, rowIndex, colIndex) => {
    if (!previewData?.validation?.issues || rowIndex === 0) return null;
    const issue = previewData.validation.issues.find(
      (i) => i.sheet === sheetName && i.row === rowIndex + 1,
    );
    if (!issue) return null;
    const headers = previewData.sheets[sheetName][0];
    const header = headers[colIndex]?.value;
    return issue.cellIssues[header]?.message || null;
  };
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Import Members</h1>
        <p className={styles.subtitle}>
          Upload Excel → Preview & Validate → Confirm Import
        </p>
      </div>
      {/* Upload Progress */}
      {uploadProgress && (
        <div className={styles.progressCard}>
          <div className={styles.progressHeader}>
            <h3>
              {uploadProgress.stage === "analyzing" &&
                "Analyzing Excel file..."}
              {uploadProgress.stage === "validating" &&
                "Running validations..."}
              {uploadProgress.stage === "importing" &&
                "Importing members..."}
              {uploadProgress.stage === "processing" &&
                "Creating accounts..."}
              {uploadProgress.stage === "complete" && "Complete!"}
            </h3>
          </div>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${uploadProgress.percent}%` }}
            />
          </div>
          <p className={styles.progressText}>{uploadProgress.percent}%</p>
        </div>
      )}
      {/* PREVIEW MODE */}
      {previewData && !importResults && (
        <>
          {/* Validation Summary */}
          <div className={styles.validationSummary}>
            <div className={styles.summaryCard}>
              <h3>Validation Results</h3>
              <div className={styles.summaryStats}>
                <div
                  className={styles.stat}
                  style={{ backgroundColor: "var(--success-bg)" }}
                >
                  <span className={styles.statNumber}>
                    {previewData.validation.summary.valid}
                  </span>
                  <span className={styles.statLabel}>Valid</span>
                </div>
                <div
                  className={styles.stat}
                  style={{ backgroundColor: "var(--danger-bg)" }}
                >
                  <span className={styles.statNumber}>
                    {previewData.validation.summary.errors}
                  </span>
                  <span className={styles.statLabel}>Errors</span>
                </div>
                <div
                  className={styles.stat}
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    border: "2px solid var(--danger)",
                  }}
                >
                  <span className={styles.statNumber}>
                    {previewData.validation.summary.duplicates}
                  </span>
                  <span className={styles.statLabel}>Duplicates</span>
                </div>
                <div
                  className={styles.stat}
                  style={{ backgroundColor: "var(--warning-bg)" }}
                >
                  <span className={styles.statNumber}>
                    {previewData.validation.summary.warnings}
                  </span>
                  <span className={styles.statLabel}>Warnings</span>
                </div>
              </div>
              {!previewData.validation.summary.canImport && (
                <div className={styles.errorBanner}>
                  Cannot import: Fix all errors and duplicates first, then
                  re-upload
                </div>
              )}
              {previewData.validation.summary.canImport && (
                <div className={styles.successBanner}>
                  All validations passed! Ready to import{" "}
                  {previewData.validation.summary.valid} members
                </div>
              )}
            </div>
            {/* Legend */}
            <div className={styles.legend}>
              <h4>Color Guide:</h4>
              <div className={styles.legendItems}>
                <div className={styles.legendItem}>
                  <span
                    className={styles.legendColor}
                    style={{ backgroundColor: "var(--success-bg)" }}
                  ></span>
                  <span>Valid Data</span>
                </div>
                <div className={styles.legendItem}>
                  <span
                    className={styles.legendColor}
                    style={{ backgroundColor: "var(--danger-bg)" }}
                  ></span>
                  <span>Error (missing/invalid)</span>
                </div>
                <div className={styles.legendItem}>
                  <span
                    className={styles.legendColor}
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      border: "2px solid var(--danger)",
                    }}
                  ></span>
                  <span>Duplicate (in DB or file)</span>
                </div>
                <div className={styles.legendItem}>
                  <span
                    className={styles.legendColor}
                    style={{ backgroundColor: "var(--warning-bg)" }}
                  ></span>
                  <span>Warning (optional field)</span>
                </div>
              </div>
            </div>
          </div>
          {/* Sheet Tabs */}
          <div className={styles.sheetTabs}>
            {Object.keys(previewData.sheets).map((sheetName, index) => (
              <button
                key={sheetName}
                className={`${styles.tabButton} ${activeSheet === index ? styles.activeTab : ""}`}
                onClick={() => setActiveSheet(index)}
              >
                {sheetName}
              </button>
            ))}
          </div>
          {/* Excel Preview Table */}
          <div className={styles.previewTable}>
            <table>
              <tbody>
                {previewData.sheets[
                  Object.keys(previewData.sheets)[activeSheet]
                ].map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, colIndex) => {
                      const cellStyle = getCellStyle(
                        Object.keys(previewData.sheets)[activeSheet],
                        rowIndex,
                        colIndex,
                      );
                      const tooltip = getCellTooltip(
                        Object.keys(previewData.sheets)[activeSheet],
                        rowIndex,
                        colIndex,
                      );
                      return (
                        <td
                          key={colIndex}
                          style={cellStyle}
                          title={tooltip || ""}
                        >
                          {cell.value || ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Actions */}
          <div className={styles.actions}>
            <button
              className={styles.btnSecondary}
              onClick={() => {
                setPreviewData(null);
                setCurrentFile(null);
                setActiveSheet(0);
              }}
            >
              Cancel
            </button>
            <button
              className={styles.btnPrimary}
              onClick={handleConfirm} // ← CHANGED
              disabled={
                !previewData.validation.summary.canImport ||
                confirmMutation.isPending
              }
            >
              {confirmMutation.isPending
                ? "Importing..."
                : `Confirm Import (${previewData.validation.summary.valid} valid members)`}
            </button>
          </div>
        </>
      )}
      {/* Import Results */}
      {importResults && (
        <div className={styles.resultsCard}>
          <div className={styles.resultsHeader}>
            <h2>Import Successful!</h2>
            <button
              className={styles.closeBtn}
              onClick={() => setImportResults(null)}
            >
              ✕
            </button>
          </div>
          <div className={styles.statsGrid}>
            <div className={`${styles.statBox} ${styles.success}`}>
              <div className={styles.statIcon}></div>
              <div className={styles.statValue}>
                {importResults.summary?.successful || 0}
              </div>
              <div className={styles.statLabel}>Successfully Imported</div>
            </div>
            <div className={`${styles.statBox} ${styles.warning}`}>
              <div className={styles.statIcon}></div>
              <div className={styles.statValue}>
                {importResults.summary?.warnings || 0}
              </div>
              <div className={styles.statLabel}>Warnings</div>
            </div>
            <div className={`${styles.statBox} ${styles.error}`}>
              <div className={styles.statIcon}></div>
              <div className={styles.statValue}>
                {importResults.summary?.failed || 0}
              </div>
              <div className={styles.statLabel}>Failed</div>
            </div>
            <div className={`${styles.statBox} ${styles.info}`}>
              <div className={styles.statIcon}></div>
              <div className={styles.statValue}>
                {importResults.summary?.total || 0}
              </div>
              <div className={styles.statLabel}>Total Records</div>
            </div>
          </div>
          {/* Detailed Checklist */}
          <div className={styles.checklist}>
            <h3>Import Checklist</h3>
            <div className={styles.checklistItems}>
              <div className={styles.checklistItem}>
                <span className={styles.checkIcon}></span>
                <span>Basic member information imported</span>
              </div>
              {importResults.details?.ownerHistoryImported > 0 && (
                <div className={styles.checklistItem}>
                  <span className={styles.checkIcon}></span>
                  <span>
                    {importResults.details.ownerHistoryImported} owner history
                    records imported
                  </span>
                </div>
              )}
              {importResults.details?.tenantHistoryImported > 0 && (
                <div className={styles.checklistItem}>
                  <span className={styles.checkIcon}></span>
                  <span>
                    {importResults.details.tenantHistoryImported} tenant history
                    records imported
                  </span>
                </div>
              )}
              {importResults.details?.parkingSlotsImported > 0 && (
                <div className={styles.checklistItem}>
                  <span className={styles.checkIcon}></span>
                  <span>
                    {importResults.details.parkingSlotsImported} parking slots
                    assigned
                  </span>
                </div>
              )}
              {importResults.details?.familyMembersImported > 0 && (
                <div className={styles.checklistItem}>
                  <span className={styles.checkIcon}></span>
                  <span>
                    {importResults.details.familyMembersImported} family members
                    added
                  </span>
                </div>
              )}
              {importResults.details?.tenantsImported > 0 && (
                <div className={styles.checklistItem}>
                  <span className={styles.checkIcon}></span>
                  <span>
                    {importResults.details.tenantsImported} current tenants
                    recorded
                  </span>
                </div>
              )}
              {importResults.details?.usersCreated > 0 && (
                <div className={styles.checklistItem}>
                  <span className={styles.checkIcon}></span>
                  <span>
                    {importResults.details.usersCreated} login accounts created
                  </span>
                </div>
              )}
            </div>
          </div>
          {/* Warnings */}
          {importResults.warnings && importResults.warnings.length > 0 && (
            <div className={styles.warningsList}>
              <h3>Warnings ({importResults.warnings.length})</h3>
              {importResults.warnings.map((warning, idx) => (
                <div key={idx} className={styles.warningItem}>
                  <span className={styles.warningIcon}></span>
                  <div>
                    <strong>Row {warning.row}:</strong> {warning.message}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Errors */}
          {importResults.errors && importResults.errors.length > 0 && (
            <div className={styles.errorsList}>
              <h3>Errors ({importResults.errors.length})</h3>
              {importResults.errors.map((error, idx) => (
                <div key={idx} className={styles.errorItem}>
                  <span className={styles.errorIcon}></span>
                  <div>
                    <strong>Row {error.row}:</strong> {error.error}
                    {error.details && (
                      <div className={styles.errorDetails}>{error.details}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Download Credentials */}
          {importResults.userCredentials &&
            importResults.userCredentials.length > 0 && (
              <div className={styles.credentialsSection}>
                <h3>Login Credentials Generated</h3>
                <p>Download the credentials file and distribute to members</p>
                <button
                  onClick={downloadCredentials}
                  className={styles.downloadBtn}
                >
                  Download Member Credentials (.xlsx)
                </button>
              </div>
            )}
        </div>
      )}
      {/* Upload Area (Initial State) */}
      {!previewData && !importResults && (
        <div className={styles.uploadSection}>
          <div className={styles.instructionsCard}>
            <h3>Before You Start</h3>
            <ol className={styles.instructions}>
              <li>Download the enhanced template with multiple sheets</li>
              <li>Fill in member details across all relevant sheets</li>
              <li>
                Sheet 1 (Basic Info) is <strong>required</strong>
              </li>
              <li>
                Other sheets are optional but recommended for complete data
              </li>
              <li>Make sure flatNo matches across all sheets</li>
              <li>Upload the completed file for preview</li>
            </ol>
            <button onClick={downloadTemplate} className={styles.templateBtn}>
              Download Enhanced Template
            </button>
          </div>
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ""}`}
          >
            <div className={styles.dropzoneIcon}></div>
            <h3>Drag & Drop Excel File Here</h3>
            <p>or click to browse</p>
            <p className={styles.fileFormat}>Supports: .xlsx files only</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  handleFile(e.target.files[0]);
                }
              }}
              style={{ display: "none" }}
            />
          </div>
          <div className={styles.featuresGrid}>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}></div>
              <h4>Owner Details</h4>
              <p>Full contact info and PAN (Aadhaar is no longer collected)</p>
            </div>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}></div>
              <h4>Owner History</h4>
              <p>Previous ownership records</p>
            </div>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}></div>
              <h4>Tenant History</h4>
              <p>Past & current tenants</p>
            </div>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}>‍</div>
              <h4>Family Members</h4>
              <p>Complete family details</p>
            </div>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}></div>
              <h4>Parking Slots</h4>
              <p>Assign parking spaces</p>
            </div>
            <div className={styles.featureCard}>
              <div className={styles.featureIcon}></div>
              <h4>Auto Validation</h4>
              <p>Real-time error checking</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
