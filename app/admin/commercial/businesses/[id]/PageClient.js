"use client";

// Full editor for one business listing. Everything the directory can show is
// editable here, because the admin is the fallback for owners who never open
// the app. Optimistic concurrency (expectedUpdatedAt) stops two admins from
// silently overwriting each other.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FULFILLMENT = [
  ["WalkIn", "Walk-in"],
  ["Pickup", "Pickup"],
  ["ShopDelivery", "Shop delivers"],
];

const S = {
  page: { padding: "1.5rem", maxWidth: 900, margin: "0 auto" },
  h1: { fontSize: "1.35rem", fontWeight: 800, margin: 0 },
  sub: { color: "var(--fg-4)", fontSize: "0.85rem", margin: "0.35rem 0 1.25rem" },
  card: { border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-surface)", padding: "1.25rem", marginBottom: "1.25rem" },
  cardTitle: { fontSize: "1rem", fontWeight: 700, margin: "0 0 0.85rem" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0.9rem" },
  field: { display: "flex", flexDirection: "column", gap: "0.3rem" },
  label: { fontSize: "0.78rem", fontWeight: 700, color: "var(--fg-3)" },
  hint: { fontSize: "0.72rem", color: "var(--fg-5)" },
  input: { padding: "0.5rem 0.65rem", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: "0.875rem", width: "100%" },
  btn: { padding: "0.55rem 0.95rem", borderRadius: 8, border: "1px solid var(--primary)", background: "var(--primary)", color: "var(--on-solid)", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" },
  btnGhost: { padding: "0.5rem 0.85rem", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-3)", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" },
  err: { background: "var(--danger-bg)", border: "1px solid var(--danger-bg)", color: "var(--danger-fg)", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1rem", fontSize: "0.85rem" },
  ok: { background: "var(--success-bg)", border: "1px solid var(--success-bg)", color: "var(--success-fg)", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: "1rem", fontSize: "0.85rem" },
  pill: (s) => ({
    display: "inline-block",
    padding: "0.2rem 0.6rem",
    borderRadius: 999,
    fontSize: "0.75rem",
    fontWeight: 700,
    background: s === "Published" ? "var(--success-bg)" : s === "Suspended" ? "var(--danger-bg)" : "var(--bg-muted)",
    color: s === "Published" ? "var(--success-fg)" : s === "Suspended" ? "var(--danger-fg)" : "var(--fg-3)",
  }),
  dayRow: { display: "grid", gridTemplateColumns: "110px 90px 1fr 1fr", gap: "0.6rem", alignItems: "center", marginBottom: "0.5rem" },
};

const emptyDays = () =>
  DAYS.map((_, i) => ({ dayOfWeek: i, isClosed: i === 0, opensAt: "09:00", closesAt: "21:00" }));

function daysFromHours(hours) {
  const base = emptyDays();
  const week = hours?.weeklySchedule ?? [];
  for (const d of week) {
    const slot = base[d.dayOfWeek];
    if (!slot) continue;
    slot.isClosed = d.isClosed === true;
    const first = (d.intervals ?? [])[0];
    if (first) {
      slot.opensAt = first.opensAt;
      slot.closesAt = first.closesAt;
    }
  }
  return base;
}

// Blank optional text must be sent as null, not "": the server rejects an
// empty string against a format rule, and null is how a field is cleared.
const orNull = (v) => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

export default function BusinessEditorPage() {
  const { id } = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const [days, setDays] = useState(emptyDays());
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const profileQuery = useQuery({
    queryKey: ["commercial-profile", id],
    queryFn: () => apiClient.get(`/api/commercial/profiles/${id}`),
    retry: false,
  });

  const categoriesQuery = useQuery({
    queryKey: ["commercial-categories"],
    queryFn: () => apiClient.get("/api/commercial/categories"),
    retry: false,
  });

  const profile = profileQuery.data?.profile;
  const categories = (categoriesQuery.data?.categories ?? []).filter((c) => c.isActive !== false);

  useEffect(() => {
    if (!profile) return;
    setForm({
      tradeName: profile.tradeName ?? "",
      legalName: profile.legalName ?? "",
      categoryId: profile.categoryId ? String(profile.categoryId) : "",
      description: profile.description ?? "",
      phone: profile.phone ?? "",
      whatsapp: profile.whatsapp ?? "",
      email: profile.email ?? "",
      gstin: profile.gstin ?? "",
      licenseNumber: profile.licenseNumber ?? "",
      fulfillmentModes: profile.fulfillmentModes ?? [],
      timezone: profile.businessHours?.timezone ?? "Asia/Kolkata",
    });
    setDays(daysFromHours(profile.businessHours));
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: (payload) => apiClient.request(`/api/commercial/profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
    onSuccess: () => {
      setError("");
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ["commercial-profile", id] });
      queryClient.invalidateQueries({ queryKey: ["commercial-profiles"] });
      setTimeout(() => setSaved(false), 4000);
    },
    onError: (e) => {
      setSaved(false);
      setError(
        /409/.test(e.message)
          ? "This listing changed while you were editing. Reload and reapply your changes."
          : e.message,
      );
    },
  });

  const transitionMutation = useMutation({
    mutationFn: (command) => apiClient.post(`/api/commercial/profiles/${id}/${command}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commercial-profile", id] });
      queryClient.invalidateQueries({ queryKey: ["commercial-profiles"] });
      setError("");
    },
    onError: (e) => setError(e.message),
  });

  // Billing-only control, deliberately separate from the trade-details save
  // above — never bundled into the owner-editable payload. See
  // lib/commercial/commercialChargeEngine.js for the 10%-capped calculation.
  const nonOccupancyMutation = useMutation({
    mutationFn: (value) =>
      apiClient.request(`/api/commercial/profiles/${id}/non-occupancy`, {
        method: "PATCH",
        body: JSON.stringify({ nonOccupancyCharged: value }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commercial-profile", id] });
      setError("");
    },
    onError: (e) => setError(e.message),
  });

  if (profileQuery.isLoading || !form) {
    return <div style={S.page}>Loading…</div>;
  }
  if (profileQuery.isError) {
    return (
      <div style={S.page}>
        <div style={S.err}>{profileQuery.error?.message ?? "Could not load this listing."}</div>
        <Link href="/admin/commercial/businesses" style={S.btnGhost}>
          Back to businesses
        </Link>
      </div>
    );
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setDay = (i, patch) =>
    setDays((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const toggleMode = (mode) =>
    set(
      "fulfillmentModes",
      form.fulfillmentModes.includes(mode)
        ? form.fulfillmentModes.filter((m) => m !== mode)
        : [...form.fulfillmentModes, mode],
    );

  const onSave = () => {
    const payload = {
      tradeName: form.tradeName.trim(),
      legalName: orNull(form.legalName),
      categoryId: form.categoryId,
      description: orNull(form.description),
      phone: orNull(form.phone),
      whatsapp: orNull(form.whatsapp),
      email: orNull(form.email),
      gstin: orNull(form.gstin),
      licenseNumber: orNull(form.licenseNumber),
      fulfillmentModes: form.fulfillmentModes,
      businessHours: {
        timezone: form.timezone || "Asia/Kolkata",
        weeklySchedule: days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          isClosed: d.isClosed,
          intervals: d.isClosed ? [] : [{ opensAt: d.opensAt, closesAt: d.closesAt }],
        })),
        exceptions: [],
      },
      updatedReason: "Business Details Updated",
    };
    if (profile?.updatedAt) {
      payload.expectedUpdatedAt = new Date(profile.updatedAt).toISOString();
    }
    saveMutation.mutate(payload);
  };

  const status = profile?.visibilityStatus ?? "Draft";

  return (
    <div style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
        <div>
          <h1 style={S.h1}>{form.tradeName || "Business"}</h1>
          <p style={S.sub}>
            <span style={S.pill(status)}>{status}</span>{" "}
            {status === "Published"
              ? "Visible to members in the app."
              : "Not visible to members yet."}
          </p>
        </div>
        <Link href="/admin/commercial/businesses" style={S.btnGhost}>
          Back
        </Link>
      </div>

      {error && <div style={S.err}>{error}</div>}
      {saved && <div style={S.ok}>Saved.</div>}

      <div style={S.card}>
        <h2 style={S.cardTitle}>Commercial billing</h2>
        <label style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.85rem" }}>
          <input
            type="checkbox"
            checked={profile?.nonOccupancyCharged === true}
            disabled={nonOccupancyMutation.isPending}
            onChange={(e) => nonOccupancyMutation.mutate(e.target.checked)}
          />
          Charge non-occupancy (this unit is rented out, not owner-occupied)
        </label>
        <p style={S.hint}>
          Adds a line capped at 10% of this unit&apos;s service-charge heads to every future
          commercial bill — the legal ceiling in Maharashtra for both residential and commercial
          premises. Takes effect from the next bill generated; existing bills are unaffected.
        </p>
      </div>

      <div style={S.card}>
        <h2 style={S.cardTitle}>Business details</h2>
        <div style={S.grid}>
          <div style={S.field}>
            <label style={S.label}>Business name *</label>
            <input style={S.input} value={form.tradeName} onChange={(e) => set("tradeName", e.target.value)} />
          </div>
          <div style={S.field}>
            <label style={S.label}>Legal name</label>
            <input style={S.input} value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
          </div>
          <div style={S.field}>
            <label style={S.label}>Category *</label>
            <select style={S.input} value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ ...S.field, marginTop: "0.9rem" }}>
          <label style={S.label}>Description</label>
          <textarea
            style={{ ...S.input, minHeight: 90 }}
            maxLength={2000}
            value={form.description}
            placeholder="What the shop sells, offers, timings notes…"
            onChange={(e) => set("description", e.target.value)}
          />
          <span style={S.hint}>{form.description.length}/2000</span>
        </div>
      </div>

      <div style={S.card}>
        <h2 style={S.cardTitle}>Contact</h2>
        <div style={S.grid}>
          <div style={S.field}>
            <label style={S.label}>Phone</label>
            <input style={S.input} value={form.phone} placeholder="+91 98765 43210" onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div style={S.field}>
            <label style={S.label}>WhatsApp</label>
            <input style={S.input} value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} />
          </div>
          <div style={S.field}>
            <label style={S.label}>Email</label>
            <input style={S.input} value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div style={S.field}>
            <label style={S.label}>GSTIN</label>
            <input style={S.input} value={form.gstin} maxLength={15} onChange={(e) => set("gstin", e.target.value)} />
            <span style={S.hint}>Exactly 15 characters, or leave blank.</span>
          </div>
          <div style={S.field}>
            <label style={S.label}>Licence number</label>
            <input style={S.input} value={form.licenseNumber} onChange={(e) => set("licenseNumber", e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: "0.9rem" }}>
          <label style={S.label}>How they serve customers</label>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.4rem", flexWrap: "wrap" }}>
            {FULFILLMENT.map(([value, label]) => (
              <label key={value} style={{ display: "flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem" }}>
                <input
                  type="checkbox"
                  checked={form.fulfillmentModes.includes(value)}
                  onChange={() => toggleMode(value)}
                />
                {label}
              </label>
            ))}
          </div>
          <span style={S.hint}>
            Descriptive only in this release — there is no ordering or delivery flow yet.
          </span>
        </div>
      </div>

      <div style={S.card}>
        <h2 style={S.cardTitle}>Opening hours</h2>
        {days.map((d, i) => (
          <div key={d.dayOfWeek} style={S.dayRow}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{DAYS[d.dayOfWeek]}</span>
            <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", fontSize: "0.8rem" }}>
              <input type="checkbox" checked={d.isClosed} onChange={(e) => setDay(i, { isClosed: e.target.checked })} />
              Closed
            </label>
            <input
              type="time"
              style={S.input}
              value={d.opensAt}
              disabled={d.isClosed}
              onChange={(e) => setDay(i, { opensAt: e.target.value })}
            />
            <input
              type="time"
              style={S.input}
              value={d.closesAt}
              disabled={d.isClosed}
              onChange={(e) => setDay(i, { closesAt: e.target.value })}
            />
          </div>
        ))}
        <span style={S.hint}>
          Closing time must be after opening time. For a shop that runs past midnight,
          mark the second half on the next day.
        </span>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "2rem" }}>
        <button type="button" style={S.btn} disabled={saveMutation.isPending} onClick={onSave}>
          {saveMutation.isPending ? "Saving…" : "Save changes"}
        </button>
        {status !== "Published" && (
          <button
            type="button"
            style={S.btnGhost}
            disabled={transitionMutation.isPending}
            onClick={() => transitionMutation.mutate(status === "Suspended" ? "reactivate" : "publish")}
          >
            {status === "Suspended" ? "Reactivate" : "Publish to members"}
          </button>
        )}
        {status === "Published" && (
          <button
            type="button"
            style={S.btnGhost}
            disabled={transitionMutation.isPending}
            onClick={() => transitionMutation.mutate("suspend")}
          >
            Suspend
          </button>
        )}
      </div>
    </div>
  );
}
