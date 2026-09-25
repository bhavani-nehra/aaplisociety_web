"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import notify from "@/lib/notify";
import {
  PageHeader, Card, Btn, Pill, Icon, Select, DataTable,
  RevampSkeleton, Modal, Toast,
} from "@/components/revamp";

const iso = (d) => d.toISOString().slice(0, 10);
const time = (d) => (d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "—");
const day = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const dur = (m) => (m == null ? "—" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

function Field({ label: l, hint, children }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{l}</div>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export default function AttendancePage() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState([]);
  const [amenities, setAmenities] = useState([]);
  // Arriving from the overview dashboard's "Attendance" quick action
  // (?amenityId=): land pre-filtered instead of on every amenity.
  const [amenityId, setAmenityId] = useState(() => searchParams.get("amenityId") || "all");
  const [openOnly, setOpenOnly] = useState(true);
  const [range, setRange] = useState(() => ({ from: iso(new Date()), to: iso(new Date()) }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [checkInModal, setCheckInModal] = useState(null);
  const [adjustModal, setAdjustModal] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (openOnly) params.set("openOnly", "true");
      else { params.set("from", range.from); params.set("to", range.to); }
      if (amenityId !== "all") params.set("amenityId", amenityId);
      const res = await fetch(`/api/amenities/attendance?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setRows(data.attendance || []);
      else showToast(data.error || "Could not load attendance", "err");
    } finally {
      setLoading(false);
    }
  }, [amenityId, openOnly, range]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
  }, []);

  const checkOut = async (row) => {
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/attendance/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendanceId: row._id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not check out");
      showToast("Checked out");
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const autoCheckout = async () => {
    if (!(await notify.confirm("Close all stale sessions past the society cutoff?", { tone: "warning" }))) return;
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/attendance/auto-checkout", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      showToast(`${data.closed} stale ${data.closed === 1 ? "session" : "sessions"} closed`);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const submitCheckIn = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/attendance", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkInModal),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not check in");
      showToast("Checked in");
      setCheckInModal(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const submitAdjust = async () => {
    if (!adjustModal.reason || adjustModal.reason.trim().length < 3) {
      return showToast("A reason is required for any correction", "err");
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/amenities/attendance/${adjustModal.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: adjustModal.reason,
          timeOut: adjustModal.timeOut ? new Date(adjustModal.timeOut).toISOString() : undefined,
          notes: adjustModal.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the correction");
      showToast("Correction recorded");
      setAdjustModal(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const cols = [
    {
      key: "person", label: "Person", render: (r) => (
        <div>
          <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>
            {r.attendeeType === "VISITOR" ? r.visitorName : r.residentName || "—"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
            {r.attendeeType === "VISITOR"
              ? `Visitor${r.visitorPhone ? ` · ${r.visitorPhone}` : ""}`
              : `${r.flatNo || "—"}${r.occupancyType ? ` · ${r.occupancyType}` : ""}`}
            {r.guestCount ? ` · +${r.guestCount} guests` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "amenity", label: "Amenity", width: 150, render: (r) => (
        <div>
          {r.amenityName}
          {r.slotLabel ? <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{r.slotLabel}</div> : null}
        </div>
      ),
    },
    {
      key: "in", label: "In", width: 120, render: (r) => (
        <div>
          {time(r.timeIn)}
          <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>{day(r.timeIn)}</div>
        </div>
      ),
    },
    {
      key: "out", label: "Out", width: 120, render: (r) => (
        <div>
          {r.timeOut ? time(r.timeOut) : <Pill tone="active" dot={false}>Inside</Pill>}
          {r.autoCheckedOut ? <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>auto-closed</div> : null}
        </div>
      ),
    },
    { key: "duration", label: "Duration", width: 90, render: (r) => dur(r.durationMins) },
    {
      key: "method", label: "Method", width: 130, render: (r) => (
        <div>
          <Pill tone="neutral" dot={false}>{r.checkInMethod}</Pill>
          {r.isOverride ? <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 3 }}>override</div> : null}
          {r.adjustedAt ? <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 3 }}>corrected</div> : null}
        </div>
      ),
    },
    {
      key: "actions", label: "", width: 170, render: (r) => (
        <div style={{ display: "flex", gap: 6 }}>
          {!r.timeOut && (
            <Btn size="sm" variant="secondary" icon="log-out" disabled={saving} onClick={() => checkOut(r)}>
              Check out
            </Btn>
          )}
          <Btn size="sm" variant="ghost" icon="pencil" onClick={() => setAdjustModal({ id: r._id, reason: "", notes: r.notes || "" })}>
            Correct
          </Btn>
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="clipboard-check" size={11} /> Operations · Attendance</>}
        title="Attendance"
        sub={openOnly ? "Everyone currently checked in" : `${range.from} to ${range.to}`}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" icon="timer-off" disabled={saving} onClick={autoCheckout}>Close stale sessions</Btn>
            <Btn
              variant="primary" icon="plus" disabled={!amenities.length}
              onClick={() => setCheckInModal({
                amenityId: amenities[0]?._id || "", attendeeType: "RESIDENT",
                residentName: "", flatNo: "", visitorName: "", visitorPhone: "",
                overrideReason: "", notes: "",
              })}
            >
              Record check-in
            </Btn>
          </div>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Select value={amenityId} size="md" onChange={setAmenityId}>
            <option value="all">All amenities</option>
            {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
          </Select>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--r-fg-2)" }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Currently inside only
          </label>
          {!openOnly && (
            <>
              <input className="input" style={{ width: "auto" }} type="date" value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })} />
              <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>to</span>
              <input className="input" style={{ width: "auto" }} type="date" value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </>
          )}
        </div>
      </Card>

      {loading ? (
        <RevampSkeleton h={320} />
      ) : (
        <DataTable
          cols={cols}
          rows={rows}
          rowKey="_id"
          tableId="amenities-attendance"
          emptyIcon={openOnly ? "door-open" : "clipboard-list"}
          emptyTitle={openOnly ? "Nobody is checked in" : "No attendance in this range"}
          emptySub={openOnly ? "Uncheck the filter to see history." : "Try a wider date range."}
        />
      )}

      <Modal open={Boolean(checkInModal)} onClose={() => setCheckInModal(null)} title="Record a check-in" width={520}>
        {checkInModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <Field label="Amenity">
              <select className="input" value={checkInModal.amenityId}
                onChange={(e) => setCheckInModal({ ...checkInModal, amenityId: e.target.value })}>
                {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
            </Field>
            <Field label="Who">
              <select className="input" value={checkInModal.attendeeType}
                onChange={(e) => setCheckInModal({ ...checkInModal, attendeeType: e.target.value })}>
                <option value="RESIDENT">Resident</option>
                <option value="VISITOR">Visitor</option>
                <option value="STAFF">Staff</option>
              </select>
            </Field>
            {checkInModal.attendeeType === "VISITOR" ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Visitor name">
                  <input className="input" value={checkInModal.visitorName}
                    onChange={(e) => setCheckInModal({ ...checkInModal, visitorName: e.target.value })} />
                </Field>
                <Field label="Phone">
                  <input className="input" value={checkInModal.visitorPhone}
                    onChange={(e) => setCheckInModal({ ...checkInModal, visitorPhone: e.target.value })} />
                </Field>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Name">
                  <input className="input" value={checkInModal.residentName}
                    onChange={(e) => setCheckInModal({ ...checkInModal, residentName: e.target.value })} />
                </Field>
                <Field label="Flat">
                  <input className="input" value={checkInModal.flatNo}
                    onChange={(e) => setCheckInModal({ ...checkInModal, flatNo: e.target.value })} />
                </Field>
              </div>
            )}
            <Field
              label="Override reason"
              hint="Staff-recorded check-ins skip eligibility checks. If you are admitting someone the rules would refuse, say why — it is recorded on the row."
            >
              <input className="input" value={checkInModal.overrideReason}
                onChange={(e) => setCheckInModal({ ...checkInModal, overrideReason: e.target.value })}
                placeholder="Only if admitting against the rules" />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" disabled={saving} onClick={submitCheckIn}>{saving ? "Saving…" : "Check in"}</Btn>
              <Btn variant="ghost" onClick={() => setCheckInModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(adjustModal)} onClose={() => setAdjustModal(null)} title="Correct this record" width={480}>
        {adjustModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{
              padding: 12, borderRadius: 8, background: "var(--r-warning-soft)", fontSize: 12.5,
              color: "var(--r-warning)", display: "flex", gap: 8,
            }}>
              <Icon name="alert-triangle" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                Attendance rows are never deleted. This records a correction against the original, stamped
                with your name and reason — which is what makes the ledger worth trusting.
              </span>
            </div>
            <Field label="Reason for the correction">
              <textarea rows={3} className="input" value={adjustModal.reason}
                onChange={(e) => setAdjustModal({ ...adjustModal, reason: e.target.value })}
                placeholder="Guard forgot to check the resident out at closing" />
            </Field>
            <Field label="Check-out time">
              <input className="input" type="datetime-local"
                value={adjustModal.timeOut || ""}
                onChange={(e) => setAdjustModal({ ...adjustModal, timeOut: e.target.value })} />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" disabled={saving} onClick={submitAdjust}>{saving ? "Saving…" : "Record correction"}</Btn>
              <Btn variant="ghost" onClick={() => setAdjustModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
