"use client";
import { useState, useEffect, useCallback, Fragment } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import notify from "@/lib/notify";
import {
  PageHeader, Card, CardHead, Btn, Pill, Icon, Tabs, Segmented, DataTable,
  RevampSkeleton, EmptyState, Modal, Toast,
} from "@/components/revamp";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TABS = [
  ["Basics", "info"], ["Availability", "clock"], ["Access", "lock"], ["Capacity", "users"],
  ["Slots", "grid-3x3"], ["Rules", "file-text"], ["Visitors", "user-plus"],
  ["Attendance & QR", "qr-code"], ["Maintenance", "wrench"],
];
const AUDIENCES = ["EVERYONE", "OWNERS", "TENANTS", "STAFF", "COMMITTEE", "CUSTOM"];
const MODES = ["NONE", "MANUAL", "QR", "QR_MANUAL"];
const RULE_KINDS = [
  ["RULE", "Rules"], ["DO", "Do"], ["DONT", "Don't"], ["INSTRUCTION", "Instructions"],
];
const MAINT_STATUS_TONE = { SCHEDULED: "info", IN_PROGRESS: "warning", COMPLETED: "paid", CANCELLED: "neutral" };
const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function Field({ label: l, hint, children }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>{l}</div>
      {children}
      {hint ? <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 4, lineHeight: 1.5 }}>{hint}</div> : null}
    </div>
  );
}

