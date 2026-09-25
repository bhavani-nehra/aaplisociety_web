"use client";
import { useState, useEffect } from "react";
import {
  PageHeader, Card, Btn, Icon, Pill, ToggleSwitch, RevampSkeleton, EmptyState, Toast,
} from "@/components/revamp";

// Flags the society can turn on now. The remainder exist in the schema but are
// deferred scope, so they are listed read-only rather than offered as switches
// that would enable half-built surfaces.
const LIVE_FLAGS = [
  ["timeSlots", "clock", "Time slots", "Divide operating hours into slots. Drives attendance and analytics even with booking off."],
  ["capacityLimits", "users", "Capacity limits", "Cap concurrent occupancy and warn before it is reached."],
  ["visitorAccess", "user-plus", "Visitor access", "Let residents bring guests, with optional approval."],
  ["attendance", "clipboard-check", "Attendance", "Record who used an amenity and for how long."],
  ["qrCheckIn", "qr-code", "QR check-in", "Residents scan a code at the door to check in and out."],
  ["events", "calendar", "Events", "Host events at an amenity with registration."],
  ["waitlists", "list-ordered", "Waitlists", "Queue residents for full events and promote automatically."],
  ["analytics", "bar-chart-3", "Analytics", "Usage dashboards and exports."],
  ["incidents", "alert-triangle", "Incidents", "Report and track damage, hazards and rule violations."],
];

const DEFERRED = [
  "bookings", "bookingApprovals", "onlinePayments", "securityDeposits", "refunds",
  "penalties", "equipmentRentals", "consumableInventory", "recurringReservations",
  "occupancyPrediction", "iotIntegration", "dynamicQrRotation", "geofencedCheckIn",
  "faceRecognition", "digitalWaiver", "billingIntegration", "loyaltyPoints",
  "calendarSync", "publicApi",
];

function SectionHead({ icon, title, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16 }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8, background: "var(--r-brand-soft)", color: "var(--r-brand)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Icon name={icon} size={15} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--r-fg-1)" }}>{title}</div>
        {sub ? <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 2 }}>{sub}</div> : null}
      </div>
    </div>
  );
}

function FlagRow({ icon, name, desc, on, onChange, last }) {
  return (
    <div style={{
      display: "flex", gap: 12, alignItems: "flex-start", padding: "11px 0",
      borderBottom: last ? "none" : "1px solid var(--r-hairline)",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7, background: "var(--r-surface-2)", color: "var(--r-fg-3)",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
      }}>
        <Icon name={icon} size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>{name}</div>
        <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 2 }}>{desc}</div>
      </div>
      <ToggleSwitch on={on} onChange={onChange} title={name} />
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint ? <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 5, lineHeight: 1.5 }}>{hint}</div> : null}
    </div>
  );
}

