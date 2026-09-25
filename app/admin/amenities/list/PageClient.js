"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader, Card, Btn, Pill, Icon, SearchInput, Select, DataTable,
  RevampSkeleton, Modal, Toast,
} from "@/components/revamp";

const STATUSES = ["OPEN", "CLOSED", "UNDER_MAINTENANCE", "TEMPORARILY_CLOSED", "PERMANENTLY_CLOSED"];
const STATUS_TONE = {
  OPEN: "paid", CLOSED: "neutral", UNDER_MAINTENANCE: "warning",
  TEMPORARILY_CLOSED: "warning", PERMANENTLY_CLOSED: "unpaid",
};
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function CapacityBar({ cap }) {
  const pct = cap && !cap.unlimited ? cap.usagePct || 0 : null;
  if (pct === null) return <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Unlimited</span>;
  const color = pct >= 100 ? "var(--r-danger)" : cap.level === "WARNING" ? "var(--r-warning)" : "var(--r-success)";
  return (
    <div style={{ minWidth: 90 }}>
      <div style={{ height: 5, background: "var(--r-surface-3)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: "100%", background: color, borderRadius: 4 }} />
      </div>
      <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 3 }}>{cap.current} / {cap.maxOccupancy}</div>
    </div>
  );
}

function Field({ label: l, children }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{l}</div>
      {children}
    </div>
  );
}

