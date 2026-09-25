"use client";
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  PageHeader, Card, Btn, Pill, Icon, Select, Tabs, DataTable,
  RevampSkeleton, Modal, Toast,
} from "@/components/revamp";

const STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED", "REJECTED"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const SEVERITY_TONE = { LOW: "info", MEDIUM: "warning", HIGH: "unpaid", CRITICAL: "unpaid" };
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
const when = (d) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function Field({ label: l, children, hint }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{l}</div>
      {children}
      {hint ? <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

export default function IncidentsPage() {
  const searchParams = useSearchParams();
  const [incidents, setIncidents] = useState([]);
  const [amenities, setAmenities] = useState([]);
  const [incidentTypes, setIncidentTypes] = useState([]);
  const [status, setStatus] = useState("OPEN");
  const [severity, setSeverity] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [detail, setDetail] = useState(null);
  const [createModal, setCreateModal] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (status !== "all") params.set("status", status);
      if (severity !== "all") params.set("severity", severity);
      const res = await fetch(`/api/amenities/incidents?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) setIncidents(data.incidents || []);
      else showToast(data.error || "Could not load incidents", "err");
    } finally {
      setLoading(false);
    }
  }, [status, severity]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
    // Incident types are society-configurable (lib/amenities/settingsService.js),
    // not a build-time enum — the create route validates against this same list.
    fetch("/api/amenities/settings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setIncidentTypes(d.settings?.incidentTypes || []))
      .catch(() => {});
  }, []);

  // Arriving from the overview dashboard's "Incident" quick action
  // (?amenityId=&open=new): open the report modal pre-selected to that
  // amenity, once both amenities and incident types have loaded.
  useEffect(() => {
    if (searchParams.get("open") !== "new" || !amenities.length || !incidentTypes.length) return;
    const requested = searchParams.get("amenityId");
    const amenityId = amenities.some((a) => a._id === requested) ? requested : amenities[0]._id;
    setCreateModal({ amenityId, incidentType: incidentTypes[0], title: "", description: "", severity: "LOW" });
  }, [amenities, incidentTypes, searchParams]);

  const create = async () => {
    if (!createModal) return;
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/incidents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createModal),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not report the incident");
      showToast("Incident reported");
      setCreateModal(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const update = async (id, body, msg) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/amenities/incidents/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the incident");
      showToast(msg || "Updated");
      setDetail(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const cols = [
    {
      key: "incident", label: "Incident", render: (i) => (
        <div>
          <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{i.title}</div>
          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{i.incidentType}</div>
        </div>
      ),
    },
    { key: "amenity", label: "Amenity", render: (i) => i.amenityName },
    { key: "severity", label: "Severity", render: (i) => <Pill tone={SEVERITY_TONE[i.severity] || "neutral"} dot={false}>{i.severity}</Pill> },
    { key: "status", label: "Status", render: (i) => <Pill tone={["RESOLVED", "CLOSED"].includes(i.status) ? "paid" : "warning"} dot={false}>{label(i.status)}</Pill> },
    {
      key: "reported", label: "Reported", render: (i) => (
        <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
          <div>{i.reportedByName || "—"}</div>
          <div>{when(i.createdAt)}</div>
        </div>
      ),
    },
    { key: "actions", label: "", render: (i) => <Btn size="sm" variant="secondary" icon="external-link" onClick={() => setDetail({ ...i, resolutionNotes: i.resolutionNotes || "" })}>Open</Btn> },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="building-2" size={11} /> Operations · Incidents</>}
        title="Incidents"
        sub="Damage, hazards, equipment failures and rule violations."
        right={
          <Btn
            variant="primary" icon="plus" disabled={!amenities.length || !incidentTypes.length}
            onClick={() => setCreateModal({ amenityId: amenities[0]?._id || "", incidentType: incidentTypes[0] || "", title: "", description: "", severity: "LOW" })}
          >
            Report incident
          </Btn>
        }
      />

      <Tabs
        value={status}
        onChange={setStatus}
        tabs={["OPEN", ...STATUSES.filter((s) => s !== "OPEN"), "all"].map((s) => ({ key: s, label: s === "all" ? "All" : label(s) }))}
      />

      <Card style={{ marginBottom: 16 }}>
        <Select value={severity} size="md" onChange={setSeverity}>
          <option value="all">Any severity</option>
          {SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
      </Card>

      {loading ? (
        <RevampSkeleton h={320} />
      ) : (
        <DataTable cols={cols} rows={incidents} rowKey="_id" emptyIcon="shield-check" emptyTitle="Nothing here" emptySub="No incidents match these filters." />
      )}

      <Modal open={Boolean(createModal)} onClose={() => setCreateModal(null)} title="Report incident" width={560}>
        {createModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <Field label="Amenity">
              <select className="input" value={createModal.amenityId} onChange={(e) => setCreateModal({ ...createModal, amenityId: e.target.value })}>
                {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
              </select>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Issue type">
                <select className="input" value={createModal.incidentType} onChange={(e) => setCreateModal({ ...createModal, incidentType: e.target.value })}>
                  {incidentTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Severity">
                <select className="input" value={createModal.severity} onChange={(e) => setCreateModal({ ...createModal, severity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Title">
              <input className="input" autoFocus value={createModal.title} onChange={(e) => setCreateModal({ ...createModal, title: e.target.value })} placeholder="Cracked tile near the pool ladder" />
            </Field>
            <Field label="Description">
              <textarea rows={3} className="input" value={createModal.description} onChange={(e) => setCreateModal({ ...createModal, description: e.target.value })} placeholder="What happened, and anything a responder needs to know" />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" disabled={saving} onClick={create}>{saving ? "Reporting…" : "Report"}</Btn>
              <Btn variant="ghost" onClick={() => setCreateModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.title}
        sub={detail ? `${detail.amenityName} · ${detail.incidentType} · reported by ${detail.reportedByName || "—"} on ${when(detail.createdAt)}` : ""}
        width={640}
      >
        {detail && (
          <div style={{ display: "grid", gap: 14 }}>
            <Field label="Description">
              <p style={{ fontSize: 13, color: "var(--r-fg-3)", margin: 0, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{detail.description}</p>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field
                label="Severity"
                hint="Residents cannot set this above low — triage is the committee's call, so that a genuinely critical hazard is not buried among self-declared emergencies."
              >
                <select className="input" value={detail.severity} onChange={(e) => setDetail({ ...detail, severity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="input" value={detail.status} onChange={(e) => setDetail({ ...detail, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Resolution notes">
              <textarea rows={3} className="input" value={detail.resolutionNotes} onChange={(e) => setDetail({ ...detail, resolutionNotes: e.target.value })} placeholder="What was done — the reporter is notified when this is resolved" />
            </Field>
            {detail.resolutionDate ? (
              <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>Resolved {when(detail.resolutionDate)} by {detail.resolvedByName || "—"}.</div>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              <Btn
                variant="primary" disabled={saving}
                onClick={() => update(detail._id, { status: detail.status, severity: detail.severity, resolutionNotes: detail.resolutionNotes || undefined },
                  detail.status === "RESOLVED" ? "Incident resolved — reporter notified" : "Incident updated")}
              >
                {saving ? "Saving…" : "Save"}
              </Btn>
              <Btn variant="ghost" onClick={() => setDetail(null)}>Close</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
