"use client";
import { useCallback, useEffect, useState } from "react";
import notify from "@/lib/notify";
import { PhotoCapture } from "@/components/visitor/ui";
import {
  PageHeader, Card, CardHead, Btn, Pill, Icon, Avatar, EmptyState,
  RevampSkeleton, Toast,
} from "@/components/revamp";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const BLANK = { name: "", phone: "", reason: "", severity: "block", photo: "" };
const fmtTime = (v) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

function Field({ label, hint, required, children }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{label}{required ? " *" : ""}</div>
      {children}
      {hint ? <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

export default function BlacklistPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api(`/api/admin/blacklist${showInactive ? "?all=1" : ""}`);
      setEntries(data.entries || []);
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => { load(); }, [load]);

  async function submit(e) {
    e.preventDefault();
    if (!form.reason.trim()) {
      setToast({ type: "error", message: "A reason is required" });
      return;
    }
    if (!form.name.trim() && !form.phone.trim()) {
      setToast({ type: "error", message: "Enter a name or a phone number to match on" });
      return;
    }
    setSaving(true);
    try {
      await api("/api/admin/blacklist", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim() || undefined,
          phone: form.phone.trim() || undefined,
          reason: form.reason.trim(),
          severity: form.severity,
          photo: form.photo || undefined,
        }),
      });
      setToast({ type: "success", message: "Added to watchlist" });
      setForm(BLANK);
      load();
    } catch (err) {
      setToast({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  }

  function remove(id) {
    const index = entries.findIndex((en) => en._id === id);
    if (index === -1) return;
    const removed = entries[index];
    // Optimistic — the row leaves the list immediately; notify.undo() gives
    // the admin a window to put it back before the DELETE actually fires.
    setEntries((prev) => prev.filter((en) => en._id !== id));
    notify.undo("Removed from watchlist", {
      onUndo: () => {
        setEntries((prev) => {
          const next = [...prev];
          next.splice(index, 0, removed);
          return next;
        });
      },
      onCommit: async () => {
        try {
          await api(`/api/admin/blacklist?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        } catch (err) {
          // Delete failed server-side after the optimistic removal already
          // happened — put the row back and say why, same as any other
          // failed mutation on this page.
          setToast({ type: "error", message: err.message });
          load();
        }
      },
    });
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="shield-alert" size={11} /> Operations · Watchlist</>}
        title="Watchlist"
        sub="Flag or block visitors by name or phone. Blocked entries are denied at the gate automatically."
      />

      <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 20, alignItems: "start" }}>
        <Card>
          <CardHead title="Add to watchlist" />
          <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 4 }}>
            <Field label="Name" hint="Matched on visitor name at entry">
              <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. John Doe" />
            </Field>
            <Field label="Phone" hint="Strongest match — normalised automatically">
              <input className="input" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. 9876543210" />
            </Field>
            <Field label="Severity" required>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn
                  type="button" variant={form.severity === "flag" ? "secondary" : "ghost"} icon="alert-triangle"
                  style={form.severity === "flag" ? { borderColor: "var(--r-warning)", color: "var(--r-warning)" } : undefined}
                  onClick={() => set("severity", "flag")}
                >
                  Flag (warn guard)
                </Btn>
                <Btn
                  type="button" variant={form.severity === "block" ? "secondary" : "ghost"} icon="shield-x"
                  style={form.severity === "block" ? { borderColor: "var(--r-danger)", color: "var(--r-danger)" } : undefined}
                  onClick={() => set("severity", "block")}
                >
                  Block (deny entry)
                </Btn>
              </div>
            </Field>
            <Field label="Reason" required>
              <textarea rows={3} className="input" value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="Why is this person on the watchlist?" />
            </Field>
            <PhotoCapture
              label="Photo (optional)"
              hint="Helps guards visually identify the person"
              value={form.photo}
              onChange={(url) => set("photo", url)}
            />
            <Btn type="submit" variant="primary" disabled={saving} style={{ width: "100%" }}>
              {saving ? "Saving…" : "Add to watchlist"}
            </Btn>
          </form>
        </Card>

        <Card padded={false}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 18px 4px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--r-fg-1)" }}>
              {showInactive ? "All entries" : "Active entries"}{!loading ? ` (${entries.length})` : ""}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--r-fg-3)", cursor: "pointer" }}>
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show deactivated
            </label>
          </div>
          {loading ? (
            <div style={{ padding: 18 }}><RevampSkeleton h={200} /></div>
          ) : entries.length === 0 ? (
            <EmptyState icon="shield-check" title="No one on the watchlist" sub="Add a name or phone above to flag or block a visitor." />
          ) : (
            entries.map((en, i) => (
              <div key={en._id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderTop: i > 0 ? "1px solid var(--r-hairline)" : "none", opacity: en.active === false ? 0.5 : 1 }}>
                <Avatar src={en.photo} name={en.name || "?"} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "var(--r-fg-1)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {en.name || "(no name)"}
                    <Pill tone={en.severity === "block" ? "unpaid" : "warning"} dot={false}>{en.severity === "block" ? "Blocked" : "Flagged"}</Pill>
                    {en.active === false ? <Pill tone="neutral" dot={false}>Deactivated</Pill> : null}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 3 }}>
                    {en.phone ? `${en.phone} · ` : ""}Added by {en.addedBy?.name || "admin"}{en.createdAt ? ` · ${fmtTime(en.createdAt)}` : ""}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--r-fg-2)", marginTop: 4 }}>{en.reason}</div>
                </div>
                {en.active !== false ? (
                  <Btn variant="ghost" size="sm" icon="trash-2" onClick={() => remove(en._id)}>Deactivate</Btn>
                ) : null}
              </div>
            ))
          )}
        </Card>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
