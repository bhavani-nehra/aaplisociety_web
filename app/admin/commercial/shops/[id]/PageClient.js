"use client";

// app/admin/commercial/shops/[id]/page.js
//
// NEW 2026-08-08. Replaces /admin/commercial/businesses/[id].
//
// One shop, one page. The old editor lived under "businesses" and edited a
// BusinessProfile that hung off a Member -- which is why it still asked whether
// the unit was residential or commercial. A shop is its own record now, so that
// question is gone: if you are on this page, it is a shop.
//
// Nothing here ever writes to a flat. The owner link is a reference; the shop
// keeps its own copy of the name and phone so a bill can be addressed even if
// the link is later removed.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import notify from "@/lib/notify";
import { Card, CardHead, Pill, Btn } from "../../_ui";
import ChargesSection from "../_ChargesSection";

const UNIT_KINDS = ["Shop", "Office"];
const AREA_BASIS = ["Carpet", "Built-up", "Super built-up", "Agreed/Other"];
const OCCUPANCY = ["Owner-Occupied", "Rented out", "Vacant"];
const ELECTRICITY = ["Own connection", "Society-managed sub-meter"];

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--cx-border-strong)",
  background: "var(--cx-surface)",
  color: "var(--cx-fg-1)",
  fontSize: 13,
  outline: "none",
};

