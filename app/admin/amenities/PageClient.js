"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader, Card, CardHead, Btn, Pill, Icon, SmallStat, Modal, RevampSkeleton, Toast,
} from "@/components/revamp";

const STATUS_TONE = {
  OPEN: "paid",
  CLOSED: "neutral",
  UNDER_MAINTENANCE: "warning",
  TEMPORARILY_CLOSED: "warning",
  PERMANENTLY_CLOSED: "unpaid",
};
const SEVERITY_TONE = { LOW: "info", MEDIUM: "warning", HIGH: "unpaid", CRITICAL: "unpaid" };
// Same set list/PageClient.js's "Change status" modal offers — UNDER_MAINTENANCE
// is excluded there too: it is set by scheduling maintenance, never chosen directly.
const SETTABLE_STATUSES = ["OPEN", "CLOSED", "TEMPORARILY_CLOSED", "PERMANENTLY_CLOSED"];
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function CapacityBar({ snapshot }) {
  if (!snapshot || snapshot.unlimited) {
    return <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Unlimited</span>;
  }
  const p = snapshot.usagePct || 0;
  const color = p >= 100 ? "var(--r-danger)" : snapshot.level === "WARNING" ? "var(--r-warning)" : "var(--r-success)";
  return (
    <div style={{ minWidth: 100 }}>
      <div style={{ height: 5, background: "var(--r-surface-3)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: "100%", height: "100%", background: color, borderRadius: 4, transform: `scaleX(${Math.min(p, 100) / 100})`, transformOrigin: "left", transition: "transform 0.3s" }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 3 }}>
        {snapshot.current} / {snapshot.maxOccupancy} · {p}%
      </div>
    </div>
  );
}

function MiniList({ items, empty, renderRow }) {
  if (!items.length) return <div style={{ padding: "24px 4px", fontSize: 12.5, color: "var(--r-fg-4)" }}>{empty}</div>;
  return (
    <div>
      {items.map((it, i) => (
        <div key={it._id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderTop: i > 0 ? "1px solid var(--r-hairline)" : "none" }}>
          {renderRow(it)}
        </div>
      ))}
    </div>
  );
}

export default function AmenitiesOverviewPage() {
  const router = useRouter();
  const [amenities, setAmenities] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [events, setEvents] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusModal, setStatusModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const iso = (d) => d.toISOString().slice(0, 10);
      const tomorrow = new Date(today.getTime() + 86400000);

      // Four independent reads, fired together — the dashboard should not render
      // progressively as each panel arrives.
      const [aRes, mRes, eRes, iRes] = await Promise.all([
        fetch("/api/amenities?limit=100", { credentials: "include" }),
        fetch(`/api/amenities/maintenance?from=${iso(today)}&to=${iso(today)}&limit=20`, { credentials: "include" }),
        fetch(`/api/amenities/events?from=${iso(today)}&to=${iso(tomorrow)}&limit=20`, { credentials: "include" }),
        fetch("/api/amenities/incidents?status=OPEN&limit=20", { credentials: "include" }),
      ]);
      const [a, m, e, i] = await Promise.all([aRes.json(), mRes.json(), eRes.json(), iRes.json()]);
      if (aRes.ok) setAmenities(a.amenities || []);
      if (mRes.ok) setMaintenance(m.maintenance || []);
      if (eRes.ok) setEvents(e.events || []);
      if (iRes.ok) setIncidents(i.incidents || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Occupancy moves constantly; a 60s refresh keeps the panel honest without
  // hammering the API.
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const changeStatus = async () => {
    if (!statusModal) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/amenities/${statusModal.id}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: statusModal.status,
          note: statusModal.note?.trim() || undefined,
          isEmergency: !!statusModal.isEmergency,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not change the status");
      showToast(data.notified ? "Status changed — residents have been notified" : "Status changed");
      setStatusModal(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const occupied = amenities.filter((a) => (a.liveOccupancy || 0) > 0);
  const insideTotal = amenities.reduce((s, a) => s + (a.liveOccupancy || 0), 0);
  const closed = amenities.filter((a) => a.status !== "OPEN").length;
  const critical = incidents.filter((i) => ["HIGH", "CRITICAL"].includes(i.severity)).length;

  const cols = [
    { key: "name", label: "Amenity", render: (a) => <span style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{a.name}</span> },
    { key: "status", label: "Status", render: (a) => <Pill tone={STATUS_TONE[a.status] || "neutral"} dot={false}>{label(a.status)}</Pill> },
    { key: "occupancy", label: "Occupancy", render: (a) => <CapacityBar snapshot={a.capacitySnapshot} /> },
    {
      key: "actions", label: "", render: (a) => (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Btn size="sm" variant="secondary" icon="sliders-horizontal"
            onClick={() => setStatusModal({ id: a._id, name: a.name, status: a.status, note: "", isEmergency: false })}>Status</Btn>
          <Btn size="sm" variant="ghost" icon="wrench" onClick={() => router.push(`/admin/amenities/maintenance?amenityId=${a._id}&open=new`)}>Maintenance</Btn>
          <Btn size="sm" variant="ghost" icon="alert-triangle" onClick={() => router.push(`/admin/amenities/incidents?amenityId=${a._id}&open=new`)}>Incident</Btn>
          <Btn size="sm" variant="ghost" icon="users" onClick={() => router.push(`/admin/amenities/attendance?amenityId=${a._id}`)}>Attendance</Btn>
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="building-2" size={11} /> Operations · Amenities</>}
        title="Amenities"
        sub="Live occupancy, today's maintenance and events, and open incidents."
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" icon="list" onClick={() => router.push("/admin/amenities/list")}>All amenities</Btn>
            <Btn variant="primary" icon="tag" onClick={() => router.push("/admin/amenities/categories")}>Categories</Btn>
          </div>
        }
      />

      {loading && !amenities.length ? (
        <RevampSkeleton h={400} />
      ) : (
        <>
          {!amenities.length && (
            <Card style={{ marginBottom: 16, background: "var(--r-brand-soft)", border: "none" }}>
              <div style={{ display: "flex", gap: 10 }}>
                <Icon name="info" size={16} color="var(--r-brand)" style={{ marginTop: 2 }} />
                <span style={{ fontSize: 13, color: "var(--r-fg-2)" }}>
                  No amenities yet. Create a category first, then add amenities to it — categories are how residents
                  browse, so it is worth naming them the way your society already talks about these facilities.
                </span>
              </div>
            </Card>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
            <SmallStat icon="building-2" label="Amenities" value={amenities.length} />
            <SmallStat icon="users" label="People inside now" value={insideTotal} />
            <SmallStat icon="wrench" label="Under maintenance today" value={maintenance.length} />
            <SmallStat icon="alert-triangle" label="Open incidents" value={incidents.length} tone={critical ? "danger" : undefined} />
          </div>

          <Card style={{ marginBottom: 16 }} padded={false}>
            <div style={{ padding: "14px 18px 4px" }}>
              <CardHead title="Amenities" />
            </div>
            {!amenities.length ? (
              <div style={{ padding: "24px 18px", fontSize: 13, color: "var(--r-fg-4)" }}>Nothing to show yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      {cols.map((c) => (
                        <th key={c.key} style={{ textAlign: "left", padding: "8px 18px", fontSize: 11, fontWeight: 700, color: "var(--r-fg-4)", borderBottom: "1px solid var(--r-hairline)" }}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {amenities.map((a) => (
                      <tr key={a._id}>
                        {cols.map((c) => (
                          <td key={c.key} style={{ padding: "10px 18px", borderTop: "1px solid var(--r-hairline)" }}>{c.render(a)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
            <Card>
              <CardHead title="Today's events" />
              <MiniList
                items={events}
                empty="No events scheduled today or tomorrow."
                renderRow={(e) => (
                  <>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--r-fg-1)", fontSize: 13 }}>{e.title}</div>
                      <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
                        {e.amenityName} · {new Date(e.startAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      </div>
                    </div>
                    <Pill tone="info" dot={false}>{e.registeredCount || 0}{e.capacity ? ` / ${e.capacity}` : ""}</Pill>
                  </>
                )}
              />
            </Card>

            <Card>
              <CardHead title="Maintenance today" />
              <MiniList
                items={maintenance}
                empty="Nothing under maintenance today."
                renderRow={(m) => (
                  <>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--r-fg-1)", fontSize: 13 }}>{m.amenityName}</div>
                      <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{m.reason}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <Pill tone="warning" dot={false}>{m.status.replace("_", " ")}</Pill>
                      {m.extensions?.length ? <div style={{ fontSize: 10.5, color: "var(--r-fg-4)", marginTop: 3 }}>extended ×{m.extensions.length}</div> : null}
                    </div>
                  </>
                )}
              />
            </Card>

            <Card>
              <CardHead title="Open incidents" />
              <MiniList
                items={incidents.slice(0, 8)}
                empty="No open incidents."
                renderRow={(i) => (
                  <>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--r-fg-1)", fontSize: 13 }}>{i.title}</div>
                      <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{i.amenityName} · {i.incidentType}</div>
                    </div>
                    <Pill tone={SEVERITY_TONE[i.severity] || "neutral"} dot={false}>{i.severity}</Pill>
                  </>
                )}
              />
            </Card>
          </div>
        </>
      )}

      <Modal open={Boolean(statusModal)} onClose={() => setStatusModal(null)} title={statusModal ? `Change status — ${statusModal.name}` : ""} width={480}>
        {statusModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ padding: 12, borderRadius: 8, background: "var(--r-warning-soft)", fontSize: 12.5, color: "var(--r-warning)", display: "flex", gap: 8 }}>
              <Icon name="alert-triangle" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Changing status notifies every resident. That is why it is a deliberate action here rather than an inline toggle.</span>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 4 }}>New status</div>
              <select className="input" value={statusModal.status}
                onChange={(e) => setStatusModal({ ...statusModal, status: e.target.value })}>
                {SETTABLE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </select>
              <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 4 }}>
                Under maintenance is set by scheduling maintenance, not chosen here.
              </div>
            </div>
            <div>
              <div className="label" style={{ marginBottom: 4 }}>Note for residents</div>
              <textarea rows={3} className="input" value={statusModal.note}
                onChange={(e) => setStatusModal({ ...statusModal, note: e.target.value })}
                placeholder="Why, and when it is expected to reopen" />
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--r-fg-2)" }}>
              <input type="checkbox" checked={statusModal.isEmergency} style={{ marginTop: 2 }}
                onChange={(e) => setStatusModal({ ...statusModal, isEmergency: e.target.checked })} />
              Emergency — send at high priority, overriding notification preferences
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" onClick={changeStatus} disabled={saving}>{saving ? "Saving…" : "Change status"}</Btn>
              <Btn variant="ghost" onClick={() => setStatusModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
