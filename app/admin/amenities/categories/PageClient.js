"use client";
import { useState, useEffect } from "react";
import styles from "@/styles/Amenities.module.css";
import notify from "@/lib/notify";

const BLANK = { name: "", description: "", isActive: true };

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
      const res = await fetch("/api/amenities/categories?includeInactive=true&withCounts=true", {
        credentials: "include",
      });
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
      const res = await fetch(
        isEdit ? `/api/amenities/categories/${modal.id}` : "/api/amenities/categories",
        {
          method: isEdit ? "PATCH" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: modal.name.trim(),
            description: modal.description?.trim() || undefined,
            isActive: modal.isActive,
          }),
        },
      );
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
          const res = await fetch(`/api/amenities/categories/${cat._id}`, {
            method: "DELETE",
            credentials: "include",
          });
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
        body: JSON.stringify({
          order: next.map((c, i) => ({ id: c._id, displayOrder: i })),
        }),
      });
      if (!res.ok) throw new Error("Could not save the new order");
    } catch (err) {
      showToast(err.message, "err");
      load(); // reconcile with the server rather than leave a lie on screen
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Amenity categories</h1>
          <p className={styles.subtitle}>
            Drag to reorder — residents see amenities grouped in this order
          </p>
        </div>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setModal({ mode: "create", ...BLANK })}>
          + New category
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : !categories.length ? (
        <div className={styles.tableWrap}>
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No categories yet</p>
            <p className={styles.emptyText}>
              Categories are entirely yours to define — Sports, Wellness, Community, or whatever your
              society actually calls these facilities. Create one to start adding amenities.
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 34 }}></th>
                <th>Category</th>
                <th style={{ width: 110 }}>Amenities</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 150 }}></th>
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
                  className={`${styles.dragRow} ${dragId === c._id ? styles.dragging : ""}`}
                >
                  <td style={{ color: "var(--border-strong)", cursor: "grab" }}>⠇</td>
                  <td>
                    <div className={styles.rowName}>{c.name}</div>
                    {c.description ? <div className={styles.rowSub}>{c.description}</div> : null}
                  </td>
                  <td>{c.amenityCount || 0}</td>
                  <td>
                    <span className={`${styles.pill} ${c.isActive ? styles.pillOpen : styles.pillMuted}`}>
                      {c.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className={`${styles.btn} ${styles.btnSm}`}
                        onClick={() => setModal({
                          mode: "edit", id: c._id, name: c.name,
                          description: c.description || "", isActive: c.isActive,
                        })}
                      >
                        Edit
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnSm} ${styles.btnDanger}`}
                        onClick={() => remove(c)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className={styles.overlay} onClick={() => setModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2 className={styles.modalTitle}>
                {modal.mode === "edit" ? "Edit category" : "New category"}
              </h2>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.label}>Name</label>
                <input
                  className={styles.input}
                  value={modal.name}
                  autoFocus
                  onChange={(e) => setModal({ ...modal, name: e.target.value })}
                  placeholder="Sports"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Description</label>
                <textarea
                  className={styles.textarea}
                  value={modal.description}
                  onChange={(e) => setModal({ ...modal, description: e.target.value })}
                  placeholder="Optional — shown to residents above the amenity list"
                />
              </div>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={modal.isActive}
                  onChange={(e) => setModal({ ...modal, isActive: e.target.checked })}
                />
                Active — visible to residents
              </label>
            </div>
            <div className={styles.modalFoot}>
              <button className={styles.btn} onClick={() => setModal(null)}>Cancel</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.type === "err" ? styles.toastErr : styles.toastOk}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
