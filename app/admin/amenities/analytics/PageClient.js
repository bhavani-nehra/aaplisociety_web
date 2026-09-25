"use client";
import { useState, useEffect, useCallback } from "react";
import {
  PageHeader, Card, CardHead, Btn, Icon, Select, Segmented, DataTable,
  RevampSkeleton, EmptyState, Toast,
} from "@/components/revamp";

const iso = (d) => d.toISOString().slice(0, 10);
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GRANULARITIES = ["daily", "weekly", "monthly", "yearly"];
const PRESETS = [
  ["7d", "Last 7 days", 7],
  ["30d", "Last 30 days", 30],
  ["90d", "Last 90 days", 90],
  ["365d", "Last year", 365],
];
const hourLabel = (h) => (h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`);
const dur = (m) => {
  if (!m) return "0h";
  const h = Math.floor(m / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m % 60}m`;
};

/** Horizontal bar row — deliberately CSS-only. Pulling in a charting library for
 *  this would add weight to every admin bundle for six bars and a heatmap. */
function BarRow({ label, value, max, suffix }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
      <div style={{ width: 120, flexShrink: 0, fontSize: 12.5, color: "var(--r-fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={label}>
        {label}
      </div>
      <div style={{ flex: 1, height: 8, background: "var(--r-surface-3)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: "100%", background: "var(--r-brand)",
          borderRadius: 999, transform: `scaleX(${Math.max(pct, 1) / 100})`, transformOrigin: "left",
          transition: "transform 0.4s cubic-bezier(.16,1,.3,1)",
        }} />
      </div>
      <div style={{ width: 44, flexShrink: 0, textAlign: "right", fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-1)" }}>
        {value}{suffix || ""}
      </div>
    </div>
  );
}

/** Download-styled anchor — needs a real href+download, which Btn (a <button>)
 *  can't carry, so it borrows Btn's secondary visual instead of adding a new
 *  href-capable variant to the shared kit for one call site. */
function DownloadLink({ href, children }) {
  return (
    <a
      href={href}
      download
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        padding: "7px 12px", fontSize: 13, fontWeight: 500, height: 32, borderRadius: 8,
        fontFamily: "inherit", whiteSpace: "nowrap", lineHeight: 1, textDecoration: "none",
        background: "var(--r-surface)", color: "var(--r-fg-2)", border: "1px solid var(--r-border)",
      }}
    >
      <Icon name="download" size={14} />
      {children}
    </a>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [amenities, setAmenities] = useState([]);
  const [amenityId, setAmenityId] = useState("all");
  const [granularity, setGranularity] = useState("daily");
  const [preset, setPreset] = useState("30d");
  const [range, setRange] = useState(() => ({
    from: iso(new Date(Date.now() - 29 * 86400000)),
    to: iso(new Date()),
  }));
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 5000);
  };

  const applyPreset = (key, days) => {
    setPreset(key);
    setRange({ from: iso(new Date(Date.now() - (days - 1) * 86400000)), to: iso(new Date()) });
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, granularity });
      if (amenityId !== "all") params.set("amenityId", amenityId);
      const res = await fetch(`/api/amenities/analytics?${params}`, { credentials: "include" });
      const body = await res.json();
      if (res.ok) setData(body.analytics || body);
      else showToast(body.error || "Could not load analytics", "err");
    } finally {
      setLoading(false);
    }
  }, [range, granularity, amenityId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/amenities?limit=100", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAmenities(d.amenities || []))
      .catch(() => {});
  }, []);

  const recompute = async () => {
    setRecomputing(true);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (amenityId !== "all") params.set("amenityId", amenityId);
      const res = await fetch(`/api/amenities/analytics/recompute?${params}`, {
        method: "POST", credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) return showToast(body.error || "Recompute failed", "err");
      showToast(`Rebuilt ${body.recomputed} day(s) from raw attendance`);
      load();
    } finally {
      setRecomputing(false);
    }
  };

  const exportUrl = () => {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (amenityId !== "all") params.set("amenityId", amenityId);
    return `/api/amenities/analytics/export?${params}`;
  };

  const totals = data?.totals || {};
  // hourly is [{ hour, checkIns }, ...24 entries], not a plain count array.
  const hourlyCounts = (data?.hourly || []).map((h) => h.checkIns || 0);
  const maxHour = Math.max(1, ...hourlyCounts);
  const mostUsed = data?.mostUsed || [];
  const leastUsed = data?.leastUsed || [];
  const peakDays = data?.peakDays || [];
  const maxUsed = Math.max(1, ...mostUsed.map((a) => a.checkIns || 0));
  const maxDay = Math.max(1, ...peakDays.map((d) => d.checkIns || 0));
  const series = data?.series || [];
  const maxSeries = Math.max(1, ...series.map((s) => s.checkIns || 0));

  const stats = [
    { icon: "door-open", label: "Check-ins", value: totals.checkIns || 0, hint: `${totals.residentCheckIns || 0} resident · ${totals.visitorCheckIns || 0} visitor` },
    { icon: "users", label: "Unique residents", value: totals.uniqueMembers || 0, hint: "distinct people, not visits" },
    { icon: "hourglass", label: "Average visit", value: totals.avgDurationMins ? `${Math.round(totals.avgDurationMins)}m` : "—", hint: "closed sessions only" },
    { icon: "gauge", label: "Capacity used", value: totals.capacityUtilisationPct != null ? `${Math.round(totals.capacityUtilisationPct)}%` : "—", hint: "peak occupancy against the cap" },
    { icon: "wrench", label: "Downtime", value: dur(totals.maintenanceDowntimeMins || 0), hint: "actual, not scheduled" },
    { icon: "qr-code", label: "QR share", value: totals.checkIns ? `${Math.round(((totals.qrCheckIns || 0) / totals.checkIns) * 100)}%` : "—", hint: `${totals.manualCheckIns || 0} manual · ${totals.overrideCheckIns || 0} override` },
    { icon: "calendar", label: "Events held", value: totals.eventsHeld || 0, hint: `${totals.eventAttendance || 0} attendances` },
    { icon: "alert-triangle", label: "Incidents", value: totals.incidentsReported || 0, hint: "reported in this range" },
  ];

  const perAmenityCols = [
    { key: "name", label: "Amenity", render: (a) => <span style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{a.amenityName}</span> },
    { key: "checkIns", label: "Check-ins", width: 100, render: (a) => a.checkIns || 0 },
    { key: "unique", label: "Unique", width: 100, render: (a) => a.uniqueMembers || 0 },
    { key: "avg", label: "Avg visit", width: 110, render: (a) => (a.avgDurationMins ? `${Math.round(a.avgDurationMins)}m` : "—") },
    { key: "peak", label: "Peak occ.", width: 110, render: (a) => a.peakOccupancy || 0 },
    { key: "downtime", label: "Downtime", width: 110, render: (a) => dur(a.maintenanceDowntimeMins || 0) },
    { key: "incidents", label: "Incidents", width: 100, render: (a) => a.incidentsReported || 0 },
  ];

  return (
    <div style={{ maxWidth: 1480, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="bar-chart-3" size={11} /> Operations · Analytics</>}
        title="Usage analytics"
        sub={`${range.from} to ${range.to}`}
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn
              variant="secondary" icon="refresh-cw" disabled={recomputing} onClick={recompute}
              title="Rebuild the rollup for this range from raw attendance — use this if numbers look stale or missing"
            >
              {recomputing ? "Recomputing…" : "Recompute"}
            </Btn>
            <DownloadLink href={exportUrl()}>Export CSV</DownloadLink>
            <Btn variant="secondary" icon="printer" onClick={() => window.print()}>Print / PDF</Btn>
          </div>
        }
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <Segmented
            value={preset}
            onChange={(key) => {
              const found = PRESETS.find((p) => p[0] === key);
              if (found) applyPreset(found[0], found[2]);
            }}
            options={PRESETS.map(([key, text]) => ({ value: key, label: text }))}
          />
          <input className="input" style={{ width: "auto" }} type="date" value={range.from}
            onChange={(e) => { setPreset(""); setRange({ ...range, from: e.target.value }); }} />
          <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>to</span>
          <input className="input" style={{ width: "auto" }} type="date" value={range.to}
            onChange={(e) => { setPreset(""); setRange({ ...range, to: e.target.value }); }} />
          <Select value={amenityId} size="md" onChange={setAmenityId}>
            <option value="all">All amenities</option>
            {amenities.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
          </Select>
          <Select value={granularity} size="md" onChange={setGranularity}>
            {GRANULARITIES.map((g) => (
              <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
            ))}
          </Select>
        </div>
      </Card>

      {loading ? (
        <RevampSkeleton h={400} />
      ) : !data ? (
        <Card>
          <EmptyState icon="bar-chart-3" title="No data" sub="Analytics appear once residents start checking in." />
        </Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
            {stats.map((s) => (
              <Card key={s.label} style={{ padding: 14 }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--r-fg-4)", fontWeight: 500, marginBottom: 6 }}>
                  <Icon name={s.icon} size={12} /> {s.label}
                </div>
                <div className="revamp-num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--r-fg-1)" }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "var(--r-fg-4)", marginTop: 4 }}>{s.hint}</div>
              </Card>
            ))}
          </div>

          <Card style={{ marginBottom: 14 }}>
            <CardHead title="Peak hours" />
            {!hourlyCounts.length ? (
              <EmptyState icon="clock" title="No check-ins in this range" />
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3 }}>
                  {hourlyCounts.map((count, h) => {
                    const intensity = count / maxHour;
                    return (
                      <div
                        key={h}
                        title={`${hourLabel(h)} — ${count} check-ins`}
                        style={{
                          height: 30, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 10, fontWeight: 600,
                          // Single-hue sequential shading off the brand token (not a new
                          // categorical palette — see Run 19/20/22 precedent on those).
                          background: count === 0
                            ? "var(--r-surface-3)"
                            : `color-mix(in srgb, var(--r-brand) ${Math.round(15 + intensity * 80)}%, var(--r-surface-3))`,
                          color: intensity > 0.55 ? "var(--r-brand-ink)" : "var(--r-fg-3)",
                        }}
                      >
                        {count || ""}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3, marginTop: 4 }}>
                  {hourlyCounts.map((_, h) => (
                    <div key={h} style={{ fontSize: 9, color: "var(--r-fg-5)", textAlign: "center" }}>{h % 3 === 0 ? hourLabel(h) : ""}</div>
                  ))}
                </div>
                {data.peakHours?.length ? (
                  <p style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 12 }}>
                    Busiest: {data.peakHours.slice(0, 3).map((p) => `${hourLabel(p.hour)} (${p.checkIns})`).join(", ")}.
                    Worth aligning cleaning and maintenance windows away from these.
                  </p>
                ) : null}
              </>
            )}
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 14, marginBottom: 14 }}>
            <Card>
              <CardHead title="Most used" />
              {!mostUsed.length ? (
                <EmptyState icon="bar-chart-3" title="Nothing recorded yet" />
              ) : mostUsed.map((a) => (
                <BarRow key={a.amenityId} label={a.amenityName} value={a.checkIns || 0} max={maxUsed} />
              ))}
            </Card>

            <Card>
              <CardHead title="Least used" />
              {!leastUsed.length ? (
                <EmptyState icon="bar-chart-3" title="Nothing recorded yet" />
              ) : (
                <>
                  {leastUsed.map((a) => (
                    <BarRow key={a.amenityId} label={a.amenityName} value={a.checkIns || 0} max={maxUsed} />
                  ))}
                  <p style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 12 }}>
                    An amenity at zero is not automatically waste — check whether it was closed or under
                    maintenance for much of this range before drawing a conclusion.
                  </p>
                </>
              )}
            </Card>

            <Card>
              <CardHead title="Peak days" />
              {!peakDays.length ? (
                <EmptyState icon="calendar" title="No data" />
              ) : peakDays.map((d) => (
                <BarRow key={d.dayOfWeek} label={DAY_SHORT[d.dayOfWeek] || String(d.dayOfWeek)}
                  value={d.checkIns || 0} max={maxDay} />
              ))}
            </Card>

            <Card>
              <CardHead title={`Trend · ${granularity}`} />
              {!series.length ? (
                <EmptyState icon="trending-up" title="No data" />
              ) : (
                <div style={{ maxHeight: 320, overflowY: "auto" }}>
                  {series.map((s) => (
                    <BarRow key={s.bucket} label={s.bucket} value={s.checkIns || 0} max={maxSeries} />
                  ))}
                </div>
              )}
            </Card>
          </div>

          {data.perAmenity?.length ? (
            <div style={{ marginBottom: 14 }}>
              <DataTable cols={perAmenityCols} rows={data.perAmenity} rowKey="amenityId" />
            </div>
          ) : null}

          <p style={{ fontSize: 12, color: "var(--r-fg-4)" }}>
            Daily figures are bucketed in the society timezone and rolled up nightly. A day still in
            progress is incomplete by definition. Export is CSV rather than native .xlsx — Excel opens it
            directly, and it avoids adding a spreadsheet-writing dependency to the server.
          </p>
        </>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
