"use client";
import { useState, useEffect } from "react";
import styles from "@/styles/AdminNotices.module.css";
import notify from "@/lib/notify";
const NOTICE_TYPES = [
  "maintenance",
  "meeting",
  "water",
  "electricity",
  "parking",
  "security",
  "event",
  "billing",
  "custom",
];
const PRIORITIES = ["low", "medium", "high", "urgent"];
const EXPIRY_OPTIONS = [
  { value: "1d", label: "1 Day" },
  { value: "3d", label: "3 Days" },
  { value: "5d", label: "5 Days" },
  { value: "7d", label: "7 Days" },
  { value: "custom", label: "Custom Date" },
  { value: "", label: "No Expiry" },
];
const TYPE_ICONS = {
  maintenance: "🔧",
  meeting: "📅",
  water: "💧",
  electricity: "⚡",
  parking: "🚗",
  security: "🔒",
  event: "🎉",
  billing: "💰",
  custom: "📋",
};
const PRIORITY_COLORS = {
  low: { bg: "var(--bg-muted)", color: "var(--fg-3)", border: "var(--border)" },
  medium: { bg: "var(--info-bg)", color: "var(--info)", border: "var(--primary)" },
  high: { bg: "var(--warning-bg)", color: "var(--warning-fg)", border: "var(--warning)" },
  urgent: { bg: "var(--danger-bg)", color: "var(--danger-fg)", border: "var(--danger)" },
};
const EMPTY_FORM = {
  type: "maintenance",
  priority: "medium",
  title: "",
  description: "",
  pinned: false,
  expiryOption: "7d",
  customExpiryDate: "",
};
export default function AdminNoticesPage() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [actionLoading, setActionLoading] = useState({});
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };
  const fetchNotices = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 15 });
      if (filterType !== "all") params.set("type", filterType);
      if (filterPriority !== "all") params.set("priority", filterPriority);
      const res = await fetch(`/api/notices?${params}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setNotices(data.notices);
        setPagination(data.pagination);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchNotices();
  }, [filterType, filterPriority, page]);
  const validate = () => {
    const e = {};
    if (!form.title || form.title.length < 10)
      e.title = "Title must be at least 10 characters";
    if (form.title.length > 150) e.title = "Title must be under 150 characters";
    if (!form.description || form.description.length < 30)
      e.description = "Description must be at least 30 characters";
    if (form.description.length > 2000)
      e.description = "Description must be under 2000 characters";
    if (form.expiryOption === "custom" && !form.customExpiryDate)
      e.customExpiryDate = "Please select a date";
    return e;
  };
  const handleCreate = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) return setErrors(errs);
    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch("/api/notices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("Notice published successfully!");
      setShowForm(false);
      setForm(EMPTY_FORM);
      fetchNotices();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };
  const handleDelete = (id) => {
    const index = notices.findIndex((n) => n._id === id);
    if (index === -1) return;
    const removed = notices[index];
    // Optimistic — the notice leaves the list immediately; notify.undo()
    // gives the admin a window to put it back before the DELETE actually
    // fires.
    setNotices((prev) => prev.filter((n) => n._id !== id));
    notify.undo("Notice deleted", {
      onUndo: () => {
        setNotices((prev) => {
          const next = [...prev];
          next.splice(index, 0, removed);
          return next;
        });
      },
      onCommit: async () => {
        try {
          const res = await fetch(`/api/notices/${id}`, {
            method: "DELETE",
            credentials: "include",
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
        } catch (err) {
          // Delete failed server-side after the optimistic removal already
          // happened — refetch to reconcile the list with reality and
          // surface why.
          showToast(err.message, "error");
          fetchNotices();
        }
      },
    });
  };
  const handlePin = async (id, currentPinned) => {
    setActionLoading({ ...actionLoading, [id]: "pin" });
    try {
      const res = await fetch(`/api/notices/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !currentPinned }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(currentPinned ? "Notice unpinned" : "Notice pinned to top");
      fetchNotices();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setActionLoading({ ...actionLoading, [id]: null });
    }
  };
  const timeAgo = (date) => {
    const diff = (Date.now() - new Date(date)) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };
  return (
    <div className={styles.page}>
      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.msg}
        </div>
      )}
      <div className={styles.pageHeader}>
        <div>
          <h1>Notice Board</h1>
          <p>Create and manage society notices</p>
        </div>
        <button className={styles.createBtn} onClick={() => setShowForm(true)}>
          + New Notice
        </button>
      </div>
      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Type:</span>
          {["all", ...NOTICE_TYPES].map((t) => (
            <button
              key={t}
              onClick={() => {
                setFilterType(t);
                setPage(1);
              }}
              className={`${styles.filterBtn} ${filterType === t ? styles.filterActive : ""}`}
            >
              {t !== "all" ? TYPE_ICONS[t] + " " : ""}
              {t}
            </button>
          ))}
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Priority:</span>
          {["all", ...PRIORITIES].map((p) => (
            <button
              key={p}
              onClick={() => {
                setFilterPriority(p);
                setPage(1);
              }}
              className={`${styles.filterBtn} ${filterPriority === p ? styles.filterActive : ""}`}
              style={
                filterPriority === p && p !== "all"
                  ? {
                      background: PRIORITY_COLORS[p].bg,
                      color: PRIORITY_COLORS[p].color,
                      borderColor: PRIORITY_COLORS[p].border,
                    }
                  : {}
              }
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      {/* Notices List */}
      {loading ? (
        <div className={styles.loading}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.skeleton} />
          ))}
        </div>
      ) : notices.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📭</div>
          <p>No notices found.</p>
          <button
            className={styles.createBtn}
            onClick={() => setShowForm(true)}
          >
            Create First Notice
          </button>
        </div>
      ) : (
        <div className={styles.list}>
          {notices.map((n) => {
            const pc = PRIORITY_COLORS[n.priority];
            return (
              <div
                key={n._id}
                className={`${styles.card} ${n.priority === "urgent" ? styles.urgentCard : ""}`}
                style={{ borderLeftColor: pc.border }}
              >
                <div className={styles.cardTop}>
                  <div className={styles.cardMeta}>
                    {n.pinned && (
                      <span className={styles.pinnedBadge}>📌 Pinned</span>
                    )}
                    <span className={styles.typeBadge}>
                      {TYPE_ICONS[n.type]} {n.type}
                    </span>
                    <span
                      className={styles.priorityBadge}
                      style={{
                        background: pc.bg,
                        color: pc.color,
                        borderColor: pc.border,
                      }}
                    >
                      {n.priority}
                    </span>
                    <span className={styles.time}>{timeAgo(n.createdAt)}</span>
                  </div>
                  <div className={styles.cardActions}>
                    <button
                      className={`${styles.actionBtn} ${n.pinned ? styles.pinnedBtn : ""}`}
                      onClick={() => handlePin(n._id, n.pinned)}
                      disabled={actionLoading[n._id] === "pin"}
                      title={n.pinned ? "Unpin" : "Pin to top"}
                    >
                      {n.pinned ? "📌" : "📍"}
                    </button>
                    <button
                      className={`${styles.actionBtn} ${styles.deleteBtn}`}
                      onClick={() => handleDelete(n._id)}
                      disabled={actionLoading[n._id] === "delete"}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                </div>
                <h3 className={styles.cardTitle}>{n.title}</h3>
                <p className={styles.cardDesc}>{n.description}</p>
                <div className={styles.cardFooter}>
                  <span className={styles.author}>By {n.createdByName}</span>
                  {n.expiresAt && (
                    <span className={styles.expiry}>
                      Expires{" "}
                      {new Date(n.expiresAt).toLocaleDateString("en-IN")}
                    </span>
                  )}
                  {/* View stats */}
                  <span className={styles.viewStats}>
                    👁 {n.viewedCount || 0} / {n.totalMembers || 0} viewed
                    {n.priority === "urgent" && (
                      <span className={styles.ackStats}>
                        &nbsp;·&nbsp;✅ {n.acknowledgedCount || 0} acknowledged
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {pagination.pages > 1 && (
        <div className={styles.pagination}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span>
            {page} / {pagination.pages}
          </span>
          <button
            disabled={page >= pagination.pages}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}
      {/* Create Notice Modal */}
      {showForm && (
        <div className={styles.modalOverlay} onClick={() => setShowForm(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Create Notice</h2>
              <button
                className={styles.closeBtn}
                onClick={() => setShowForm(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate} className={styles.form}>
              <div className={styles.formRow}>
                <div className={styles.field}>
                  <label>Type *</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value })}
                  >
                    {NOTICE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_ICONS[t]} {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Priority *</label>
                  <select
                    value={form.priority}
                    onChange={(e) =>
                      setForm({ ...form, priority: e.target.value })
                    }
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={styles.field}>
                <label>
                  Title *{" "}
                  <span className={styles.hint}>{form.title.length}/150</span>
                </label>
                <input
                  type="text"
                  value={form.title}
                  maxLength={150}
                  placeholder="Notice title (10–150 characters)"
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className={errors.title ? styles.inputError : ""}
                />
                {errors.title && (
                  <span className={styles.error}>{errors.title}</span>
                )}
              </div>
              <div className={styles.field}>
                <label>
                  Description *{" "}
                  <span className={styles.hint}>
                    {form.description.length}/2000
                  </span>
                </label>
                <textarea
                  rows={6}
                  value={form.description}
                  maxLength={2000}
                  placeholder="Detailed notice description (30–2000 characters)"
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  className={errors.description ? styles.inputError : ""}
                />
                {errors.description && (
                  <span className={styles.error}>{errors.description}</span>
                )}
              </div>
              <div className={styles.formRow}>
                <div className={styles.field}>
                  <label>Expiry</label>
                  <select
                    value={form.expiryOption}
                    onChange={(e) =>
                      setForm({ ...form, expiryOption: e.target.value })
                    }
                  >
                    {EXPIRY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {form.expiryOption === "custom" && (
                  <div className={styles.field}>
                    <label>Custom Date *</label>
                    <input
                      type="date"
                      value={form.customExpiryDate}
                      min={new Date().toISOString().split("T")[0]}
                      onChange={(e) =>
                        setForm({ ...form, customExpiryDate: e.target.value })
                      }
                      className={
                        errors.customExpiryDate ? styles.inputError : ""
                      }
                    />
                    {errors.customExpiryDate && (
                      <span className={styles.error}>
                        {errors.customExpiryDate}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(e) =>
                    setForm({ ...form, pinned: e.target.checked })
                  }
                />
                <span>📌 Pin this notice to top</span>
              </label>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={submitting}
                >
                  {submitting ? "Publishing..." : "Publish Notice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
