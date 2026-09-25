"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, PageHeader, Button, Spinner, Toast, EmptyState, tokens } from "@/components/visitor/ui";

// "Your society's records" — the page a committee member lands on from the
// handover email.
//
// ## Who this is written for
//
// A society secretary in their fifties who has been told their society's data
// is being handed back, has never heard of a checksum, and wants to know two
// things: what do I click, and am I finished. Every word here is chosen for
// that reader.
//
// What that ruled out:
//
//   - "SHA-256", "digest", "manifest", "drift", "artifact" — all gone from the
//     visible copy. The hashes still run; they are just never named. A word
//     the reader cannot evaluate does not reassure them, it worries them.
//   - Two files presented as a choice. Choices stall people. Both are offered,
//     one is recommended, and the recommendation is explained in one line.
//   - A wall of green ticks per section. The old report showed everything it
//     had checked, which is right for an operator auditing a deletion and
//     wrong for someone who needs to know whether they are done.
//
// What replaced it: three numbered steps, always in the same order, with the
// current one highlighted and the finished ones ticked. The end state is a
// single green box that says "You're done" — because that is the only thing
// the reader actually came here to find out.
//
// The technical work is unchanged: the file is hashed in this browser with
// crypto.subtle and only the fingerprint is sent back. The file never leaves
// the visitor's machine. The reader is simply not made to think about it.

const FORMATS = [
  {
    key: "xlsx",
    title: "Excel file",
    detail: "Opens in Excel or Google Sheets. One tab per section — members, bills, receipts, and so on.",
    recommended: true,
  },
  {
    key: "json",
    title: "Data file",
    detail: "For your next software provider. Not meant to be read by a person.",
  },
];

async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a later tick — revoking synchronously races the download in
  // Safari and the file arrives empty.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const S = {
  wrap: { display: "grid", gap: 16, maxWidth: 780 },
  muted: { color: tokens.sub, fontSize: 14, margin: "4px 0 0", lineHeight: 1.6 },
  lead: { color: tokens.text, fontSize: 15, lineHeight: 1.7, margin: 0 },
  step: (state) => ({
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
    opacity: state === "todo" ? 0.55 : 1,
  }),
  bullet: (state) => ({
    flex: "0 0 auto",
    width: 30,
    height: 30,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    fontWeight: 700,
    fontSize: 14,
    background: state === "done" ? "#10b981" : state === "now" ? tokens.text : "var(--bg-muted)",
    color: state === "done" || state === "now" ? "#fff" : tokens.sub,
  }),
  stepTitle: { fontSize: 16, fontWeight: 700, color: tokens.text, margin: 0 },
  fileRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    padding: "12px 0",
    borderTop: "1px solid var(--bg-muted)",
  },
  tick: { color: "#047857", fontWeight: 600, fontSize: 14 },
  done: {
    border: "1.5px solid #10b981",
    background: "#10b98112",
    borderRadius: 12,
    padding: 20,
  },
  problem: {
    border: "1.5px solid #ef4444",
    background: "#ef444412",
    borderRadius: 12,
    padding: 20,
  },
  notice: {
    borderLeft: "3px solid #f59e0b",
    background: "#fffbeb",
    color: "#111",
    padding: "14px 18px",
    borderRadius: 6,
    fontSize: 14,
    lineHeight: 1.6,
  },
  help: { fontSize: 13, color: tokens.sub, lineHeight: 1.6, marginTop: 10 },
};