export default function AmenityListPage() {
  const router = useRouter();
  const [amenities, setAmenities] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({});
  const [toast, setToast] = useState(null);
  const [createModal, setCreateModal] = useState(null);
  const [statusModal, setStatusModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20", includeInactive: "true" });
      if (search.trim()) params.set("search", search.trim());
      if (categoryId !== "all") params.set("categoryId", categoryId);
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/amenities?${params}`, { credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        setAmenities(data.amenities || []);
        setMeta(data.pagination || {});
      } else showToast(data.error || "Could not load amenities", "err");
    } finally {
      setLoading(false);
    }
  }, [page, search, categoryId, status]);

  useEffect(() => {
    // Debounced so typing in the search box does not fire a request per keystroke.
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    fetch("/api/amenities/categories", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
      .catch(() => {});
  }, []);

  const create = async () => {
    if (!createModal?.name?.trim() || !createModal.categoryId) {
      return showToast("A name and a category are both required", "err");
    }
    setSaving(true);
    try {
      const res = await fetch("/api/amenities", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createModal.name.trim(),
          categoryId: createModal.categoryId,
          description: createModal.description?.trim() || undefined,
          location: createModal.location?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not create the amenity");
      showToast("Amenity created — open it to set hours, access and rules");
      setCreateModal(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

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

  const cols = [
    {
      key: "name", label: "Amenity", render: (a) => (
        <div>
          <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{a.name}</div>
          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{a.location || "No location set"}{!a.isActive ? " · inactive" : ""}</div>
        </div>
      ),
    },
    { key: "category", label: "Category", render: (a) => a.categoryName },
    {
      key: "status", label: "Status", render: (a) => (
        <div>
          <Pill tone={STATUS_TONE[a.status] || "neutral"} dot={false}>{label(a.status)}</Pill>
          {a.effectiveStatus && a.effectiveStatus.state !== "OPEN" && a.status === "OPEN" ? (
            <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 3 }}>{a.effectiveStatus.label}</div>
          ) : null}
        </div>
      ),
    },
    { key: "occupancy", label: "Occupancy", render: (a) => <CapacityBar cap={a.capacitySnapshot} /> },
    { key: "attendance", label: "Attendance", render: (a) => <Pill tone="neutral" dot={false}>{a.attendanceMode === "QR_MANUAL" ? "QR + manual" : label(a.attendanceMode)}</Pill> },
    {
      key: "actions", label: "", render: (a) => (
        <div style={{ display: "flex", gap: 6 }}>
          <Btn size="sm" variant="secondary" icon="sliders-horizontal"
            onClick={() => setStatusModal({ id: a._id, name: a.name, status: a.status, note: "", isEmergency: false })}>Status</Btn>
          <Btn size="sm" variant="primary" icon="settings" onClick={() => router.push(`/admin/amenities/${a._id}`)}>Manage</Btn>
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="building-2" size={11} /> Operations · Amenities</>}
        title="All amenities"
        sub={`${meta.total ?? amenities.length} total`}
        right={
          <Btn
            variant="primary" icon="plus" disabled={!categories.length}
            title={!categories.length ? "Create a category first" : undefined}
            onClick={() => setCreateModal({ name: "", categoryId: categories[0]?._id || "", description: "", location: "" })}
          >
            New amenity
          </Btn>
        }
      />

      {!categories.length && !loading && (
        <Card style={{ marginBottom: 16, background: "var(--r-warning-soft)", border: "none" }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Icon name="alert-triangle" size={16} color="var(--r-warning)" style={{ marginTop: 2 }} />
            <span style={{ fontSize: 13, color: "var(--r-fg-2)" }}>Every amenity belongs to a category, so create at least one category before adding amenities.</span>
          </div>
        </Card>
      )}

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search amenities…" />
          </div>
          <Select value={categoryId} size="md" onChange={(v) => { setCategoryId(v); setPage(1); }}>
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </Select>
          <Select value={status} size="md" onChange={(v) => { setStatus(v); setPage(1); }}>
            <option value="all">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </Select>
        </div>
      </Card>

      {loading ? (
        <RevampSkeleton h={320} />
      ) : (
        <DataTable
          cols={cols}
          rows={amenities}
          rowKey="_id"
          emptyIcon="search-x"
          emptyTitle="Nothing matches"
          emptySub="Try clearing the filters, or create a new amenity."
        />
      )}

      {meta.totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Page {meta.page} of {meta.totalPages}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn size="sm" variant="ghost" icon="chevron-left" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
            <Btn size="sm" variant="ghost" iconR="chevron-right" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>Next</Btn>
          </div>
        </div>
      )}

      <Modal open={Boolean(createModal)} onClose={() => setCreateModal(null)} title="New amenity" width={480}>
        {createModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <Field label="Name">
              <input className="input" autoFocus value={createModal.name}
                onChange={(e) => setCreateModal({ ...createModal, name: e.target.value })} placeholder="Swimming Pool" />
            </Field>
            <Field label="Category">
              <select className="input" value={createModal.categoryId}
                onChange={(e) => setCreateModal({ ...createModal, categoryId: e.target.value })}>
                {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input className="input" value={createModal.location}
                onChange={(e) => setCreateModal({ ...createModal, location: e.target.value })} placeholder="Optional — e.g. Basement, Tower B" />
            </Field>
            <Field label="Description">
              <textarea rows={3} className="input" value={createModal.description}
                onChange={(e) => setCreateModal({ ...createModal, description: e.target.value })} />
            </Field>
            <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
              Hours, access, capacity, slots and rules are set on the amenity page after it is created.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="primary" onClick={create} disabled={saving}>{saving ? "Creating…" : "Create"}</Btn>
              <Btn variant="ghost" onClick={() => setCreateModal(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(statusModal)} onClose={() => setStatusModal(null)} title={statusModal ? `Change status — ${statusModal.name}` : ""} width={480}>
        {statusModal && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ padding: 12, borderRadius: 8, background: "var(--r-warning-soft)", fontSize: 12.5, color: "var(--r-warning)", display: "flex", gap: 8 }}>
              <Icon name="alert-triangle" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Changing status notifies every resident. That is why it is a deliberate action here rather than an inline toggle.</span>
            </div>
            <Field label="New status">
              <select className="input" value={statusModal.status}
                onChange={(e) => setStatusModal({ ...statusModal, status: e.target.value })}>
                {STATUSES.filter((s) => s !== "UNDER_MAINTENANCE").map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </select>
              <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 4 }}>Under maintenance is set by scheduling maintenance, not chosen here.</div>
            </Field>
            <Field label="Note for residents">
              <textarea rows={3} className="input" value={statusModal.note}
                onChange={(e) => setStatusModal({ ...statusModal, note: e.target.value })} placeholder="Why, and when it is expected to reopen" />
            </Field>
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
