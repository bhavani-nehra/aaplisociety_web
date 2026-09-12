"use client";
import { useCallback, useEffect, useState } from "react";
import notify from "@/lib/notify";
import {
  Card,
  PageHeader,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  Avatar,
  Badge,
  Spinner,
  Toast,
  EmptyState,
  PhotoCapture,
  grid,
  tokens,
  fmtTime,
} from "@/components/visitor/ui";
async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}
const BLANK = { name: "", phone: "", reason: "", severity: "block", photo: "" };
const S = {
  layout: { display: "grid", gridTemplateColumns: "360px 1fr", gap: 20, alignItems: "start" },
  formGrid: { display: "grid", gap: 14 },
  hint: { fontSize: 12.5, color: tokens.sub, marginTop: -4, marginBottom: 4 },
  toggleRow: { display: "flex", gap: 8 },
  sevBtn: (active, color) => ({
    flex: 1,
    padding: "10px 12px",
    borderRadius: tokens.radiusSm,
    border: active ? `1.5px solid ${color}` : tokens.border,
    background: active ? `${color}14` : "var(--bg-surface)",
    color: active ? color : tokens.sub,
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  }),
  listHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12 },
  listTitle: { fontSize: 16, fontWeight: 700, color: tokens.text },
  filterRow: { display: "flex", gap: 8, alignItems: "center" },
  row: { display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--bg-muted)" },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontWeight: 600, color: tokens.text, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rowMeta: { fontSize: 12.5, color: tokens.sub, marginTop: 3 },
  rowReason: { fontSize: 13, color: tokens.text, marginTop: 4 },
  dim: { opacity: 0.5 },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  spacer: { height: 14 },
  switchRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: tokens.sub, cursor: "pointer" },
};
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
  useEffect(() => {
    load();
  }, [load]);
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
    <div>
      <PageHeader
        title="Watchlist"
        subtitle="Flag or block visitors by name or phone. Blocked entries are denied at the gate automatically."
      />
      <div style={S.layout}>
        {/* Add form */}
        <Card>
          <div style={S.listTitle}>Add to watchlist</div>
          <div style={S.spacer} />
          <form onSubmit={submit} style={S.formGrid}>
            <Field label="Name" hint="Matched on visitor name at entry">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. John Doe" />
            </Field>
            <Field label="Phone" hint="Strongest match — normalised automatically">
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="e.g. 9876543210" />
            </Field>
            <Field label="Severity" required>
              <div style={S.toggleRow}>
                <button
                  type="button"
                  style={S.sevBtn(form.severity === "flag", "var(--warning)")}
                  onClick={() => set("severity", "flag")}
                >
                  ⚠️ Flag (warn guard)
                </button>
                <button
                  type="button"
                  style={S.sevBtn(form.severity === "block", tokens.danger)}
                  onClick={() => set("severity", "block")}
                >
                  ⛔ Block (deny entry)
                </button>
              </div>
            </Field>
            <Field label="Reason" required>
              <Textarea
                value={form.reason}
                onChange={(e) => set("reason", e.target.value)}
                placeholder="Why is this person on the watchlist?"
              />
            </Field>
            <PhotoCapture
              label="Photo (optional)"
              hint="Helps guards visually identify the person"
              value={form.photo}
              onChange={(url) => set("photo", url)}
            />
            <Button type="submit" full disabled={saving}>
              {saving ? "Saving…" : "Add to watchlist"}
            </Button>
          </form>
        </Card>
        {/* List */}
        <Card>
          <div style={S.listHead}>
            <div style={S.listTitle}>
              {showInactive ? "All entries" : "Active entries"}
              {!loading ? ` (${entries.length})` : ""}
            </div>
            <label style={S.switchRow}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show deactivated
            </label>
          </div>
          {loading ? (
            <div style={S.center}>
              <Spinner />
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon="✅"
              title="No one on the watchlist"
              subtitle="Add a name or phone above to flag or block a visitor."
            />
          ) : (
            entries.map((en) => {
              const sevColor = en.severity === "block" ? tokens.danger : "var(--warning)";
              const sevLabel = en.severity === "block" ? "Blocked" : "Flagged";
              const rowStyle = en.active === false ? Object.assign({}, S.row, S.dim) : S.row;
              return (
                <div key={en._id} style={rowStyle}>
                  <Avatar src={en.photo} name={en.name || "?"} size={44} />
                  <div style={S.rowMain}>
                    <div style={S.rowName}>
                      {en.name || "(no name)"}
                      <Badge color={sevColor}>{sevLabel}</Badge>
                      {en.active === false ? <Badge color={tokens.sub}>Deactivated</Badge> : null}
                    </div>
                    <div style={S.rowMeta}>
                      {en.phone ? `📞 ${en.phone}  ·  ` : ""}
                      Added by {en.addedBy && en.addedBy.name ? en.addedBy.name : "admin"}
                      {en.createdAt ? `  ·  ${fmtTime(en.createdAt)}` : ""}
                    </div>
                    <div style={S.rowReason}>{en.reason}</div>
                  </div>
                  {en.active !== false ? (
                    <Button variant="ghost" size="sm" onClick={() => remove(en._id)}>
                      Deactivate
                    </Button>
                  ) : null}
                </div>
              );
            })
          )}
        </Card>
      </div>
      {toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
