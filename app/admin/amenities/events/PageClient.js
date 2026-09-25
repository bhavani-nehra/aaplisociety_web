"use client";
import { useState, useEffect, useCallback } from "react";
import notify from "@/lib/notify";
import {
  PageHeader, Card, CardHead, Btn, Pill, Icon, Tabs, DataTable,
  RevampSkeleton, Modal, Toast,
} from "@/components/revamp";

const iso = (d) => d.toISOString().slice(0, 10);
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const STATUS_TONE = { DRAFT: "neutral", PUBLISHED: "paid", CANCELLED: "unpaid", COMPLETED: "info" };
const REG_TONE = { ATTENDED: "paid", NO_SHOW: "unpaid" };
const when = (d) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Field({ label: l, children }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{l}</div>
      {children}
    </div>
  );
}

export default function EventsPage() {
  const [events, setEvents] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [detail, setDetail] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - 30 * 86400000);
      const to = new Date(Date.now() + 120 * 86400000);
      const params = new URLSearchParams({ from: iso(from), to: iso(to), limit: "100" });
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/amenities/events?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setEvents(data.events || []);
      else showToast(data.error || "Could not load events", "err");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
  }, []);

  const openDetail = async (ev) => {
    // Registrations and the waitlist are a separate read — the list view does not
    // need them, and most events are never opened.
    try {
      const [rRes, wRes] = await Promise.all([
        fetch(`/api/amenities/events/${ev._id}/registrations`, { credentials: "include" }),
        fetch(`/api/amenities/events/${ev._id}/waitlist`, { credentials: "include" }),
      ]);
      const [r, wl] = await Promise.all([rRes.json(), wRes.json()]);
      setDetail({ event: ev, registrations: r.registrations || [], waitlist: wl.waitlist || [] });
    } catch {
      showToast("Could not load registrations", "err");
    }
  };

  const create = async () => {
    if (!createModal.title?.trim() || !createModal.startAt || !createModal.endAt) {
      return showToast("Title, start and end are all required", "err");
    }
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/events", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amenityId: createModal.amenityId,
          title: createModal.title.trim(),
          description: createModal.description?.trim() || undefined,
          organizerName: createModal.organizerName?.trim() || undefined,
          startAt: new Date(createModal.startAt).toISOString(),
          endAt: new Date(createModal.endAt).toISOString(),
          capacity: createModal.capacity ? Number(createModal.capacity) : null,
          registrationRequired: createModal.registrationRequired,
          guestsAllowed: createModal.guestsAllowed,
          waitlistEnabled: createModal.waitlistEnabled,
          status: createModal.publish ? "PUBLISHED" : "DRAFT",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the event");
      showToast(createModal.publish ? "Event published — residents notified" : "Draft saved");
      setCreateModal(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const cancelEvent = async (e) => {
    const reason = await notify.prompt("Why is this event being cancelled? Registrants will be told.");
    if (reason === null) return;
    const res = await fetch(`/api/amenities/events/${e._id}`, {
      method: "DELETE", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const data = await res.json();
    if (!res.ok) return showToast(data.error || "Could not cancel", "err");
    showToast("Event cancelled — registrants notified");
    load();
  };

  const markAttendance = async (regId, st) => {
    const res = await fetch(`/api/amenities/events/${detail.event._id}/registrations`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ registrationId: regId, status: st }),
    });
    if (!res.ok) return showToast("Could not update", "err");
    showToast("Updated");
    openDetail(detail.event);
    load();
  };

  const cols = [
    {
      key: "event", label: "Event", render: (e) => (
        <div>
          <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{e.title}</div>
          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{e.amenityName}{e.organizerName ? ` · ${e.organizerName}` : ""}</div>
        </div>
      ),
    },
    { key: "when", label: "When", render: (e) => <span style={{ fontSize: 12.5 }}>{when(e.startAt)}</span> },
    {
      key: "registered", label: "Registered", render: (e) => {
        const full = e.capacity && (e.registeredCount || 0) >= e.capacity;
        return (
          <div style={{ fontSize: 12.5 }}>
            {e.registeredCount || 0}{e.capacity ? ` / ${e.capacity}` : ""}
            {full ? <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>full</div> : null}
            {e.guestCount ? <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>+{e.guestCount} guests</div> : null}
          </div>
        );
      },
    },
    { key: "waitlist", label: "Waitlist", render: (e) => e.waitlistCount || 0 },
    { key: "status", label: "Status", render: (e) => <Pill tone={STATUS_TONE[e.status] || "neutral"} dot={false}>{label(e.status)}</Pill> },
    {
      key: "actions", label: "", render: (e) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" variant="secondary" icon="users" onClick={() => openDetail(e)}>Attendees</Btn>
          {["DRAFT", "PUBLISHED"].includes(e.status) && <Btn size="sm" variant="danger" icon="x" onClick={() => cancelEvent(e)}>Cancel</Btn>}
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="calendar" size={11} /> Operations · Events</>}
        title="Events"
        sub="Events hosted at your amenities."
        right={
          <Btn variant="primary" icon="plus" disabled={!amenities.length}
            onClick={() => setCreateModal({
              amenityId: amenities[0]?._id || "", title: "", description: "", organizerName: "",
              startAt: "", endAt: "", capacity: "", registrationRequired: true,
              guestsAllowed: false, waitlistEnabled: true, publish: true,
            })}>
            New event
          </Btn>
        }
      />

      <Tabs value={status} onChange={setStatus} tabs={["all", "PUBLISHED", "DRAFT", "COMPLETED", "CANCELLED"].map((s) => ({ key: s, label: s === "all" ? "All" : label(s) }))} />

      {loading ? (
        <RevampSkeleton h={320} />
      ) : (
        <DataTable cols={cols} rows={events} rowKey="_id" emptyIcon="calendar" emptyTitle="No events" emptySub="Yoga, society meetings, festival celebrations — create one to start." />
      )}

      <Modal open={Boolean(createModal)} onClose={() => setCreateModal(null)} title="New event" width={640}>
        {createModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Amenity / venue">
                <select className="input" value={createModal.amenityId} onChange={(e) => setCreateModal({ ...createModal, amenityId: e.target.value })}>
                  {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Organizer">
                <input className="input" value={createModal.organizerName} onChange={(e) => setCreateModal({ ...createModal, organizerName: e.target.value })} />
              </Field>
            </div>
            <Field label="Title">
              <input className="input" autoFocus value={createModal.title} onChange={(e) => setCreateModal({ ...createModal, title: e.target.value })} placeholder="Morning yoga" />
            </Field>
            <Field label="Description">
              <textarea rows={3} className="input" value={createModal.description} onChange={(e) => setCreateModal({ ...createModal, description: e.target.value })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Starts">
                <input type="datetime-local" className="input" value={createModal.startAt} onChange={(e) => setCreateModal({ ...createModal, startAt: e.target.value })} />
              </Field>
              <Field label="Ends">
                <input type="datetime-local" className="input" value={createModal.endAt} onChange={(e) => setCreateModal({ ...createModal, endAt: e.target.value })} />
              </Field>
            </div>
            <Field label="Capacity">
              <input type="number" min={1} className="input" value={createModal.capacity} onChange={(e) => setCreateModal({ ...createModal, capacity: e.target.value })} placeholder="Leave blank for unlimited" />
            </Field>
            {[
              ["registrationRequired", "Registration required"],
              ["guestsAllowed", "Residents may bring guests"],
              ["waitlistEnabled", "Waitlist when full — promotes automatically on a cancellation"],
              ["publish", "Publish now and notify residents"],
            ].map(([k, l]) => (
              <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--r-fg-2)" }}>
                <input type="checkbox" checked={createModal[k]} onChange={(e) => setCreateModal({ ...createModal, [k]: e.target.checked })} />
                {l}
              </label>
            ))}
            <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>Save as a draft if the details are not settled. Drafts are invisible to residents.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" disabled={saving} onClick={create}>{saving ? "Saving…" : createModal.publish ? "Publish" : "Save draft"}</Btn>
              <Btn variant="ghost" onClick={() => setCreateModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.event.title} sub={detail ? when(detail.event.startAt) : ""} width={640}>
        {detail && (
          <div>
            <CardHead title={`Registered (${detail.registrations.length})`} />
            {!detail.registrations.length ? (
              <div style={{ fontSize: 13, color: "var(--r-fg-4)", marginBottom: 16 }}>Nobody registered yet.</div>
            ) : (
              <div style={{ marginBottom: 20 }}>
                {detail.registrations.map((r) => (
                  <div key={r._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--r-hairline)" }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--r-fg-1)", fontSize: 13 }}>{r.memberName}</div>
                      <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
                        {r.flatNo}{r.guestCount ? ` · +${r.guestCount} guests` : ""}{r.fromWaitlist ? " · promoted from waitlist" : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Pill tone={REG_TONE[r.status] || "neutral"} dot={false}>{label(r.status)}</Pill>
                      {r.status === "CONFIRMED" && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <Btn size="sm" variant="ghost" onClick={() => markAttendance(r._id, "ATTENDED")}>Attended</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => markAttendance(r._id, "NO_SHOW")}>No show</Btn>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <CardHead title={`Waitlist (${detail.waitlist.length})`} />
            {!detail.waitlist.length ? (
              <div style={{ fontSize: 13, color: "var(--r-fg-4)" }}>Nobody queued.</div>
            ) : (
              detail.waitlist.map((w) => (
                <div key={w._id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid var(--r-hairline)" }}>
                  <Pill tone="neutral" dot={false}>#{w.position}</Pill>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: "var(--r-fg-1)", fontSize: 13 }}>{w.memberName}</div>
                    <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{w.flatNo}</div>
                  </div>
                  <Pill tone="neutral" dot={false}>{label(w.status)}</Pill>
                </div>
              ))
            )}

            <div style={{ marginTop: 16 }}>
              <Btn variant="ghost" onClick={() => setDetail(null)}>Close</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
