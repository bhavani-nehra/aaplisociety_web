"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Card,
  PageHeader,
  Button,
  Select,
  Input,
  Spinner,
  EmptyState,
  tokens,
  fmtTime,
} from "@/components/visitor/ui";
async function api(url) {
  const res = await fetch(url, { credentials: "include" });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}
const ACTION_META = {
  VISITOR_OFFLINE_ENTRY: { label: "Offline entry", color: "var(--warning)" },
  VISITOR_ENTRY_CONFIRMED: { label: "Confirmed", color: "var(--success)" },
  VISITOR_ENTRY_FLAGGED: { label: "Flagged", color: "var(--danger)" },
};
const S = {
  filters: {
    display: "grid",
    gridTemplateColumns: "1.5fr 1fr 1fr",
    gap: 10,
    marginBottom: 16,
  },
  filterItem: { display: "flex", flexDirection: "column", gap: 4 },
  filterLabel: { fontSize: 12, fontWeight: 600, color: tokens.sub },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: 12,
    color: tokens.sub,
    borderBottom: tokens.border,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 12px",
    borderBottom: "1px solid var(--bg-muted)",
    verticalAlign: "top",
  },
  badge: (c) => ({
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    background: `${c}22`,
    color: c,
    whiteSpace: "nowrap",
  }),
  sub: { fontSize: 12, color: tokens.sub, marginTop: 2 },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 14,
  },
  pageInfo: { fontSize: 13, color: tokens.sub },
  resultMeta: { fontSize: 13, color: tokens.sub, marginBottom: 10 },
};
export default function AdminVisitorAudit() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ action: "", from: "", to: "" });
  const set = (k, v) => {
    setPage(1);
    setF((prev) => ({ ...prev, [k]: v }));
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "25" });
      if (f.action) params.set("action", f.action);
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      const data = await api("/api/admin/visitors/audit?" + params.toString());
      setRows((data && data.logs) || []);
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
  return (
    <div>
      <PageHeader
        title="Offline Entry Audit"
        subtitle="Every offline gate entry and the resident's confirm / flag decision"
      />
      <Card>
        <div style={S.filters}>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>Event</label>
            <Select
              value={f.action}
              onChange={(e) => set("action", e.target.value)}
            >
              <option value="">All offline events</option>
              <option value="VISITOR_OFFLINE_ENTRY">Offline entry</option>
              <option value="VISITOR_ENTRY_CONFIRMED">
                Confirmed by resident
              </option>
              <option value="VISITOR_ENTRY_FLAGGED">Flagged by resident</option>
            </Select>
          </div>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>From</label>
            <Input
              type="date"
              value={f.from}
              onChange={(e) => set("from", e.target.value)}
            />
          </div>
          <div style={S.filterItem}>
            <label style={S.filterLabel}>To</label>
            <Input
              type="date"
              value={f.to}
              onChange={(e) => set("to", e.target.value)}
            />
          </div>
        </div>
        <div style={S.resultMeta}>
          {total} event{total === 1 ? "" : "s"}
        </div>
        {loading ? (
          <div style={S.center}>
            <Spinner size={28} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="clipboard-list"
            title="No offline events"
            subtitle="Offline entries and resident confirmations will appear here."
          />
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Time</th>
                  <th style={S.th}>Event</th>
                  <th style={S.th}>By</th>
                  <th style={S.th}>Visitor</th>
                  <th style={S.th}>Flat</th>
                  <th style={S.th}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const meta = ACTION_META[l.action] || {
                    label: l.action,
                    color: tokens.sub,
                  };
                  const d = l.newData || {};
                  const actor = l.userId || {};
                  return (
                    <tr key={l._id}>
                      <td style={S.td}>
                        {fmtTime(l.timestamp || l.createdAt)}
                      </td>
                      <td style={S.td}>
                        <span style={S.badge(meta.color)}>{meta.label}</span>
                      </td>
                      <td style={S.td}>
                        {actor.name || "—"}
                        {actor.gateLabel ? (
                          <div style={S.sub}>{actor.gateLabel}</div>
                        ) : null}
                      </td>
                      <td style={S.td}>
                        {d.name || "—"}
                        {d.purpose ? (
                          <div style={S.sub}>{d.purpose}</div>
                        ) : null}
                      </td>
                      <td style={S.td}>
                        {d.wing ? `${d.wing}-` : ""}
                        {d.flatNo || (d.name ? "" : "—")}
                      </td>
                      <td style={S.td}>
                        {l.action === "VISITOR_OFFLINE_ENTRY"
                          ? d.note
                            ? `${d.note}`
                            : "—"
                          : d.decision
                            ? `Decision: ${d.decision}`
                            : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={S.pager}>
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Prev
          </Button>
          <span style={S.pageInfo}>Page {page}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
        </div>
      </Card>
    </div>
  );
}
