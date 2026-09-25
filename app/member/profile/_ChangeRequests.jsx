"use client";
// app/member/profile/_ChangeRequests.jsx
//
// Family members and parking are not directly editable by a resident (a wrong
// parking slot changes a bill, so it goes through admin approval — see
// lib/profile-edit-apply.js). Before this, the web profile page had no way to
// even ASK for one of these to change; the mobile app's ProfileEditRequest
// flow was the only door. This posts to the web equivalent,
// /api/member/profile-edit-requests, and shows what is already pending so a
// resident does not submit the same request twice.

import { useState } from "react";
import { apiClient } from "@/lib/api-client";
import { Btn, Pill } from "@/components/revamp";

const PARKING_TYPES = ["Stilt", "Open", "Covered"];
const VEHICLE_TYPES = ["Two-Wheeler", "Four-Wheeler"];

const box = { padding: "10px 0", borderBottom: "1px solid var(--r-border)" };
const label = { fontSize: 13, color: "var(--r-fg-4)", display: "block", marginBottom: 6 };

function PendingNote({ requests, section, familyMemberId }) {
  const pending = (requests || []).filter(
    (r) =>
      r.status === "Pending" &&
      r.section === section &&
      (familyMemberId === undefined || r.familyMemberId === familyMemberId),
  );
  if (!pending.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <Pill tone="warning">
        {pending.length === 1
          ? `A ${pending[0].action.toLowerCase()} request is waiting for admin approval.`
          : `${pending.length} requests for this are waiting for admin approval.`}
      </Pill>
    </div>
  );
}

export function RequestFamilyMember({ requests, onSent }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState({ name: "", relation: "", age: "", contactNumber: "", occupation: "" });

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post("/api/member/profile-edit-requests", {
        section: "FamilyMember",
        action: "Add",
        payload: {
          name: draft.name,
          // relation is required by the schema (min 1 char); default rather
          // than let an empty field turn into an unexplained 400.
          relation: draft.relation.trim() || "Family member",
          age: draft.age !== "" && Number(draft.age) > 0 ? Number(draft.age) : undefined,
          contactNumber: draft.contactNumber || undefined,
          occupation: draft.occupation || undefined,
        },
      });
      setOpen(false);
      setDraft({ name: "", relation: "", age: "", contactNumber: "", occupation: "" });
      onSent();
    } catch (e) {
      setErr(e?.message || "That request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <div style={box}>
        <Btn variant="ghost" size="sm" icon="plus" onClick={() => setOpen(true)}>
          Request to add a family member
        </Btn>
        <PendingNote requests={requests} section="FamilyMember" />
      </div>
    );

  return (
    <div style={box}>
      {err && <div style={{ color: "var(--r-danger)", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
        <div>
          <label style={label}>Name</label>
          <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div>
          <label style={label}>Relation</label>
          <input
            className="input"
            value={draft.relation}
            onChange={(e) => setDraft({ ...draft, relation: e.target.value })}
            placeholder="Spouse, Son..."
          />
        </div>
        <div>
          <label style={label}>Age</label>
          <input
            className="input"
            type="number"
            value={draft.age}
            onChange={(e) => setDraft({ ...draft, age: e.target.value })}
          />
        </div>
        <div>
          <label style={label}>Contact</label>
          <input
            className="input"
            value={draft.contactNumber}
            onChange={(e) => setDraft({ ...draft, contactNumber: e.target.value })}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Btn variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Btn>
        <Btn variant="primary" size="sm" onClick={submit} disabled={busy || !draft.name.trim()}>
          {busy ? "Sending…" : "Send to admin for approval"}
        </Btn>
      </div>
    </div>
  );
}

export function RequestRemoveFamilyMember({ familyMemberId, requests, onSent }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const already = (requests || []).some(
    (r) => r.status === "Pending" && r.section === "FamilyMember" && r.familyMemberId === familyMemberId,
  );

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post("/api/member/profile-edit-requests", {
        section: "FamilyMember",
        action: "Remove",
        familyMemberId,
      });
      onSent();
    } catch (e) {
      setErr(e?.message || "That request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  if (already) return <Pill tone="warning">Removal pending approval</Pill>;
  return (
    <>
      <Btn variant="danger" size="sm" onClick={submit} disabled={busy}>
        {busy ? "Sending…" : "Request removal"}
      </Btn>
      {err && <div style={{ color: "var(--r-danger)", fontSize: 12, marginTop: 4 }}>{err}</div>}
    </>
  );
}

export function RequestParkingSlot({ requests, onSent }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [draft, setDraft] = useState({ slotNumber: "", type: "Open", vehicleType: "Four-Wheeler" });

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post("/api/member/profile-edit-requests", {
        section: "Parking",
        action: "Add",
        payload: draft,
      });
      setOpen(false);
      setDraft({ slotNumber: "", type: "Open", vehicleType: "Four-Wheeler" });
      onSent();
    } catch (e) {
      setErr(e?.message || "That request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  if (!open)
    return (
      <div style={box}>
        <Btn variant="ghost" size="sm" icon="plus" onClick={() => setOpen(true)}>
          Request to add a parking slot
        </Btn>
        <PendingNote requests={requests} section="Parking" />
      </div>
    );

  return (
    <div style={box}>
      {err && <div style={{ color: "var(--r-danger)", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
        <div>
          <label style={label}>Slot number</label>
          <input
            className="input"
            value={draft.slotNumber}
            onChange={(e) => setDraft({ ...draft, slotNumber: e.target.value })}
            placeholder="P-12"
          />
        </div>
        <div>
          <label style={label}>Type</label>
          <select className="input" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            {PARKING_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={label}>Vehicle</label>
          <select
            className="input"
            value={draft.vehicleType}
            onChange={(e) => setDraft({ ...draft, vehicleType: e.target.value })}
          >
            {VEHICLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 6 }}>
        {draft.type === "Stilt" ? "Stilt slots are not billed monthly." : "Non-Stilt slots are billed monthly once approved."}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Btn variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Btn>
        <Btn variant="primary" size="sm" onClick={submit} disabled={busy || !draft.slotNumber.trim()}>
          {busy ? "Sending…" : "Send to admin for approval"}
        </Btn>
      </div>
    </div>
  );
}

export function RequestRemoveParkingSlot({ slotNumber, requests, onSent }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const already = (requests || []).some(
    (r) =>
      r.status === "Pending" &&
      r.section === "Parking" &&
      r.action === "Remove" &&
      r.payload?.slotNumber === slotNumber,
  );

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post("/api/member/profile-edit-requests", {
        section: "Parking",
        action: "Remove",
        payload: { slotNumber },
      });
      onSent();
    } catch (e) {
      setErr(e?.message || "That request could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  if (already) return <Pill tone="warning">Removal pending approval</Pill>;
  return (
    <>
      <Btn variant="danger" size="sm" onClick={submit} disabled={busy}>
        {busy ? "Sending…" : "Request removal"}
      </Btn>
      {err && <div style={{ color: "var(--r-danger)", fontSize: 12, marginTop: 4 }}>{err}</div>}
    </>
  );
}
