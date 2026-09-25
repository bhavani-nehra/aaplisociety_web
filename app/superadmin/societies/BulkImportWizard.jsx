"use client";

// app/superadmin/societies/BulkImportWizard.jsx
//
// Upload the filled template → preview validates everything (every sheet,
// every DB check — society name taken, admin/member emails already
// registered) and shows every row's status before anything is created →
// Import commits using that same reviewed result, never re-checking what
// preview already confirmed.
//
// This used to also offer a native in-browser paste-grid as a second way to
// enter the same data, sheet by sheet. Removed: every real use of this tool
// starts from a spreadsheet that already has the data, so the grid was a
// second path to the same result nobody needed. If a future need for
// hand-typing a society with no spreadsheet at all shows up, rebuild it
// then — don't resurrect this from history speculatively.

import PulseLoader from "@/components/brand/PulseLoader";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import {
  ClipboardPaste,
  AlertTriangle,
  CheckCircle2,
  X,
  Download,
  Search,
  Building2,
  ClipboardList,
  Lock,
  Mail,
  KeyRound,
  Users,
  History,
  ArrowRight,
  XCircle,
} from "lucide-react";
import styles from "@/styles/BulkImportWizard.module.css";
import notify from "@/lib/notify";

const ROW_COLOR = {
  ok: "var(--success)",
  warning: "var(--warning)",
  error: "var(--danger)",
};
const ROW_CLASS = {
  ok: "",
  warning: styles.memberRowWarning,
  error: styles.memberRowError,
};