export default function PageClient() {
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(null);
  const [saved, setSaved] = useState({});
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/society-handover", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not load this page. Please try again.");
      setState(data);
      if (data?.handover?.confirmedAt) setResult({ ok: true, alreadyDone: true });
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Download and fingerprint are one action on one buffer. Hashing a second,
  // separate fetch would prove nothing about the file the visitor kept.
  const collect = useCallback(async (format) => {
    setBusy(format);
    setResult(null);
    try {
      const res = await fetch(`/api/v1/society-handover/download?format=${format}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || data?.error || "The download did not finish. Please try again.");
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `society-records.${format}`;
      const serverHash = res.headers.get("X-Export-SHA256");
      const buffer = await res.arrayBuffer();
      const localHash = await sha256Hex(buffer);
      saveBlob(new Blob([buffer]), filename);

      if (localHash !== serverHash) {
        setToast({
          type: "error",
          message: `${filename} did not download completely. Please click Download again.`,
        });
        return;
      }
      setSaved((d) => ({ ...d, [format]: { sha256: localHash, filename } }));
      setToast({ type: "success", message: `${filename} saved to your computer.` });
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setBusy(null);
    }
  }, []);

  const confirm = useCallback(async () => {
    setBusy("confirm");
    try {
      const digests = Object.entries(saved).map(([format, d]) => ({ format, sha256: d.sha256 }));
      const res = await fetch("/api/v1/society-handover/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digests }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not confirm. Please try again.");
      setResult(data);
      await load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setBusy(null);
    }
  }, [saved, load]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 64 }}>
        <Spinner size={28} />
      </div>
    );
  }

  const handover = state?.handover;
  const finished = Boolean(result?.ok || handover?.confirmedAt);
  const anySaved = Object.keys(saved).length > 0;

  // Which step is live. Kept as one expression so the numbered list, the
  // ticks and the highlight can never disagree with each other.
  const stepState = (n) => {
    if (finished) return "done";
    if (n === 1) return anySaved ? "done" : "now";
    if (n === 2) return anySaved ? "now" : "todo";
    return "todo";
  };

  return (
    <div style={S.wrap}>
      <PageHeader
        title="Your society's records"
        subtitle="Save a copy of everything, for your own files."
      />

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {!handover ? (
        <Card>
          <EmptyState
            icon="package"
            title="Nothing to collect right now"
            subtitle="When a copy of your society's records is prepared for you, it will appear here and we will email you."
          />
        </Card>
      ) : finished ? (
        <>
          <div style={S.done}>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#047857", marginBottom: 6 }}>
              ✓ You're done
            </div>
            <p style={{ ...S.lead, color: "#065f46" }}>
              You have a complete copy of {state.societyName || "your society"}'s records, and we have
              checked it opened correctly on your computer. Keep the files somewhere safe — with your
              society's other important documents.
            </p>
            <p style={S.help}>
              You can come back and download them again at any time while this page is available.
            </p>
          </div>
          <Card>
            <p style={S.muted}>
              Need them again? Use the buttons below.
            </p>
            <div style={{ marginTop: 8 }}>
              {FORMATS.map((f) => (
                <div key={f.key} style={S.fileRow}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ fontWeight: 600, color: tokens.text }}>{f.title}</div>
                    <p style={S.muted}>{f.detail}</p>
                  </div>
                  <Button variant="subtle" onClick={() => collect(f.key)} disabled={busy === f.key}>
                    {busy === f.key ? "Preparing…" : "Download"}
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <>
          {state.scheduledErasure && (
            <div style={S.notice}>
              <strong>
                Please save your records before{" "}
                {new Date(state.scheduledErasure).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
                .
              </strong>{" "}
              After that date your society's information will be removed from this system. Nothing has
              been removed yet.
            </div>
          )}

          <Card>
            <p style={S.lead}>
              This is everything we hold for{" "}
              <strong>{state.societyName || "your society"}</strong> — members, bills, receipts,
              payments, notices, complaints and accounts. Follow the two steps below. It takes about
              a minute.
            </p>
          </Card>

          {/* Step 1 */}
          <Card>
            <div style={S.step(stepState(1))}>
              <div style={S.bullet(stepState(1))}>{stepState(1) === "done" ? "✓" : "1"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={S.stepTitle}>Download your files</h3>
                <p style={S.muted}>
                  We suggest the Excel file — it is the one you can actually read. Download both if
                  you would like.
                </p>
                <div style={{ marginTop: 10 }}>
                  {FORMATS.map((f) => {
                    const got = saved[f.key];
                    return (
                      <div key={f.key} style={S.fileRow}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <div style={{ fontWeight: 600, color: tokens.text }}>
                            {f.title}
                            {f.recommended && (
                              <span style={{ ...S.muted, display: "inline", marginLeft: 8 }}>
                                — recommended
                              </span>
                            )}
                          </div>
                          <p style={S.muted}>{f.detail}</p>
                          {got && <div style={S.tick}>✓ Saved as {got.filename}</div>}
                        </div>
                        <Button
                          onClick={() => collect(f.key)}
                          disabled={busy === f.key}
                          variant={got ? "subtle" : "primary"}
                        >
                          {busy === f.key ? "Preparing…" : got ? "Download again" : "Download"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <p style={S.help}>
                  The file goes to your computer's Downloads folder. If nothing seems to happen, check
                  there before trying again.
                </p>
              </div>
            </div>
          </Card>

          {/* Step 2 */}
          <Card>
            <div style={S.step(stepState(2))}>
              <div style={S.bullet(stepState(2))}>2</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={S.stepTitle}>Tell us you have them</h3>
                <p style={S.muted}>
                  This confirms the files arrived on your computer complete and undamaged. We check
                  this on your own computer — the files are not sent back to us.
                </p>
                <div style={{ marginTop: 14 }}>
                  <Button onClick={confirm} disabled={!anySaved || busy === "confirm"}>
                    {busy === "confirm" ? "Checking…" : "I have saved my records"}
                  </Button>
                  {!anySaved && <p style={S.help}>Download a file first, then this button turns on.</p>}
                </div>
              </div>
            </div>
          </Card>

          {result && !result.ok && (
            <div style={S.problem}>
              <div style={{ fontSize: 17, fontWeight: 700, color: "#b91c1c", marginBottom: 6 }}>
                The file did not arrive complete
              </div>
              <p style={{ ...S.lead, color: "#7f1d1d" }}>
                This nearly always means the download was interrupted. Please download it again, then
                press the button once more.
              </p>
            </div>
          )}

          <p style={S.help}>
            Anything unclear? Reply to the email that brought you here and we will help.
          </p>
        </>
      )}
    </div>
  );
}
