"use client";
import { useState, useEffect } from "react";
import {
  PageHeader, Card, Btn, Pill, Icon, Segmented, Tabs, RevampSkeleton,
  EmptyState, Modal, Toast,
} from "@/components/revamp";

const STATUS_TABS = ["PENDING", "APPROVED", "REJECTED", "CLOSED", "all"];
const CATEGORIES = [
  "all",
  "noise",
  "parking",
  "water",
  "security",
  "cleanliness",
  "maintenance",
  "billing",
  "staff",
  "pets",
  "other",
];
const STATUS_TONE = {
  PENDING: "warning",
  APPROVED: "paid",
  REJECTED: "unpaid",
  CLOSED: "neutral",
  EXPIRED: "neutral",
};
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export default function AdminComplaintsPage() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState("PENDING");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [rejectModal, setRejectModal] = useState(null); // { id, reason }
  const [toast, setToast] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };
  const fetchComplaints = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusTab,
        page,
        limit: 15,
      });
      if (category !== "all") params.set("category", category);
      const res = await fetch(`/api/complaints/admin?${params}`, {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setComplaints(data.complaints);
        setPagination(data.pagination);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchComplaints();
  }, [statusTab, category, page]);
  const handleApprove = async (id) => {
    setActionLoading({ ...actionLoading, [id]: true });
    try {
      const res = await fetch(`/api/complaints/admin/${id}/approve`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("Complaint approved and now visible society-wide");
      fetchComplaints();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setActionLoading({ ...actionLoading, [id]: false });
    }
  };
  const handleReject = async () => {
    if (!rejectModal) return;
    const { id, reason } = rejectModal;
    if (!reason || reason.trim().length < 120) {
      return showToast(
        "Rejection reason must be at least 120 characters",
        "error",
      );
    }
    setActionLoading({ ...actionLoading, [id]: true });
    try {
      const res = await fetch(`/api/complaints/admin/${id}/reject`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("Complaint rejected");
      setRejectModal(null);
      fetchComplaints();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setActionLoading({ ...actionLoading, [id]: false });
    }
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="building-2" size={11} /> Operations · Complaints</>}
        title="Complaints Moderation"
        sub="Review, approve, or reject community complaints"
      />

      <Tabs
        value={statusTab}
        onChange={(s) => {
          setStatusTab(s);
          setPage(1);
        }}
        tabs={STATUS_TABS.map((s) => ({ key: s, label: s === "all" ? "All" : capitalize(s) }))}
      />

      <Card style={{ marginBottom: 16 }}>
        <Segmented
          value={category}
          onChange={(c) => {
            setCategory(c);
            setPage(1);
          }}
          options={CATEGORIES.map((c) => ({ value: c, label: c === "all" ? "All" : capitalize(c) }))}
        />
      </Card>

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          {[1, 2, 3].map((i) => <RevampSkeleton key={i} h={120} />)}
        </div>
      ) : complaints.length === 0 ? (
        <Card>
          <EmptyState icon="check-circle" title="No complaints in this queue." />
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {complaints.map((c) => (
            <Card key={c._id} hover>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap", fontSize: 12.5, color: "var(--r-fg-4)" }}>
                <Pill tone={STATUS_TONE[c.status] || "neutral"}>{c.status}</Pill>
                <strong style={{ color: "var(--r-fg-1)", fontWeight: 600 }}>{c.anonymousName}</strong>
                <span>·</span>
                <span style={{ textTransform: "capitalize" }}>{c.category}</span>
                <span>·</span>
                <span>{new Date(c.createdAt).toLocaleDateString("en-IN")}</span>
              </div>

              {/* Admin sees real identity */}
              {c.member && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--r-fg-3)",
                  marginBottom: 10, padding: "6px 10px", background: "var(--r-surface-2)", borderRadius: 8,
                }}>
                  <Icon name="user" size={13} />
                  {c.member.ownerName} · {c.member.wing}-{c.member.flatNo} · {c.member.contactNumber}
                </div>
              )}

              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--r-fg-1)", margin: "0 0 6px" }}>{c.title}</h3>
              <p style={{ fontSize: 13.5, color: "var(--r-fg-2)", lineHeight: 1.55, margin: 0 }}>{c.description}</p>

              {c.status === "PENDING" && (
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <Btn
                    variant="primary" icon="check"
                    disabled={actionLoading[c._id]}
                    onClick={() => handleApprove(c._id)}
                  >
                    Approve
                  </Btn>
                  <Btn
                    variant="danger" icon="x"
                    disabled={actionLoading[c._id]}
                    onClick={() => setRejectModal({ id: c._id, reason: "" })}
                  >
                    Reject
                  </Btn>
                </div>
              )}

              {c.adminRejectionReason && (
                <div style={{
                  marginTop: 14, padding: "10px 12px", borderRadius: 8, fontSize: 12.5, lineHeight: 1.5,
                  background: "var(--r-danger-soft)", color: "var(--r-fg-2)",
                }}>
                  <strong style={{ color: "var(--r-danger)" }}>Rejection reason:</strong> {c.adminRejectionReason}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {pagination.pages > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 16 }}>
          <Btn size="sm" variant="ghost" icon="chevron-left" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
          <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Page {page} of {pagination.pages}</span>
          <Btn size="sm" variant="ghost" iconR="chevron-right" disabled={page >= pagination.pages} onClick={() => setPage(page + 1)}>Next</Btn>
        </div>
      )}

      {/* Reject Modal */}
      <Modal
        open={Boolean(rejectModal)}
        onClose={() => setRejectModal(null)}
        title="Reject Complaint"
        sub="Reason must be 120–500 characters. Member will see this reason."
        width={520}
      >
        {rejectModal && (
          <div style={{ display: "grid", gap: 10 }}>
            <textarea
              rows={6}
              autoFocus
              placeholder="Explain why this complaint is being rejected... (min 120 chars)"
              value={rejectModal.reason}
              maxLength={500}
              onChange={(e) =>
                setRejectModal({ ...rejectModal, reason: e.target.value })
              }
              className="input"
              style={{ resize: "vertical" }}
            />
            <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
              {rejectModal.reason.length} / 500
              {rejectModal.reason.length < 120 && (
                <span style={{ color: "var(--r-danger)" }}>
                  {" "}(need {120 - rejectModal.reason.length} more)
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn
                variant="ghost"
                onClick={() => setRejectModal(null)}
              >
                Cancel
              </Btn>
              <Btn
                variant="dangerSolid"
                disabled={rejectModal.reason.length < 120}
                onClick={handleReject}
              >
                Confirm Rejection
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