export default function BulkImportWizard({ open, onClose, onImported, BillHistoryStep }) {
  // idle | previewing | reviewing | importing | done
  const [stage, setStage] = useState("idle");
  const [previewResult, setPreviewResult] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [revealedCount, setRevealedCount] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [serverResult, setServerResult] = useState(null);
  // SEC-20: state for the "Repair role setup" action shown when an import
  // committed but its RBAC seeding did not finish.
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [showBillHistory, setShowBillHistory] = useState(false);
  const [billHistoryDone, setBillHistoryDone] = useState(false);
  const [ackWarnings, setAckWarnings] = useState(false);
  const shellRef = useRef(null);
  const scrimRef = useRef(null);
  const fileInputRef = useRef(null);

  // ── Entrance morph ─────────────────────────────────────────────────────
  // transform + opacity only.
  useEffect(() => {
    if (!open || !shellRef.current) return;
    const shell = shellRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      gsap.set(shell, { opacity: 1, scale: 1, y: 0 });
      return;
    }
    const tl = gsap.timeline();
    gsap.set(scrimRef.current, { opacity: 0 });
    gsap.set(shell, { opacity: 0, scaleX: 0.86, scaleY: 0.6, y: 28 });
    tl.to(scrimRef.current, { opacity: 1, duration: 0.18, ease: "none" }, 0)
      .to(shell, { opacity: 1, duration: 0.14, ease: "none" }, 0)
      .to(shell, { scaleX: 1, duration: 0.42, ease: "power3.out" }, 0)
      .to(shell, { scaleY: 1, y: 0, duration: 0.5, ease: "back.out(1.2)" }, 0.12)
      .to(
        shell.querySelectorAll("[data-stagger]"),
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: { amount: 0.2 } },
        0.3,
      )
      .set(shell, { clearProps: "transform" });
    return () => tl.kill();
  }, [open]);

  // ── Preview: parses + runs every check (including DB reads), writes
  //    nothing. Every row's status comes back at once; the "live" feel
  //    below is a staged reveal of an already-complete result, not a
  //    server that's still checking — nothing here is hidden or delayed
  //    on the server side.
  const previewFile = useCallback(async (file) => {
    setStage("previewing");
    setPreviewError(null);
    setPreviewResult(null);
    setRevealedCount(0);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/admin/bulk-import/preview", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok && json.fatalError) {
        setPreviewError(json.fatalError);
        setStage("idle");
        return;
      }
      setPreviewResult(json);
      setStage("reviewing");
    } catch (err) {
      setPreviewError(err.message || "Could not reach the server.");
      setStage("idle");
    }
  }, []);

  // Staged reveal of the (already complete) preview result — total time is
  // constant regardless of row count, never so fast a small sheet just
  // flashes, never so slow a big one drags.
  useEffect(() => {
    if (stage !== "reviewing" || !previewResult) return;
    const total = previewResult.memberRows?.length || 0;
    setRevealedCount(0);
    if (total === 0) return;
    let i = 0;
    const stepMs = Math.max(12, Math.min(70, 1100 / total));
    const id = setInterval(() => {
      i += 1;
      setRevealedCount(i);
      if (i >= total) clearInterval(id);
    }, stepMs);
    return () => clearInterval(id);
  }, [stage, previewResult]);

  const revealDone = !previewResult || revealedCount >= (previewResult.memberRows?.length || 0);

  // ── Commit: uses the previewId the reviewed result already carries.
  //    Never re-uploads the file, never re-runs a DB check — everything
  //    here was already confirmed by preview. A retry after a mid-import
  //    failure calls this again with the SAME previewId (new importRunId,
  //    so the run itself isn't treated as a duplicate) rather than sending
  //    the admin back to re-validate from scratch.
  const commitPreview = useCallback(async () => {
    if (!previewResult?.previewId || submitting) return;
    setSubmitting(true);
    setServerResult(null);
    setStage("importing");

    const runId = crypto.randomUUID();

    const poll = setInterval(async () => {
      try {
        const r = await fetch(
          `/api/admin/bulk-import/status?importRunId=${runId}`,
          { credentials: "include" },
        );
        if (r.ok) setProgress(await r.json());
      } catch { /* transient; next tick retries */ }
    }, 1200);

    try {
      const formData = new FormData();
      formData.append("previewId", previewResult.previewId);
      formData.append("importRunId", runId);
      const res = await fetch("/api/admin/bulk-import", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const json = await res.json();
      setServerResult({ ok: res.ok, ...json });
      if (res.ok && json.success) onImported?.(json);
    } catch (err) {
      setServerResult({ ok: false, error: err.message });
    } finally {
      clearInterval(poll);
      setSubmitting(false);
      // Stops at "importing" otherwise — nothing else moves it off that
      // stage on completion. Harmless on its own (the progress panel is now
      // gated on !serverResult too, see below), but leaving stage stuck
      // wrong is a trap for the next person who branches on it.
      setStage("done");
    }
  }, [previewResult, submitting, onImported]);

  const downloadTemplate = useCallback(async () => {
    const res = await fetch("/api/admin/bulk-import/template", { credentials: "include" });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "BulkImport_Template.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const reset = useCallback(() => {
    setStage("idle");
    setPreviewResult(null);
    setPreviewError(null);
    setServerResult(null);
    setRevealedCount(0);
    setAckWarnings(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === "Escape" && !submitting) onClose?.();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, submitting, onClose]);

  const summary = previewResult?.summary || { total: 0, ok: 0, warning: 0, error: 0 };
  const societyHasErrors = (previewResult?.society?.errors?.length || 0) > 0;
  const canImport =
    stage === "reviewing" &&
    revealDone &&
    previewResult?.ok &&
    !societyHasErrors &&
    (summary.warning === 0 || ackWarnings);

  if (!open) return null;

  // Portaled to document.body: app/superadmin pages wrap their content in
  // .contentFrame, which sets backdrop-filter (styles/SuperAdminLayout.module.css).
  // A filter (like transform) on an ancestor makes it the containing block for
  // any position:fixed descendant — so without the portal this overlay was
  // clipped to .contentFrame's box instead of covering the real viewport, and
  // sat under the sidebar's z-index instead of over it.
  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div ref={scrimRef} className={styles.scrim} onClick={() => !submitting && onClose?.()} />

      <div ref={shellRef} className={styles.shell}>
        {/* Header */}
        <header className={styles.header} data-stagger>
          <div>
            <h2 className={styles.title}>Import a society</h2>
            <p className={styles.subtitle}>
              Download the template, fill all 7 sheets in Excel, upload it back here. Every check
              — including the database ones — runs before anything is created, and you see every
              row's result before you commit to it.
            </p>
          </div>
          {stage === "idle" && !submitting && (
            <div className={styles.sheetActions}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ""; // allow re-selecting the same file after a fix
                  if (f) previewFile(f);
                }}
              />
              <button className={styles.ghostBtn} onClick={downloadTemplate}>
                <Download size={14} /> Download template
              </button>
              <button
                className={styles.ghostBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                <ClipboardPaste size={14} /> Upload filled Excel (.xlsx)
              </button>
            </div>
          )}
          {stage === "reviewing" && !submitting && (
            <div className={styles.sheetActions}>
              <button className={styles.ghostBtn} onClick={reset}>
                Try a different file
              </button>
            </div>
          )}
          <button className={styles.iconBtn} onClick={onClose} disabled={submitting} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className={styles.body} data-stagger>
          {stage === "idle" && !serverResult && (
            <div className={styles.centerState}>
              {previewError ? (
                <>
                  <AlertTriangle size={22} className={styles.errIcon} />
                  <p>{previewError}</p>
                </>
              ) : (
                <p>
                  No file uploaded yet. Download the template above if you don't have one, fill it
                  in Excel, then use Upload — you'll see a full review before anything is created.
                </p>
              )}
            </div>
          )}

          {stage === "previewing" && (
            <div className={styles.centerState}>
              <PulseLoader size={30} />
              <p>Checking every sheet — society details, all flats, every email against the database…</p>
            </div>
          )}

          {stage === "reviewing" && previewResult && (
            <div className={styles.reviewBody}>
              {/* Society */}
              <div className={`${styles.summaryCard} ${societyHasErrors ? styles.summaryCardErr : ""}`}>
                <div className={styles.summaryHead}>
                  {societyHasErrors ? <AlertTriangle size={15} /> : <Building2 size={15} />}
                  Society — {previewResult.society?.name || "(unnamed)"}
                </div>
                <p className={styles.summaryMeta}>
                  Admin: {previewResult.society?.adminName} · {previewResult.society?.adminEmail}
                </p>
                {previewResult.society?.errors?.map((e, i) => (
                  <div key={i} className={`${styles.summaryLine} ${styles.summaryLineErr}`}>{e}</div>
                ))}
                {previewResult.society?.advisories?.map((a, i) => (
                  <div key={i} className={`${styles.summaryLine} ${styles.summaryLineWarn}`}>{a}</div>
                ))}
              </div>

              {previewResult.warnings?.length > 0 && (
                <div className={styles.warningBanner}>
                  {previewResult.warnings.map((w, i) => (
                    <div key={i}>{w}</div>
                  ))}
                </div>
              )}

              {/* Member rows — staged reveal, colored by status */}
              <div className={styles.memberListHead}>
                <span>Flats ({summary.total})</span>
                <span className={styles.memberListCount}>
                  {summary.ok} ready, {summary.warning} note{summary.warning === 1 ? "" : "s"}, {summary.error} need fixing
                </span>
              </div>
              <div className={styles.memberList}>
                {(previewResult.memberRows || []).slice(0, revealedCount).map((r, i) => (
                  <div key={i} className={`${styles.memberRow} ${ROW_CLASS[r.status] || ""}`}>
                    <span className={styles.memberRowIcon}>
                      {r.status === "ok" && <CheckCircle2 size={14} color={ROW_COLOR.ok} />}
                      {r.status === "warning" && <AlertTriangle size={14} color={ROW_COLOR.warning} />}
                      {r.status === "error" && <AlertTriangle size={14} color={ROW_COLOR.error} />}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span className={styles.memberRowFlat}>
                        {r.wing ? `${r.wing}-${r.flatNo}` : r.flatNo || `Row ${r.rowNum}`}
                      </span>
                      {r.ownerName && <span className={styles.memberRowOwner}> · {r.ownerName}</span>}
                      {r.messages?.length > 0 && (
                        <div className={`${styles.memberRowMsg} ${r.status === "error" ? styles.memberRowMsgErr : ""}`}>
                          {r.messages.join("; ")}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {!revealDone && (
                  <div className={styles.checkingRow}>checking… {revealedCount}/{summary.total}</div>
                )}
              </div>

              {revealDone && summary.warning > 0 && !societyHasErrors && (
                <label className={styles.ackRow}>
                  <input
                    type="checkbox"
                    checked={ackWarnings}
                    onChange={(e) => setAckWarnings(e.target.checked)}
                  />
                  <span>
                    I reviewed the {summary.warning} note{summary.warning === 1 ? "" : "s"} above — including any
                    "existing account linked" flats, which reuse a login that already exists instead of creating one.
                  </span>
                </label>
              )}

              <div className={styles.reviewFooter}>
                {!canImport && revealDone && (previewResult?.ok === false || societyHasErrors) && (
                  <span className={styles.reviewFooterHint}>
                    Fix the errors above (in Excel) and upload again to import.
                  </span>
                )}
                {!canImport && revealDone && previewResult?.ok && !societyHasErrors && summary.warning > 0 && !ackWarnings && (
                  <span className={`${styles.reviewFooterHint} ${styles.reviewFooterHintWarn}`}>
                    Check the box above to confirm you've seen the notes.
                  </span>
                )}
                <button className={styles.submitBtn} onClick={commitPreview} disabled={!canImport}>
                  {revealDone ? `Import ${summary.ok + summary.warning} flat${summary.ok + summary.warning === 1 ? "" : "s"}` : "Checking…"}
                </button>
              </div>
            </div>
          )}

          {/* Live progress — real server stages, polled from BulkImportRun */}
          {stage === "importing" && !serverResult && (
            <div className={styles.progressBody}>
              <div className={styles.progressHead}>
                Importing {progress?.totalCount ? `${progress.processedCount ?? 0} / ${progress.totalCount} flats` : "…"}
              </div>
              {[
                { key: "VALIDATING", label: "Loading the reviewed preview", Icon: Search },
                { key: "IMPORTING", label: "Creating society, admin and flats", Icon: Building2 },
                { key: "FINALIZING", label: "Billing heads and current month bills", Icon: ClipboardList },
                { key: "COMMITTED", label: "Committing the transaction", Icon: Lock },
                { key: "EMAIL_QUEUED", label: "Queueing onboarding emails", Icon: Mail },
                { key: "COMPLETED", label: "Done", Icon: CheckCircle2 },
              ].map((s, i, arr) => {
                const now = arr.findIndex((x) => x.key === progress?.status);
                const done = now > i;
                const active = now === i;
                const StepIcon = done ? CheckCircle2 : s.Icon;
                return (
                  <div
                    key={s.key}
                    className={`${styles.progressStep} ${done ? styles.progressStepDone : ""} ${active ? styles.progressStepActive : ""}`}
                  >
                    <span className={styles.progressStepIcon}>
                      <StepIcon size={16} />
                    </span>
                    <div className={styles.progressStepLabel}>
                      {progress?.stage && active ? progress.stage : s.label}
                    </div>
                    {done && <div className={styles.progressStepStatus}>Done</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Commit rejection — retry reuses the same previewId, no re-check */}
          {serverResult && !serverResult.success && (
            <div className={styles.serverErr}>
              <AlertTriangle size={16} />
              <div>
                <strong>The import failed partway through.</strong>
                <ul>
                  {(serverResult.errors || [serverResult.error || "Unknown error"])
                    .slice(0, 12)
                    .map((e, i) => (
                      <li key={i}>{typeof e === "string" ? e : e.label}</li>
                    ))}
                </ul>
                {serverResult.code !== "PREVIEW_NOT_FOUND" && serverResult.code !== "PREVIEW_ALREADY_USED" && previewResult?.previewId && (
                  <button className={styles.submitBtn} style={{ marginTop: 10 }} onClick={commitPreview}>
                    Retry import (uses the same reviewed data — nothing re-checked)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Success */}
          {serverResult?.success && (
            <div className={styles.resultStack}>
              {/* SEC-20: the society, members and bills are real, but role
                  seeding did not finish — which means the admin cannot sign in
                  at all. Shown ABOVE the success card, because an unqualified
                  "Import Successful" over a society nobody can log into is the
                  exact failure this whole change exists to stop. */}
              {serverResult.rbacRepairNeeded && (
                <div className={`${styles.resultCard} ${styles.resultCardWarn}`}>
                  <div className={styles.resultTitle}>
                    <AlertTriangle size={16} /> Role setup did not complete
                  </div>
                  <div className={styles.resultRows}>
                    <div>
                      The society, its members and its bills were created. But the admin
                      <strong> cannot sign in yet</strong> — this society has no role setup.
                    </div>
                    {serverResult.rbacRepairReason && (
                      <div className={styles.summaryLineWarn}>{serverResult.rbacRepairReason}</div>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <button
                        className={styles.linkBtn}
                        disabled={repairing}
                        onClick={async () => {
                          setRepairing(true);
                          try {
                            const res = await fetch("/api/admin/bulk-import/repair-rbac", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                              body: JSON.stringify({ importRunId: serverResult.importRunId }),
                            });
                            const data = await res.json();
                            if (res.ok && data.success) {
                              // Clear the banner rather than reload — the rest
                              // of the result is still accurate.
                              setServerResult((r) => ({ ...r, rbacRepairNeeded: false }));
                            } else {
                              setRepairError(data.error || "Repair failed");
                            }
                          } catch (err) {
                            setRepairError(err.message);
                          } finally {
                            setRepairing(false);
                          }
                        }}
                      >
                        {repairing ? "Repairing…" : "Repair role setup"}
                      </button>
                      {repairError && (
                        <div className={styles.summaryLineWarn} style={{ marginTop: 6 }}>
                          {repairError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className={`${styles.resultCard} ${styles.resultCardOk}`}>
                <div className={styles.resultTitle}>
                  <CheckCircle2 size={16} /> Import Successful
                </div>
                <div className={styles.resultRows}>
                  <div><strong>Society:</strong> {serverResult.society?.name} ({serverResult.society?.societyId})</div>
                  <div><strong>Members imported:</strong> {serverResult.membersCreated} / {serverResult.totalMemberRows}</div>
                  <div>
                    <strong>Billing heads:</strong>{" "}
                    {serverResult.billingHeadsCreated > 0
                      ? `${serverResult.billingHeadsCreated} heads created`
                      : <span className={styles.summaryLineWarn}>None — rates were 0</span>}
                  </div>
                  <div>
                    <strong>Bills generated:</strong>{" "}
                    {serverResult.billsGenerated > 0
                      ? `${serverResult.billsGenerated} bills for ${serverResult.billPeriod}`
                      : <span className={styles.summaryLineWarn}>0</span>}
                  </div>
                  {serverResult.society?.chargesSummary?.length > 0 && (
                    <div className={styles.resultCharges}>
                      {serverResult.society.chargesSummary.map((c, i) => (
                        <div key={i}>{c}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={`${styles.resultCard} ${styles.resultCardAccent}`}>
                <div className={styles.resultTitle}>
                  <KeyRound size={16} /> Admin Credentials
                </div>
                <div className={styles.resultRows}>
                  <div><strong>Name:</strong> {serverResult.admin?.name}</div>
                  <div><strong>Email:</strong> {serverResult.admin?.email}</div>
                  {serverResult.admin?.reusedExistingAccount ? (
                    <div className={styles.summaryLineWarn}>
                      {serverResult.admin.note || "This email already had a login — no new password was created. They sign in as before; this society now appears in their profile picker."}
                    </div>
                  ) : (
                    // SEC-19: this used to print the generated admin password
                    // and call it the only copy. That display WAS the delivery
                    // mechanism, which is why the plaintext existed. The admin
                    // now receives the same setup link every new member gets
                    // and picks their own password; the link below is a
                    // fallback for when email delivery fails.
                    <div className={styles.credentialLine}>
                      <strong>Setup link:</strong>
                      {serverResult.admin?.setCredentialsUrl ? (
                        <>
                          <button
                            className={styles.linkBtn}
                            onClick={() => navigator.clipboard.writeText(serverResult.admin.setCredentialsUrl)}
                          >Copy link</button>
                          <span className={styles.credentialFlag}>
                            Emailed to them. Valid 7 days. Single use — don&apos;t post it in a group.
                          </span>
                        </>
                      ) : (
                        <span className={styles.credentialFlag}>
                          Emailed to them. Valid 7 days.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {serverResult.memberCredentials?.length > 0 && (
                <div className={`${styles.resultCard} ${styles.resultCardAccent}`}>
                  <div className={styles.resultTitle}>
                    <Users size={16} /> Members ({serverResult.memberCredentials.length})
                  </div>
                  <div className={`${styles.tableScroll} ${styles.membersTableWrap}`}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Flat</th>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Account</th>
                          <th>Setup Link</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serverResult.memberCredentials.map((c, i) => (
                          <tr key={i}>
                            <td style={{ padding: "6px 8px" }}>{c.wing}-{c.flatNo}</td>
                            <td style={{ padding: "6px 8px" }}>{c.ownerName}</td>
                            <td style={{ padding: "6px 8px" }}>{c.email || <span style={{ color: "var(--fg-4)" }}>none</span>}</td>
                            <td style={{ padding: "6px 8px" }}>
                              {c.isNewUser
                                ? <span className={styles.accountOk}>new login created</span>
                                : <span className={styles.accountWarn}>existing account linked</span>}
                            </td>
                            <td style={{ padding: "6px 8px" }}>
                              {c.setCredentialsUrl ? (
                                <button
                                  className={styles.linkBtn}
                                  onClick={() => navigator.clipboard.writeText(c.setCredentialsUrl)}
                                >Copy link</button>
                              ) : <span style={{ color: "var(--fg-4)" }}>—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {serverResult.warnings?.length > 0 && (
                <div className={`${styles.resultCard} ${styles.resultCardWarn}`}>
                  <div className={styles.resultTitle}>
                    <AlertTriangle size={16} /> {serverResult.warnings.length} Warning{serverResult.warnings.length > 1 ? "s" : ""}
                  </div>
                  <div className={styles.resultList}>
                    {serverResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                  </div>
                </div>
              )}

              {serverResult.billErrors?.length > 0 && (
                <div className={`${styles.resultCard} ${styles.resultCardWarn}`}>
                  <div className={styles.resultTitle}>
                    <AlertTriangle size={16} /> {serverResult.billErrors.length} bill(s) failed to generate
                  </div>
                  <div className={styles.resultList}>
                    {serverResult.billErrors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </div>
              )}

              {serverResult.memberCreateErrors?.length > 0 && (
                <div className={`${styles.resultCard} ${styles.resultCardErr}`}>
                  <div className={styles.resultTitle}>
                    <XCircle size={16} /> {serverResult.memberCreateErrors.length} member(s) failed
                  </div>
                  <div className={styles.resultList}>
                    {serverResult.memberCreateErrors.map((e, i) => <div key={i}>{e.flat}: {e.error}</div>)}
                  </div>
                </div>
              )}

              {serverResult.onboardingEmailErrors?.length > 0 && (
                <div className={`${styles.resultCard} ${styles.resultCardErr}`}>
                  <div className={styles.resultTitle}>
                    <AlertTriangle size={16} /> {serverResult.onboardingEmailErrors.length} onboarding email(s) failed to send
                  </div>
                  <div className={styles.summaryMeta} style={{ color: "var(--danger-fg)", marginBottom: 6 }}>
                    Everything was created, but these members won't get their link by mail — use the Copy link column or the export below.
                  </div>
                  <div className={styles.resultList}>
                    {serverResult.onboardingEmailErrors.map((e, i) => <div key={i}>{e}</div>)}
                  </div>
                </div>
              )}

              {serverResult.memberCredentials?.length > 0 && (
                <button
                  className={styles.downloadBtn}
                  onClick={async () => {
                    const res = await fetch("/api/members/download-credentials", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ credentials: serverResult.memberCredentials }),
                    });
                    if (!res.ok) { notify.error("Download failed"); return; }
                    const url = URL.createObjectURL(await res.blob());
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `Member_Credentials_${Date.now()}.xlsx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download size={15} /> Download Member Credentials ({serverResult.memberCredentials.length} members)
                </button>
              )}

              {BillHistoryStep && !showBillHistory && !billHistoryDone && (
                <div className={`${styles.resultCard} ${styles.resultCardAccent}`}>
                  <div className={styles.resultTitle}>
                    <History size={16} /> Step 4: Import Bill History (Recommended)
                  </div>
                  <p className={styles.summaryMeta} style={{ marginBottom: 10 }}>
                    Historical bills from the previous April up to the month before {serverResult.society?.name} joined. Required for correct opening balances and audit reports.
                  </p>
                  <button className={styles.submitBtn} onClick={() => setShowBillHistory(true)}>
                    Start Bill History Import <ArrowRight size={14} />
                  </button>
                </div>
              )}

              {BillHistoryStep && showBillHistory && !billHistoryDone && (
                <div className={styles.resultCard}>
                  <BillHistoryStep
                    societyId={serverResult.society?.id}
                    societyName={serverResult.society?.name || ""}
                    joinPeriodId={serverResult.billPeriod || ""}
                    interestRate={21}
                    onComplete={() => setBillHistoryDone(true)}
                    onSkip={() => { setShowBillHistory(false); setBillHistoryDone(true); }}
                  />
                </div>
              )}

              {billHistoryDone && (
                <div className={styles.doneBadge}>
                  <CheckCircle2 size={15} /> Bill History step complete
                </div>
              )}

              <button className={styles.closeBtn} onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      </div>
      <style jsx global>{`
        @keyframes bulkImportRowIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
