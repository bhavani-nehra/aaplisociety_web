"use client";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import notify from "@/lib/notify";
import {
  PageHeader, Card, Btn, Pill, Icon, Tabs, DataTable, RevampSkeleton,
  Modal, Toast,
} from "@/components/revamp";

const STATUS_TABS = ["all", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const STATUS_TONE = { SCHEDULED: "info", IN_PROGRESS: "warning", COMPLETED: "paid", CANCELLED: "neutral" };
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const iso = (d) => d.toISOString().slice(0, 10);
const fmt = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Field({ label: l, children, hint }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{l}</div>
      {children}
      {hint ? <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

export default function MaintenancePage() {
  const searchParams = useSearchParams();
  const [records, setRecords] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    return { from: iso(from), to: iso(to) };
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [extendModal, setExtendModal] = useState(null);
  const [reopenModal, setReopenModal] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, limit: "100" });
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/amenities/maintenance?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setRecords(data.maintenance || []);
      else showToast(data.error || "Could not load maintenance", "err");
    } finally {
      setLoading(false);
    }
  }, [status, range]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
  }, []);

  // Arriving from the overview dashboard's "Schedule maintenance" quick
  // action (?amenityId=&open=new): open the create modal pre-selected to
  // that amenity instead of making the admin find it again in the dropdown.
  // Waits on `amenities` so the preselected id is one the <select> actually
  // has an <option> for.
  useEffect(() => {
    if (searchParams.get("open") !== "new" || !amenities.length) return;
    const requested = searchParams.get("amenityId");
    const amenityId = amenities.some((a) => a._id === requested) ? requested : amenities[0]._id;
    setCreateModal({ amenityId, startDate: iso(new Date()), endDate: iso(new Date(Date.now() + 86400000)), reason: "", notes: "" });
  }, [amenities, searchParams]);

  const call = async (url, body, method, successMsg, close) => {
    setSaving(true);
    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      showToast(successMsg);
      close?.();
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const cols = [
    { key: "amenity", label: "Amenity", render: (m) => <span style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{m.amenityName}</span> },
    {
      key: "reason", label: "Reason", render: (m) => (
        <div>
          <div>{m.reason}</div>
          {m.extensions?.length ? (
            <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>Extended {m.extensions.length}× · originally ended {fmt(m.extensions[0].previousEndDate)}</div>
          ) : null}
          {m.reopenedEarly ? <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>Reopened early</div> : null}
        </div>
      ),
    },
    {
      key: "window", label: "Window", render: (m) => (
        <div style={{ fontSize: 12.5 }}>
          {fmt(m.startDate)} – {fmt(m.actualEndDate || m.endDate)}
          {m.actualEndDate && m.actualEndDate !== m.endDate ? <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>scheduled to {fmt(m.endDate)}</div> : null}
        </div>
      ),
    },
    { key: "status", label: "Status", render: (m) => <Pill tone={STATUS_TONE[m.status] || "neutral"} dot={false}>{label(m.status)}</Pill> },
    {
      key: "actions", label: "", render: (m) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["SCHEDULED", "IN_PROGRESS"].includes(m.status) && (
            <>
              <Btn size="sm" variant="secondary" icon="calendar-plus"
                onClick={() => setExtendModal({ id: m._id, name: m.amenityName, currentEnd: iso(new Date(m.endDate)), newEndDate: "", reason: "" })}>Extend</Btn>
              <Btn size="sm" variant="secondary" icon="check"
                onClick={() => setReopenModal({ id: m._id, name: m.amenityName, notes: "" })}>Reopen</Btn>
            </>
          )}
          {m.status === "SCHEDULED" && (
            <Btn size="sm" variant="danger" icon="x"
              onClick={async () => {
                if (!(await notify.confirm("Cancel this scheduled maintenance?", { tone: "warning" }))) return;
                call(`/api/amenities/maintenance/${m._id}`, null, "DELETE", "Maintenance cancelled");
              }}>Cancel</Btn>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="building-2" size={11} /> Operations · Maintenance</>}
        title="Maintenance"
        sub="Schedule, extend and reopen — history is kept permanently."
        right={
          <Btn variant="primary" icon="plus" disabled={!amenities.length}
            onClick={() => setCreateModal({ amenityId: amenities[0]?._id || "", startDate: iso(new Date()), endDate: iso(new Date(Date.now() + 86400000)), reason: "", notes: "" })}>
            Schedule maintenance
          </Btn>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="date" className="input" style={{ width: "auto" }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>to</span>
          <input type="date" className="input" style={{ width: "auto" }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </div>
      </Card>

      <Tabs value={status} onChange={setStatus} tabs={STATUS_TABS.map((s) => ({ key: s, label: s === "all" ? "All" : label(s) }))} />

      {loading ? (
        <RevampSkeleton h={320} />
      ) : (
        <DataTable cols={cols} rows={records} rowKey="_id" emptyIcon="wrench" emptyTitle="Nothing in this range" emptySub="Widen the dates, or schedule maintenance." />
      )}

      <Modal open={Boolean(createModal)} onClose={() => setCreateModal(null)} title="Schedule maintenance" width={520}>
        {createModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <Field label="Amenity">
              <select className="input" value={createModal.amenityId} onChange={(e) => setCreateModal({ ...createModal, amenityId: e.target.value })}>
                {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Starts">
                <input type="date" className="input" value={createModal.startDate} onChange={(e) => setCreateModal({ ...createModal, startDate: e.target.value })} />
              </Field>
              <Field label="Ends">
                <input type="date" className="input" value={createModal.endDate} onChange={(e) => setCreateModal({ ...createModal, endDate: e.target.value })} />
              </Field>
            </div>
            <Field label="Reason" hint="Residents see this, so write it for them.">
              <input className="input" value={createModal.reason} onChange={(e) => setCreateModal({ ...createModal, reason: e.target.value })} placeholder="Pool retiling" />
            </Field>
            <Field label="Internal notes">
              <textarea rows={3} className="input" value={createModal.notes} onChange={(e) => setCreateModal({ ...createModal, notes: e.target.value })} />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" disabled={saving}
                onClick={() => call("/api/amenities/maintenance", createModal, "POST", "Maintenance scheduled — residents notified", () => setCreateModal(null))}>
                {saving ? "Saving…" : "Schedule"}
              </Btn>
              <Btn variant="ghost" onClick={() => setCreateModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(extendModal)} onClose={() => setExtendModal(null)} title={extendModal ? `Extend — ${extendModal.name}` : ""} width={480}>
        {extendModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>
              Currently ends {fmt(extendModal.currentEnd)}. Extensions are appended to the record with your reason rather than overwriting the original dates.
            </div>
            <Field label="New end date">
              <input type="date" className="input" value={extendModal.newEndDate} min={extendModal.currentEnd} onChange={(e) => setExtendModal({ ...extendModal, newEndDate: e.target.value })} />
            </Field>
            <Field label="Reason for the extension">
              <textarea rows={3} className="input" value={extendModal.reason} onChange={(e) => setExtendModal({ ...extendModal, reason: e.target.value })} placeholder="Contractor delayed by material shortage" />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" disabled={saving}
                onClick={() => call(`/api/amenities/maintenance/${extendModal.id}/extend`, { newEndDate: extendModal.newEndDate, reason: extendModal.reason }, "POST", "Maintenance extended — residents notified", () => setExtendModal(null))}>
                {saving ? "Saving…" : "Extend"}
              </Btn>
              <Btn variant="ghost" onClick={() => setExtendModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(reopenModal)} onClose={() => setReopenModal(null)} title={reopenModal ? `Reopen — ${reopenModal.name}` : ""} width={480}>
        {reopenModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>
              The amenity returns to whatever status it had before maintenance began, and residents are told it is available again. Actual end date is recorded separately from the scheduled one, so planned versus actual downtime stays answerable.
            </div>
            <Field label="Completion notes">
              <textarea rows={3} className="input" value={reopenModal.notes} onChange={(e) => setReopenModal({ ...reopenModal, notes: e.target.value })} />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" disabled={saving}
                onClick={() => call(`/api/amenities/maintenance/${reopenModal.id}/reopen`, { notes: reopenModal.notes }, "POST", "Amenity reopened — residents notified", () => setReopenModal(null))}>
                {saving ? "Saving…" : "Reopen now"}
              </Btn>
              <Btn variant="ghost" onClick={() => setReopenModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
