"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";

async function adminFetch(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
  } catch {
    const err = new Error("Can't reach the server. Check your connection and try again.");
    err.network = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const STATUS_TONE = {
  awaiting_consent: { label: "Awaiting consent", color: "var(--warning, #b45309)" },
  pending_otp: { label: "Confirming code", color: "var(--warning, #b45309)" },
  active: { label: "Active", color: "var(--success)" },
  expired: { label: "Expired", color: "var(--fg-4)" },
  revoked: { label: "Ended", color: "var(--fg-4)" },
  denied: { label: "Denied", color: "var(--danger)" },
};

function fmt(iso) {
  return iso ? new Date(iso).toLocaleString("en-IN") : "—";
}

// Cross-society view of every takeover grant — what the per-ticket control
// in app/superadmin/tickets/page.js can't show, since that's scoped to one
// ticket. See docs/superpowers/specs/2026-09-11-society-takeover-design.md.
export default function TakeoverSessionsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["superadmin-takeover-all", statusFilter],
    queryFn: () => adminFetch(`/api/superadmin/takeover?all=1&status=${statusFilter}`),
    refetchInterval: 10000,
    retry: 2,
  });

  const endMutation = useMutation({
    mutationFn: (grantId) => adminFetch(`/api/superadmin/takeover/${grantId}/end`, { method: "POST" }),
    onSuccess: (res) => {
      notify.success(res.alreadyEnded ? "Session had already ended." : "Session ended.");
      qc.invalidateQueries({ queryKey: ["superadmin-takeover-all"] });
    },
    onError: (err) => {
      notify.error(err.message);
      qc.invalidateQueries({ queryKey: ["superadmin-takeover-all"] });
    },
  });

  const grants = data?.grants || [];

  return (
    <div style={{ padding: "2rem", maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.5rem" }}>Takeover Sessions</h1>
      <p style={{ color: "var(--fg-4)", marginBottom: "1.5rem" }}>
        Every support-access request across every society — consent, activity, and endings.
      </p>

      <div style={{ display: "flex", gap: "1rem", marginBottom: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
        >
          <option value="all">All statuses</option>
          {Object.keys(STATUS_TONE).map((s) => (
            <option key={s} value={s}>{STATUS_TONE[s].label}</option>
          ))}
        </select>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          style={{ padding: "0.5rem 1rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-surface)", cursor: "pointer" }}
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div style={{ padding: "1rem 1.25rem", borderRadius: 8, background: "var(--danger-bg, #fee)", border: "1px solid var(--danger)", color: "var(--danger)", marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>{error.message}</span>
          <button onClick={() => refetch()} style={{ padding: "0.4rem 0.9rem", borderRadius: 6, border: "1px solid var(--danger)", background: "transparent", color: "var(--danger)", cursor: "pointer", fontWeight: 700 }}>
            Retry
          </button>
        </div>
      )}

      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-sunken)" }}>
                {["Society", "Ticket", "Scope", "Requested by", "Status", "Requested", "Expires / Ended", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)" }}>Loading…</td></tr>
              ) : grants.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)" }}>No takeover requests yet.</td></tr>
              ) : (
                grants.map((g) => {
                  const tone = STATUS_TONE[g.status] || { label: g.status, color: "var(--fg-4)" };
                  return (
                    <tr key={g._id} style={{ borderBottom: "1px solid var(--bg-muted)" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{g.societyName || "—"}</td>
                      <td style={{ padding: "10px 12px" }}>{g.ticketTitle || "—"}</td>
                      <td style={{ padding: "10px 12px" }}>{g.scope === "write" ? "View + edit" : "View only"}</td>
                      <td style={{ padding: "10px 12px" }}>{g.requestedByName}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700, background: `${tone.color}22`, color: tone.color, whiteSpace: "nowrap" }}>
                          {tone.label}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{fmt(g.createdAt)}</td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                        {g.status === "active" ? fmt(g.expiresAt) : fmt(g.endedAt)}
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {g.status === "active" && (
                          <button
                            onClick={() => endMutation.mutate(g._id)}
                            disabled={endMutation.isPending}
                            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--danger)", color: "var(--danger)", background: "transparent", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                          >
                            End
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