export default function AmenityDetailPage() {
  const { id } = useParams();
  const router = useRouter();

  const [amenity, setAmenity] = useState(null);
  const [categories, setCategories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [slots, setSlots] = useState([]);
  const [rules, setRules] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [closures, setClosures] = useState([]);
  const [maintenance, setMaintenance] = useState([]);
  const [qr, setQr] = useState(null);
  const [newToken, setNewToken] = useState(null);
  const [qrImage, setQrImage] = useState(null);
  const [editingSlot, setEditingSlot] = useState(null);
  const [savingSlot, setSavingSlot] = useState(false);
  const [selectingSlots, setSelectingSlots] = useState(false);
  const [selectedSlotIds, setSelectedSlotIds] = useState([]);
  const [ruleDraft, setRuleDraft] = useState([]);
  const [savingRules, setSavingRules] = useState(false);
  const [weeklyDraft, setWeeklyDraft] = useState(() => DAYS.map((_, i) => ({ dayOfWeek: i, windows: [] })));
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [quickOpen, setQuickOpen] = useState("09:00");
  const [quickClose, setQuickClose] = useState("21:00");
  const [quickBreaks, setQuickBreaks] = useState([]);
  const [closureDraft, setClosureDraft] = useState({ closureType: "HOLIDAY", startDate: "", endDate: "", reason: "" });
  const [savingClosure, setSavingClosure] = useState(false);
  const newRuleKey = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newKey = () => `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [tab, setTab] = useState("Basics");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [draft, setDraft] = useState({});

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, cRes, sRes] = await Promise.all([
        fetch(`/api/amenities/${id}`, { credentials: "include" }),
        fetch("/api/amenities/categories", { credentials: "include" }),
        fetch("/api/amenities/settings", { credentials: "include" }),
      ]);
      const [a, c, s] = await Promise.all([aRes.json(), cRes.json(), sRes.json()]);
      if (!aRes.ok) throw new Error(a.error || "Could not load this amenity");

      // The detail endpoint returns the whole configuration in one response, so
      // switching tabs never costs another round trip.
      setAmenity(a.amenity);
      setSlots(a.slots || []);
      // API may return `rules` either grouped by kind (object) or as a flat array.
      // Normalize to an array so `rules.filter(...)` works in the UI.
      const loadedRules = a.rules || [];
      const flatRules = Array.isArray(loadedRules) ? loadedRules : [].concat(...Object.values(loadedRules || {}));
      setRules(flatRules);
      setRuleDraft(flatRules
        .filter((r) => r.isActive !== false)
        .map((r) => ({ key: r._id || newRuleKey(), kind: r.kind, text: r.text, displayOrder: r.displayOrder ?? 0 })));
      setAvailability(a.availability || []);
      const weeklyRows = (a.availability || []).filter((r) => r.type === "WEEKLY");
      setWeeklyDraft(DAYS.map((_, i) => ({
        dayOfWeek: i,
        windows: weeklyRows
          .filter((r) => r.dayOfWeek === i)
          .map((r) => ({ key: r._id || newKey(), openTime: r.openTime, closeTime: r.closeTime })),
      })));
      setClosures(a.closures || []);
      setMaintenance(a.maintenance || []);
      setQr(a.qr || null);
      setCategories(c.categories || []);
      setSettings(s.settings || null);
      setDraft({
        name: a.amenity.name,
        categoryId: a.amenity.categoryId,
        description: a.amenity.description || "",
        location: a.amenity.location || "",
        contactName: a.amenity.contactPerson?.name || "",
        contactPhone: a.amenity.contactPerson?.phone || "",
        isActive: a.amenity.isActive,
        access: { ...(a.amenity.access || {}) },
        capacity: { ...(a.amenity.capacity || {}) },
        slotPolicy: { ...(a.amenity.slotPolicy || {}) },
        visitorPolicy: { ...(a.amenity.visitorPolicy || {}) },
        attendanceMode: a.amenity.attendanceMode,
      });
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!newToken) { setQrImage(null); return; }
    const value = newToken.deepLink || newToken.token;
    if (!value) return;
    let cancelled = false;
    QRCode.toDataURL(value, { width: 220, margin: 1 })
      .then((url) => { if (!cancelled) setQrImage(url); })
      .catch((err) => console.error("QR render failed", err));
    return () => { cancelled = true; };
  }, [newToken]);

  const addWindow = (dayOfWeek) => {
    setWeeklyDraft((prev) => prev.map((d) => (
      d.dayOfWeek === dayOfWeek
        ? { ...d, windows: [...d.windows, { key: newKey(), openTime: "09:00", closeTime: "18:00" }] }
        : d
    )));
  };
  const removeWindow = (dayOfWeek, key) => {
    setWeeklyDraft((prev) => prev.map((d) => (
      d.dayOfWeek === dayOfWeek ? { ...d, windows: d.windows.filter((w) => w.key !== key) } : d
    )));
  };
  const updateWindow = (dayOfWeek, key, field, value) => {
    setWeeklyDraft((prev) => prev.map((d) => (
      d.dayOfWeek === dayOfWeek
        ? { ...d, windows: d.windows.map((w) => (w.key === key ? { ...w, [field]: value } : w)) }
        : d
    )));
  };

  // Cuts break windows out of an open-close span so residents can't book across
  // lunch/cleaning gaps without needing one manual window per gap per day.
  const splitByBreaks = (openTime, closeTime, breaks) => {
    const sorted = breaks
      .filter((b) => b.start && b.end && b.start < b.end && b.start > openTime && b.end < closeTime)
      .sort((a, b) => a.start.localeCompare(b.start));
    const windows = [];
    let cursor = openTime;
    for (const b of sorted) {
      if (b.start > cursor) windows.push({ openTime: cursor, closeTime: b.start });
      cursor = b.end > cursor ? b.end : cursor;
    }
    if (cursor < closeTime) windows.push({ openTime: cursor, closeTime });
    return windows.map((w) => ({ key: newKey(), ...w }));
  };

  const addBreak = () => setQuickBreaks((prev) => (prev.length >= 2 ? prev : [...prev, { key: newKey(), start: "13:00", end: "14:00" }]));
  const removeBreak = (key) => setQuickBreaks((prev) => prev.filter((b) => b.key !== key));
  const updateBreak = (key, field, value) => setQuickBreaks((prev) => prev.map((b) => (b.key === key ? { ...b, [field]: value } : b)));

  const applyAllDays = () => {
    const windows = splitByBreaks(quickOpen, quickClose, quickBreaks);
    setWeeklyDraft(DAYS.map((_, i) => ({ dayOfWeek: i, windows: windows.map((w) => ({ ...w, key: newKey() })) })));
  };
  const toggleDayOpen = (dayOfWeek, open) => {
    setWeeklyDraft((prev) => prev.map((d) => (
      d.dayOfWeek === dayOfWeek
        ? { ...d, windows: open ? splitByBreaks(quickOpen, quickClose, quickBreaks) : [] }
        : d
    )));
  };

  const saveAvailability = async () => {
    const weekly = weeklyDraft.flatMap((d) => d.windows.map((w) => ({
      dayOfWeek: d.dayOfWeek, openTime: w.openTime, closeTime: w.closeTime,
    })));
    setSavingAvailability(true);
    try {
      const res = await fetch(`/api/amenities/${id}/availability`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekly }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save weekly hours");
      showToast("Weekly hours saved");
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingAvailability(false);
    }
  };

  const addClosure = async () => {
    if (!closureDraft.startDate || !closureDraft.endDate || !closureDraft.reason.trim()) {
      return showToast("Start date, end date and reason are required", "err");
    }
    setSavingClosure(true);
    try {
      const res = await fetch(`/api/amenities/${id}/closures`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(closureDraft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add closure");
      showToast("Closure added");
      setClosureDraft({ closureType: "HOLIDAY", startDate: "", endDate: "", reason: "" });
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingClosure(false);
    }
  };

  const removeClosure = async (closureId) => {
    if (!(await notify.confirm("Cancel this closure? The amenity will reopen per its weekly hours.", { tone: "warning" }))) return;
    const res = await fetch(`/api/amenities/${id}/closures/${closureId}`, {
      method: "DELETE", credentials: "include",
    });
    if (!res.ok) return showToast("Could not cancel closure", "err");
    showToast("Closure cancelled");
    load();
  };

  const patchAmenity = async (body, successMsg) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/amenities/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      showToast(successMsg || "Saved");
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  // A slot's identity on the server is { dayOfWeek, startTime } — PUT upserts
  // on that key. Changing the start time therefore targets a different key,
  // so the old slot is deactivated first or it would linger as a stray
  // duplicate alongside the edited one.
  const saveSlot = async (original, form) => {
    setSavingSlot(true);
    try {
      if (original && !original.isNew && original.startTime !== form.startTime) {
        const res = await fetch(`/api/amenities/${id}/slots`, {
          method: "PUT", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dayOfWeek: original.dayOfWeek,
            startTime: original.startTime,
            endTime: original.endTime,
            isActive: false,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Could not move the old slot");
        }
      }

      const res = await fetch(`/api/amenities/${id}/slots`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayOfWeek: form.dayOfWeek,
          startTime: form.startTime,
          endTime: form.endTime,
          capacity: form.capacity === "" ? null : Number(form.capacity),
          label: form.label || "",
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the slot");
      showToast(original && !original.isNew ? "Slot updated" : "Slot added");
      setEditingSlot(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingSlot(false);
    }
  };

  const deleteSlots = async (ids) => {
    if (!ids.length) return;
    if (!(await notify.confirm(`Delete ${ids.length} slot${ids.length === 1 ? "" : "s"}? This can't be undone.`, { tone: "danger" }))) return;
    setSavingSlot(true);
    try {
      const res = await fetch(`/api/amenities/${id}/slots`, {
        method: "DELETE", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not delete slots");
      showToast(`Deleted ${data.deleted} slot${data.deleted === 1 ? "" : "s"}`);
      setSelectingSlots(false);
      setSelectedSlotIds([]);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingSlot(false);
    }
  };

  const removeSlot = async (s) => {
    if (!(await notify.confirm(`Remove the ${s.startTime}–${s.endTime} slot?`, { tone: "warning" }))) return;
    setSavingSlot(true);
    try {
      const res = await fetch(`/api/amenities/${id}/slots`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, isActive: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not remove the slot");
      showToast("Slot removed");
      setEditingSlot(null);
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingSlot(false);
    }
  };

  // Whole-list replace, matching the API: PUT /rules always sends the
  // complete set, never a single row.
  const saveRules = async () => {
    const cleaned = ruleDraft
      .map((r) => ({ ...r, text: r.text.trim() }))
      .filter((r) => r.text);
    setSavingRules(true);
    try {
      const res = await fetch(`/api/amenities/${id}/rules`, {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: cleaned.map(({ kind, text, displayOrder }, idx) => ({ kind, text, displayOrder: idx })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save rules");
      showToast("Rules saved");
      load();
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSavingRules(false);
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <RevampSkeleton h={420} />
      </div>
    );
  }

  if (!amenity) {
    return (
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
        <Card>
          <EmptyState icon="search-x" title="Amenity not found" sub="It may have been removed." />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Link href="/admin/amenities/list">
              <Btn variant="secondary" icon="arrow-left">Back to all amenities</Btn>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const eff = amenity.effectiveStatus;
  const weekly = availability.filter((r) => r.type === "WEEKLY");

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--r-fg-4)", marginBottom: 10 }}>
        <Link href="/admin/amenities" style={{ color: "inherit" }}>Amenities</Link>
        <Icon name="chevron-right" size={12} />
        <Link href="/admin/amenities/list" style={{ color: "inherit" }}>All amenities</Link>
        <Icon name="chevron-right" size={12} />
        <span style={{ color: "var(--r-fg-2)", fontWeight: 500 }}>{amenity.name}</span>
      </div>

      <PageHeader
        eyebrow={<><Icon name="building-2" size={11} /> Operations · Amenities</>}
        title={amenity.name}
        sub={`${amenity.categoryName}${amenity.location ? ` · ${amenity.location}` : ""}`}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Pill
              tone={amenity.status === "OPEN" ? "paid" : "neutral"} dot={false}
              style={{ cursor: "default" }}
              title="Manual status — set via the Status action, overrides the weekly schedule below"
            >
              {label(amenity.status)} (manual)
            </Pill>
            {eff && (
              <Pill
                tone={eff.state === "OPEN" ? "paid" : "unpaid"} dot={false}
                style={{ cursor: "default" }}
                title="Live status — computed right now from the weekly hours and any closures"
              >
                {eff.label} (live)
              </Pill>
            )}
            {amenity.liveOccupancy > 0 && (
              <Pill tone="info" dot={false}>{amenity.liveOccupancy} inside</Pill>
            )}
            <Link href="/admin/amenities/list">
              <Btn variant="secondary" size="sm" icon="arrow-left">All amenities</Btn>
            </Link>
          </div>
        }
      />

      {eff && eff.state !== "OPEN" && (
        <div style={{
          display: "flex", gap: 10, padding: 12, borderRadius: 10, marginBottom: 16,
          background: "var(--r-warning-soft)", color: "var(--r-warning)", fontSize: 13,
        }}>
          <Icon name="alert-triangle" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>{eff.label}</strong>
            {eff.reason ? ` — ${eff.reason}` : ""}
            {eff.nextOpenAt
              ? ` Reopens ${new Date(eff.nextOpenAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`
              : ""}
          </span>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={TABS.map(([t, icon]) => ({ key: t, label: t, icon }))}
        style={{ flexWrap: "wrap" }}
      />

      {/* ------------------------------------------------------------ Basics */}
      {tab === "Basics" && (
        <Card style={{ maxWidth: 640 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Name">
              <input className="input" value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Category">
              <select className="input" value={draft.categoryId}
                onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input className="input" value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </Field>
            <Field label="Description">
              <textarea rows={3} className="input" value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Contact person">
                <input className="input" value={draft.contactName}
                  onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} />
              </Field>
              <Field label="Contact phone">
                <input className="input" value={draft.contactPhone}
                  onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} />
              </Field>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--r-fg-2)" }}>
              <input type="checkbox" checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              Active — visible to residents
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <Btn variant="primary" disabled={saving}
                onClick={() => patchAmenity({
                  name: draft.name, categoryId: draft.categoryId,
                  description: draft.description, location: draft.location,
                  isActive: draft.isActive,
                  contactPerson: { name: draft.contactName, phone: draft.contactPhone },
                }, "Basics saved")}>
                {saving ? "Saving…" : "Save basics"}
              </Btn>
              <Btn variant="danger"
                onClick={async () => {
                  if (!(await notify.confirm(`Delete "${amenity.name}"? Attendance and incident history is retained.`, { tone: "danger" }))) return;
                  const res = await fetch(`/api/amenities/${id}`, { method: "DELETE", credentials: "include" });
                  const data = await res.json();
                  if (!res.ok) return showToast(data.error || "Delete failed", "err");
                  router.push("/admin/amenities/list");
                }}>
                Delete amenity
              </Btn>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", lineHeight: 1.5 }}>
              Deleting hides the amenity but attendance, incidents and analytics keep referring to it,
              because those histories are required permanently.
            </p>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------ Availability */}
      {tab === "Availability" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 16 }}>
          <Card>
            <CardHead title="Weekly hours" />
            {!weekly.length && (
              <p style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginBottom: 12 }}>
                No weekly hours set — residents see this amenity as always open.
              </p>
            )}

            <div style={{ marginBottom: 16, padding: 12, background: "var(--r-surface-2)", borderRadius: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Open</span>
                <input type="time" className="input" style={{ width: "auto" }} value={quickOpen} onChange={(e) => setQuickOpen(e.target.value)} />
                <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>–</span>
                <input type="time" className="input" style={{ width: "auto" }} value={quickClose} onChange={(e) => setQuickClose(e.target.value)} />
              </div>
              {quickBreaks.map((b) => (
                <div key={b.key} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Break</span>
                  <input type="time" className="input" style={{ width: "auto" }} value={b.start} onChange={(e) => updateBreak(b.key, "start", e.target.value)} />
                  <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>–</span>
                  <input type="time" className="input" style={{ width: "auto" }} value={b.end} onChange={(e) => updateBreak(b.key, "end", e.target.value)} />
                  <Btn size="sm" variant="ghost" onClick={() => removeBreak(b.key)}>×</Btn>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {quickBreaks.length < 2 && (
                  <Btn size="sm" variant="secondary" onClick={addBreak}>+ Add break</Btn>
                )}
                <Btn size="sm" variant="primary" onClick={applyAllDays}>Apply to all 7 days</Btn>
              </div>
              <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 8, lineHeight: 1.5 }}>
                Up to 2 breaks (e.g. lunch, cleaning) — applied to every day. Then just uncheck a day below to close it.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "104px 1fr", rowGap: 10, columnGap: 14 }}>
              {DAYS.map((d, i) => {
                const day = weeklyDraft.find((wd) => wd.dayOfWeek === i) || { windows: [] };
                const isOpen = day.windows.length > 0;
                const primary = day.windows[0];
                const extra = day.windows.slice(1);
                return (
                  <Fragment key={d}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", fontSize: 13, color: "var(--r-fg-2)" }}>
                      <input type="checkbox" checked={isOpen} onChange={(e) => toggleDayOpen(i, e.target.checked)} />
                      {d}
                    </label>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      {!isOpen ? (
                        <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>Closed</span>
                      ) : (
                        <>
                          <input type="time" className="input" style={{ width: "auto" }} value={primary.openTime}
                            onChange={(e) => updateWindow(i, primary.key, "openTime", e.target.value)} />
                          <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>–</span>
                          <input type="time" className="input" style={{ width: "auto" }} value={primary.closeTime}
                            onChange={(e) => updateWindow(i, primary.key, "closeTime", e.target.value)} />
                          {extra.map((w) => (
                            <span key={w.key} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>+</span>
                              <input type="time" className="input" style={{ width: "auto" }} value={w.openTime}
                                onChange={(e) => updateWindow(i, w.key, "openTime", e.target.value)} />
                              <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>–</span>
                              <input type="time" className="input" style={{ width: "auto" }} value={w.closeTime}
                                onChange={(e) => updateWindow(i, w.key, "closeTime", e.target.value)} />
                              <Btn size="sm" variant="ghost" onClick={() => removeWindow(i, w.key)}>×</Btn>
                            </span>
                          ))}
                          <Btn size="sm" variant="ghost" onClick={() => addWindow(i)}>+ split shift</Btn>
                        </>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 14, lineHeight: 1.5 }}>
              For a one-off holiday, don't uncheck the day here — use Closures below instead so it doesn't
              repeat every week.
            </p>
            <div style={{ marginTop: 14 }}>
              <Btn variant="primary" disabled={savingAvailability} onClick={saveAvailability}>
                {savingAvailability ? "Saving…" : "Save weekly hours"}
              </Btn>
            </div>
          </Card>

          <Card>
            <CardHead title="Closures" />
            {!closures.length ? (
              <p style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>No holiday or temporary closures scheduled.</p>
            ) : (
              <div>
                {closures.map((c, i) => (
                  <div key={c._id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                    padding: "10px 0", borderTop: i > 0 ? "1px solid var(--r-hairline)" : "none",
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--r-fg-1)", fontSize: 13 }}>{c.reason}</div>
                      <div style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
                        {new Date(c.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                        {" – "}
                        {new Date(c.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Pill tone={c.closureType === "HOLIDAY" ? "info" : "warning"} dot={false}>{label(c.closureType)}</Pill>
                      <Btn size="sm" variant="danger" onClick={() => removeClosure(c._id)}>Cancel</Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 12, lineHeight: 1.5 }}>
              Closures more than a week out appear here and on the resident page but send no notification —
              a holiday eight months away is not news.
            </p>

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--r-hairline)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <Field label="Type">
                  <select className="input" value={closureDraft.closureType}
                    onChange={(e) => setClosureDraft({ ...closureDraft, closureType: e.target.value })}>
                    <option value="HOLIDAY">Holiday</option>
                    <option value="TEMPORARY">Temporary</option>
                  </select>
                </Field>
                <Field label="Start date">
                  <input type="date" className="input" value={closureDraft.startDate}
                    onChange={(e) => setClosureDraft({ ...closureDraft, startDate: e.target.value })} />
                </Field>
                <Field label="End date">
                  <input type="date" className="input" value={closureDraft.endDate}
                    onChange={(e) => setClosureDraft({ ...closureDraft, endDate: e.target.value })} />
                </Field>
              </div>
              <Field label="Reason">
                <input className="input" placeholder="e.g. Diwali, deep cleaning, pump repair"
                  value={closureDraft.reason}
                  onChange={(e) => setClosureDraft({ ...closureDraft, reason: e.target.value })} />
              </Field>
              <Btn variant="primary" style={{ alignSelf: "flex-start" }} disabled={savingClosure} onClick={addClosure}>
                {savingClosure ? "Adding…" : "Add closure"}
              </Btn>
            </div>
          </Card>
        </div>
      )}

      {/* ----------------------------------------------------------- Access */}
      {tab === "Access" && (
        <Card style={{ maxWidth: 560 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Who may use this amenity">
              <select className="input" value={draft.access?.audience || "EVERYONE"}
                onChange={(e) => setDraft({ ...draft, access: { ...draft.access, audience: e.target.value } })}>
                {AUDIENCES.map((a) => <option key={a} value={a}>{label(a)}</option>)}
              </select>
            </Field>

            {draft.access?.audience === "CUSTOM" && (
              <Field label="Custom roles">
                {!settings?.customAccessRoles?.length ? (
                  <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", lineHeight: 1.5 }}>
                    No custom roles configured yet. Add them in amenity settings first — the API rejects
                    roles that are not in the society list.
                  </p>
                ) : settings.customAccessRoles.map((role) => (
                  <label key={role} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--r-fg-2)", marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={(draft.access?.customRoles || []).includes(role)}
                      onChange={(e) => {
                        const cur = draft.access?.customRoles || [];
                        setDraft({
                          ...draft,
                          access: {
                            ...draft.access,
                            customRoles: e.target.checked ? [...cur, role] : cur.filter((r) => r !== role),
                          },
                        });
                      }}
                    />
                    {role}
                  </label>
                ))}
              </Field>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Minimum age">
                <input className="input" type="number" min={0} max={120}
                  value={draft.access?.minAge ?? ""}
                  onChange={(e) => setDraft({ ...draft, access: { ...draft.access, minAge: e.target.value === "" ? null : Number(e.target.value) } })} />
              </Field>
              <Field label="Maximum age">
                <input className="input" type="number" min={0} max={120}
                  value={draft.access?.maxAge ?? ""}
                  onChange={(e) => setDraft({ ...draft, access: { ...draft.access, maxAge: e.target.value === "" ? null : Number(e.target.value) } })} />
              </Field>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", lineHeight: 1.5 }}>
              Age limits apply to resident self check-in. A guard recording a check-in can override them,
              and the override is recorded with a reason — someone standing in front of you may be a
              legitimate exception the rules cannot see.
            </p>

            <Btn variant="primary" disabled={saving}
              onClick={() => patchAmenity({ access: draft.access }, "Access rules saved")}>
              {saving ? "Saving…" : "Save access"}
            </Btn>
          </div>
        </Card>
      )}

      {/* --------------------------------------------------------- Capacity */}
      {tab === "Capacity" && (
        <Card style={{ maxWidth: 520 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--r-fg-2)" }}>
              <input type="checkbox" checked={draft.capacity?.unlimited !== false}
                onChange={(e) => setDraft({ ...draft, capacity: { ...draft.capacity, unlimited: e.target.checked } })} />
              Unlimited capacity
            </label>

            {draft.capacity?.unlimited === false && (
              <>
                <Field label="Maximum occupancy">
                  <input className="input" type="number" min={1}
                    value={draft.capacity?.maxOccupancy ?? ""}
                    onChange={(e) => setDraft({ ...draft, capacity: { ...draft.capacity, maxOccupancy: Number(e.target.value) } })} />
                </Field>
                <Field
                  label="Warning threshold (%)"
                  hint="The dashboard turns amber at this point, so the guard can slow admissions before the amenity becomes unpleasant rather than at the moment it is full."
                >
                  <input className="input" type="number" min={1} max={100}
                    value={draft.capacity?.warningThresholdPct ?? 80}
                    onChange={(e) => setDraft({ ...draft, capacity: { ...draft.capacity, warningThresholdPct: Number(e.target.value) } })} />
                </Field>
                {amenity.liveOccupancy > 0 && (
                  <div style={{ display: "flex", gap: 8, padding: 12, borderRadius: 8, background: "var(--r-brand-soft)", fontSize: 12.5, color: "var(--r-fg-2)" }}>
                    <Icon name="info" size={15} color="var(--r-brand)" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      {amenity.liveOccupancy} {amenity.liveOccupancy === 1 ? "person is" : "people are"} checked in
                      right now. The maximum cannot be set below that.
                    </span>
                  </div>
                )}
              </>
            )}

            <Btn variant="primary" disabled={saving}
              onClick={() => patchAmenity({ capacity: draft.capacity }, "Capacity saved")}>
              {saving ? "Saving…" : "Save capacity"}
            </Btn>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------------ Slots */}
      {tab === "Slots" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 16 }}>
          <Card>
            <CardHead title="Slot policy" />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--r-fg-2)" }}>
                <input type="checkbox" checked={!!draft.slotPolicy?.enabled}
                  onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, enabled: e.target.checked } })} />
                Use time slots
              </label>
              <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", lineHeight: 1.5 }}>
                Booking is not enabled, but slots still attribute attendance, scope QR check-ins and give
                analytics a unit finer than a whole day. A gym typically needs none; a tennis court does.
              </p>

              {draft.slotPolicy?.enabled && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Field label="Slot duration (min)">
                      <input className="input" type="number" min={5} max={1440}
                        value={draft.slotPolicy?.slotDurationMins ?? 60}
                        onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, slotDurationMins: Number(e.target.value) } })} />
                    </Field>
                    <Field label="Gap between slots (min)">
                      <input className="input" type="number" min={0} max={240}
                        value={draft.slotPolicy?.gapBetweenSlotsMins ?? 0}
                        onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, gapBetweenSlotsMins: Number(e.target.value) } })} />
                    </Field>
                    <Field label="Buffer time (min)" hint="Trimmed off the end of each slot for cleaning or changeover.">
                      <input className="input" type="number" min={0} max={240}
                        value={draft.slotPolicy?.bufferTimeMins ?? 0}
                        onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, bufferTimeMins: Number(e.target.value) } })} />
                    </Field>
                    <Field label="Capacity per slot">
                      <input className="input" type="number" min={1}
                        value={draft.slotPolicy?.maxCapacityPerSlot ?? ""}
                        onChange={(e) => setDraft({ ...draft, slotPolicy: { ...draft.slotPolicy, maxCapacityPerSlot: e.target.value === "" ? null : Number(e.target.value) } })} />
                    </Field>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="secondary" disabled={saving}
                      onClick={async () => {
                        // Dry run first: regenerating replaces generated slots, so
                        // showing the count beforehand is worth the extra call.
                        const res = await fetch(`/api/amenities/${id}/slots`, {
                          method: "POST", credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ ...draft.slotPolicy, dryRun: true }),
                        });
                        const data = await res.json();
                        if (!res.ok) return showToast(data.error || "Preview failed", "err");
                        showToast(`Would generate ${data.generated} slots across the week`);
                      }}>
                      Preview
                    </Btn>
                    <Btn variant="primary" disabled={saving}
                      onClick={async () => {
                        await patchAmenity({ slotPolicy: draft.slotPolicy }, "Slot policy saved");
                        const res = await fetch(`/api/amenities/${id}/slots`, {
                          method: "POST", credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({}),
                        });
                        const data = await res.json();
                        if (res.ok) showToast(`${data.created} slots generated`);
                        load();
                      }}>
                      Save and regenerate
                    </Btn>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHead
              title="Generated slots"
              right={!!slots.length && (
                selectingSlots ? (
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>{selectedSlotIds.length} selected</span>
                    <Btn size="sm" variant="secondary" onClick={() => setSelectedSlotIds(slots.map((s) => s._id))}>Select all</Btn>
                    <Btn size="sm" variant="danger" disabled={savingSlot || !selectedSlotIds.length} onClick={() => deleteSlots(selectedSlotIds)}>
                      Delete selected
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => { setSelectingSlots(false); setSelectedSlotIds([]); }}>Cancel</Btn>
                  </div>
                ) : (
                  <Btn size="sm" variant="secondary" onClick={() => setSelectingSlots(true)}>Select slots to delete</Btn>
                )
              )}
            />
            {!slots.length ? (
              <p style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>No slots yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {DAYS.map((d, i) => {
                  const rows = slots.filter((s) => s.dayOfWeek === i && s.isActive !== false);
                  if (!rows.length && selectingSlots) return null;
                  return (
                    <div key={d}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--r-fg-3)", marginBottom: 6 }}>{d}</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {rows.map((s) => {
                          const picked = selectedSlotIds.includes(s._id);
                          return (
                            <button
                              key={s._id}
                              type="button"
                              title={selectingSlots ? "Click to select" : "Click to edit"}
                              onClick={() => (selectingSlots
                                ? setSelectedSlotIds((prev) => (picked ? prev.filter((x) => x !== s._id) : [...prev, s._id]))
                                : setEditingSlot({
                                  dayOfWeek: i, startTime: s.startTime, endTime: s.endTime,
                                  capacity: s.capacity ?? "", label: s.label || "", isNew: false,
                                }))}
                              style={{
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "6px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500,
                                fontFamily: "inherit", cursor: "pointer",
                                background: selectingSlots
                                  ? (picked ? "var(--r-danger-soft)" : "var(--r-surface-2)")
                                  : (s.isCustom ? "var(--r-brand-soft)" : "var(--r-surface-2)"),
                                color: selectingSlots
                                  ? (picked ? "var(--r-danger)" : "var(--r-fg-2)")
                                  : (s.isCustom ? "var(--r-brand)" : "var(--r-fg-2)"),
                                border: selectingSlots
                                  ? (picked ? "1px solid var(--r-danger)" : "1px solid transparent")
                                  : "1px solid var(--r-border)",
                              }}
                            >
                              {selectingSlots ? (picked ? "" : "") : ""}
                              {s.startTime}–{s.endTime}
                              {s.capacity ? ` · ${s.capacity}` : ""}
                            </button>
                          );
                        })}
                        {!selectingSlots && (
                          <button
                            type="button"
                            onClick={() => setEditingSlot({
                              dayOfWeek: i, startTime: "", endTime: "", capacity: "", label: "", isNew: true,
                            })}
                            style={{
                              display: "inline-flex", alignItems: "center", padding: "6px 10px",
                              borderRadius: 999, fontSize: 12, fontWeight: 500, fontFamily: "inherit",
                              cursor: "pointer", background: "transparent", color: "var(--r-fg-4)",
                              border: "1px dashed var(--r-border)",
                            }}
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", lineHeight: 1.5 }}>
                  {selectingSlots
                    ? "Tick the slots you want gone, then Delete selected."
                    : "Highlighted slots were created by hand and are preserved when the grid is regenerated. Click any slot to edit its time or capacity, or add one by hand."}
                </p>
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal
        open={Boolean(editingSlot)}
        onClose={() => !savingSlot && setEditingSlot(null)}
        title={editingSlot ? `${editingSlot.isNew ? "Add slot" : "Edit slot"} · ${DAYS[editingSlot.dayOfWeek]}` : ""}
        width={480}
      >
        {editingSlot && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Start time">
                <input className="input" type="time" value={editingSlot.startTime}
                  onChange={(e) => setEditingSlot({ ...editingSlot, startTime: e.target.value })} />
              </Field>
              <Field label="End time">
                <input className="input" type="time" value={editingSlot.endTime}
                  onChange={(e) => setEditingSlot({ ...editingSlot, endTime: e.target.value })} />
              </Field>
              <Field label="Capacity (optional)">
                <input className="input" type="number" min={1} value={editingSlot.capacity}
                  onChange={(e) => setEditingSlot({ ...editingSlot, capacity: e.target.value })} />
              </Field>
              <Field label="Label (optional)">
                <input className="input" type="text" maxLength={80} value={editingSlot.label}
                  onChange={(e) => setEditingSlot({ ...editingSlot, label: e.target.value })} />
              </Field>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              {!editingSlot.isNew ? (
                <Btn variant="danger" disabled={savingSlot} onClick={() => removeSlot(editingSlot)}>Remove</Btn>
              ) : <span />}
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="ghost" disabled={savingSlot} onClick={() => setEditingSlot(null)}>Cancel</Btn>
                <Btn
                  variant="primary" disabled={savingSlot}
                  onClick={() => {
                    if (!editingSlot.startTime || !editingSlot.endTime) {
                      return showToast("Start and end time are required", "err");
                    }
                    if (editingSlot.endTime <= editingSlot.startTime) {
                      return showToast("End time must be after start time", "err");
                    }
                    saveSlot(editingSlot.isNew ? null : editingSlot, editingSlot);
                  }}>
                  {savingSlot ? "Saving…" : "Save"}
                </Btn>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------------ Rules */}
      {tab === "Rules" && (
        <Card>
          <CardHead title="Rulebook" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 22 }}>
            {RULE_KINDS.map(([kind, heading]) => {
              const rows = ruleDraft.filter((r) => r.kind === kind);
              return (
                <div key={kind}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-2)", marginBottom: 9 }}>{heading}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {rows.map((r) => (
                      <div key={r.key} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <input
                          className="input"
                          style={{ flex: 1 }}
                          value={r.text}
                          maxLength={240}
                          placeholder={`Add a ${heading.toLowerCase()} line…`}
                          onChange={(e) => setRuleDraft(ruleDraft.map((row) =>
                            row.key === r.key ? { ...row, text: e.target.value } : row))}
                        />
                        <Btn size="sm" variant="ghost" title="Remove"
                          onClick={() => setRuleDraft(ruleDraft.filter((row) => row.key !== r.key))}>
                          ✕
                        </Btn>
                      </div>
                    ))}
                    <Btn
                      size="sm" variant="secondary" style={{ alignSelf: "flex-start" }}
                      onClick={() => setRuleDraft([...ruleDraft, { key: newRuleKey(), kind, text: "", displayOrder: ruleDraft.length }])}
                    >
                      + Add
                    </Btn>
                  </div>
                </div>
              );
            })}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 18, lineHeight: 1.5 }}>
            Rules are saved as a complete set. Retired rules are deactivated rather than deleted, so an
            incident raised for a rule violation still resolves to the rule as it stood that day. Blank
            lines are dropped on save.
          </p>
          <Btn variant="primary" style={{ marginTop: 14 }} disabled={savingRules} onClick={saveRules}>
            {savingRules ? "Saving…" : "Save rulebook"}
          </Btn>
        </Card>
      )}

      {/* --------------------------------------------------------- Visitors */}
      {tab === "Visitors" && (
        <Card style={{ maxWidth: 560 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--r-fg-2)" }}>
              <input type="checkbox" checked={!!draft.visitorPolicy?.allowed}
                onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, allowed: e.target.checked } })} />
              Visitors allowed
            </label>

            {draft.visitorPolicy?.allowed && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Max visitors per resident">
                    <input className="input" type="number" min={0} max={100}
                      value={draft.visitorPolicy?.maxVisitorsPerResident ?? 2}
                      onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, maxVisitorsPerResident: Number(e.target.value) } })} />
                  </Field>
                  <Field label="Max visitors in total">
                    <input className="input" type="number" min={0}
                      value={draft.visitorPolicy?.maxVisitorsTotal ?? ""}
                      onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, maxVisitorsTotal: e.target.value === "" ? null : Number(e.target.value) } })} />
                  </Field>
                  <Field label="Allowed from">
                    <input className="input" type="time"
                      value={draft.visitorPolicy?.allowedFrom || ""}
                      onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, allowedFrom: e.target.value } })} />
                  </Field>
                  <Field label="Allowed until">
                    <input className="input" type="time"
                      value={draft.visitorPolicy?.allowedTo || ""}
                      onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, allowedTo: e.target.value } })} />
                  </Field>
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--r-fg-2)" }}>
                  <input type="checkbox" checked={!!draft.visitorPolicy?.approvalRequired}
                    onChange={(e) => setDraft({ ...draft, visitorPolicy: { ...draft.visitorPolicy, approvalRequired: e.target.checked } })} />
                  Committee approval required before entry
                </label>
              </>
            )}

            <Btn variant="primary" disabled={saving}
              onClick={() => patchAmenity({ visitorPolicy: draft.visitorPolicy }, "Visitor policy saved")}>
              {saving ? "Saving…" : "Save visitor policy"}
            </Btn>
          </div>
        </Card>
      )}

      {/* --------------------------------------------------- Attendance & QR */}
      {tab === "Attendance & QR" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
          <Card>
            <CardHead title="Attendance mode" />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Segmented
                value={draft.attendanceMode}
                onChange={(v) => setDraft({ ...draft, attendanceMode: v })}
                options={MODES.map((m) => ({ value: m, label: m === "QR_MANUAL" ? "QR with manual override" : label(m) }))}
              />
              <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", lineHeight: 1.5 }}>
                QR with manual override is usually the right answer in practice: residents self-scan, and a
                guard can still admit someone whose phone is flat rather than turning them away.
              </p>
              <Btn variant="primary" disabled={saving}
                onClick={() => patchAmenity({ attendanceMode: draft.attendanceMode }, "Attendance mode saved")}>
                {saving ? "Saving…" : "Save mode"}
              </Btn>
            </div>
          </Card>

          <Card>
            <CardHead title="QR code" />
            {qr && qr.isActive ? (
              <div>
                <p style={{ fontSize: 13, color: "var(--r-fg-3)", margin: "0 0 8px" }}>
                  Active code{qr.label ? ` · ${qr.label}` : ""} · {qr.mode}
                </p>
                <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", lineHeight: 1.5 }}>
                  Scanned {qr.scanCount || 0} times.
                  {qr.lastScannedAt
                    ? ` Last used ${new Date(qr.lastScannedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`
                    : " Not used yet."}
                </p>
                <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 10, lineHeight: 1.5 }}>
                  The scannable value is not shown again — only a hash is stored, which is what makes a
                  leaked screenshot recoverable by revoking rather than a permanent problem.
                </p>
                <Btn variant="danger" size="sm" style={{ marginTop: 12 }}
                  onClick={async () => {
                    if (!(await notify.confirm("Revoke this code? Printed copies stop working immediately.", { tone: "danger" }))) return;
                    const res = await fetch(`/api/amenities/${id}/qr?tokenId=${qr._id}`, {
                      method: "DELETE", credentials: "include",
                    });
                    if (!res.ok) return showToast("Could not revoke the code", "err");
                    showToast("Code revoked");
                    load();
                  }}>
                  Revoke
                </Btn>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>No active code for this amenity.</p>
                <Btn variant="primary" style={{ marginTop: 12 }}
                  onClick={async () => {
                    const res = await fetch(`/api/amenities/${id}/qr`, {
                      method: "POST", credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ mode: "STATIC" }),
                    });
                    const data = await res.json();
                    if (!res.ok) return showToast(data.error || "Could not generate a code", "err");
                    setNewToken(data.qr);
                    load();
                  }}>
                  Generate QR code
                </Btn>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ------------------------------------------------------ Maintenance */}
      {tab === "Maintenance" && (
        <DataTable
          cols={[
            {
              key: "reason", label: "Reason", render: (m) => (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{m.reason}</div>
                  {m.extensions?.length ? (
                    <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>Extended {m.extensions.length}×</div>
                  ) : null}
                  {m.reopenedEarly ? <div style={{ fontSize: 11, color: "var(--r-fg-4)" }}>Reopened early</div> : null}
                </div>
              ),
            },
            {
              key: "window", label: "Window", width: 200, render: (m) => (
                <span style={{ fontSize: 12.5 }}>
                  {new Date(m.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  {" – "}
                  {new Date(m.actualEndDate || m.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              ),
            },
            {
              key: "status", label: "Status", width: 130,
              render: (m) => <Pill tone={MAINT_STATUS_TONE[m.status] || "neutral"} dot={false}>{label(m.status)}</Pill>,
            },
            { key: "createdBy", label: "Recorded by", width: 150, render: (m) => <span style={{ color: "var(--r-fg-4)" }}>{m.createdByName || "—"}</span> },
          ]}
          rows={maintenance}
          rowKey="_id"
          emptyIcon="wrench"
          emptyTitle="No maintenance history"
          emptySub={<>Schedule maintenance from the <Link href="/admin/amenities/maintenance">maintenance calendar</Link>.</>}
        />
      )}

      <Modal open={Boolean(newToken)} onClose={() => setNewToken(null)} title="QR code generated" width={420}>
        {newToken && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{
              padding: 12, borderRadius: 8, background: "var(--r-warning-soft)", fontSize: 12.5,
              color: "var(--r-warning)", display: "flex", gap: 8,
            }}>
              <Icon name="alert-triangle" size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                This is the only time the code is shown. Only a hash is stored, so it cannot be retrieved
                later — print it now, or generate a fresh one.
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
              {qrImage ? (
                <img src={qrImage} width={220} height={220} alt="Scannable QR code" />
              ) : (
                <div style={{ width: 220, height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--r-fg-5)", fontSize: 12 }}>
                  Rendering…
                </div>
              )}
            </div>
            <Field label="Token">
              <textarea className="input" readOnly value={newToken.token || ""}
                onClick={(e) => e.target.select()} style={{ fontFamily: "monospace", fontSize: 12 }} />
            </Field>
            {newToken.deepLink ? (
              <Field label="Deep link">
                <input className="input" readOnly value={newToken.deepLink}
                  onClick={(e) => e.target.select()} style={{ fontFamily: "monospace", fontSize: 12 }} />
              </Field>
            ) : null}
            <div style={{ display: "flex", gap: 8 }}>
              {qrImage ? (
                <a
                  href={qrImage}
                  download={`amenity-qr-${id}.png`}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "7px 12px", fontSize: 13, fontWeight: 500, height: 32, borderRadius: 8,
                    background: "var(--r-surface)", color: "var(--r-fg-2)", border: "1px solid var(--r-border)",
                    textDecoration: "none", fontFamily: "inherit",
                  }}
                >
                  Download PNG
                </a>
              ) : null}
              <Btn variant="primary" onClick={() => setNewToken(null)}>Done</Btn>
            </div>
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
