"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import notify from "@/lib/notify";

// Mismatch values are canonical JSON of whole subdocuments — a full
// tenantHistory[] would push everything else off screen.
const clip = (v, max = 220) => {
  const s = String(v ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const num = (n) => Number(n || 0).toLocaleString("en-IN");

// diffManifests emits a status per change rather than a before/after pair —
// there is no before/after to emit, by design. These are those statuses in
// words an operator can act on.
const CHANGE_TEXT = {
  changed: "value changed since the handover",
  "field-added": "field gained a value",
  "field-removed": "field lost its value",
  "field-name-added": "new field appeared on this collection",
  "field-name-removed": "field disappeared from this collection",
  "document-added": "record created since the handover",
  "document-removed": "record deleted since the handover",
  "document-changed": "record changed since the handover",
  "collection-added": "whole collection appeared since the handover",
  "collection-removed": "whole collection disappeared since the handover",
};

const STATUS = {
  ok: { icon: "✓", color: "var(--success-fg)", bg: "var(--success-bg)", text: "match" },
  mismatch: { icon: "✕", color: "var(--danger-fg)", bg: "var(--danger-bg)", text: "differs" },
  empty: { icon: "–", color: "var(--fg-4)", bg: "transparent", text: "no data" },
  skipped: { icon: "◌", color: "var(--warning-fg)", bg: "transparent", text: "not checked" },
};

const cellStyle = { padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
const headStyle = { ...cellStyle, textAlign: "left", color: "var(--fg-4)", fontWeight: 600, position: "sticky", top: 0, background: "var(--bg-sunken)" };

// The account of what verification actually compared. Shown on BOTH outcomes:
// green means "here is everything I checked", red means "here is the row that
// differs and what it differs by" — never a bare tick or a bare failure.
function VerifyReport({ report, mismatches = [], mismatchCount = 0 }) {
  if (!report) return null;
  const { sections = [], skipped = [], totals = {} } = report;
  const failing = sections.filter((s) => s.status === "mismatch");
  const byCollection = mismatches.reduce((acc, m) => {
    (acc[m.collection] ||= []).push(m);
    return acc;
  }, {});

  return (
    <div style={{ marginTop: "1rem" }}>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
        {[
          ["Collections compared", num(totals.collections)],
          ["Documents compared", num(totals.documents)],
          ["Fields compared", num(totals.fields)],
          ["Differences", num(totals.mismatches)],
        ].map(([label, value], i) => (
          <div
            key={label}
            style={{
              flex: "1 1 130px",
              background: "var(--bg-surface)",
              border: `1px solid ${i === 3 && totals.mismatches ? "var(--danger-fg)" : "var(--border)"}`,
              borderRadius: 8,
              padding: "0.55rem 0.7rem",
            }}
          >
            <div style={{ fontSize: "1.15rem", fontWeight: 700, color: i === 3 && totals.mismatches ? "var(--danger)" : "var(--fg-1)" }}>
              {value}
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
          <thead>
            <tr>
              <th style={headStyle}>Collection</th>
              <th style={{ ...headStyle, textAlign: "right" }}>At handover</th>
              <th style={{ ...headStyle, textAlign: "right" }}>Live now</th>
              <th style={{ ...headStyle, textAlign: "right" }}>Fields</th>
              <th style={headStyle}>Result</th>
            </tr>
          </thead>
          <tbody>
            {[...sections, ...skipped].map((s) => {
              const st = STATUS[s.status] || STATUS.empty;
              return (
                <tr key={`${s.status}-${s.key}`} style={{ background: st.bg }}>
                  <td style={{ ...cellStyle, color: "var(--fg-1)" }}>{s.label}</td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "var(--fg-2)" }}>{num(s.inFile)}</td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "var(--fg-2)" }}>{num(s.inDatabase)}</td>
                  <td style={{ ...cellStyle, textAlign: "right", color: "var(--fg-3)" }}>{s.fieldsCompared ? num(s.fieldsCompared) : "—"}</td>
                  <td style={{ ...cellStyle, color: st.color, fontWeight: 600 }}>
                    {st.icon} {s.status === "mismatch" ? `${num(s.mismatches)} ${s.mismatches === 1 ? "difference" : "differences"}` : st.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {skipped.length > 0 && (
        <p style={{ fontSize: "0.72rem", color: "var(--fg-4)", marginTop: "0.5rem", lineHeight: 1.5 }}>
          ◌ {skipped.length} log/notification collection{skipped.length === 1 ? " is" : "s are"} exported but not compared
          ({num(totals.skippedDocuments)} records) — they write themselves in the background, so a difference there means
          nothing. Everything else above was compared field by field.
        </p>
      )}

      {failing.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ color: "var(--danger)", fontWeight: 700, fontSize: "0.82rem", marginBottom: "0.5rem" }}>
            {num(mismatchCount)} difference{mismatchCount === 1 ? "" : "s"} — cannot proceed
            {mismatchCount > mismatches.length ? ` (first ${num(mismatches.length)} shown)` : ""}
          </div>
          {failing.map((s) => (
            <div key={s.key} style={{ marginBottom: "0.9rem" }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--danger-fg)", marginBottom: 4 }}>
                {s.label} — {num(s.mismatches)} of {num(s.fieldsCompared)} fields differ
              </div>
              <div style={{ border: "1px solid var(--danger-fg)", borderRadius: 6, maxHeight: 240, overflowY: "auto" }}>
                {(byCollection[s.key] || []).map((m, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "0.5rem 0.6rem",
                      borderBottom: "1px solid var(--border)",
                      fontFamily: "monospace",
                      fontSize: "0.72rem",
                      lineHeight: 1.5,
                    }}
                  >
                    <div style={{ color: "var(--fg-3)" }}>
                      {m.id || "—"}
                      {m.field ? (
                        <>
                          {" · "}
                          <b style={{ color: "var(--fg-1)" }}>{m.field}</b>
                        </>
                      ) : null}
                    </div>
                    <div style={{ color: "var(--danger-fg)" }}>{CHANGE_TEXT[m.status] || m.status}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {/* Deliberately no before/after values: the manifest stores salted
              digests, not data, so we genuinely cannot show what changed —
              only that it did, and where. That is the trade that lets this
              check run without anyone holding a copy of the society. */}
          <p style={{ fontSize: "0.75rem", color: "var(--fg-4)", lineHeight: 1.5, marginBottom: "0.5rem" }}>
            The old and new values are not shown because they are not kept — only salted fingerprints are, which
            is what lets this comparison happen without a copy of the data existing anywhere.
          </p>
          <p style={{ fontSize: "0.75rem", color: "var(--fg-3)", lineHeight: 1.5 }}>
            This society&apos;s data changed after the handover was certified, so the copy the society holds is now
            out of date. Go back to step 1, resend the handover, and verify again.
          </p>
        </div>
      )}
    </div>
  );
}

// LOOP-05 delete wizard.
//
// Step 1: hand the society its own complete copy — emailed to its registered
//         address, downloaded by them, verified in their browser. No file
//         reaches the operator (C1). A recorded break-glass export remains for
//         regulator demands and investigations.
// Step 2: verify that the live database still matches what was certified at
//         handover time. A manifest diff, so nothing is uploaded and nothing
//         is downloaded (C2); field-level precision survives, values do not
//         exist to show.
// Step 3 (only unlocked after a clean verify): Pause / Pause until / Delete
//         until (soft-delete + scheduled purge, restorable up to that date)
//         / Delete permanently.
export default function DeleteWizard({ society, onClose, onDone }) {
  const [step, setStep] = useState(1);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [downloaded, setDownloaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null); // { ok, mismatches, mismatchCount }
  const [verificationToken, setVerificationToken] = useState(null);
  const [untilDate, setUntilDate] = useState("");
  const [error, setError] = useState(null);
  // One timestamp for both downloads, so the .json and .xlsx of a single
  // export sit next to each other under the same name.
  const [stamp] = useState(() => Date.now());
  // Phase 3: the society's own copy. Loaded on entry to step 3 and refreshed
  // after every action that can change it, so "Delete until date" is never
  // pressed without the operator seeing whether the society has actually
  // collected anything.
  const [handover, setHandover] = useState(null);
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [actionResult, setActionResult] = useState(null);
  const [sentHandover, setSentHandover] = useState(null);
  // Server-supplied, because the floor and ceiling are env-configurable and
  // the lifecycle route re-checks them regardless of what the picker allows.
  const [bounds, setBounds] = useState(null);

  const loadHandover = useCallback(async () => {
    try {
      const res = await fetch(`/api/superadmin/societies/${society._id}/handover`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setHandover((data.handovers || [])[0] || null);
    } catch {
      // A missing handover panel must never block the delete flow.
    }
  }, [society._id]);

  useEffect(() => {
    if (step === 3) loadHandover();
  }, [step, loadHandover]);

  async function sendHandover() {
    setHandoverBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/superadmin/societies/${society._id}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notify: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not build the handover");
      setActionResult({
        kind: "handover",
        text: data.recipients?.length
          ? `Handover built and emailed to ${data.recipients.join(", ")} — ${num(data.counts?.documents)} records.`
          : data.warning,
        tone: data.recipients?.length ? "ok" : "warn",
      });
      await loadHandover();
    } catch (e) {
      setError(e.message);
    } finally {
      setHandoverBusy(false);
    }
  }

  async function waiveHandover() {
    const reason = await notify.prompt?.("Why can this society not collect its own records? This is recorded in the purge audit trail.");
    if (!reason || reason.trim().length < 10) {
      setError("A written reason of at least 10 characters is required to waive the handover.");
      return;
    }
    setHandoverBusy(true);
    try {
      const res = await fetch(`/api/superadmin/societies/${society._id}/handover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ waive: true, reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not record the waiver");
      setActionResult({ kind: "waive", tone: "warn", text: `Handover waived: ${reason}` });
    } catch (e) {
      setError(e.message);
    } finally {
      setHandoverBusy(false);
    }
  }

  // Step 1 is no longer a download. The society receives its own copy; the
  // operator receives a receipt — counts, digests, and who it went to. See
  // app/api/superadmin/societies/[id]/handover.
  async function handleSendHandover(override = null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/superadmin/societies/${society._id}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ notify: true, ...(override || {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not build the handover");
      setSentHandover(data);
      await loadHandover();

      // The dead end this replaces: the handover was built, nobody was told,
      // the wizard advanced to step 2 anyway, and the operator found out weeks
      // later when purge gate 6 would not clear. Ask now, while the person who
      // can answer is still looking at the screen.
      if (data.needsRecipient) {
        await promptForRecipient();
        return;
      }
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // No address on file. handoverRecipients() has no platform fallback on
  // purpose — a handover addressed to us defeats its own purpose — so the only
  // way out is a human supplying one.
  async function promptForRecipient() {
    const address = await notify.prompt(
      `${society.name} has no email address on record, so nobody has been told their records are ready.\n\n` +
        "Enter an address to send it to — a committee member, the outgoing secretary, whoever you have actually spoken to. " +
        "Separate several with commas.",
    );
    if (!address || !address.includes("@")) {
      setError(
        "No address given. The handover is built and recorded, but nobody has been told — this society cannot be purged until somebody collects it.",
      );
      return;
    }

    const reason = await notify.prompt(
      "How did you get this address, and who confirmed it is right?\n\n" +
        "This is recorded permanently against your name, because sending a society's complete records to an address that is not on their own record is a judgement somebody has to own.",
    );
    if (!reason || reason.trim().length < 10) {
      setError("A written reason of at least 10 characters is required to send to a supplied address.");
      return;
    }

    await handleSendHandover({
      overrideRecipients: address.split(",").map((s) => s.trim()),
      overrideReason: reason.trim(),
    });
  }

  // The break-glass path: a copy on the operator's own machine. Deliberately
  // awkward, deliberately recorded. Not part of the normal flow.
  async function breakGlassExport() {
    const reason = await notify.prompt(
      "This downloads a complete copy of this society's personal data onto YOUR machine, recorded permanently against your name. " +
        "The normal handover sends the society its own copy and needs no file here.\n\nWhy is that not sufficient?",
    );
    if (!reason || reason.trim().length < 20) {
      setError("A written reason of at least 20 characters is required for a break-glass export.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const [format, ext] of [["json", "json"], ["xlsx", "xlsx"]]) {
        const query = `?reason=${encodeURIComponent(reason)}${format === "xlsx" ? "&format=xlsx" : ""}`;
        const res = await fetch(`/api/superadmin/societies/${society._id}/export${query}`, { credentials: "include" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || data.error || `${ext.toUpperCase()} export failed`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `society-export-${society.societyId || society._id}-${stamp}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setDownloaded(true);
      setActionResult({
        kind: "break-glass",
        tone: "warn",
        text: "Break-glass export downloaded and recorded in the audit trail. Delete it from your machine once you are done with it.",
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Step 2 sends nothing and receives no data. The server rebuilds the live
  // manifest with the handover's stored salt and diffs it against the one
  // certified at handover time — field-level precision, zero payload.
  async function handleVerify() {
    setBusy(true);
    setError(null);
    setVerifyResult(null);
    try {
      const res = await fetch(`/api/superadmin/societies/${society._id}/verify-export`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok && !("ok" in data)) throw new Error(data.detail || data.error || "Verification failed");
      setVerifyResult(data);
      if (data.ok) {
        setVerificationToken(data.verificationToken);
        if (data.graceBounds) {
          setBounds(data.graceBounds);
          if (!untilDate) setUntilDate(String(data.graceBounds.suggested).slice(0, 10));
        }
        setStep(3);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // C4. Two keys, not one: a written reason always, plus a separate explicit
  // acknowledgement in the one case that cannot be undone or apologised for —
  // erasing a society that never received a copy of its own records.
  async function deletePermanently() {
    const reason = await notify.prompt(
      `Permanently delete "${society.name}" and ALL its data right now?\n\nNo grace window, no restore, no notice to members. Why can this not go through the scheduled path?`,
    );
    if (!reason || reason.trim().length < 20) {
      setError("Immediate deletion needs a written reason of at least 20 characters.");
      return;
    }

    let acknowledgeNoHandover = false;
    // Ask the server first without the acknowledgement. If the society has in
    // fact collected its records, the operator is never shown a warning that
    // does not apply to them — and if it has not, the warning names the real
    // consequence rather than a generic one.
    const res = await fetch(`/api/superadmin/societies/${society._id}/lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action: "delete-permanently", verificationToken, breakGlassReason: reason }),
    });
    const data = await res.json();

    if (res.ok) {
      onDone?.("delete-permanently", data);
      return;
    }
    if (data.code !== "NO_HANDOVER_COLLECTED") {
      setError(data.detail || data.error || "Action failed");
      return;
    }

    acknowledgeNoHandover = await notify.confirm(
      [
        `${society.name} has never collected a copy of its records.`,
        "",
        "Deleting now destroys the only copy that exists. Nobody at the society will be able to produce a bill, a receipt, or a dues certificate afterwards — from us or from anywhere.",
        "",
        "Proceed anyway?",
      ].join("\n"),
      { tone: "danger", confirmLabel: "Erase without handover" },
    );
    if (!acknowledgeNoHandover) return;

    runLifecycleAction("delete-permanently", { breakGlassReason: reason, acknowledgeNoHandover: true });
  }

  async function runLifecycleAction(action, extra = {}) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/superadmin/societies/${society._id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action, verificationToken, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      // delete-until does three things beyond the soft delete itself, any of
      // which can partially fail without failing the request. Reporting them
      // here is the only place the operator finds out.
      if (action === "delete-until") {
        const bits = [];
        if (data.handover?.recipients?.length) {
          bits.push(`records emailed to ${data.handover.recipients.join(", ")}`);
        } else if (data.handoverError) {
          bits.push(`handover FAILED: ${data.handoverError}`);
        } else {
          bits.push("no registered society address — nobody was told the records are ready");
        }
        if (data.memberNotice) {
          bits.push(`${num(data.memberNotice.sent)} of ${num(data.memberNotice.attempted)} members notified`);
        }
        setActionResult({
          kind: "delete-until",
          tone: data.handover?.recipients?.length ? "ok" : "warn",
          text: `Scheduled for ${new Date(data.purgeScheduledFor).toLocaleDateString("en-IN")} — ${bits.join("; ")}.`,
        });
        await loadHandover();
      }
      onDone?.(action, data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const btn = (bg) => ({
    background: bg,
    // Literal white, not var(--bg-surface) — this is button text on a
    // colored (primary/danger/warning) background, not a page surface, so it
    // must not flip dark in dark mode (see DashboardLayout.js's white-on-brand
    // convention).
    color: "#fff",
    border: "none",
    padding: "0.6rem 1.2rem",
    borderRadius: 6,
    cursor: busy ? "wait" : "pointer",
    fontWeight: 600,
    fontSize: "0.85rem",
    opacity: busy ? 0.6 : 1,
  });

  if (!mounted) return null;
  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      {/* Wide: the verification report is a table of every collection
          compared, and it has to be readable without horizontal scrolling. */}
      <div
        style={{ background: "linear-gradient(180deg, var(--danger-bg) 0%, var(--bg-sunken) 100%)", border: "2px solid var(--danger-fg)", borderRadius: 12, padding: "2rem", width: 920, maxWidth: "95vw", maxHeight: "92vh", overflowY: "auto", color: "var(--fg-1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>⚠️</div>
        <h2 style={{ margin: "0 0 0.25rem", color: "var(--danger)", fontSize: "1.1rem" }}>
          Manage / Delete — {society.name}
        </h2>
        <p style={{ color: "var(--fg-4)", fontSize: "0.78rem", marginBottom: "1.25rem" }}>
          Step {step} of 3 — hand over, verify, then choose an action.
        </p>

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 6, marginBottom: "1.25rem" }}>
          {[1, 2, 3].map((n) => (
            <div key={n} style={{ flex: 1, height: 4, borderRadius: 2, background: n <= step ? "var(--danger)" : "var(--fg-3)" }} />
          ))}
        </div>

        {error && (
          <div
          style={{ background: "var(--danger-bg)", border: "1px solid var(--danger-fg)", borderRadius: 6, padding: "0.6rem 0.9rem", marginBottom: "1rem", fontSize: "0.8rem", color: "var(--danger-fg)" }}>
            {error}
          </div>
        )}

        {step === 1 && (
          <div>
            <p style={{ fontSize: "0.85rem", lineHeight: 1.6, color: "var(--fg-2)" }}>
              First, hand <b>{society.name}</b> its own complete copy of everything we hold — members, bills,
              receipts, transactions, billing heads, notices, complaints, ledger and journal entries, amenities,
              shops, user accounts, role assignments: every collection that carries this society&apos;s id.
            </p>
            <p style={{ fontSize: "0.85rem", lineHeight: 1.6, color: "var(--fg-2)" }}>
              An email goes to the society&apos;s <b>registered address</b> with the file checksums and a link to
              their own dashboard. Nothing is attached, nothing is stored, and no copy lands on your machine —
              they log in with their existing credentials and download it themselves, and their browser verifies
              it. We keep the fingerprint, never the data.
            </p>
            <ul style={{ fontSize: "0.82rem", lineHeight: 1.6, color: "var(--fg-2)", paddingLeft: "1.1rem", marginTop: 0 }}>
              <li>
                <b>Excel</b> — Society sheet, then members in bulk-import layout, then one sheet per remaining
                collection with data. Readable, and re-importable through the normal onboarding flow.
              </li>
              <li>
                <b>JSON</b> — the exact data: ids, timestamps and nested records preserved, so the society can be
                rebuilt from it if it ever comes back.
              </li>
            </ul>
            <p style={{ fontSize: "0.78rem", lineHeight: 1.6, color: "var(--fg-4)" }}>
              Aadhaar numbers are never included and PAN numbers are masked.
            </p>

            {/* A handover nobody was told about is worse than no handover: it
                looks done, and it silently jams purge gate 6. So the no-address
                case gets the alarming panel, not a footnote. */}
            {sentHandover && sentHandover.needsRecipient && (
              <div style={{ background: "var(--danger-bg, #fef2f2)", border: "1px solid var(--danger-fg)", borderRadius: 6, padding: "0.7rem 0.9rem", fontSize: "0.8rem", color: "var(--danger-fg)", marginBottom: "0.9rem", lineHeight: 1.6 }}>
                <strong>Built, but nobody was told.</strong> {society.name} has no email address on
                record. Until somebody collects these records, this society cannot be purged.
                <div style={{ marginTop: "0.6rem" }}>
                  <button style={btn("var(--danger-fg)")} disabled={busy} onClick={promptForRecipient}>
                    Enter an address to send it to
                  </button>
                </div>
              </div>
            )}

            {sentHandover && !sentHandover.needsRecipient && (
              <div style={{ background: "var(--success-bg)", border: "1px solid var(--success-fg)", borderRadius: 6, padding: "0.6rem 0.9rem", fontSize: "0.8rem", color: "var(--success-fg)", marginBottom: "0.9rem" }}>
                Sent to {sentHandover.recipients?.join(", ")} · {num(sentHandover.counts?.documents)} records ·{" "}
                {num(sentHandover.counts?.collections)} collections
                {sentHandover.recipientSource === "override" && (
                  <div style={{ marginTop: "0.4rem", fontSize: "0.74rem" }}>
                    Sent to an address you supplied, recorded against your name. The society&apos;s own
                    record still has none — worth fixing before the next one.
                  </div>
                )}
              </div>
            )}

            <button style={btn("var(--primary)")} disabled={busy} onClick={() => handleSendHandover()}>
              {busy ? "Building…" : sentHandover ? "↻ Rebuild and resend" : "✉ Send the society its records"}
            </button>

            {/* Kept, because a regulator's demand or a support investigation
                sometimes genuinely needs the bytes — but demoted, explained,
                and recorded. It is not the way out of an ordinary offboarding. */}
            <details style={{ marginTop: "1.1rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--fg-4)" }}>
                I need a copy on my own machine
              </summary>
              <p style={{ fontSize: "0.76rem", lineHeight: 1.6, color: "var(--fg-3)", marginBottom: "0.6rem" }}>
                Break-glass only — a regulator&apos;s demand, a court order, an investigation the handover cannot
                serve. It creates a second copy of this society&apos;s personal data outside our systems, so it is
                recorded permanently against your name with the reason you give, and it needs a written one.
              </p>
              <button style={btn("var(--warning-fg)")} disabled={busy} onClick={breakGlassExport}>
                ⬇ Break-glass export (recorded)
              </button>
            </details>
          </div>
        )}

        {step === 2 && (
          <div>
            <p style={{ fontSize: "0.85rem", lineHeight: 1.6, color: "var(--fg-2)" }}>
              Now check that the live database still matches what was certified when the handover was built.
            </p>
            <p style={{ fontSize: "0.8rem", lineHeight: 1.6, color: "var(--fg-3)" }}>
              Nothing is uploaded and nothing is downloaded. The database is re-fingerprinted with the same salt
              used at handover time and the two fingerprints are compared field by field. A difference means
              someone changed this society&apos;s data since the handover — the copy the society holds would then
              be out of date, and the fix is to resend it, not to proceed.
            </p>

            {handover && (
              <div style={{ fontSize: "0.76rem", color: "var(--fg-3)", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "0.6rem 0.8rem", marginBottom: "0.9rem", lineHeight: 1.7 }}>
                Certified {new Date(handover.createdAt).toLocaleString("en-IN")} ·{" "}
                {num(handover.counts?.documents)} records · sent to{" "}
                {handover.recipients?.join(", ") || "— no registered address —"}
                <br />
                Society has{" "}
                <b style={{ color: handover.downloadedAt ? "var(--success-fg)" : "var(--warning-fg)" }}>
                  {handover.confirmedAt ? "confirmed custody" : handover.downloadedAt ? "collected it" : "not collected it yet"}
                </b>
              </div>
            )}

            <button style={btn("var(--primary)")} disabled={busy} onClick={handleVerify}>
              {busy ? "Comparing…" : "🔍 Verify against the live database"}
            </button>

            {verifyResult && !verifyResult.ok && (
              <VerifyReport
                report={verifyResult.report}
                mismatches={verifyResult.mismatches}
                mismatchCount={verifyResult.mismatchCount}
              />
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <div
              style={{ background: "var(--success-bg)", border: "1px solid var(--success-fg)", borderRadius: 6, padding: "0.6rem 0.9rem", fontSize: "0.8rem", color: "var(--success-fg)" }}>
              ✓ Export verified against the live database —{" "}
              <b>
                {num(verifyResult?.report?.totals?.fields)} fields across{" "}
                {num(verifyResult?.report?.totals?.documents)} documents in{" "}
                {num(verifyResult?.report?.totals?.collections)} collections
              </b>{" "}
              matched exactly, 0 differences. Choose an action — the token from this verification is valid for
              15 minutes.
            </div>

            {/* The full account, on success too: what was compared, what
                wasn't, and how much of it. */}
            <details open style={{ marginBottom: "1.25rem" }}>
              <summary style={{ cursor: "pointer", fontSize: "0.78rem", color: "var(--fg-3)", padding: "0.4rem 0" }}>
                What was checked
              </summary>
              <VerifyReport report={verifyResult?.report} />
            </details>

            {actionResult && (
              <div
                style={{
                  background: actionResult.tone === "ok" ? "var(--success-bg)" : "var(--warning-bg)",
                  border: `1px solid ${actionResult.tone === "ok" ? "var(--success-fg)" : "var(--warning-fg)"}`,
                  color: actionResult.tone === "ok" ? "var(--success-fg)" : "var(--warning-fg)",
                  borderRadius: 6,
                  padding: "0.6rem 0.9rem",
                  fontSize: "0.8rem",
                  marginBottom: "1rem",
                }}
              >
                {actionResult.text}
              </div>
            )}

            {/* The society's own copy. Verification above proves WE hold a
                good export; this section is about whether THEY do — which is
                what the purge cron's sixth gate actually requires, and what
                the law cares about. */}
            <div
              style={{ border: "1px solid var(--border-strong)", borderRadius: 8, padding: "0.9rem", marginBottom: "1.25rem", background: "var(--bg-surface)" }}
            >
              <div style={{ fontSize: "0.82rem", fontWeight: 700, marginBottom: 6 }}>
                Handover to the society
              </div>
              {handover ? (
                <div style={{ fontSize: "0.75rem", color: "var(--fg-3)", lineHeight: 1.7 }}>
                  <div>
                    Status: <b style={{ color: handover.confirmedAt ? "var(--success-fg)" : handover.downloadedAt ? "var(--success-fg)" : "var(--warning-fg)" }}>
                      {handover.confirmedAt ? "confirmed by the society" : handover.downloadedAt ? "collected" : "sent, not yet collected"}
                    </b>
                  </div>
                  <div>Sent to: {handover.recipients?.join(", ") || "— no registered address —"}</div>
                  <div>
                    {num(handover.counts?.documents)} records · manifest{" "}
                    <span style={{ fontFamily: "ui-monospace,monospace" }}>{String(handover.manifestRoot || "").slice(0, 16)}…</span>
                  </div>
                  {handover.notifyError && (
                    <div style={{ color: "var(--danger-fg)" }}>Delivery problem: {handover.notifyError}</div>
                  )}
                  {!handover.downloadedAt && (
                    <div style={{ color: "var(--warning-fg)" }}>
                      Scheduled erasure will not run until the society collects this, or the handover is waived.
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: "0.75rem", color: "var(--fg-4)", lineHeight: 1.7 }}>
                  Nothing has been handed to this society yet. &ldquo;Delete until date&rdquo; builds and sends one
                  automatically; send it now if you want them to have their records before any deletion is scheduled.
                </div>
              )}
              <div style={{ marginTop: "0.7rem", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={btn("var(--fg-3)")} disabled={handoverBusy} onClick={sendHandover}>
                  {handoverBusy ? "Working…" : handover ? "↻ Rebuild and resend" : "✉ Send handover now"}
                </button>
                {handover && !handover.downloadedAt && (
                  <button style={btn("var(--warning-fg)")} disabled={handoverBusy} onClick={waiveHandover}>
                    Waive (unreachable society)
                  </button>
                )}
              </div>
            </div>

            {society.isDeleted && (
              <div style={{ marginBottom: "1.25rem" }}>
                <button
                  style={{ ...btn("var(--success-fg)"), marginRight: 8 }}
                  disabled={busy}
                  onClick={async () => {
                    if (!(await notify.confirm(`Cancel the scheduled deletion of "${society.name}" and bring it back online now?`))) return;
                    runLifecycleAction("undo-delete");
                  }}
                >
                  ↩ Cancel scheduled deletion
                </button>
                <span style={{ fontSize: "0.75rem", color: "var(--fg-4)" }}>
                  Restores access immediately. Nothing was deleted, so nothing needs re-importing.
                </span>
              </div>
            )}

            <div style={{ marginBottom: "1.25rem" }}>
              <button style={{ ...btn("var(--fg-3)"), marginRight: 8 }} disabled={busy} onClick={() => runLifecycleAction("pause")}>
                ⏸ Pause now
              </button>
              <span style={{ fontSize: "0.75rem", color: "var(--fg-4)" }}>
                Blocks all login/access immediately. No data touched. Resume anytime.
              </span>
            </div>

            <div style={{ marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                type="date"
                value={untilDate}
                onChange={(e) => setUntilDate(e.target.value)}
                // G7: the picker is constrained to the same window the
                // lifecycle route enforces. It is a convenience, not the
                // control — the server re-checks either way.
                min={bounds ? String(bounds.min).slice(0, 10) : undefined}
                max={bounds ? String(bounds.max).slice(0, 10) : undefined}
                style={{ background: "var(--bg-surface)", border: "1px solid var(--border-strong)", color: "var(--fg-1)", borderRadius: 6, padding: "0.4rem 0.6rem" }}
              />
              <button
                style={btn("var(--fg-3)")}
                disabled={busy || !untilDate}
                onClick={() => runLifecycleAction("pause-until", { until: new Date(untilDate).toISOString() })}
              >
                ⏸ Pause until date
              </button>
              <button
                style={btn("var(--warning-fg)")}
                disabled={busy || !untilDate}
                onClick={async () => {
                  if (
                    !(await notify.confirm(
                      [
                        `Soft-delete "${society.name}" now, scheduled to purge on ${untilDate}?`,
                        "",
                        "This also builds the society's own copy of its records, emails their registered address, and tells every member with an address on file that their data will be erased on that date.",
                        "",
                        "Reversible until the purge runs — nothing is deleted today.",
                      ].join("\n"),
                      { tone: "danger" },
                    ))
                  )
                    return;
                  runLifecycleAction("delete-until", { until: new Date(untilDate).toISOString() });
                }}
              >
                🗑 Delete until date
              </button>
              {bounds && (
                <span style={{ fontSize: "0.72rem", color: "var(--fg-4)", flexBasis: "100%" }}>
                  Grace window: {bounds.minDays}–{bounds.maxDays} days, {bounds.defaultDays} by default. Short enough
                  that we are not storing data indefinitely, long enough that the society can actually collect its
                  records.
                </span>
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--danger-fg)", paddingTop: "1rem" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--fg-3)", lineHeight: 1.6, marginBottom: "0.6rem" }}>
                <b style={{ color: "var(--danger)" }}>Break-glass.</b> Immediate deletion skips everything the
                scheduled path is for: no grace window, so nothing can be brought back; no wait for the society to
                collect its records; no notice to the members whose data this is. Use &ldquo;Delete until date&rdquo;
                for an ordinary offboarding. This needs a written reason and is recorded permanently against your name.
              </div>
              <button
                style={btn("var(--danger)")}
                disabled={busy}
                onClick={() => deletePermanently()}
              >
                🗑 Delete permanently (break-glass)
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "1.5rem" }}>
          <button onClick={onClose} style={{ background: "var(--fg-3)", color: "#fff", border: "none", padding: "0.5rem 1.2rem", borderRadius: 6, cursor: "pointer" }}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