function TagEditor({ label, hint, values, onChange, placeholder }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) { setDraft(""); return; }
    onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <label className="label">{label}</label>
      {hint ? <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 2, marginBottom: 9 }}>{hint}</div> : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 9 }}>
        {values.length === 0 ? <span style={{ fontSize: 12, color: "var(--r-fg-5)" }}>None configured</span> : null}
        {values.map((v) => (
          <span key={v} style={{
            display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 6px 3px 10px",
            borderRadius: 999, fontSize: 12, fontWeight: 500,
            background: "var(--r-surface-3)", color: "var(--r-fg-2)",
          }}>
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              style={{
                border: "none", background: "none", cursor: "pointer", color: "var(--r-fg-4)",
                display: "flex", padding: 2, borderRadius: 999,
              }}
            >
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="input"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          style={{ flex: 1 }}
        />
        <Btn variant="secondary" icon="plus" onClick={add}>Add</Btn>
      </div>
    </div>
  );
}

export default function AmenitySettingsPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    fetch("/api/amenities/settings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setSettings(d.settings || null))
      .catch(() => showToast("Could not load settings", "err"))
      .finally(() => setLoading(false));
  }, []);

  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const setFlag = (key, on) => setSettings((s) => ({ ...s, features: { ...s.features, [key]: on } }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/amenities/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features: settings.features,
          incidentTypes: settings.incidentTypes,
          customAccessRoles: settings.customAccessRoles,
          visitorTypes: settings.visitorTypes,
          timezone: settings.timezone,
          autoCheckoutAfterMins: Number(settings.autoCheckoutAfterMins),
          eventReminderLeadMins: Number(settings.eventReminderLeadMins),
          waitlistHoldMins: Number(settings.waitlistHoldMins),
          notifyOnStatusChange: settings.notifyOnStatusChange,
          notifyOnRulesUpdate: settings.notifyOnRulesUpdate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save settings");
      setSettings(data.settings);
      showToast("Settings saved");
    } catch (err) {
      showToast(err.message, "err");
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <PageHeader
      eyebrow={<><Icon name="building-2" size={11} /> Operations · Amenities</>}
      title="Amenity settings"
      sub="Society-wide configuration — individual amenities can override features"
      right={
        settings ? (
          <Btn variant="primary" icon="save" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Btn>
        ) : null
      }
    />
  );

  if (loading) {
    return (
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        {header}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>
          <RevampSkeleton h={340} />
          <RevampSkeleton h={340} />
          <RevampSkeleton h={280} />
          <RevampSkeleton h={280} />
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        {header}
        <Card><EmptyState icon="alert-triangle" title="Settings unavailable" sub="Reload the page to try again." /></Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      {header}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 16 }}>
        <Card>
          <SectionHead icon="sliders-horizontal" title="Features" sub="Turn on the capabilities this society is ready to use" />
          <div>
            {LIVE_FLAGS.map(([key, icon, name, desc], i) => (
              <FlagRow
                key={key}
                icon={icon}
                name={name}
                desc={desc}
                on={!!settings.features?.[key]}
                onChange={(v) => setFlag(key, v)}
                last={i === LIVE_FLAGS.length - 1}
              />
            ))}
          </div>
        </Card>

        <Card>
          <SectionHead icon="clock" title="Timing" sub="Windows and lead times used across every amenity" />
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Field
              label="Timezone"
              hint="Every daily metric is bucketed in this timezone. Getting it wrong shifts check-ins made late at night into the wrong day."
            >
              <input className="input" value={settings.timezone || ""}
                onChange={(e) => set({ timezone: e.target.value })} placeholder="Asia/Kolkata" />
            </Field>
            <Field
              label="Auto check-out after (minutes)"
              hint="Residents forget to check out. Sessions open longer than this are closed automatically and flagged as estimated, so they are never confused with an observed check-out."
            >
              <input className="input" type="number" min={15} max={1440}
                value={settings.autoCheckoutAfterMins ?? 240}
                onChange={(e) => set({ autoCheckoutAfterMins: e.target.value })} />
            </Field>
            <Field label="Event reminder lead time (minutes)">
              <input className="input" type="number" min={5} max={10080}
                value={settings.eventReminderLeadMins ?? 120}
                onChange={(e) => set({ eventReminderLeadMins: e.target.value })} />
            </Field>
            <Field
              label="Waitlist hold (minutes)"
              hint="How long a promoted resident keeps their seat before it passes to the next in queue."
            >
              <input className="input" type="number" min={5} max={10080}
                value={settings.waitlistHoldMins ?? 1440}
                onChange={(e) => set({ waitlistHoldMins: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card>
          <SectionHead icon="tag" title="Vocabulary" sub="The picklists residents and staff choose from" />
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <TagEditor
              label="Incident types"
              hint="Residents pick from this list when reporting a problem."
              values={settings.incidentTypes || []}
              onChange={(v) => set({ incidentTypes: v })}
              placeholder="Equipment failure"
            />
            <TagEditor
              label="Custom access roles"
              hint="Extra audiences beyond owners, tenants, staff and committee."
              values={settings.customAccessRoles || []}
              onChange={(v) => set({ customAccessRoles: v })}
              placeholder="Senior citizens"
            />
            <TagEditor
              label="Visitor types"
              hint="Leave empty to allow any visitor type."
              values={settings.visitorTypes || []}
              onChange={(v) => set({ visitorTypes: v })}
              placeholder="Guest"
            />
          </div>
        </Card>

        <Card>
          <SectionHead icon="bell" title="Notifications" sub="What residents hear about automatically" />
          <div>
            <FlagRow
              icon="bell-ring"
              name="Notify on status change"
              desc="Emergency closures are sent regardless — that is the one case where this preference should not win."
              on={settings.notifyOnStatusChange !== false}
              onChange={(v) => set({ notifyOnStatusChange: v })}
            />
            <FlagRow
              icon="file-text"
              name="Notify on rules update"
              desc="Only fires when the rules actually change, never on a no-op save."
              on={settings.notifyOnRulesUpdate !== false}
              onChange={(v) => set({ notifyOnRulesUpdate: v })}
              last
            />
          </div>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--r-hairline)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--r-fg-4)", marginBottom: 8 }}>
              <Icon name="archive" size={12} /> Deferred features
            </div>
            <p style={{ fontSize: 12, color: "var(--r-fg-4)", marginBottom: 10, lineHeight: 1.5 }}>
              Reserved in the schema and switched off. They are listed here so the roadmap is visible, but
              they are not offered as switches because the surfaces behind them are not built.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DEFERRED.map((f) => <Pill key={f} tone="neutral" dot={false}>{f}</Pill>)}
            </div>
          </div>
        </Card>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
