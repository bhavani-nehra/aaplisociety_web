"use client";

import notify from "@/lib/notify";

// app/admin/commercial/shops/page.js
//
// NEW 2026-08-07. The one place a shop or office exists.
//
// THIS SCREEN REPLACES "classify a unit as commercial".
//
// The old flow asked you to pick a flat and change its "Flat Type" to Shop.
// That wrote flatType onto the MEMBER record, which meant the flat stopped
// being a flat. A-103 was a home; after one click it was a shop, its residential
// bill kept running off the same carpet area, its Rs 1,335 arrears got claimed
// by both series, and the original flat type was gone with no way to recover it.
//
// A shop is now its own record with its own area, its own opening balance and
// its own bill series. Linking it to an owner stores a reference on the SHOP.
// Nothing on this screen ever writes to a flat. You can delete a shop and the
// flat is exactly as it was.
//
// REVAMPED 2026-08-17. The old layout was one long vertical scroll: a table
// row expanded into a ~40-field form, with owner email, listing status and
// opening hours buried below the fold or missing from the table entirely.
// This version is a card grid (every important fact visible without a click)
// plus a tabbed drawer for editing, so "is this shop listed", "does the owner
// have app access" and "what are its hours" are answered at a glance.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ChargesSection from "./_ChargesSection";
import { apiClient } from "@/lib/api-client";
import { Card, Pill, Segmented, Btn, StatTile, Tabs, Icon } from "../_ui";
import { OwnerAccessTab, ShopStorefrontPanel } from "./ShopCommerceAdmin";

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "BILLABLE", label: "In billing" },
  { value: "NEEDS_ATTENTION", label: "Needs attention" },
  { value: "INACTIVE", label: "Not billed" },
];

const UNIT_KINDS = ["Shop", "Office"];
const AREA_BASIS = ["Carpet", "Built-up", "Super built-up", "Agreed/Other"];
const OCCUPANCY = ["Owner-Occupied", "Rented out", "Vacant"];
const ELECTRICITY = ["Own connection", "Society-managed sub-meter"];

const inputStyle = {
  width: "100%",
  padding: "7px 9px",
  borderRadius: 7,
  border: "1px solid var(--cx-border)",
  background: "var(--cx-surface)",
  color: "var(--cx-fg-1)",
  fontSize: 13,
  fontFamily: "inherit",
};

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--cx-fg-3)",
  marginBottom: 4,
};

const help = { fontSize: 11, color: "var(--cx-fg-4)", marginTop: 3, lineHeight: 1.45 };

const sectionTitle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.6px",
  
  color: "var(--cx-fg-4)",
  margin: "18px 0 10px",
};

const grid = (cols = 2) => ({
  display: "grid",
  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
  gap: 12,
});

function Field({ label, hint, children, span }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label style={labelStyle}>{label}</label>
      {children}
      {hint && <div style={help}>{hint}</div>}
    </div>
  );
}

const EMPTY_FORM = {
  shopNo: "",
  wing: "",
  floor: 0,
  unitKind: "Shop",
  ownerMemberId: "",
  ownerName: "",
  ownerPhone: "",
  ownerEmail: "",
  areaSqft: "",
  areaBasisNote: "Carpet",
  occupancyType: "Owner-Occupied",
  tenantName: "",
  tenantPhone: "",
  tradeName: "",
  categoryId: "",
  gstin: "",
  shopActNumber: "",
  fssaiNumber: "",
  electricityMode: "Own connection",
  electricityMeterNo: "",
  waterConnectionNo: "",
  shutterCount: 1,
  hasSignage: false,
  signageSizeSqft: "",
  chargeOptIns: [],
  emergencyContactName: "",
  emergencyContactPhone: "",
  openingPrincipal: 0,
  openingInterest: 0,
  isBillable: true,
  isActive: true,
};

const DRAWER_TABS = [
  { value: "unit", label: "Unit details" },
  { value: "owner", label: "Owner & access" },
  { value: "listing", label: "Listing & hours" },
  { value: "orders", label: "Orders & payment" },
];
const NEW_ONLY_DISABLED_REASON = "Save the shop first — there is nothing to invite or list yet.";

const cardBoxStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  background: "var(--cx-surface)",
  border: "1px solid var(--cx-border)",
  borderRadius: "var(--cx-radius-lg)",
  padding: 18,
  boxShadow: "var(--cx-shadow-card)",
  cursor: "pointer",
};

/** One shop, as a scannable card. Every fact this screen exists to surface
 * (owner + email, area, business, billing status, listed status + hours) is
 * on the card itself, not one click away. */
function ShopCard({ shop, onOpen, isOpen }) {
  const s = shop;
  const published = s.storefront?.isPublished === true;

  return (
    <div
      onClick={() => onOpen(s)}
      style={
        isOpen
          ? { ...cardBoxStyle, outline: "2px solid var(--cx-brand)", outlineOffset: 2 }
          : cardBoxStyle
      }
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5, color: "var(--cx-fg-1)" }}>
            {s.unitKind} {s.unitLabel}
          </div>
          <div style={{ fontSize: 11, color: "var(--cx-fg-4)" }}>floor {s.floor ?? 0}</div>
        </div>
        {s.problems.length ? (
          <Pill tone="overdue">Needs attention</Pill>
        ) : !s.isBillable || !s.isActive ? (
          <Pill tone="neutral">Not billed</Pill>
        ) : (
          <Pill tone="active">In billing</Pill>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--cx-border)", paddingTop: 10, display: "grid", gap: 6 }}>
        <Row label="Owner">
          <div>
            <div style={{ fontSize: 13, color: "var(--cx-fg-1)" }}>{s.ownerName || "—"}</div>
            {s.ownerEmail && <div style={{ fontSize: 11, color: "var(--cx-fg-4)" }}>{s.ownerEmail}</div>}
          </div>
        </Row>
        <Row label="Area">
          <span className="cx-num" style={{ fontSize: 13, color: "var(--cx-fg-1)" }}>
            {Number(s.areaSqft) > 0 ? `${s.areaSqft} sq ft` : "—"}
          </span>
        </Row>
        <Row label="Business">
          <span style={{ fontSize: 13, color: s.tradeName ? "var(--cx-fg-1)" : "var(--cx-fg-4)" }}>
            {s.tradeName || "not set"}
          </span>
        </Row>
        <Row label="Listing">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {published ? <Pill tone="active">Listed</Pill> : <Pill tone="neutral">Not listed</Pill>}
            <span style={{ fontSize: 11, color: "var(--cx-fg-4)" }}>
              {published ? s.storefront?.hoursToday?.label || "Hours not set" : "hidden from residents"}
            </span>
          </div>
        </Row>
        <Row label="Owner access">
          {s.ownerAccess?.granted ? (
            <Pill tone="active">Has app access</Pill>
          ) : (
            <Pill tone="neutral">Not invited</Pill>
          )}
        </Row>
      </div>

      {s.problems.length > 0 && (
        <div style={{ fontSize: 11, color: "var(--cx-warning)", lineHeight: 1.5 }}>
          {s.problems.map((p, i) => (
            <div key={i}>&bull; {p}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 11, color: "var(--cx-fg-4)", flexShrink: 0 }}>{label}</span>
      <div style={{ textAlign: "right" }}>{children}</div>
    </div>
  );
}

export default function CommercialShopsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState(null); // shop id, or "NEW"
  const [drawerTab, setDrawerTab] = useState("unit");
  const [form, setForm] = useState(EMPTY_FORM);
  const [banner, setBanner] = useState(null); // { tone, title, detail }
  // The card->dialog below is position:fixed, rendered directly in the page.
  // DashboardLayout.js wraps every page in .contentFrame, which sets
  // backdrop-filter — a CSS containing block for fixed descendants — so
  // without a portal this dialog was fixed to that scrolled content box, not
  // the real viewport. `mounted` keeps the portal call out of the SSR pass.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const shopsQuery = useQuery({
    queryKey: ["commercial-shops", search],
    queryFn: () =>
      apiClient.get(
        `/api/commercial/shops?inactive=1${search ? `&q=${encodeURIComponent(search)}` : ""}`,
      ),
  });

  const membersQuery = useQuery({
    queryKey: ["members-list", "shop-owner-picker"],
    queryFn: () => apiClient.get("/api/members/list?limit=500"),
  });

  const categoriesQuery = useQuery({
    queryKey: ["commercial-categories"],
    queryFn: () => apiClient.get("/api/commercial/categories"),
  });

  const shops = shopsQuery.data?.shops ?? [];
  const members = membersQuery.data?.members ?? [];
  const categories = (categoriesQuery.data?.categories ?? []).filter(
    (c) => c.isActive !== false,
  );

  // The rate card, so the drawer can show WHICH charges this unit is billed
  // and what they come to — the opt-in half of commercial billing.
  const headsQuery = useQuery({
    queryKey: ["commercial-billing-heads"],
    queryFn: () => apiClient.get("/api/commercial/billing-heads"),
  });
  const heads = headsQuery.data?.heads ?? [];

  const settingsQuery = useQuery({
    queryKey: ["commercial-settings"],
    queryFn: () => apiClient.get("/api/commercial/settings"),
  });
  const settings = settingsQuery.data?.settings ?? null;
  const tradeRequired = settings?.requireBusinessProfileBeforeBilling === true;

  // A shop needs attention when it cannot produce a correct bill.
  const problemsFor = (s) => {
    const out = [];
    if (!(Number(s.areaSqft) > 0))
      out.push("No area recorded, so every per-sq-ft charge would be ₹0.");
    if (tradeRequired && !s.hasTradeDetails)
      out.push("Business name and category are required by this society before billing.");
    if (s.occupancyType === "Rented out" && !s.tenantName)
      out.push("Marked as rented out but no tenant name is recorded.");
    if (s.electricityMode === "Society-managed sub-meter" && !settings?.electricity?.societyManagedEnabled)
      out.push("Set to a society sub-meter, but that feature is switched off on the Rate Card.");
    return out;
  };

  const decorated = useMemo(
    () => shops.map((s) => ({ ...s, problems: problemsFor(s) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shops, tradeRequired, settings],
  );

  const counts = useMemo(
    () => ({
      all: decorated.length,
      billable: decorated.filter((s) => s.isBillable && s.isActive).length,
      problems: decorated.filter((s) => s.problems.length > 0).length,
      inactive: decorated.filter((s) => !s.isBillable || !s.isActive).length,
    }),
    [decorated],
  );

  const visible = useMemo(() => {
    if (filter === "BILLABLE") return decorated.filter((s) => s.isBillable && s.isActive);
    if (filter === "NEEDS_ATTENTION") return decorated.filter((s) => s.problems.length > 0);
    if (filter === "INACTIVE") return decorated.filter((s) => !s.isBillable || !s.isActive);
    return decorated;
  }, [decorated, filter]);

  // Members already used as a shop owner are still selectable — one person can
  // own several shops. We only show their flat for recognition.
  const memberOptions = useMemo(
    () =>
      members
        .filter((m) => !m.isDeleted)
        .map((m) => ({
          id: String(m.memberId ?? m._id ?? m.id ?? ""),
          label: `${m.wing || ""}-${m.flatNo || "?"} · ${m.ownerName || "Unnamed"}`,
          ownerName: m.ownerName || "",
          phone: m.contactNumber || "",
          email: m.emailPrimary || "",
        }))
        .filter((m) => m.id),
    [members],
  );

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const openNew = () => {
    setForm(EMPTY_FORM);
    setOpenId("NEW");
    setDrawerTab("unit");
    setBanner(null);
  };

  const openExisting = (s) => {
    setForm({
      ...EMPTY_FORM,
      ...s,
      ownerMemberId: s.ownerMemberId || "",
      categoryId: s.categoryId || "",
      areaSqft: s.areaSqft ?? "",
      signageSizeSqft: s.signageSizeSqft ?? "",
      chargeOptIns: Array.isArray(s.chargeOptIns) ? s.chargeOptIns : [],
    });
    setOpenId(s.id);
    setDrawerTab("unit");
    setBanner(null);
  };

  const closeDrawer = () => setOpenId(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["commercial-shops"] });
    qc.invalidateQueries({ queryKey: ["commercial-readiness"] });
  };

  // Errors from the API carry `issues[]` and a `hint`. Both are written for a
  // non-technical admin, so we render them verbatim rather than inventing text.
  const showError = (err) => {
    const body = err?.body ?? err?.data ?? {};
    setBanner({
      tone: "danger",
      title: body.error || err?.message || "That could not be saved.",
      detail: body.hint || null,
      issues: body.issues || null,
    });
  };

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      openId === "NEW"
        ? apiClient.post("/api/commercial/shops", payload)
        : apiClient.patch(`/api/commercial/shops/${openId}`, payload),
    onSuccess: (res) => {
      invalidate();
      const wasNew = openId === "NEW";
      setBanner({
        tone: "success",
        title:
          res?.nextStep ||
          "Saved. This shop will appear in the next commercial bill run.",
      });
      if (wasNew && res?.id) {
        // Stay open on the new shop instead of closing — the owner/listing
        // tabs only make sense once there is an id, and the admin is most
        // likely to want them next.
        setOpenId(res.id);
        setDrawerTab("owner");
      } else {
        closeDrawer();
      }
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => apiClient.delete(`/api/commercial/shops/${id}`),
    onSuccess: (res) => {
      invalidate();
      closeDrawer();
      setBanner({
        tone: "success",
        title: res?.nextStep || "Shop removed. The linked flat was not changed.",
      });
    },
    onError: showError,
  });

  const submit = (e) => {
    e.preventDefault();
    setBanner(null);

    // Client-side checks mirror the server exactly, so the admin gets the same
    // sentence either way and never sees a raw validation dump.
    const issues = [];
    if (!String(form.shopNo).trim())
      issues.push({ field: "shopNo", message: "Shop number is required, for example 103 or S-4." });
    if (!(Number(form.areaSqft) > 0))
      issues.push({
        field: "areaSqft",
        message:
          "Area is required. Per-sq-ft charges multiply by this number, so a blank area silently produces a ₹0 bill.",
      });
    if (!form.ownerMemberId && !String(form.ownerName).trim())
      issues.push({
        field: "ownerName",
        message:
          "Pick the owner from the member list, or type a name if the owner is not a society member.",
      });
    if (form.occupancyType === "Rented out" && !String(form.tenantName).trim())
      issues.push({
        field: "tenantName",
        message: "Tenant name is required when a shop is rented out.",
      });

    if (issues.length) {
      setBanner({
        tone: "danger",
        title: "Please fix these before saving:",
        issues,
      });
      return;
    }

    const payload = {
      ...form,
      floor: Number(form.floor) || 0,
      areaSqft: Number(form.areaSqft),
      shutterCount: Number(form.shutterCount) || 0,
      signageSizeSqft: form.signageSizeSqft === "" ? null : Number(form.signageSizeSqft),
      openingPrincipal: Number(form.openingPrincipal) || 0,
      openingInterest: Number(form.openingInterest) || 0,
      ownerMemberId: form.ownerMemberId || null,
      categoryId: form.categoryId || null,
      chargeOptIns: (form.chargeOptIns || []).map((r) => ({
        ...r,
        quantity: Number(r.quantity) || 0,
      })),
    };
    saveMutation.mutate(payload);
  };

  const emptyText = shopsQuery.error
    ? "The shop list could not be loaded. Refresh the page, and if it keeps failing your session may have expired."
    : search
      ? `No shop matches "${search}".`
      : "No shops or offices yet. Add your first one — this does not change any flat.";

  const editing = openId && openId !== "NEW" ? decorated.find((s) => s.id === openId) : null;
  const isNew = openId === "NEW";
  const tabItems = DRAWER_TABS.map((t) => ({
    ...t,
    disabled: isNew && t.value !== "unit",
    disabledReason: isNew && t.value !== "unit" ? NEW_ONLY_DISABLED_REASON : undefined,
  }));

  return (
    // "commercial-scope" is not decoration -- _ui/tokens.css defines every
    // --cx-* variable under this exact class. Without it the whole page
    // renders with unresolved custom properties, which is the "no CSS" bug.
    <div
      className="commercial-scope cx-fade"
      style={{ padding: "1.75rem 2rem", maxWidth: 1180, margin: "0 auto" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 18,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--cx-fg-1)", margin: 0 }}>
            Shops &amp; Offices
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--cx-fg-3)", margin: "5px 0 0", maxWidth: 620 }}>
            Commercial units are separate records with their own area and their own
            bills. Adding one here never changes a flat, and removing one leaves the
            flat untouched.
          </p>
        </div>
        <Btn variant="primary" icon="plus" onClick={openNew}>
          Add shop or office
        </Btn>
      </div>

      <div style={{ ...grid(4), marginBottom: 16 }}>
        <StatTile icon="store" label="Total units" value={counts.all} />
        <StatTile icon="check-circle" label="In billing" value={counts.billable} />
        <StatTile
          icon="alert-triangle"
          label="Needs attention"
          value={counts.problems}
          tone={counts.problems ? "danger" : undefined}
          hint={counts.problems ? "These would bill incorrectly" : "All good"}
        />
        <StatTile icon="clock" label="Not billed" value={counts.inactive} />
      </div>

      {banner && !openId && (
        <Card
          style={{
            marginBottom: 14,
            borderColor:
              banner.tone === "danger" ? "var(--cx-danger)" : "var(--cx-success)",
            background:
              banner.tone === "danger" ? "var(--cx-danger-soft)" : "var(--cx-success-soft)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: banner.tone === "danger" ? "var(--cx-danger)" : "var(--cx-success)",
            }}
          >
            {banner.title}
          </div>
          {banner.detail && <div style={{ ...help, marginTop: 5 }}>{banner.detail}</div>}
        </Card>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Segmented
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({
            ...f,
            count:
              f.value === "ALL"
                ? counts.all
                : f.value === "BILLABLE"
                  ? counts.billable
                  : f.value === "NEEDS_ATTENTION"
                    ? counts.problems
                    : counts.inactive,
          }))}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search shop no, owner or business"
          style={{ ...inputStyle, width: 260 }}
        />
      </div>

      {shopsQuery.isLoading ? (
        <Card>
          <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--cx-fg-4)" }}>
            Loading shops…
          </div>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <div style={{ padding: 28, textAlign: "center", fontSize: 13, color: "var(--cx-fg-4)" }}>
            {emptyText}
          </div>
        </Card>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          {visible.map((s) => (
            <ShopCard key={s.id} shop={s} onOpen={openExisting} isOpen={s.id === openId} />
          ))}
        </div>
      )}

      <div style={{ ...help, marginTop: 18 }}>
        Rates for these units are set once on the{" "}
        <Link href="/admin/commercial/rate-card" style={{ color: "var(--cx-brand)", fontWeight: 600 }}>
          Commercial Rate Card
        </Link>
        , and apply to every shop and office.
      </div>

      {mounted && createPortal(
      <AnimatePresence>
        {openId && (
          <>
            <motion.div
              key="backdrop"
              onClick={closeDrawer}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ position: "fixed", inset: 0, background: "rgba(10,10,15,0.4)", zIndex: 60 }}
            />
            <motion.div
              key="dialog"
              className="cxShopDialog"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              style={{
                position: "fixed",
                top: "6vh",
                bottom: "6vh",
                left: "calc(260px + 5vw)",
                right: "5vw",
                zIndex: 61,
                background: "var(--cx-canvas)",
                border: "1px solid var(--cx-border)",
                borderRadius: 18,
                boxShadow: "var(--cx-shadow-pop)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {/* The "soundbar": the card's own header row, condensed. Same
                  facts the card showed (unit, owner, status), now as a strip
                  instead of a stack — this is what the card visually becomes. */}
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--cx-border)",
                  background: "var(--cx-surface)",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cx-fg-1)" }}>
                    {isNew
                      ? "Add a shop or office"
                      : `${editing?.unitKind || "Shop"} ${editing?.unitLabel || ""}`}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--cx-fg-4)" }}>
                    {isNew
                      ? "Only three things are required: the shop number, the owner, and the area."
                      : editing?.ownerName || "No owner recorded"}
                  </div>
                </div>

                {!isNew && editing && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {Number(editing.areaSqft) > 0 && (
                      <span className="cx-num" style={{ fontSize: 12, color: "var(--cx-fg-3)" }}>
                        {editing.areaSqft} sq ft
                      </span>
                    )}
                    {editing.problems.length ? (
                      <Pill tone="overdue">Needs attention</Pill>
                    ) : !editing.isBillable || !editing.isActive ? (
                      <Pill tone="neutral">Not billed</Pill>
                    ) : (
                      <Pill tone="active">In billing</Pill>
                    )}
                    {editing.storefront?.isPublished ? (
                      <Pill tone="active">Listed</Pill>
                    ) : (
                      <Pill tone="neutral">Not listed</Pill>
                    )}
                    {editing.ownerAccess?.granted ? (
                      <Pill tone="active">Owner has access</Pill>
                    ) : (
                      <Pill tone="neutral">Not invited</Pill>
                    )}
                  </div>
                )}

                <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                  {!isNew && (
                    <Btn
                      variant="danger"
                      onClick={async () => {
                        if (
                          await notify.confirm(
                            "Remove this shop? Its past bills are kept, and the linked flat is not changed.",
                            { tone: "danger" },
                          )
                        )
                          deleteMutation.mutate(openId);
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      Remove
                    </Btn>
                  )}
                  <button
                    onClick={closeDrawer}
                    aria-label="Close"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      border: "1px solid var(--cx-border)",
                      background: "var(--cx-surface)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      color: "var(--cx-fg-3)",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              </motion.div>

              {/* Body: fades/slides in just after the header settles, so the
                  motion reads as "card becomes bar, then content appears"
                  rather than everything popping in at once. */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.14 }}
                style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}
              >
                <Tabs items={tabItems} value={drawerTab} onChange={setDrawerTab} />

        {drawerTab === "unit" && (
          <form id="shop-unit-form" onSubmit={submit}>
            <div style={sectionTitle}>The unit</div>
            <div style={grid(2)}>
              <Field label="Shop number *" hint="As painted on the shutter.">
                <input
                  style={inputStyle}
                  value={form.shopNo}
                  onChange={(e) => set("shopNo", e.target.value)}
                  placeholder="103"
                />
              </Field>
              <Field label="Wing" hint="Leave blank if the society has no wings.">
                <input
                  style={inputStyle}
                  value={form.wing}
                  onChange={(e) => set("wing", e.target.value)}
                  placeholder="A"
                />
              </Field>
              <Field label="Floor">
                <input
                  type="number"
                  style={inputStyle}
                  value={form.floor}
                  onChange={(e) => set("floor", e.target.value)}
                />
              </Field>
              <Field label="Type">
                <select
                  style={inputStyle}
                  value={form.unitKind}
                  onChange={(e) => set("unitKind", e.target.value)}
                >
                  {UNIT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div style={sectionTitle}>Area used for billing</div>
            <div style={grid(2)}>
              <Field
                label="Area (sq ft) *"
                hint="This shop's own area. It is never taken from a flat."
              >
                <input
                  type="number"
                  step="0.01"
                  style={inputStyle}
                  value={form.areaSqft}
                  onChange={(e) => set("areaSqft", e.target.value)}
                  placeholder="300"
                />
              </Field>
              <Field label="What this figure is" hint="For your records. Does not change the maths.">
                <select
                  style={inputStyle}
                  value={form.areaBasisNote}
                  onChange={(e) => set("areaBasisNote", e.target.value)}
                >
                  {AREA_BASIS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ ...help, marginTop: -6, marginBottom: 12 }}>
              Bills already generated keep the area they were generated with, so correcting this never rewrites history.
            </div>

            <div style={sectionTitle}>Owner</div>
            <div style={grid(2)}>
              <Field
                label="Society member"
                hint="Links the shop to an existing member. Their flat is not modified."
                span={2}
              >
                <select
                  style={inputStyle}
                  value={form.ownerMemberId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const m = memberOptions.find((x) => x.id === id);
                    setForm((f) => ({
                      ...f,
                      ownerMemberId: id,
                      ownerName: m?.ownerName || f.ownerName,
                      ownerPhone: m?.phone || f.ownerPhone,
                      ownerEmail: m?.email || f.ownerEmail,
                    }));
                  }}
                >
                  <option value="">Not a member / enter manually</option>
                  {memberOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Owner name *">
                <input
                  style={inputStyle}
                  value={form.ownerName}
                  onChange={(e) => set("ownerName", e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <input
                  style={inputStyle}
                  value={form.ownerPhone}
                  onChange={(e) => set("ownerPhone", e.target.value)}
                />
              </Field>
              <Field label="Email" hint="Bills and payment receipts go here.">
                <input
                  type="email"
                  style={inputStyle}
                  value={form.ownerEmail}
                  onChange={(e) => set("ownerEmail", e.target.value)}
                />
              </Field>
            </div>

            <div style={sectionTitle}>Who occupies it</div>
            <div style={grid(2)}>
              <Field
                label="Occupancy"
                hint="Non-occupancy charge, if your society has it switched on, applies only to rented units."
              >
                <select
                  style={inputStyle}
                  value={form.occupancyType}
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
                  <Field label="Tenant name *">
                    <input
                      style={inputStyle}
                      value={form.tenantName}
                      onChange={(e) => set("tenantName", e.target.value)}
                    />
                  </Field>
                  <Field label="Tenant phone">
                    <input
                      style={inputStyle}
                      value={form.tenantPhone}
                      onChange={(e) => set("tenantPhone", e.target.value)}
                    />
                  </Field>
                </>
              )}
            </div>

            <div style={sectionTitle}>
              Business details{" "}
              <span style={{ textTransform: "none", fontWeight: 500, letterSpacing: 0 }}>
                {tradeRequired ? "(required by this society)" : "(optional)"}
              </span>
            </div>
            <div style={grid(2)}>
              <Field label="Business name">
                <input
                  style={inputStyle}
                  value={form.tradeName}
                  onChange={(e) => set("tradeName", e.target.value)}
                />
              </Field>
              <Field label="Category">
                <select
                  style={inputStyle}
                  value={form.categoryId}
                  onChange={(e) => set("categoryId", e.target.value)}
                >
                  <option value="">Not set</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="GSTIN" hint="Only if the shop is GST registered.">
                <input
                  style={inputStyle}
                  value={form.gstin}
                  onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Shop Act / Gumasta no.">
                <input
                  style={inputStyle}
                  value={form.shopActNumber}
                  onChange={(e) => set("shopActNumber", e.target.value)}
                />
              </Field>
              <Field label="FSSAI no." hint="Food businesses only." span={2}>
                <input
                  style={inputStyle}
                  value={form.fssaiNumber}
                  onChange={(e) => set("fssaiNumber", e.target.value)}
                />
              </Field>
            </div>

            <div style={sectionTitle}>Utilities &amp; premises</div>
            <div style={grid(2)}>
              <Field
                label="Electricity"
                hint="Most shops pay their own bill. Pick the sub-meter option only if the society recovers it."
              >
                <select
                  style={inputStyle}
                  value={form.electricityMode}
                  onChange={(e) => set("electricityMode", e.target.value)}
                >
                  {ELECTRICITY.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Meter number">
                <input
                  style={inputStyle}
                  value={form.electricityMeterNo}
                  onChange={(e) => set("electricityMeterNo", e.target.value)}
                />
              </Field>
              <Field label="Water connection no.">
                <input
                  style={inputStyle}
                  value={form.waterConnectionNo}
                  onChange={(e) => set("waterConnectionNo", e.target.value)}
                />
              </Field>
              <Field label="Shutters" hint="Record-keeping only — does not affect billing.">
                <input
                  type="number"
                  style={inputStyle}
                  value={form.shutterCount}
                  onChange={(e) => set("shutterCount", e.target.value)}
                />
              </Field>
              <Field label="Signage board" hint="Record-keeping only. Turn signage billing on/off in Charges below.">
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, height: 32 }}>
                  <input
                    type="checkbox"
                    checked={!!form.hasSignage}
                    onChange={(e) => set("hasSignage", e.target.checked)}
                  />
                  Has a signage board
                </label>
              </Field>
              {form.hasSignage && (
                <Field label="Signage size (sq ft)">
                  <input
                    type="number"
                    step="0.01"
                    style={inputStyle}
                    value={form.signageSizeSqft}
                    onChange={(e) => set("signageSizeSqft", e.target.value)}
                  />
                </Field>
              )}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--cx-fg-4)", margin: "-6px 0 0" }}>
              Electricity above decides whether Common Electricity is even eligible. Whether
              signage, parking or garbage actually bill this unit — and how much — is set per
              charge in the Charges section right below, not by the fields above.
            </p>

            <div style={sectionTitle}>Charges</div>
            {headsQuery.isLoading ? (
              <div style={{ fontSize: 12.5, color: "var(--cx-fg-3)" }}>Loading the rate card...</div>
            ) : headsQuery.error ? (
              <div style={{ fontSize: 12.5, color: "var(--cx-danger)" }}>
                The rate card could not be loaded, so charges cannot be set here yet.{" "}
                {headsQuery.error?.message || ""}
              </div>
            ) : (
              <ChargesSection
                heads={heads}
                unitKind={form.unitKind}
                areaSqft={form.areaSqft}
                electricityMode={form.electricityMode}
                value={form.chargeOptIns}
                onChange={(next) => set("chargeOptIns", next)}
                disabled={saveMutation.isPending}
              />
            )}

            <div style={sectionTitle}>Emergency contact</div>
            <div style={grid(2)}>
              <Field label="Name">
                <input
                  style={inputStyle}
                  value={form.emergencyContactName}
                  onChange={(e) => set("emergencyContactName", e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <input
                  style={inputStyle}
                  value={form.emergencyContactPhone}
                  onChange={(e) => set("emergencyContactPhone", e.target.value)}
                />
              </Field>
            </div>

            <div style={sectionTitle}>Opening balance</div>
            <div style={grid(2)}>
              <Field
                label="Amount already due (Rs)"
                hint="What this SHOP owed before the system started. A flat's arrears are never carried here."
              >
                <input
                  type="number"
                  step="0.01"
                  style={inputStyle}
                  value={form.openingPrincipal}
                  onChange={(e) => set("openingPrincipal", e.target.value)}
                />
              </Field>
              <Field label="Interest already due (Rs)">
                <input
                  type="number"
                  step="0.01"
                  style={inputStyle}
                  value={form.openingInterest}
                  onChange={(e) => set("openingInterest", e.target.value)}
                />
              </Field>
              <Field label="Include in billing" hint="Switch off for a vacant unit you do not want billed." span={2}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, height: 32 }}>
                  <input
                    type="checkbox"
                    checked={!!form.isBillable}
                    onChange={(e) => set("isBillable", e.target.checked)}
                  />
                  Generate bills for this unit
                </label>
              </Field>
            </div>
          </form>
        )}

        {drawerTab === "owner" && editing && (
          <OwnerAccessTab shop={editing} onBanner={setBanner} />
        )}
        {(drawerTab === "listing" || drawerTab === "orders") && editing && (
          // ONE mounted instance shared by both tabs — see the comment atop
          // ShopStorefrontPanel's render. Two separate wrapper components
          // (formerly ListingHoursTab / OrdersTab) meant switching tabs here
          // unmounted whichever one was active, silently discarding any
          // pickup/delivery/payment-method toggle the admin hadn't saved yet.
          <ShopStorefrontPanel shopId={editing.id} onBanner={setBanner} tab={drawerTab} />
        )}
              </motion.div>

              <div
                style={{
                  padding: "12px 20px",
                  borderTop: "1px solid var(--cx-border)",
                  background: "var(--cx-surface)",
                  display: "flex",
                  gap: 8,
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  {banner && openId && (
                    <div
                      style={{
                        fontSize: 12,
                        color: banner.tone === "danger" ? "var(--cx-danger)" : "var(--cx-success)",
                        maxWidth: 460,
                      }}
                    >
                      {banner.title}
                      {banner.issues && (
                        <ul style={{ margin: "4px 0 0 14px", padding: 0 }}>
                          {banner.issues.map((iss, idx) => (
                            <li key={iss.field || idx}>{iss.message}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
                {drawerTab === "unit" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn onClick={closeDrawer}>Cancel</Btn>
                    <Btn
                      variant="primary"
                      disabled={saveMutation.isPending}
                      onClick={() =>
                        document.getElementById("shop-unit-form")?.requestSubmit()
                      }
                    >
                      {saveMutation.isPending ? "Saving…" : isNew ? "Add shop" : "Save changes"}
                    </Btn>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
      )}

    </div>
  );
}
