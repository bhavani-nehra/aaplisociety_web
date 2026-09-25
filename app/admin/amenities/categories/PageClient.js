"use client";
import { useState, useEffect } from "react";
import notify from "@/lib/notify";
import {
  PageHeader, Card, Btn, Pill, Icon, EmptyState, RevampSkeleton, Modal, Toast,
} from "@/components/revamp";

const BLANK = { name: "", description: "", isActive: true };

function Field({ label, children }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

export default function AmenityCategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState(null); // { mode, id, ...fields }
  const [toast, setToast] = useState(null);
  const [dragId, setDragId] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/amenities/categories?includeInactive=true&withCounts=true", { credentials: "include" });
      const data = await res.json();
      if (res.ok) setCategories(data.categories || []);
      else showToast(data.error || "Could not load categories", "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!modal) return;
    if (!modal.name || modal.name.trim().length < 2) {
      return showToast("Give the category a name of at least 2 characters", "err");
    }
    setSaving(true);
    try {
      const isEdit = modal.mode === "edit";
      const res = await fetch(isEdit ? `/api/amenities/categories/${modal.id}` : "/api/amenities/categories", {
        method: isEdit ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modal.name.trim(), description: modal.description?.trim() || undefined, isActive: modal.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      showToast(isEdit ? "Category updated" : "Category created");
      setModal(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const remove = (cat) => {
    const index = categories.findIndex((c) => c._id === cat._id);
    if (index === -1) return;
    // Optimistic — the category leaves the list immediately; notify.undo()
    // gives the admin a window to put it back before the DELETE actually
    // fires. The API still independently refuses the delete (409) if
    // amenities still reference this category — see the catch below, which
    // restores the row and surfaces that message verbatim if so.
    setCategories((prev) => prev.filter((c) => c._id !== cat._id));
    notify.undo(`"${cat.name}" deleted`, {
      onUndo: () => {
        setCategories((prev) => {
          const next = [...prev];
          next.splice(index, 0, cat);
          return next;
        });
      },
      onCommit: async () => {
        try {
          const res = await fetch(`/api/amenities/categories/${cat._id}`, { method: "DELETE", credentials: "include" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Delete failed");
        } catch (err) {
          // The API refuses to delete a category that still has amenities
          // and tells us how many — surface that verbatim, and put the row
          // back since the delete never actually happened server-side.
          showToast(err.message, "err");
          setCategories((prev) => {
            if (prev.some((c) => c._id === cat._id)) return prev;
            const next = [...prev];
            next.splice(index, 0, cat);
            return next;
          });
        }
      },
    });
  };

  const onDrop = async (targetId) => {
    if (!dragId || dragId === targetId) return setDragId(null);
    const from = categories.findIndex((c) => c._id === dragId);
    const to = categories.findIndex((c) => c._id === targetId);
    if (from < 0 || to < 0) return setDragId(null);

    const next = [...categories];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCategories(next); // optimistic — dragging should feel immediate
    setDragId(null);

    try {
      const res = await fetch("/api/amenities/categories/reorder", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((c, i) => ({ id: c._id, displayOrder: i })) }),
      });
      if (!res.ok) throw new Error("Could not save the new order");
    } catch (err) {
      showToast(err.message, "err");
      load(); // reconcile with the server rather than leave a lie on screen
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="tag" size={11} /> Operations · Categories</>}
        title="Amenity categories"
        sub="Drag to reorder — residents see amenities grouped in this order."
        right={<Btn variant="primary" icon="plus" onClick={() => setModal({ mode: "create", ...BLANK })}>New category</Btn>}
      />

      {loading ? (
        <RevampSkeleton h={300} />
      ) : !categories.length ? (
        <Card>
          <EmptyState icon="tag" title="No categories yet"
            sub="Categories are entirely yours to define — Sports, Wellness, Community, or whatever your society actually calls these facilities. Create one to start adding amenities." />
        </Card>
      ) : (
        <Card padded={false} style={{ overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["", "Category", "Amenities", "Status", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700, color: "var(--r-fg-4)", borderBottom: "1px solid var(--r-hairline)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr
                  key={c._id}
                  draggable
                  onDragStart={() => setDragId(c._id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(c._id)}
                  style={{ borderTop: "1px solid var(--r-hairline)", background: dragId === c._id ? "var(--r-surface-2)" : "transparent", opacity: dragId === c._id ? 0.6 : 1 }}
                >
                  <td style={{ padding: "10px 14px", color: "var(--r-fg-5)", cursor: "grab" }}><Icon name="grip-vertical" size={14} /></td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{c.name}</div>
                    {c.description ? <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{c.description}</div> : null}
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--r-fg-3)" }}>{c.amenityCount || 0}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <Pill tone={c.isActive ? "paid" : "neutral"} dot={false}>{c.isActive ? "Active" : "Inactive"}</Pill>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Btn size="sm" variant="secondary" icon="pencil"
                        onClick={() => setModal({ mode: "edit", id: c._id, name: c.name, description: c.description || "", isActive: c.isActive })}>Edit</Btn>
                      <Btn size="sm" variant="danger" icon="trash-2" onClick={() => remove(c)}>Delete</Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={Boolean(modal)} onClose={() => setModal(null)} title={modal?.mode === "edit" ? "Edit category" : "New category"} width={480}>
        {modal && (
          <div style={{ display: "grid", gap: 14 }}>
            <Field label="Name">
              <input className="input" autoFocus value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} placeholder="Sports" />
            </Field>
            <Field label="Description">
              <textarea rows={3} className="input" value={modal.description} onChange={(e) => setModal({ ...modal, description: e.target.value })} placeholder="Optional — shown to residents above the amenity list" />
            </Field>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--r-fg-2)" }}>
              <input type="checkbox" checked={modal.isActive} onChange={(e) => setModal({ ...modal, isActive: e.target.checked })} />
              Active — visible to residents
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Btn>
              <Btn variant="ghost" onClick={() => setModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
