"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader, Card, Btn, Icon, Pill, Segmented, RevampSkeleton, EmptyState,
} from "@/components/revamp";

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
const CATEGORY_ICONS = {
  noise: "volume-2",
  parking: "car",
  water: "droplet",
  security: "lock",
  cleanliness: "sparkles",
  maintenance: "wrench",
  billing: "indian-rupee",
  staff: "hard-hat",
  pets: "paw-print",
  other: "clipboard-list",
};

export default function PublicComplaintsPage() {
  const router = useRouter();
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});

  const fetchComplaints = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, limit: 15 });
      if (category !== "all") params.set("category", category);
      const res = await fetch(`/api/complaints?${params}`, {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, page]);

  const timeAgo = (date) => {
    const diff = (Date.now() - new Date(date)) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const categoryOptions = CATEGORIES.map((c) => ({
    value: c,
    label: `${c !== "all" ? CATEGORY_ICONS[c] + " " : ""}${c.charAt(0).toUpperCase() + c.slice(1)}`,
  }));

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="message-square" size={11} /> Community</>}
        title="Community Complaints"
        sub="Anonymous complaints approved by society admin"
        right={
          <Btn variant="primary" icon="plus" onClick={() => router.push("/member/complaints/new")}>
            New Complaint
          </Btn>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <Segmented
          value={category}
          onChange={(v) => { setCategory(v); setPage(1); }}
          options={categoryOptions}
        />
      </Card>

      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {[1, 2, 3].map((i) => <RevampSkeleton key={i} h={140} />)}
        </div>
      ) : complaints.length === 0 ? (
        <Card><EmptyState icon="inbox" title="No complaints" sub="No complaints in this category yet." /></Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {complaints.map((c) => (
            <Card key={c._id} hover style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Pill tone="neutral" dot={false}>
                  <Icon name={CATEGORY_ICONS[c.category] || "clipboard-list"} size={13} /> {c.category}
                </Pill>
                <span style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{timeAgo(c.createdAt)}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--r-fg-1)" }}>{c.title}</div>
              <p style={{ fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.5, margin: 0 }}>{c.description}</p>
              <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 2 }}>— {c.anonymousName}</div>
            </Card>
          ))}
        </div>
      )}

      {pagination.pages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 20 }}>
          <Btn variant="ghost" icon="chevron-left" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Prev
          </Btn>
          <span style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>
            Page {page} of {pagination.pages}
          </span>
          <Btn variant="ghost" iconR="chevron-right" disabled={page >= pagination.pages} onClick={() => setPage(page + 1)}>
            Next
          </Btn>
        </div>
      )}
    </div>
  );
}
