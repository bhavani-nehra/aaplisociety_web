"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";

async function adminFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function CollectionBreakdown({ collections }) {
  const dirty = collections.filter((c) => !c.inSync);
  const rows = dirty.length > 0 ? dirty : collections;
  return (
    <div style={{ background: "var(--bg-sunken)", borderTop: "1px solid var(--border)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["Collection", "Test", "Staging", "Missing", "Status"].map((h) => (
              <th key={h} style={{ padding: "6px 12px", textAlign: "left", color: "var(--fg-5)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.name}>
              <td style={{ padding: "5px 12px", fontFamily: "monospace", color: "var(--fg-3)" }}>{c.name}</td>
              <td style={{ padding: "5px 12px", color: "var(--fg-4)" }}>{c.testCount}</td>
              <td style={{ padding: "5px 12px", color: "var(--fg-4)" }}>{c.stagingCount}</td>
              <td style={{ padding: "5px 12px", color: c.missing > 0 ? "var(--warning)" : "var(--fg-4)" }}>{c.missing}</td>
              <td style={{ padding: "5px 12px" }}>
                {c.inSync ? (
                  <span style={{ color: "var(--success)" }}>✅</span>
                ) : (
                  <span style={{ color: "var(--warning)" }}>🟡 {c.missing} missing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {dirty.length === 0 && (
        <div style={{ padding: "8px 12px", color: "var(--fg-5)", fontSize: 12 }}>
          Showing all {collections.length} collection(s) — all in sync.
        </div>
      )}
    </div>
  );
}

function SocietyRow({ society, onSync, syncing }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr style={{ borderBottom: expanded ? "none" : "1px solid var(--bg-muted)" }}>
        <td style={{ padding: "10px 12px" }}>
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--fg-4)", padding: 0, marginRight: 8, fontSize: 11 }}
          >
            {expanded ? "▾" : "▸"}
          </button>
          <span style={{ fontWeight: 600, color: "var(--fg-2)" }}>{society.name}</span>
        </td>
        <td style={{ padding: "10px 12px" }}>{society.inTest ? "✅" : "—"}</td>
        <td style={{ padding: "10px 12px" }}>{society.inStaging ? "✅" : "—"}</td>
        <td style={{ padding: "10px 12px", color: "var(--fg-3)" }}>
          {society.totalTest} / {society.totalStaging}
        </td>
        <td style={{ padding: "10px 12px", color: society.totalMissing > 0 ? "var(--warning)" : "var(--fg-3)" }}>
          {society.totalMissing}
        </td>
        <td style={{ padding: "10px 12px" }}>
          {society.inSync ? (
            <span style={{ color: "var(--success)" }}>✅ in sync</span>
          ) : (
            <span style={{ color: "var(--warning)" }}>🟡 {society.totalMissing} missing</span>
          )}
        </td>
        <td style={{ padding: "10px 12px" }}>
          <button
            onClick={() => onSync(society)}
            disabled={syncing || society.totalMissing === 0}
            style={{
              padding: "0.45rem 1rem",
              borderRadius: 8,
              border: "none",
              fontWeight: 700,
              fontSize: 12,
              cursor: society.totalMissing > 0 ? "pointer" : "not-allowed",
              background: society.totalMissing > 0 ? "var(--primary)" : "var(--border)",
              color: society.totalMissing > 0 ? "#fff" : "var(--fg-5)",
              whiteSpace: "nowrap",
            }}
          >
            {syncing ? "Syncing..." : "⬇ Sync to Staging"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <CollectionBreakdown collections={society.collections} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function DbSyncPage() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState(null);
  const [syncingId, setSyncingId] = useState(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["db-sync-status"],
    queryFn: () => adminFetch("/api/superadmin/db-sync"),
  });

  const syncMutation = useMutation({
    mutationFn: (societyId) =>
      adminFetch("/api/superadmin/db-sync", {
        method: "POST",
        body: JSON.stringify({ societyId }),
      }),
    onSuccess: (res, societyId) => {
      setLastResult(res);
      notify.success(`Copied ${res.totalInserted} missing document(s) into staging.`);
      qc.invalidateQueries({ queryKey: ["db-sync-status"] });
    },
    onError: (err) => notify.error(err.message),
    onSettled: () => setSyncingId(null),
  });

  const societies = data?.societies || [];
  const totalMissing = data?.totalMissing ?? 0;
  const allInSync = !isLoading && !error && totalMissing === 0 && societies.length > 0;

  const handleSync = (society) => {
    setSyncingId(society.id);
    syncMutation.mutate(society.id);
  };

  return (
    <div style={{ padding: 0, maxWidth: 1100, margin: "0 auto", color: "var(--fg-2)" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, color: "var(--fg-2)" }}>DB Sync — Test → Staging</h1>
        <p style={{ color: "var(--fg-4)", fontSize: "0.85rem", marginTop: 4 }}>
          Per-society, one-way copy from the test cluster into staging. Skips documents that
          already exist in staging — never overwrites, never deletes.
        </p>
      </div>

      {error && (
        <div style={{ padding: "1rem 1.25rem", borderRadius: 8, background: "var(--danger-bg, #fee)", border: "1px solid var(--danger)", color: "var(--danger)", marginBottom: "1.25rem" }}>
          {error.message}
          {error.message?.includes("MONGODB_STAGING_URI") && (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Add <code>MONGODB_STAGING_URI</code> to your env vars (Vercel project settings or
              .env.local) with the staging cluster's connection string.
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "1rem 1.25rem",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--bg-surface)",
          marginBottom: "1.25rem",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: 20 }}>{allInSync ? "✅" : isLoading ? "⏳" : "🟡"}</span>
        {isLoading
          ? "Checking status..."
          : allInSync
          ? "All societies in sync"
          : `${totalMissing} document(s) missing in staging across ${societies.filter((s) => !s.inSync).length} society(ies)`}
      </div>

      {lastResult && (
        <div style={{ padding: "0.9rem 1.25rem", borderRadius: 8, background: "var(--success-bg)", border: "1px solid var(--success)", color: "var(--success-fg)", marginBottom: "1.25rem", fontSize: 13 }}>
          Last sync: inserted {lastResult.totalInserted} document(s) across{" "}
          {lastResult.results.filter((r) => r.inserted > 0).length} collection(s).
        </div>
      )}

      <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg-sunken)" }}>
              {["Society", "In Test", "In Staging", "Docs (test/staging)", "Missing", "Status", ""].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "var(--fg-4)", fontWeight: 600, borderBottom: "1px solid var(--border)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)" }}>Loading...</td></tr>
            ) : societies.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--fg-4)" }}>No societies found.</td></tr>
            ) : (
              societies.map((s) => (
                <SocietyRow
                  key={s.id}
                  society={s}
                  onSync={handleSync}
                  syncing={syncingId === s.id}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
