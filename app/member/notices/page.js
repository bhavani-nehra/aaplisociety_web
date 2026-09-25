"use client";
import { useState, useEffect, useRef } from "react";
import {
  PageHeader, Card, Btn, Pill, Icon, Segmented, SectionLabel,
  EmptyState, RevampSkeleton, Toast,
} from "@/components/revamp";

const TYPE_ICONS = {
  maintenance: "wrench",
  meeting: "calendar",
  water: "droplet",
  electricity: "zap",
  parking: "car",
  security: "lock",
  event: "party-popper",
  billing: "wallet",
  custom: "clipboard-list",
};
const PRIORITY_TONE = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "overdue",
};
const TYPES = [
  "maintenance", "meeting", "water", "electricity", "parking",
  "security", "event", "billing", "custom",
];

function NoticeCard({ n, acknowledged, onAcknowledge }) {
  const tone = PRIORITY_TONE[n.priority] || "neutral";
  const isUrgent = n.priority === "urgent";
  const isAcknowledged = acknowledged.has(n._id);
  return (
    <div data-id={n._id}>
    <Card
      style={{ display: "grid", gap: 10 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {n.pinned && <Icon name="pin" size={13} color="var(--r-brand)" />}
          <Pill tone="neutral" dot={false}>
            <Icon name={TYPE_ICONS[n.type] || "clipboard-list"} size={11} />
            {n.type}
          </Pill>
          <Pill tone={tone}>{n.priority}</Pill>
        </div>
        <span style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
          {new Date(n.createdAt).toLocaleDateString("en-IN", {
            day: "2-digit", month: "short", year: "numeric",
          })}
        </span>
      </div>

      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--r-fg-1)" }}>{n.title}</div>
        <p style={{ fontSize: 13, color: "var(--r-fg-3)", marginTop: 5, lineHeight: 1.55 }}>{n.description}</p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>— {n.createdByName}</span>
        {n.expiresAt && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--r-fg-4)" }}>
            <Icon name="hourglass" size={11} /> Expires {new Date(n.expiresAt).toLocaleDateString("en-IN")}
          </span>
        )}
      </div>

      {isUrgent && (
        <div style={{ paddingTop: 10, borderTop: "1px solid var(--r-hairline)" }}>
          {isAcknowledged ? (
            <Pill tone="paid">
              <Icon name="check-circle-2" size={12} /> You acknowledged this notice
            </Pill>
          ) : (
            <Btn variant="primary" size="sm" icon="hand" onClick={() => onAcknowledge(n._id)}>
              Acknowledge this notice
            </Btn>
          )}
        </div>
      )}
    </Card>
    </div>
  );
}

export default function MemberNoticesPage() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [toast, setToast] = useState(null);
  const [acknowledged, setAcknowledged] = useState(new Set());
  const viewedRef = useRef(new Set());

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchNotices = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 20 });
      if (filterType !== "all") params.set("type", filterType);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, page]);

  // Auto mark-viewed using IntersectionObserver
  useEffect(() => {
    if (!notices.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = entry.target.dataset.id;
            if (id && !viewedRef.current.has(id)) {
              viewedRef.current.add(id);
              fetch(`/api/notices/${id}/viewed`, {
                method: "POST",
                credentials: "include",
              }).catch(() => {});
            }
          }
        });
      },
      { threshold: 0.6 },
    );
    document
      .querySelectorAll("[data-id]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [notices]);

  const handleAcknowledge = async (id) => {
    try {
      const res = await fetch(`/api/notices/${id}/acknowledge`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAcknowledged((prev) => new Set([...prev, id]));
      showToast("Acknowledged successfully!");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const urgentNotices = notices.filter((n) => n.priority === "urgent");
  const pinnedNotices = notices.filter(
    (n) => n.pinned && n.priority !== "urgent",
  );
  const restNotices = notices.filter(
    (n) => !n.pinned && n.priority !== "urgent",
  );
  const showGroupLabels = urgentNotices.length > 0 || pinnedNotices.length > 0;

  const filterOptions = [
    { value: "all", label: "All" },
    ...TYPES.map((t) => ({ value: t, label: t, icon: TYPE_ICONS[t] })),
  ];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="megaphone" size={11} /> Notice Board</>}
        title="Society Notices"
        sub="Stay updated with announcements from your society"
      />

      <div style={{ marginBottom: 18, overflowX: "auto" }}>
        <Segmented
          value={filterType}
          onChange={(v) => { setFilterType(v); setPage(1); }}
          options={filterOptions}
        />
      </div>

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          {[1, 2, 3, 4].map((i) => <RevampSkeleton key={i} h={120} />)}
        </div>
      ) : notices.length === 0 ? (
        <Card><EmptyState icon="inbox" title="No notices yet" sub="Check back soon!" /></Card>
      ) : (
        <>
          {urgentNotices.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <SectionLabel icon="alert-triangle">Urgent Notices</SectionLabel>
              <div style={{ display: "grid", gap: 12 }}>
                {urgentNotices.map((n) => (
                  <NoticeCard key={n._id} n={n} acknowledged={acknowledged} onAcknowledge={handleAcknowledge} />
                ))}
              </div>
            </div>
          )}

          {pinnedNotices.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <SectionLabel icon="pin">Pinned</SectionLabel>
              <div style={{ display: "grid", gap: 12 }}>
                {pinnedNotices.map((n) => (
                  <NoticeCard key={n._id} n={n} acknowledged={acknowledged} onAcknowledge={handleAcknowledge} />
                ))}
              </div>
            </div>
          )}

          {restNotices.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              {showGroupLabels && <SectionLabel icon="list">All Notices</SectionLabel>}
              <div style={{ display: "grid", gap: 12 }}>
                {restNotices.map((n) => (
                  <NoticeCard key={n._id} n={n} acknowledged={acknowledged} onAcknowledge={handleAcknowledge} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {pagination.pages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 20 }}>
          <Btn variant="secondary" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Prev
          </Btn>
          <span style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>
            Page {page} of {pagination.pages}
          </span>
          <Btn variant="secondary" size="sm" iconR="chevron-right" disabled={page >= pagination.pages} onClick={() => setPage(page + 1)}>
            Next
          </Btn>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
