"use client";
import { useCallback, useEffect, useState } from "react";
import {
  PageHeader, Card, Btn, Icon, Avatar, Pill, SearchInput, Select,
  DataTable, RevampSkeleton,
} from "@/components/revamp";
import { VISITOR_STATUSES, VISITOR_PURPOSES } from "@/lib/visitor-config";

async function api(url) {
  const res = await fetch(url, { credentials: "include" });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const STATUSES = Array.isArray(VISITOR_STATUSES)
  ? VISITOR_STATUSES
  : ["Pending", "Approved", "Rejected", "Entered", "Exited", "Expired"];
const PURPOSES = Array.isArray(VISITOR_PURPOSES)
  ? VISITOR_PURPOSES
  : ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"];

// Same status -> tone mapping as the sibling overview page
// (app/admin/visitors/PageClient.js), plus Expired, which the overview
// dashboard never renders but the full log does.
const STATUS_TONE = {
  Pending: "warning", Approved: "info", Entered: "paid",
  Exited: "neutral", Rejected: "unpaid", Expired: "neutral",
};
const fmtTime = (v) => (v ? new Date(v).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "—");

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--r-fg-4)" }}>{label}</label>
      {children}
    </div>
  );
}

export default function AdminVisitorLog() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({
    q: "",
    status: "",
    purpose: "",
    entry: "",
    from: "",
    to: "",
  });
  const set = (k, v) => {
    setPage(1);
    setF((prev) => ({ ...prev, [k]: v }));
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (f.q) params.set("q", f.q);
      if (f.status) params.set("status", f.status);
      if (f.purpose) params.set("purpose", f.purpose);
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      if (f.entry === "offline") params.set("offline", "1");
      const data = await api("/api/admin/visitors?" + params.toString());
      setRows((data && data.visitors) || []);
      setTotal((data && data.total) || 0);
      setHasMore((data && data.hasMore) || false);
    } catch (_) {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, f]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const cols = [
    {
      key: "visitor", label: "Visitor",
      render: (v) => (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={v.name} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{v.name}</div>
            {v.phone && <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{v.phone}</div>}
          </div>
        </div>
      ),
    },
    { key: "purpose", label: "Purpose", render: (v) => <span style={{ color: "var(--r-fg-2)" }}>{v.purpose}</span> },
    {
      key: "flat", label: "Flat",
      render: (v) => (v.memberId && v.memberId.wing ? `${v.memberId.wing}-` : "") + ((v.memberId && v.memberId.flatNo) || "—"),
    },
    { key: "vehicle", label: "Vehicle", render: (v) => v.vehicleNumber || "—" },
    { key: "loggedBy", label: "Logged by", render: (v) => (v.enteredBy && v.enteredBy.name) || "—" },
    { key: "time", label: "Time", render: (v) => fmtTime(v.entryTime || v.createdAt) },
    { key: "status", label: "Status", render: (v) => <Pill tone={STATUS_TONE[v.status] || "neutral"}>{v.status}</Pill> },
    {
      key: "entry", label: "Entry",
      render: (v) =>
        v.entryMethod === "OfflineEntry" ? (
          <span
            title={(v.offlineMeta && v.offlineMeta.note) || ""}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--r-fg-3)" }}
          >
            <Icon name="wifi-off" size={12} color="var(--r-fg-4)" />
            Offline
            {v.offlineMeta && v.offlineMeta.confirmation ? ` · ${v.offlineMeta.confirmation.status}` : ""}
          </span>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--r-fg-3)" }}>
            <Icon name="wifi" size={12} color="var(--r-fg-4)" />
            Online
          </span>
        ),
    },
  ];

  return (
    <div style={{ maxWidth: 1300, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="scroll-text" size={11} /> Operations · Visitors</>}
        title="Visitor Log"
        sub="Complete, searchable history of every visitor"
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <Field label="Search">
            <SearchInput placeholder="Name, phone or vehicle" value={f.q} onChange={(v) => set("q", v)} />
          </Field>
          <Field label="Status">
            <Select value={f.status} onChange={(v) => set("status", v)} style={{ width: "100%" }}>
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Purpose">
            <Select value={f.purpose} onChange={(v) => set("purpose", v)} style={{ width: "100%" }}>
              <option value="">All</option>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Field label="From">
            <input type="date" className="input" value={f.from} onChange={(e) => set("from", e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" className="input" value={f.to} onChange={(e) => set("to", e.target.value)} />
          </Field>
          <Field label="Entry">
            <Select value={f.entry} onChange={(v) => set("entry", v)} style={{ width: "100%" }}>
              <option value="">All</option>
              <option value="offline">Offline only</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div style={{ fontSize: 13, color: "var(--r-fg-4)", marginBottom: 10 }}>
        {total} result{total === 1 ? "" : "s"}
      </div>

      {loading ? (
        <RevampSkeleton h={360} />
      ) : (
        <DataTable
          cols={cols}
          rows={rows}
          rowKey="_id"
          emptyIcon="search"
          emptyTitle="No matching visitors"
          emptySub="Try adjusting the filters."
        />
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
        <Btn variant="ghost" size="sm" icon="chevron-left" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Prev
        </Btn>
        <span style={{ fontSize: 13, color: "var(--r-fg-4)" }}>Page {page}</span>
        <Btn variant="ghost" size="sm" iconR="chevron-right" disabled={!hasMore} onClick={() => setPage((p) => p + 1)}>
          Next
        </Btn>
      </div>
    </div>
  );
}
