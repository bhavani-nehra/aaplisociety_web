"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Btn, Card, Pill, Segmented, StatTile, Table, Icon } from "@/app/admin/commercial/_ui";
import { useMounted } from "@/components/revamp";
import notify from "@/lib/notify";

// Admin custody of resident amenity cards: find a card, confirm who holds it,
// revoke it when it is lost or the resident has moved out.
//
// Deliberately read-mostly. Cards are issued by the resident opening My Amenity
// Cards, and revoking is the only write on this screen — so the page is a
// searchable register with one destructive action, not a CRUD table.
//
// Animation notes (following the house animation guide):
// • Layout-critical CSS for the dialog and backdrop is inline, so it cannot be
//   lost to a stylesheet that loads later or a breakpoint override.
// • The dialog is a spring (320/30) scale+fade from 0.97, never a slide, and the
//   originating row keeps a brand outline so the connection is visible.
// • AnimatePresence is keyed on the real card id.
// • Nothing animates position via top/left; only transform and opacity.
// • prefers-reduced-motion collapses every duration to 0 rather than changing
//   what is on screen.

const STATUS_TABS = [
  { value: "ACTIVE", label: "Active" },
  { value: "REVOKED", label: "Revoked" },
  { value: "", label: "All" },
];

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export default function PageClient() {
  const reduced = useReducedMotion();
  // The dialog/backdrop/toast below are position:fixed, rendered directly in
  // the page. DashboardLayout.js wraps every page in .contentFrame, which
  // sets backdrop-filter — a CSS containing block for fixed descendants — so
  // without a portal these were fixed to that scrolled content box, not the
  // real viewport. `mounted` keeps the portal call out of the SSR pass.
  const mounted = useMounted();
  const [status, setStatus] = useState("ACTIVE");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState("");
  const [revoking, setRevoking] = useState(false);
  const [reissuingId, setReissuingId] = useState(null);
  const [toast, setToast] = useState("");
  const reasonRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams({ page: String(page), limit: "25" });
      if (status) sp.set("status", status);
      if (q.trim()) sp.set("q", q.trim());
      const res = await fetch(`/api/amenities/member-cards?${sp}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not load cards.");
      setData(body.data || body);
    } catch (e) {
      setError(e.message || "Could not load cards.");
    } finally {
      setLoading(false);
    }
  }, [page, q, status]);

  // Debounced so typing a flat number is one request, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(load, q ? 280 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e) => e.key === "Escape" && setTarget(null);
    window.addEventListener("keydown", onKey);
    // Focus lands on the reason field, because the reason is required and the
    // dialog is otherwise a dead end for a keyboard.
    const t = setTimeout(() => reasonRef.current?.focus(), reduced ? 0 : 120);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [target, reduced]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const cards = data?.cards || [];
  const counts = data?.counts || {};

  const revoke = async () => {
    if (!target || reason.trim().length < 3) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/amenities/member-cards/${target._id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not revoke this card.");
      setToast(body?.data?.message || "Card revoked.");
      setTarget(null);
      setReason("");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setRevoking(false);
    }
  };

  // One click, no dialog: revokes the current card (if still active) and
  // mints a fresh one for the same holder in a single request (see
  // memberCardService.reissueCard()). Works from either status - a REVOKED
  // card has nothing left to revoke, so the service just issues the
  // replacement straight away.
  const reissue = async (card) => {
    if (!(await notify.confirm(`Issue a new card for ${card.holderName}? ${card.status === "ACTIVE" ? "The current one stops working immediately." : ""}`, { tone: "warning" }))) return;
    setReissuingId(card._id);
    try {
      const res = await fetch(`/api/amenities/member-cards/${card._id}/reissue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Reissued from the admin card screen" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not reissue this card.");
      setToast(body?.data?.message || body?.message || "New card issued.");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setReissuingId(null);
    }
  };

  const spring = reduced
    ? { duration: 0 }
    : { type: "spring", stiffness: 320, damping: 30 };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.01em" }}>Amenity Cards</h1>
          <p style={{ margin: "6px 0 0", color: "var(--cx-fg3)", fontSize: 13, maxWidth: 620 }}>
            Every stored owner and family member carries a permanent card. Cards are created the first
            time a resident opens <strong>My Amenity Cards</strong> and update themselves when approved
            member details change. Revoking is the only change made from here.
          </p>
        </div>
        <Btn variant="ghost" onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <StatTile label="Active cards" value={counts.active ?? "—"} />
        <StatTile label="Revoked" value={counts.revoked ?? "—"} />
        <StatTile
          label="Flats with cards"
          value={counts.flatsTotal ? `${counts.flatsWithCards} / ${counts.flatsTotal}` : "—"}
          hint="Remaining flats generate theirs on first open"
        />
      </div>

      <Card>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <Segmented
            options={STATUS_TABS}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Card number, resident, flat or phone"
            style={{
              flex: "1 1 260px",
              minWidth: 200,
              padding: "9px 12px",
              borderRadius: 10,
              border: "1px solid var(--cx-border)",
              background: "var(--cx-surface2)",
              color: "var(--cx-fg1)",
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>

        {error ? (
          <div style={{ padding: "14px 0", color: "var(--cx-danger)", fontSize: 13 }}>{error}</div>
        ) : null}

        <Table
          head={["Card", "Holder", "Flat", "Contact", "Issued", "Last scan", ""]}
          empty={loading ? "Loading cards…" : "No cards match that search."}
        >
          {cards.map((c) => {
            const isTarget = target?._id === c._id;
            return (
              <tr
                key={c._id}
                style={{
                  // The row the dialog came from stays marked while it is open, so
                  // the confirmation is anchored to something the eye can find.
                  outline: isTarget ? "2px solid var(--cx-brand)" : "none",
                  outlineOffset: -2,
                  transition: reduced ? "none" : "outline-color 160ms ease",
                }}
              >
                <td style={{ fontFamily: "var(--cx-mono, ui-monospace)", fontSize: 12.5, whiteSpace: "nowrap" }}>
                  {c.cardNo}
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{c.holderName}</div>
                  <div style={{ color: "var(--cx-fg3)", fontSize: 12 }}>
                    {c.holderKind === "OWNER" ? "Owner" : c.relation || "Family"}
                  </div>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{[c.wing, c.flatNo].filter(Boolean).join("-")}</td>
                <td style={{ whiteSpace: "nowrap", color: "var(--cx-fg2)" }}>{c.contactNumber || "—"}</td>
                <td style={{ whiteSpace: "nowrap", color: "var(--cx-fg3)", fontSize: 12.5 }}>
                  {c.issuedAt ? new Date(c.issuedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                </td>
                <td style={{ whiteSpace: "nowrap", color: "var(--cx-fg3)", fontSize: 12.5 }}>
                  {c.lastScannedAt
                    ? new Date(c.lastScannedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                    : "Never"}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    {c.status === "REVOKED" ? <Pill tone="danger">Revoked</Pill> : null}
                    {c.status !== "REVOKED" ? (
                      <Btn variant="ghost" tone="danger" onClick={() => setTarget(c)}>
                        Revoke
                      </Btn>
                    ) : null}
                    {/* Works on either status - see reissue() above. The one
                        answer to "the resident's code stopped working" and
                        "they lost their phone, replace it now." */}
                    <Btn
                      variant="ghost"
                      onClick={() => reissue(c)}
                      disabled={reissuingId === c._id}
                    >
                      {reissuingId === c._id ? "Issuing…" : "Reissue"}
                    </Btn>
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>

        {data?.totalPages > 1 ? (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <Btn variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Btn>
            <span style={{ alignSelf: "center", color: "var(--cx-fg3)", fontSize: 12.5 }}>
              Page {page} of {data.totalPages}
            </span>
            <Btn variant="ghost" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Btn>
          </div>
        ) : null}
      </Card>

      {mounted && createPortal(
      <AnimatePresence>
        {target ? (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.18 }}
              onClick={() => setTarget(null)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(10,10,15,0.4)",
                zIndex: 60,
              }}
            />
            <motion.div
              key={`dialog-${target._id}`}
              role="dialog"
              aria-modal="true"
              aria-label={`Revoke ${target.holderName}'s amenity card`}
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={spring}
              style={{
                position: "fixed",
                top: "6vh",
                bottom: "6vh",
                left: "calc(260px + 5vw)",
                right: "5vw",
                zIndex: 61,
                display: "flex",
                flexDirection: "column",
                background: "var(--cx-surface)",
                border: "1px solid var(--cx-border)",
                borderRadius: 18,
                boxShadow: "var(--cx-shadow-pop)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--cx-hairline)" }}>
                <div style={{ fontSize: 16, fontWeight: 650 }}>Revoke this card</div>
                <div style={{ color: "var(--cx-fg3)", fontSize: 12.5, marginTop: 4 }}>
                  {target.cardNo} · {target.holderName} · {[target.wing, target.flatNo].filter(Boolean).join("-")}
                </div>
              </div>

              <div style={{ padding: 22, overflowY: "auto", display: "grid", gap: 14 }}>
                <p style={{ margin: 0, fontSize: 13.5, color: "var(--cx-fg2)", lineHeight: 1.55 }}>
                  The card stops working at the clubhouse scanner immediately. Sessions already open stay
                  open and can still be checked out. This cannot be undone — the resident will receive a
                  new card the next time they open My Amenity Cards.
                </p>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 12.5, color: "var(--cx-fg3)" }}>Reason (recorded in the audit log)</span>
                  <textarea
                    ref={reasonRef}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder="Card lost, resident moved out, misuse reported…"
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--cx-border)",
                      background: "var(--cx-surface2)",
                      color: "var(--cx-fg1)",
                      fontSize: 13,
                      resize: "vertical",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </label>
              </div>

              <div style={{ padding: "14px 22px", borderTop: "1px solid var(--cx-hairline)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Btn variant="ghost" onClick={() => setTarget(null)} disabled={revoking}>
                  Cancel
                </Btn>
                <Btn tone="danger" onClick={revoke} disabled={revoking || reason.trim().length < 3}>
                  {revoking ? "Revoking…" : "Revoke card"}
                </Btn>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>,
      document.body
      )}

      {mounted && createPortal(
      <AnimatePresence>
        {toast ? (
          <motion.div
            key="toast"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: reduced ? 0 : 0.18 }}
            style={{
              position: "fixed",
              bottom: 24,
              left: "calc(260px + 24px)",
              zIndex: 62,
              padding: "11px 16px",
              borderRadius: 12,
              background: "var(--cx-surface3)",
              border: "1px solid var(--cx-border)",
              boxShadow: "var(--cx-shadow-pop)",
              fontSize: 13,
            }}
          >
            {toast}
          </motion.div>
        ) : null}
      </AnimatePresence>,
      document.body
      )}
    </div>
  );
}
