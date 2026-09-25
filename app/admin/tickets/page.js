"use client";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PageHeader, Card, CardHead, Btn, Pill, Icon, Modal, Toast, DataTable, RevampSkeleton,
} from "@/components/revamp";
import {
  TICKET_CATEGORIES,
  MAX_SCREENSHOTS,
  MAX_SCREENSHOT_BYTES,
  ACCEPTED_SCREENSHOT_TYPES,
  MAX_TITLE_CHARS,
  MAX_DESCRIPTION_CHARS,
  MAX_ERROR_LOG_CHARS,
  STATUS_TONE,
} from "@/lib/support/ticketPolicy";

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ticketPolicy's STATUS_TONE speaks in semantic tones (info/warning/success/
// danger); the revamp kit's <Pill> only ships info/warning/neutral plus a
// set of billing-status names — "paid" and "unpaid" are its green/red, so
// map onto those rather than falling through to an uncolored neutral pill.
const PILL_TONE = { info: "info", warning: "warning", success: "paid", danger: "unpaid" };

function Field({ label, children, hint }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{label}</div>
      {children}
      {hint ? <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

const EMPTY_FORM = { category: TICKET_CATEGORIES[0], title: "", description: "", errorLogs: "" };

export default function AdminTicketsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [screenshots, setScreenshots] = useState([]); // [{ data, filename, size }]
  const [selected, setSelected] = useState(null); // ticket id whose detail is open
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: () => apiFetch("/api/admin/tickets"),
  });

  const detailQuery = useQuery({
    queryKey: ["admin-ticket-detail", selected],
    queryFn: () => apiFetch(`/api/admin/tickets/${selected}`),
    enabled: Boolean(selected),
  });

  const createMutation = useMutation({
    mutationFn: (payload) => apiFetch("/api/admin/tickets", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      showToast("Ticket submitted");
      setForm(EMPTY_FORM);
      setScreenshots([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      qc.invalidateQueries({ queryKey: ["admin-tickets"] });
    },
    onError: (err) => showToast(err.message, "error"),
  });

  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (screenshots.length + files.length > MAX_SCREENSHOTS) {
      showToast(`Maximum ${MAX_SCREENSHOTS} screenshots allowed`, "error");
      e.target.value = "";
      return;
    }
    for (const file of files) {
      if (!ACCEPTED_SCREENSHOT_TYPES.includes(file.type)) {
        showToast(`${file.name}: only PNG, JPEG, WebP allowed`, "error");
        continue;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        showToast(`${file.name} is ${Math.round(file.size / 1024)}KB — max is ${MAX_SCREENSHOT_BYTES / 1024}KB`, "error");
        continue;
      }
      const data = await readFileAsDataUrl(file);
      setScreenshots((prev) => [...prev, { data, filename: file.name, size: file.size }]);
    }
    e.target.value = "";
  }

  function removeScreenshot(i) {
    setScreenshots((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (form.title.trim().length < 5) return showToast("Title must be at least 5 characters", "error");
    if (form.description.trim().length < 10) return showToast("Description must be at least 10 characters", "error");
    createMutation.mutate({
      ...form,
      screenshots: screenshots.map((s) => ({ data: s.data, filename: s.filename })),
    });
  }

  const tickets = data?.tickets || [];

  const cols = [
    {
      key: "ticket", label: "Ticket", render: (t) => (
        <div>
          <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{t.title}</div>
          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{t.category}</div>
        </div>
      ),
    },
    { key: "status", label: "Status", render: (t) => <Pill tone={PILL_TONE[STATUS_TONE[t.status]] || "info"}>{t.status}</Pill> },
    {
      key: "created", label: "Created", render: (t) => (
        <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>{new Date(t.createdAt).toLocaleDateString("en-IN")}</span>
      ),
    },
    { key: "actions", label: "", render: (t) => <Btn size="sm" variant="secondary" icon="external-link" onClick={() => setSelected(t.id)}>Open</Btn> },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="life-buoy" size={11} /> Support</>}
        title="Support Ticket"
        sub="Report a bug, an error, or ask something — this goes straight to the platform team."
      />

      <form onSubmit={handleSubmit}>
        <Card style={{ marginBottom: 24 }}>
          <CardHead title="New ticket" sub="Tell us what happened — the more detail, the faster it gets triaged." />
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 14 }}>
              <Field label="Category">
                <select className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                  {TICKET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Title">
                <input
                  className="input"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  maxLength={MAX_TITLE_CHARS}
                  placeholder="One line summarising the issue"
                />
              </Field>
            </div>

            <Field label="Description">
              <textarea
                className="input"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                maxLength={MAX_DESCRIPTION_CHARS}
                rows={5}
                placeholder="What happened, what you expected, steps to reproduce…"
                style={{ resize: "vertical" }}
              />
              <div style={{ fontSize: 11.5, color: "var(--r-fg-5)", textAlign: "right", marginTop: 4 }}>
                {form.description.length}/{MAX_DESCRIPTION_CHARS}
              </div>
            </Field>

            <Field label="Error logs" hint="Optional — paste console/stack trace text">
              <textarea
                className="input"
                value={form.errorLogs}
                onChange={(e) => setForm((f) => ({ ...f, errorLogs: e.target.value }))}
                maxLength={MAX_ERROR_LOG_CHARS}
                rows={4}
                placeholder="Paste any error text here"
                style={{ resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}
              />
            </Field>

            <Field
              label="Screenshots"
              hint={`Optional — up to ${MAX_SCREENSHOTS}, ${MAX_SCREENSHOT_BYTES / 1024}KB each, PNG/JPEG/WebP`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_SCREENSHOT_TYPES.join(",")}
                multiple
                disabled={screenshots.length >= MAX_SCREENSHOTS}
                onChange={handleFiles}
                style={{ display: "block", fontSize: 13 }}
              />
              {screenshots.length > 0 && (
                <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  {screenshots.map((s, i) => (
                    <div key={i} style={{ position: "relative", border: "1px solid var(--r-border)", borderRadius: 8, overflow: "hidden" }}>
                      <img src={s.data} alt={s.filename} style={{ width: 100, height: 70, objectFit: "cover", display: "block" }} />
                      <button
                        type="button"
                        onClick={() => removeScreenshot(i)}
                        title="Remove"
                        aria-label={`Remove ${s.filename}`}
                        style={{
                          position: "absolute", top: 2, right: 2, width: 20, height: 20, borderRadius: "50%",
                          border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer",
                          fontSize: 12, lineHeight: "20px", padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Field>

            <div>
              <Btn type="submit" variant="primary" size="lg" disabled={createMutation.isPending} icon={createMutation.isPending ? undefined : "send"}>
                {createMutation.isPending ? "Submitting…" : "Submit ticket"}
              </Btn>
            </div>
          </div>
        </Card>
      </form>

      <SectionHeading />

      {isLoading ? (
        <RevampSkeleton h={220} />
      ) : (
        <DataTable
          cols={cols}
          rows={tickets}
          rowKey="id"
          onRowClick={(t) => setSelected(t.id)}
          emptyIcon="life-buoy"
          emptyTitle="No tickets yet"
          emptySub="Anything you report will show up here."
        />
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={detailQuery.data?.ticket?.title}
        sub={detailQuery.data?.ticket ? detailQuery.data.ticket.category : ""}
        width={640}
      >
        {detailQuery.isLoading || !detailQuery.data ? (
          <RevampSkeleton h={200} />
        ) : (
          <TicketDetail ticket={detailQuery.data.ticket} onClose={() => setSelected(null)} />
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function SectionHeading() {
  return (
    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--r-fg-2)", margin: "4px 0 12px" }}>
      My tickets
    </div>
  );
}

function TicketDetail({ ticket, onClose }) {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Pill tone={PILL_TONE[STATUS_TONE[ticket.status]] || "info"}>{ticket.status}</Pill>
      </div>

      <p style={{ whiteSpace: "pre-wrap", color: "var(--r-fg-2)", fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
        {ticket.description}
      </p>

      {ticket.errorLogs && (
        <Field label="Error logs">
          <pre style={{
            background: "var(--r-surface-2)", padding: "0.75rem", borderRadius: 8, fontSize: 12,
            maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap", userSelect: "none",
            border: "1px solid var(--r-hairline)", margin: 0,
          }}>
            {ticket.errorLogs}
          </pre>
        </Field>
      )}

      {ticket.screenshots?.length > 0 && (
        <Field label="Screenshots">
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {ticket.screenshots.map((s, i) => (
              <img
                key={i}
                src={s.data}
                alt={s.filename || `screenshot ${i + 1}`}
                onContextMenu={(e) => e.preventDefault()}
                style={{ maxWidth: 240, maxHeight: 180, borderRadius: 8, border: "1px solid var(--r-border)" }}
              />
            ))}
          </div>
        </Field>
      )}

      <Field label="Status history">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ticket.statusHistory?.map((h, i) => (
            <div key={i} style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "baseline" }}>
              <Pill tone={PILL_TONE[STATUS_TONE[h.status]] || "info"}>{h.status}</Pill>
              <span style={{ color: "var(--r-fg-5)", fontSize: 11.5 }}>
                {new Date(h.changedAt).toLocaleString("en-IN")}
              </span>
              {h.note && <span style={{ color: "var(--r-fg-3)" }}>— {h.note}</span>}
            </div>
          ))}
        </div>
      </Field>

      <div>
        <Btn variant="secondary" onClick={onClose}>Close</Btn>
      </div>
    </div>
  );
}
