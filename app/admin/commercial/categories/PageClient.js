"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Card, Pill, Btn, Icon } from "../_ui";

// Global categories are platform-managed and read-only here; a society can add
// and manage its own on top of them. Global rows are never copied per society.
export default function AdminCommercialCategoriesPage() {
  const [enabled, setEnabled] = useState(true);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  // The toast below is position:fixed; DashboardLayout.js's .contentFrame
  // sets backdrop-filter, which makes it the containing block for fixed
  // descendants — so without a portal the toast was fixed to that scrolled
  // box, not the real viewport. `mounted` keeps document access client-only.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const notify = (message, tone) => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/commercial/categories", { credentials: "include" });
      if (res.status === 403) {
        setEnabled(false);
        return;
      }
      setEnabled(true);
      setRows((await res.json()).categories ?? []);
    } catch {
      notify("Could not load categories", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/commercial/categories", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed");
      setName("");
      notify("Category added");
      load();
    } catch (e2) {
      notify(typeof e2.message === "string" ? e2.message : "Could not add", "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row) {
    setBusy(true);
    try {
      const res = await fetch(`/api/commercial/categories/${row.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Failed");
      load();
    } catch (e) {
      notify(String(e.message ?? e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <div className="commercial-scope cx-fade" style={{ padding: "1.75rem 2rem" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--cx-fg-1)", letterSpacing: "-0.018em" }}>
          Categories
        </h1>
        <Card style={{ marginTop: 16, borderColor: "var(--cx-warning)" }}>
          <span style={{ color: "var(--cx-warning)" }}>
            The commercial module is switched off for this society. Turn it on in{" "}
          </span>
          <Link href="/admin/society-config" style={{ fontWeight: 700, color: "var(--cx-brand)" }}>
            Society Config
          </Link>
          .
        </Card>
      </div>
    );
  }

  return (
    <div className="commercial-scope cx-fade" style={{ padding: "1.75rem 2rem" }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, color: "var(--cx-fg-4)", marginBottom: 8 }}>
          <Icon name="tag" size={11} /> Shops &amp; offices
        </div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--cx-fg-1)", letterSpacing: "-0.018em" }}>Categories</h1>
        <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--cx-fg-3)" }}>
          Shared defaults plus categories you add for this society.
        </p>
      </div>

      {loading ? (
        <p style={{ color: "var(--cx-fg-3)", fontSize: 13 }}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {rows.map((c) => (
            <Card key={c.id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--cx-brand-soft)", color: "var(--cx-brand)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon name="tag" size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cx-fg-1)" }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "var(--cx-fg-4)", marginTop: 2 }}>
                      {c.scope === "GLOBAL" ? "Shared default" : "This society"} · order {c.sortOrder}
                    </div>
                  </div>
                </div>
                <Pill tone={c.isActive ? "active" : "neutral"} dot={false}>
                  {c.isActive ? "Active" : "Hidden"}
                </Pill>
              </div>
              {c.scope === "SOCIETY" && (
                <div>
                  <Btn variant="ghost" disabled={busy} onClick={() => toggle(c)}>
                    {c.isActive ? "Hide" : "Show"}
                  </Btn>
                </div>
              )}
            </Card>
          ))}

          <Card style={{ border: "1px dashed var(--cx-border)", background: "transparent", boxShadow: "none", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--cx-fg-2)" }}>
              <Icon name="plus" size={14} /> New category
            </div>
            <form onSubmit={add} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                style={{ padding: "9px 11px", borderRadius: 8, border: "1px solid var(--cx-border)", fontSize: 13, fontFamily: "inherit", color: "var(--cx-fg-1)", background: "var(--cx-surface)" }}
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Tiffin Service"
              />
              <Btn variant="primary" type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add"}
              </Btn>
            </form>
          </Card>
        </div>
      )}

      {toast && mounted && createPortal(
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            color: "#fff",
            padding: "10px 16px",
            borderRadius: 10,
            fontSize: 14,
            background: toast.tone === "error" ? "var(--cx-danger)" : "var(--cx-fg-1)",
          }}
        >
          {toast.message}
        </div>,
        document.body
      )}
    </div>
  );
}