const grid = (n) => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fit,minmax(${n === 4 ? 190 : 240}px,1fr))`,
  gap: 14,
  marginBottom: 18,
});

function Field({ label, hint, error, children }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cx-fg-2)", marginBottom: 4 }}>
        {label}
      </div>
      {children}
      {hint && !error && (
        <div style={{ fontSize: 11, color: "var(--cx-fg-4)", marginTop: 4, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: "var(--cx-danger)", marginTop: 4, lineHeight: 1.5 }}>
          {error}
        </div>
      )}
    </label>
  );
}

function SectionTitle({ children, note }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          
          letterSpacing: "0.6px",
          color: "var(--cx-fg-4)",
        }}
      >
        {children}
      </div>
      {note && (
        <div style={{ fontSize: 12, color: "var(--cx-fg-3)", marginTop: 4, lineHeight: 1.6 }}>
          {note}
        </div>
      )}
    </div>
  );
}

export default function ShopDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = params?.id;

  const [form, setForm] = useState(null);
  const [banner, setBanner] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const shopQ = useQuery({
    queryKey: ["commercial-shop", id],
    queryFn: () => apiClient.get(`/api/commercial/shops/${id}`),
    enabled: Boolean(id),
  });

  // The rate card. Without it this page could show signage as a size box but
  // never as a yes/no — which is exactly why a shop created with signage off
  // could not be switched on again.
  const headsQ = useQuery({
    queryKey: ["commercial-billing-heads"],
    queryFn: () => apiClient.get("/api/commercial/billing-heads"),
  });

  const categoriesQ = useQuery({
    queryKey: ["commercial-categories"],
    queryFn: () => apiClient.get("/api/commercial/categories"),
  });

  const shop = shopQ.data?.shop;
  const categories = categoriesQ.data?.categories ?? [];

  useEffect(() => {
    if (shop && !form) setForm({ ...shop });
  }, [shop, form]);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFieldErrors((e) => {
      if (!e[k]) return e;
      const copy = { ...e };
      delete copy[k];
      return copy;
    });
  };

  const save = useMutation({
    mutationFn: (payload) => apiClient.patch(`/api/commercial/shops/${id}`, payload),
    onSuccess: () => {
      setFieldErrors({});
      setBanner({ tone: "ok", text: "Saved. The next bill for this shop will use these details." });
      qc.invalidateQueries({ queryKey: ["commercial-shop", id] });
      qc.invalidateQueries({ queryKey: ["commercial-shops"] });
      qc.invalidateQueries({ queryKey: ["commercial-readiness"] });
    },
    onError: (e) => {
      const body = e?.data || e?.body || {};
      const errs = {};
      for (const issue of body.issues || []) {
        if (issue.field) errs[issue.field] = issue.message;
      }
      setFieldErrors(errs);
      setBanner({
        tone: "bad",
        text: body.error || e?.message || "That could not be saved.",
      });
    },
  });

  const remove = useMutation({
    mutationFn: () => apiClient.delete(`/api/commercial/shops/${id}`),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["commercial-shops"] });
      router.push("/admin/commercial/shops");
    },
    onError: (e) =>
      setBanner({
        tone: "bad",
        text: e?.data?.error || e?.message || "That shop could not be removed.",
      }),
  });

  // What is stopping this shop from being billed, in plain language.
  const problems = useMemo(() => {
    if (!form) return [];
    const out = [];
    if (!(Number(form.areaSqft) > 0))
      out.push("No area recorded, so every per-sq-ft charge would come to ₹0.");
    if (!form.ownerName) out.push("No owner name, so the bill cannot be addressed.");
    if (form.occupancyType === "Rented out" && !form.tenantName)
      out.push("Marked rented out but no tenant name is recorded.");
    if (form.electricityMode === "Society-managed sub-meter" && !(Number(form.lastMeterReading) >= 0))
      out.push("Sub-metered, but no meter reading has been entered.");
    if (form.isBillable === false) out.push("Switched off, so it is skipped in every run.");
    return out;
  }, [form]);

  if (shopQ.isLoading || (!form && !shopQ.isError)) {
    return (
      <div className="commercial-scope cx-fade" style={{ padding: "1.75rem 2rem" }}>
        <Card>Loading this shop&hellip;</Card>
      </div>
    );
  }

  if (shopQ.isError) {
    const code = shopQ.error?.data?.code;
    return (
      <div className="commercial-scope cx-fade" style={{ padding: "1.75rem 2rem" }}>
        <Card>
          <CardHead
            title={code === "NOT_FOUND" ? "That shop no longer exists" : "This shop could not be loaded"}
            sub={
              code === "NOT_FOUND"
                ? "It may have been removed. Nothing has been lost from the flat it was linked to."
                : shopQ.error?.message || "Something went wrong fetching it."
            }
          />
          <Link href="/admin/commercial/shops">
            <Btn variant="primary">Back to all shops</Btn>
          </Link>
        </Card>
      </div>
    );
  }

  const submit = (e) => {
    e.preventDefault();
    setBanner(null);
    const payload = { ...form };
    delete payload.id;
    delete payload._id;
    delete payload.unitLabel;
    payload.chargeOptIns = (form.chargeOptIns || []).map((r) => ({
      ...r,
      quantity: Number(r.quantity) || 0,
    }));
    save.mutate(payload);
  };

  return (
    <div
      className="commercial-scope cx-fade"
      style={{ padding: "1.75rem 2rem", maxWidth: 1080, margin: "0 auto" }}
    >
      <div style={{ marginBottom: 6, fontSize: 12 }}>
        <Link href="/admin/commercial/shops" style={{ color: "var(--cx-fg-4)" }}>
          &larr; All shops &amp; offices
        </Link>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cx-fg-1)", margin: 0 }}>
            {form.unitLabel || `${form.wing ? form.wing + "-" : ""}${form.shopNo}`}
          </h1>
          <div style={{ fontSize: 13, color: "var(--cx-fg-3)", marginTop: 4 }}>
            {form.unitKind} &middot; {form.ownerName || "No owner recorded"} &middot;{" "}
            {Number(form.areaSqft) > 0 ? `${form.areaSqft} sq ft` : "no area"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Pill tone={problems.length === 0 ? "active" : "overdue"}>
            {problems.length === 0 ? "Ready to bill" : `${problems.length} thing(s) to fix`}
          </Pill>
        </div>
      </div>

      {banner && (
        <div
          style={{
            marginBottom: 14,
            padding: "11px 14px",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.6,
            background: banner.tone === "ok" ? "var(--cx-success-soft)" : "var(--cx-danger-soft,var(--danger-bg))",
            border: `1px solid ${banner.tone === "ok" ? "var(--cx-success)" : "var(--cx-danger)"}`,
            color: "var(--cx-fg-1)",
          }}
        >
          {banner.text}
        </div>
      )}

      {problems.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle note="Until these are sorted, this shop is skipped or billed short.">
            What is stopping this bill
          </SectionTitle>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8, color: "var(--cx-fg-2)" }}>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      )}

      <form onSubmit={submit}>
        <Card style={{ marginBottom: 16 }}>
          <SectionTitle note="This is the shop's own area. It is not the flat's carpet area and changing it never touches a flat.">
            The unit
          </SectionTitle>
          <div style={grid(4)}>
            <Field label="Shop number *" error={fieldErrors.shopNo} hint="As painted on the shutter.">
              <input style={inputStyle} value={form.shopNo || ""} onChange={(e) => set("shopNo", e.target.value)} />
            </Field>
            <Field label="Wing" hint="Leave blank if the society has no wings.">
              <input style={inputStyle} value={form.wing || ""} onChange={(e) => set("wing", e.target.value)} />
            </Field>
            <Field label="Floor">
              <input
                style={inputStyle}
                type="number"
                value={form.floor ?? ""}
                onChange={(e) => set("floor", e.target.value === "" ? null : Number(e.target.value))}
              />
            </Field>
            <Field label="Type" hint="Decides which column of the rate card applies.">
              <select style={inputStyle} value={form.unitKind || "Shop"} onChange={(e) => set("unitKind", e.target.value)}>
                {UNIT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Area (sq ft) *"
              error={fieldErrors.areaSqft}
              hint="Bills already generated keep the area they were made with."
            >
              <input
                style={inputStyle}
                type="number"
                value={form.areaSqft ?? ""}
                onChange={(e) => set("areaSqft", e.target.value === "" ? null : Number(e.target.value))}
              />
            </Field>
            <Field label="What that area is" hint="Recorded for your reference; it does not change the maths.">
              <select
                style={inputStyle}
                value={form.areaBasisNote || "Carpet"}
                onChange={(e) => set("areaBasisNote", e.target.value)}
              >
                {AREA_BASIS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <SectionTitle note="The shop keeps its own copy of these, so the bill can be addressed even if the flat link is removed.">
            Owner
          </SectionTitle>
          <div style={grid(4)}>
            <Field label="Owner name *" error={fieldErrors.ownerName}>
              <input style={inputStyle} value={form.ownerName || ""} onChange={(e) => set("ownerName", e.target.value)} />
            </Field>
            <Field label="Phone">
              <input style={inputStyle} value={form.ownerPhone || ""} onChange={(e) => set("ownerPhone", e.target.value)} />
            </Field>
            <Field label="Email">
              <input style={inputStyle} value={form.ownerEmail || ""} onChange={(e) => set("ownerEmail", e.target.value)} />
            </Field>
          </div>

          <SectionTitle note="Only matters if the society charges non-occupancy. Owner-occupied and vacant units are never charged it.">
            Who is using it
          </SectionTitle>
          <div style={grid(4)}>
            <Field label="Occupancy">
              <select
                style={inputStyle}
                value={form.occupancyType || "Owner-Occupied"}
                onChange={(e) => set("occupancyType", e.target.value)}
              >
                {OCCUPANCY.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            {form.occupancyType === "Rented out" && (
              <>
                <Field label="Tenant name" error={fieldErrors.tenantName}>
                  <input style={inputStyle} value={form.tenantName || ""} onChange={(e) => set("tenantName", e.target.value)} />
                </Field>
                <Field label="Tenant phone">
                  <input style={inputStyle} value={form.tenantPhone || ""} onChange={(e) => set("tenantPhone", e.target.value)} />
                </Field>
                <Field label="Lease start">
                  <input
                    style={inputStyle}
                    type="date"
                    value={(form.leaseStartDate || "").slice(0, 10)}
                    onChange={(e) => set("leaseStartDate", e.target.value || null)}
                  />
                </Field>
                <Field label="Lease end">
                  <input
                    style={inputStyle}
                    type="date"
                    value={(form.leaseEndDate || "").slice(0, 10)}
                    onChange={(e) => set("leaseEndDate", e.target.value || null)}
                  />
                </Field>
              </>
            )}
          </div>

          <SectionTitle note="Optional. Required before billing only if you switched that rule on in the rate card.">
            The business
          </SectionTitle>
          <div style={grid(4)}>
            <Field label="Trade name" hint="The board name, if different from the owner.">
              <input style={inputStyle} value={form.tradeName || ""} onChange={(e) => set("tradeName", e.target.value)} />
            </Field>
            <Field label="Category">
              <select
                style={inputStyle}
                value={form.categoryId || ""}
                onChange={(e) => set("categoryId", e.target.value || null)}
              >
                <option value="">Not set</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="GSTIN" hint="The shop's own GST number, not the society's.">
              <input
                style={inputStyle}
                value={form.gstin || ""}
                onChange={(e) => set("gstin", e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Shop Act number">
              <input style={inputStyle} value={form.shopActNumber || ""} onChange={(e) => set("shopActNumber", e.target.value)} />
            </Field>
            <Field label="FSSAI number" hint="Only for food businesses.">
              <input style={inputStyle} value={form.fssaiNumber || ""} onChange={(e) => set("fssaiNumber", e.target.value)} />
            </Field>
          </div>

          <SectionTitle note="Most shops pay the power company directly. Only use sub-meter if the society bills them for units consumed.">
            Electricity &amp; water
          </SectionTitle>
          <div style={grid(4)}>
            <Field label="Electricity">
              <select
                style={inputStyle}
                value={form.electricityMode || "Own connection"}
                onChange={(e) => set("electricityMode", e.target.value)}
              >
                {ELECTRICITY.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            {form.electricityMode === "Society-managed sub-meter" && (
              <>
                <Field label="Meter number">
                  <input
                    style={inputStyle}
                    value={form.electricityMeterNo || ""}
                    onChange={(e) => set("electricityMeterNo", e.target.value)}
                  />
                </Field>
                <Field label="Last reading" error={fieldErrors.lastMeterReading}>
                  <input
                    style={inputStyle}
                    type="number"
                    value={form.lastMeterReading ?? ""}
                    onChange={(e) =>
                      set("lastMeterReading", e.target.value === "" ? null : Number(e.target.value))
                    }
                  />
                </Field>
                <Field label="Reading date">
                  <input
                    style={inputStyle}
                    type="date"
                    value={(form.lastMeterReadingDate || "").slice(0, 10)}
                    onChange={(e) => set("lastMeterReadingDate", e.target.value || null)}
                  />
                </Field>
              </>
            )}
            <Field label="Water connection no.">
              <input
                style={inputStyle}
                value={form.waterConnectionNo || ""}
                onChange={(e) => set("waterConnectionNo", e.target.value)}
              />
            </Field>
          </div>

          <SectionTitle note="What this shop already owed before the system started billing it. Kept separate from the flat's arrears.">
            Opening balance
          </SectionTitle>
          <div style={grid(4)}>
            <Field label="Opening principal (Rs)">
              <input
                style={inputStyle}
                type="number"
                value={form.openingPrincipal ?? ""}
                onChange={(e) =>
                  set("openingPrincipal", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field label="Opening interest (Rs)">
              <input
                style={inputStyle}
                type="number"
                value={form.openingInterest ?? ""}
                onChange={(e) =>
                  set("openingInterest", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </Field>
          </div>

          <SectionTitle>Charges</SectionTitle>
          {headsQ.isLoading ? (
            <div style={{ fontSize: 12.5, color: "var(--cx-fg-3)", marginBottom: 18 }}>
              Loading the rate card...
            </div>
          ) : headsQ.error ? (
            <div style={{ fontSize: 12.5, color: "var(--cx-danger)", marginBottom: 18 }}>
              The rate card could not be loaded, so charges cannot be changed here yet.{" "}
              {headsQ.error?.message || ""}
            </div>
          ) : (
            <div style={{ marginBottom: 18 }}>
              <ChargesSection
                heads={headsQ.data?.heads ?? []}
                unitKind={form.unitKind || "Shop"}
                areaSqft={form.areaSqft}
                electricityMode={form.electricityMode}
                value={form.chargeOptIns || []}
                onChange={(next) => set("chargeOptIns", next)}
                disabled={save.isPending}
              />
            </div>
          )}

          <SectionTitle>Other details</SectionTitle>
          <div style={grid(4)}>
            <Field label="Number of shutters">
              <input
                style={inputStyle}
                type="number"
                value={form.shutterCount ?? ""}
                onChange={(e) => set("shutterCount", e.target.value === "" ? null : Number(e.target.value))}
              />
            </Field>
            <Field label="Signage size (sq ft)" hint="Used if you bill a signage charge per sq ft.">
              <input
                style={inputStyle}
                type="number"
                value={form.signageSizeSqft ?? ""}
                onChange={(e) =>
                  set("signageSizeSqft", e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </Field>
            <Field label="Emergency contact">
              <input
                style={inputStyle}
                value={form.emergencyContactName || ""}
                onChange={(e) => set("emergencyContactName", e.target.value)}
              />
            </Field>
            <Field label="Emergency phone">
              <input
                style={inputStyle}
                value={form.emergencyContactPhone || ""}
                onChange={(e) => set("emergencyContactPhone", e.target.value)}
              />
            </Field>
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 4 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.isBillable !== false}
                onChange={(e) => set("isBillable", e.target.checked)}
              />
              <span>
                <b>Include in billing.</b> Untick to keep the record but skip it in every run.
              </span>
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.isActive !== false}
                onChange={(e) => set("isActive", e.target.checked)}
              />
              <span>
                <b>Active.</b> Untick for a shut or handed-over unit.
              </span>
            </label>
          </div>
        </Card>

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "space-between",
            flexWrap: "wrap",
            position: "sticky",
            bottom: 0,
            background: "var(--cx-canvas)",
            padding: "12px 0",
            borderTop: "1px solid var(--cx-border)",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="primary" type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving\u2026" : "Save changes"}
            </Btn>
            <Link href="/admin/commercial/shops">
              <Btn variant="secondary" type="button">
                Back
              </Btn>
            </Link>
          </div>
          <Btn
            variant="danger"
            type="button"
            disabled={remove.isPending}
            onClick={async () => {
              if (
                await notify.confirm(
                  "Remove this shop from billing?\n\nBills already generated for it are kept, and the flat it is linked to is not touched.",
                  { tone: "danger" },
                )
              )
                remove.mutate();
            }}
          >
            {remove.isPending ? "Removing\u2026" : "Remove shop"}
          </Btn>
        </div>
      </form>
    </div>
  );
}
