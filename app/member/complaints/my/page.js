"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader, Card, Btn, Icon, Pill, RevampSkeleton, EmptyState, Toast,
} from "@/components/revamp";

const STATUS_CONFIG = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "paid" },
  REJECTED: { label: "Rejected", tone: "unpaid" },
  CLOSED: { label: "Closed", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

export default function MyComplaintsPage() {
  const router = useRouter();
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState({});
  const [replying, setReplying] = useState({});
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState({});

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchMyComplaints = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/complaints/my", { credentials: "include" });
      const data = await res.json();
      if (res.ok) setComplaints(data.complaints);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyComplaints();
  }, []);

  const handleReply = async (complaintId) => {
    const message = replyText[complaintId]?.trim();
    if (!message || message.length < 10) {
      return showToast("Reply must be at least 10 characters", "err");
    }
    setReplying({ ...replying, [complaintId]: true });
    try {
      const res = await fetch(`/api/complaints/${complaintId}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("Reply submitted");
      setReplyText({ ...replyText, [complaintId]: "" });
      fetchMyComplaints();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setReplying({ ...replying, [complaintId]: false });
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="message-square" size={11} /> Community</>}
        title="My Complaints"
        sub="Track your submitted complaints and appeals"
        right={
          <Btn variant="primary" icon="plus" onClick={() => router.push("/member/complaints/new")}>
            New
          </Btn>
        }
      />

      {loading ? (
        <div style={{ display: "grid", gap: 14 }}>
          {[1, 2, 3].map((i) => <RevampSkeleton key={i} h={120} />)}
        </div>
      ) : complaints.length === 0 ? (
        <Card>
          <EmptyState icon="inbox" title="No complaints yet" sub="You have not submitted any complaints yet." />
          <div style={{ textAlign: "center", marginTop: 4 }}>
            <Btn variant="primary" icon="plus" onClick={() => router.push("/member/complaints/new")}>
              Submit First Complaint
            </Btn>
          </div>
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {complaints.map((c) => {
            const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.PENDING;
            const isRejected = c.status === "REJECTED";
            const memberReplies = (c.replies || []).filter(
              (r) => r.authorRole === "Member",
            );
            const canReply = isRejected && memberReplies.length < 3;
            const isExpanded = !!expanded[c._id];
            return (
              <Card key={c._id} style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Pill tone={cfg.tone}>{cfg.label}</Pill>
                    <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>{c.category}</span>
                  </div>
                  <span style={{ fontSize: 11.5, color: "var(--r-fg-4)", whiteSpace: "nowrap" }}>
                    {new Date(c.createdAt).toLocaleDateString("en-IN")}
                  </span>
                </div>

                <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--r-fg-1)" }}>{c.title}</div>
                <p style={{ fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.5, margin: 0 }}>{c.description}</p>
                <p style={{ fontSize: 12, color: "var(--r-fg-4)", margin: 0 }}>
                  Posted as: <strong style={{ color: "var(--r-fg-2)" }}>{c.anonymousName}</strong>
                </p>

                {isRejected && c.adminRejectionReason && (
                  <div style={{
                    padding: "10px 12px", borderRadius: 8,
                    background: "var(--r-danger-soft)", color: "var(--r-danger)", fontSize: 12.5,
                  }}>
                    <strong>Admin&apos;s Reason:</strong>
                    <p style={{ margin: "4px 0 0" }}>{c.adminRejectionReason}</p>
                  </div>
                )}

                {(c.replies?.length > 0 || isRejected) && (
                  <div style={{ borderTop: "1px solid var(--r-hairline)", paddingTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => setExpanded({ ...expanded, [c._id]: !expanded[c._id] })}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, border: "none",
                        background: "none", cursor: "pointer", color: "var(--r-fg-3)",
                        fontSize: 12.5, fontWeight: 600, padding: 0, fontFamily: "inherit",
                      }}
                    >
                      <Icon name={isExpanded ? "chevron-up" : "chevron-down"} size={13} />
                      {isExpanded ? "Hide" : "Show"} Thread ({c.replies?.length || 0} replies)
                    </button>

                    {isExpanded && (
                      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                        {c.replies.map((r) => {
                          const isAdmin = r.authorRole !== "Member";
                          return (
                            <div key={r._id} style={{
                              padding: "8px 10px", borderRadius: 8,
                              background: isAdmin ? "var(--r-brand-soft)" : "var(--r-surface-2)",
                            }}>
                              <div style={{
                                fontSize: 11.5, fontWeight: 700,
                                color: isAdmin ? "var(--r-brand)" : "var(--r-fg-3)",
                              }}>{r.displayName}</div>
                              <p style={{ fontSize: 13, color: "var(--r-fg-2)", margin: "3px 0" }}>{r.message}</p>
                              <span style={{ fontSize: 11, color: "var(--r-fg-5)" }}>
                                {new Date(r.createdAt).toLocaleDateString("en-IN")}
                              </span>
                            </div>
                          );
                        })}

                        {canReply && (
                          <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
                            <textarea
                              className="input"
                              placeholder="Write your appeal reply... (min 10 chars)"
                              rows={3}
                              value={replyText[c._id] || ""}
                              onChange={(e) => setReplyText({ ...replyText, [c._id]: e.target.value })}
                              style={{ resize: "vertical", fontFamily: "inherit" }}
                            />
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
                                {3 - memberReplies.length} reply(ies) left
                              </span>
                              <Btn
                                variant="primary"
                                size="sm"
                                disabled={replying[c._id]}
                                onClick={() => handleReply(c._id)}
                              >
                                {replying[c._id] ? "Sending…" : "Send Reply"}
                              </Btn>
                            </div>
                          </div>
                        )}
                        {!canReply && isRejected && (
                          <p style={{ fontSize: 12, color: "var(--r-fg-4)", margin: 0 }}>
                            Maximum replies reached for this complaint.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
