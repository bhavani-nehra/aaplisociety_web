"use client";
import { useEffect, useState } from "react";
import notify from "@/lib/notify";
import {
  PageHeader, Card, Btn, Icon, EmptyState,
  RevampSkeleton, Modal, SmallStat,
} from "@/components/revamp";

function Field({ label, required, children }) {
  return (
    <div>
      <label className="label" style={{ marginBottom: 4, display: "block" }}>
        {label}{required ? " *" : ""}
      </label>
      {children}
    </div>
  );
}

export default function SecurityGuardsPage() {
  const [guards, setGuards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    gateLabel: "Main Gate",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  // Edit state. The backend already exposes PATCH /api/admin/security-guards/:id
  // (name, phone, gateLabel, isActive) - the UI simply never offered it.
  const [edit, setEdit] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");

  async function loadGuards() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/security-guards", {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) setGuards(data.guards || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGuards();
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setMsg("");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/security-guards", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "Failed");
        return;
      }
      setMsg("Guard account created.");
      setForm({ name: "", username: "", password: "", gateLabel: "Main Gate" });
      setShowForm(false);
      loadGuards();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(guardId, current) {
    const res = await fetch(`/api/admin/security-guards/${guardId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !current }),
    });
    if (res.ok) loadGuards();
  }

  async function saveEdit(e) {
    e.preventDefault();
    setEditErr("");
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/security-guards/${edit._id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: edit.name,
          phone: edit.phone || "",
          gateLabel: edit.gateLabel || "Main Gate",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEditErr(data.error || "Failed to update guard");
        return;
      }
      setEdit(null);
      loadGuards();
    } finally {
      setEditSaving(false);
    }
  }

  async function removeGuard(guardId, name) {
    if (!(await notify.confirm(`Delete the guard account for ${name}? This cannot be undone.`, { tone: "danger" }))) return;
    const res = await fetch(`/api/admin/security-guards/${guardId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) loadGuards();
    else {
      const data = await res.json().catch(() => ({}));
      setMsg(data.error || "Failed to delete guard");
    }
  }

  const activeCount = guards.filter((g) => g.isActive).length;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="shield" size={11} /> Operations · Security</>}
        title="Security guards"
        sub="Manage gate guard accounts for this society."
        right={
          <Btn
            variant="primary"
            icon={showForm ? "x" : "plus"}
            onClick={() => {
              setShowForm((f) => !f);
              setMsg("");
            }}
          >
            {showForm ? "Cancel" : "Add guard"}
          </Btn>
        }
      />

      {!loading && guards.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
          <SmallStat icon="users" label="Total guards" value={guards.length} />
          <SmallStat icon="check-circle-2" label="Active" value={activeCount} tone="success" />
          <SmallStat icon="pause-circle" label="Inactive" value={guards.length - activeCount} tone={guards.length - activeCount > 0 ? "danger" : undefined} />
        </div>
      )}

      {msg && (
        <Card style={{ marginBottom: 16, background: "var(--r-success-soft)", border: "none" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Icon name="check-circle-2" size={16} color="var(--r-success)" />
            <span style={{ fontSize: 13, color: "var(--r-fg-2)" }}>{msg}</span>
          </div>
        </Card>
      )}

      {showForm && (
        <Card style={{ marginBottom: 16 }}>
          <form onSubmit={handleCreate} style={{ display: "grid", gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--r-fg-1)" }}>New guard account</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="Full name" required>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Guard name"
                  required
                />
              </Field>
              <Field label="Username" required>
                <input
                  className="input"
                  value={form.username}
                  onChange={(e) => setForm((s) => ({ ...s, username: e.target.value }))}
                  placeholder="e.g. guard01"
                  required
                />
              </Field>
              <Field label="Password" required>
                <input
                  type="password"
                  className="input"
                  value={form.password}
                  onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))}
                  placeholder="Min 6 characters"
                  required
                />
              </Field>
              <Field label="Gate label">
                <input
                  className="input"
                  value={form.gateLabel}
                  onChange={(e) => setForm((s) => ({ ...s, gateLabel: e.target.value }))}
                  placeholder="e.g. Main Gate, Rear Gate"
                />
              </Field>
            </div>
            <Btn type="submit" variant="primary" disabled={saving} style={{ width: "100%" }}>
              {saving ? "Creating…" : "Create guard account"}
            </Btn>
          </form>
        </Card>
      )}

      {loading ? (
        <RevampSkeleton h={220} />
      ) : guards.length === 0 ? (
        <Card>
          <EmptyState icon="shield" title="No security guards yet" sub="Add one above to get started." />
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {guards.map((g) => (
            <Card key={g._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: "var(--r-fg-1)" }}>{g.name}</div>
                <div style={{ color: "var(--r-fg-4)", fontSize: 12.5 }}>
                  @{g.username} · {g.gateLabel || "Main Gate"}
                  {g.phone ? ` · ${g.phone}` : " · no phone on file"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Btn
                  size="sm"
                  variant="secondary"
                  icon="pencil"
                  onClick={() =>
                    setEdit({
                      _id: g._id,
                      name: g.name || "",
                      phone: g.phone || "",
                      gateLabel: g.gateLabel || "Main Gate",
                      username: g.username,
                    })
                  }
                >
                  Edit
                </Btn>
                <Btn size="sm" variant="danger" icon="trash-2" onClick={() => removeGuard(g._id, g.name)}>
                  Delete
                </Btn>
                <button
                  type="button"
                  onClick={() => toggleActive(g._id, g.isActive)}
                  title="Click to toggle"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "5px 12px", borderRadius: 999, border: "none",
                    fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
                    background: g.isActive ? "var(--r-success-soft)" : "var(--r-danger-soft)",
                    color: g.isActive ? "var(--r-success)" : "var(--r-danger)",
                  }}
                >
                  <Icon name={g.isActive ? "check-circle-2" : "circle-slash"} size={12} />
                  {g.isActive ? "Active" : "Inactive"}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title="Edit guard" sub={edit ? `@${edit.username} · username and password cannot be changed here` : ""} width={440}>
        {edit && (
          <form onSubmit={saveEdit} style={{ display: "grid", gap: 14 }}>
            {editErr && (
              <div style={{ color: "var(--r-danger)", fontSize: 13, fontWeight: 600 }}>{editErr}</div>
            )}
            <Field label="Name" required>
              <input
                className="input"
                value={edit.name}
                onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                required
              />
            </Field>
            <Field label="Phone">
              <input
                className="input"
                value={edit.phone}
                onChange={(e) => setEdit((s) => ({ ...s, phone: e.target.value }))}
                placeholder="Used by the Call guard button in the resident app"
              />
            </Field>
            <Field label="Gate label">
              <input
                className="input"
                value={edit.gateLabel}
                onChange={(e) => setEdit((s) => ({ ...s, gateLabel: e.target.value }))}
                placeholder="e.g. Main Gate, Rear Gate"
              />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn type="submit" variant="primary" disabled={editSaving} style={{ flex: 1 }}>
                {editSaving ? "Saving…" : "Save changes"}
              </Btn>
              <Btn type="button" variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Btn>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
