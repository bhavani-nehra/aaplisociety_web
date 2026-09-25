"use client";

// app/admin/commercial/shops/ShopCommerceAdmin.js
//
// NEW (Step 1 / Checkpoint 1). The two admin actions that were missing from the
// Shops screen, kept in their own file so PageClient.js only gains a column and
// one panel:
//
//   1. INVITE THE OWNER. The endpoint existed but nothing on screen called it,
//      so an admin could create a shop with an owner email and had no way to
//      get that owner onto the platform.
//
//   2. PUBLISH THE STOREFRONT. Residents only see published shops (approved
//      product rule: the society decides what is listed), so without this the
//      member "Society Shops" list would always be empty.
//
// The invite call deliberately uses fetch() instead of apiClient. apiClient
// collapses an error response into `new Error(data.error)` and throws the body
// away - and the body is exactly what matters here: a 409 carries the list of
// existing accounts the admin has to choose between. Losing it would leave the
// admin stuck on "An account already uses this email address" with no way to
// act on it.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Pill, Btn } from "../_ui";

const DAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const PICKUP_METHODS = [
  { value: "PAY_AT_SHOP", label: "Cash at the shop" },
  { value: "UPI_ON_PICKUP", label: "UPI at the shop" },
];
const DELIVERY_METHODS = [
  { value: "PAY_ON_DELIVERY", label: "Cash on delivery" },
  { value: "UPI_ON_DELIVERY", label: "UPI on delivery" },
];

const SETUP_LABELS = {
  tradeName: "Business name",
  category: "Category",
  businessHours: "Opening hours",
  fulfillment: "Pickup or delivery",
  paymentMethods: "Payment methods",
};

const OWNER_PATH_LABELS = {
  RESIDENT: "resident's existing login",
  EXISTING_OWNER_USER: "owner's existing login",
  LINKED_EXISTING_ACCOUNT: "linked to existing account",
  NEW_ACCOUNT: "new account created",
};

// Each concern within a drawer tab (listing status, public info, hours,
// orders) gets its own bordered card instead of one long unbroken scroll.
const bentoCard = {
  border: "1px solid var(--cx-border)",
  borderRadius: 10,
  padding: 14,
  background: "var(--cx-surface-2)",
};
const bentoCardTitle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.4px",
  
  color: "var(--cx-fg-4)",
  marginBottom: 10,
};

const input = {
  width: "100%",
  padding: "7px 9px",
  fontSize: 13,
  borderRadius: 7,
  border: "1px solid var(--cx-border)",
  background: "var(--cx-surface)",
  color: "var(--cx-fg-1)",
};
const label = { fontSize: 11.5, fontWeight: 600, color: "var(--cx-fg-3)", marginBottom: 4 };
const help = { fontSize: 11.5, color: "var(--cx-fg-4)", lineHeight: 1.5 };

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data: data ?? {} };
}

// ---------------------------------------------------------------- row summary

/** The "Residents" table cell: can a resident see this shop, and if not, why. */
export function ShopVisibilityCell({ shop }) {
  const published = shop?.storefront?.isPublished === true;
  const hours = shop?.storefront?.hoursToday;
  return (
    <div>
      {published ? <Pill tone="active">Listed</Pill> : <Pill tone="neutral">Not listed</Pill>}
      <div style={{ ...help, marginTop: 4 }}>
        {published
          ? hours?.label || "Hours not set"
          : "residents cannot see it"}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- owner invite

export function OwnerInvite({ shop, onBanner }) {
  const [candidates, setCandidates] = useState(null);
  const [pending, setPending] = useState(false);
  const qc = useQueryClient();

  const invite = async (body) => {
    setPending(true);
    const { ok, status, data } = await postJson(
      `/api/commercial/shops/${shop.id}/invite`,
      body,
    );
    setPending(false);

    if (status === 409 && data.code === "OWNER_ACCOUNT_CHOICE_REQUIRED") {
      // An explicit human decision, not a guess. User email is not unique, so
      // auto-linking could hand this shop to the wrong person's login.
      setCandidates(data.candidates || []);
      return;
    }
    if (!ok) {
      onBanner({
        tone: "danger",
        title: data.error || "The owner could not be invited.",
        detail:
          status === 400 && data.code === "NO_OWNER_EMAIL"
            ? "Add the owner's email address to this shop first, then invite again."
            : null,
      });
      return;
    }

    setCandidates(null);
    qc.invalidateQueries({ queryKey: ["commercial-shops"] });
    onBanner({
      tone: "success",
      title:
        data.path === "RESIDENT" || data.path === "LINKED_EXISTING_ACCOUNT"
          ? "Shop linked to the owner's existing account."
          : "Owner invited.",
      detail: data.credentialsEmailSent
        ? "They have been emailed a link to set their username and password."
        : "They already have a login, so they were told to sign in and pick the Shop profile - no new account was created.",
    });
  };

  if (candidates) {
    return (
      <div
        style={{
          border: "1px solid var(--cx-warning)",
          background: "var(--cx-warning-soft)",
          borderRadius: 9,
          padding: 12,
          marginTop: 10,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cx-fg-1)" }}>
          An account already uses {shop.ownerEmail}
        </div>
        <div style={{ ...help, marginTop: 4 }}>
          Email addresses are not unique in this system, so we will not guess. Link this
          shop to one of these accounts only if it belongs to the same person.
        </div>
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {candidates.map((c) => (
            <div
              key={c.userId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                background: "var(--cx-surface)",
                border: "1px solid var(--cx-border)",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cx-fg-1)" }}>
                  {c.name || c.username}
                </div>
                <div style={help}>
                  {c.username}
                  {" · "}
                  {c.isActivated ? "already signed in before" : "never signed in"}
                  {" · "}
                  {c.profileCount} profile{c.profileCount === 1 ? "" : "s"}
                </div>
              </div>
              <Btn
                variant="primary"
                disabled={pending}
                onClick={() => invite({ linkUserId: c.userId })}
              >
                Link this account
              </Btn>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <Btn disabled={pending} onClick={() => invite({ createNew: true })}>
            Different person &mdash; create a separate account
          </Btn>
          <Btn disabled={pending} onClick={() => setCandidates(null)}>
            Cancel
          </Btn>
        </div>
      </div>
    );
  }

  const granted = shop.ownerAccess?.granted === true;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ marginBottom: 8 }}>
        {granted ? (
          <Pill tone="active">
            Owner has app access
            {shop.ownerAccess?.path && ` · ${OWNER_PATH_LABELS[shop.ownerAccess.path] || shop.ownerAccess.path}`}
          </Pill>
        ) : (
          <Pill tone="neutral">Not invited yet</Pill>
        )}
      </div>
      <Btn variant={granted ? undefined : "primary"} disabled={pending || !shop.ownerEmail} onClick={() => invite({})}>
        {pending ? "Sending…" : granted ? "Resend" : "Invite the owner"}
      </Btn>
      <div style={{ ...help, marginTop: 6 }}>
        {shop.ownerEmail
          ? granted
            ? `${shop.ownerEmail} already has access. Resend only if they lost the email.`
            : `Sends ${shop.ownerEmail} what they need to open this shop in the app. A resident owner keeps their existing login and gains a Shop profile.`
          : "Add an owner email above and save before inviting."}
      </div>
    </div>
  );
}

// ---------------------------------------------------------- storefront editor

function emptyDay(value) {
  return { dayOfWeek: value, isClosed: true, opensAt: "09:00", closesAt: "21:00", split: false };
}

function daysFromStorefront(storefront) {
  const byDay = new Map(
    (storefront?.weeklyHours || []).map((d) => [Number(d.dayOfWeek), d]),
  );
  return DAYS.map(({ value }) => {
    const found = byDay.get(value);
    if (!found) return emptyDay(value);
    const first = (found.intervals || [])[0];
    return {
      dayOfWeek: value,
      isClosed: found.isClosed === true || !first,
      opensAt: first?.opensAt || "09:00",
      closesAt: first?.closesAt || "21:00",
      split: (found.intervals || []).length > 1,
    };
  });
}

/**
 * The public face of one shop: what residents see in Society Shops, and the
 * publish switch.
 *
 * Hours are edited as ONE range per day here. The data model supports split
 * hours (a lunch break), and any day that already has them says so instead of
 * silently pretending the second range does not exist.
 *
 * `tab` picks which slice of this ONE form to render — "listing" (publish +
 * public info + hours) or "orders" (pickup/delivery/payment). Both slices
 * share the same state and the same save button on purpose: it is one PATCH
 * to the storefront either way, so switching tabs must never lose an edit
 * made on the other one.
 */
export function ShopStorefrontPanel({ shopId, onBanner, tab = "listing" }) {
  const qc = useQueryClient();
  const [days, setDays] = useState(() => DAYS.map((d) => emptyDay(d.value)));
  const [form, setForm] = useState({
    tagline: "",
    description: "",
    pickupEnabled: false,
    deliveryEnabled: false,
    serviceOnly: false,
    deliveryNote: "",
    minOrderAmount: "",
    offlinePaymentMethods: [],
    publicPhone: "",
    manualClosed: false,
    manualClosedNote: "",
  });

  const query = useQuery({
    queryKey: ["commercial-shop-storefront", shopId],
    queryFn: () => apiClient.get(`/api/commercial/shops/${shopId}/storefront`),
    enabled: Boolean(shopId),
  });

  const shop = query.data?.shop;

  useEffect(() => {
    if (!shop) return;
    setDays(daysFromStorefront(shop));
    setForm({
      tagline: shop.tagline ?? "",
      description: shop.description ?? "",
      pickupEnabled: shop.pickupEnabled === true,
      deliveryEnabled: shop.deliveryEnabled === true,
      serviceOnly: shop.serviceOnly === true,
      deliveryNote: shop.deliveryNote ?? "",
      minOrderAmount: shop.minOrderAmount ?? "",
      offlinePaymentMethods: shop.offlinePaymentMethods ?? [],
      publicPhone: shop.phone ?? "",
      manualClosed: shop.manualClosed === true,
      manualClosedNote: shop.manualClosedNote ?? "",
    });
  }, [shop]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Only methods whose fulfilment mode is switched on may be offered, because
  // the API rejects the rest - showing them as available would produce a save
  // error the admin cannot explain.
  const availableMethods = useMemo(
    () => [
      ...(form.pickupEnabled || form.serviceOnly ? PICKUP_METHODS : []),
      ...(form.deliveryEnabled ? DELIVERY_METHODS : []),
    ],
    [form.pickupEnabled, form.deliveryEnabled, form.serviceOnly],
  );

  const toggleMethod = (value) =>
    set(
      "offlinePaymentMethods",
      form.offlinePaymentMethods.includes(value)
        ? form.offlinePaymentMethods.filter((m) => m !== value)
        : [...form.offlinePaymentMethods, value],
    );

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      apiClient.patch(`/api/commercial/shops/${shopId}/storefront`, payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["commercial-shops"] });
      qc.setQueryData(["commercial-shop-storefront", shopId], data);
      onBanner({
        tone: "success",
        title: "Storefront saved.",
        detail: data?.shop?.setup?.isReadyToPublish
          ? "This shop is ready to be listed for residents."
          : `Still needed before listing: ${(data?.shop?.setup?.missing || [])
              .map((m) => SETUP_LABELS[m] || m)
              .join(", ")}.`,
      });
    },
    onError: (err) =>
      onBanner({ tone: "danger", title: err?.message || "The storefront could not be saved." }),
  });

  const publishMutation = useMutation({
    mutationFn: (isPublished) =>
      apiClient.post(`/api/commercial/shops/${shopId}/storefront`, { isPublished }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["commercial-shops"] });
      qc.setQueryData(["commercial-shop-storefront", shopId], data);
      onBanner({
        tone: "success",
        title: data?.shop?.isPublished
          ? "Listed. Residents can now find this shop in the app."
          : "Removed from the resident list.",
      });
    },
    onError: (err) =>
      onBanner({
        tone: "danger",
        title: err?.message || "This shop could not be listed.",
        detail:
          "A shop can only be listed once its name, category, hours, fulfilment and payment methods are set.",
      }),
  });

  const save = () => {
    const weeklyHours = days.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      isClosed: d.isClosed,
      intervals: d.isClosed ? [] : [{ opensAt: d.opensAt, closesAt: d.closesAt }],
    }));
    saveMutation.mutate({
      tagline: form.tagline.trim() || null,
      description: form.description.trim() || null,
      weeklyHours,
      pickupEnabled: form.pickupEnabled,
      deliveryEnabled: form.deliveryEnabled,
      serviceOnly: form.serviceOnly,
      deliveryNote: form.deliveryNote.trim() || null,
      minOrderAmount: form.minOrderAmount === "" ? null : Number(form.minOrderAmount),
      // Methods whose fulfilment was just switched off must not be sent.
      offlinePaymentMethods: form.offlinePaymentMethods.filter((m) =>
        availableMethods.some((a) => a.value === m),
      ),
      publicPhone: form.publicPhone.trim() || null,
      manualClosed: form.manualClosed,
      manualClosedNote: form.manualClosedNote.trim() || null,
    });
  };

  if (query.isLoading) {
    return (
      <div style={{ ...help, padding: "14px 0" }}>Loading the resident-facing details…</div>
    );
  }
  if (query.error) {
    return (
      <div style={{ ...help, padding: "14px 0", color: "var(--cx-danger)" }}>
        The resident-facing details could not be loaded. Save the shop first, then reopen it.
      </div>
    );
  }

  const missing = shop?.setup?.missing || [];
  const ready = shop?.setup?.isReadyToPublish === true;
  const published = shop?.isPublished === true;

  return (
    <div>
      {/* Both sections stay mounted at all times — only their CSS visibility
          follows the active tab. Listing and Orders used to be two SEPARATE
          mounts of this component (see ListingHoursTab/OrdersTab below and
          their call sites in PageClient.js), so toggling pickup/delivery/
          payment on the Orders tab and switching to Listing without clicking
          "Save what residents see" first discarded that edit on unmount —
          the toggle looked like it took effect (it updated local state) but
          never reached the server, so the shop stayed stuck on "still
          needed: Pickup or delivery, Payment methods" even after a refresh. */}
      <div style={{ display: tab === "listing" ? "block" : "none" }}>
      <div style={{ ...bentoCard, marginBottom: 12 }}>
          <div style={bentoCardTitle}>Listing status</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--cx-fg-1)" }}>
            {published ? "Listed in Society Shops" : "Not listed in Society Shops"}
          </div>
          <div style={{ ...help, marginTop: 3, marginBottom: 10 }}>
            {published
              ? "Residents of this society can find this shop in the app. Un-listing hides it immediately; nothing is deleted."
              : ready
                ? "Everything needed is in place. Listing it makes it visible to every resident of this society."
                : `Cannot be listed yet — still needed: ${missing
                    .map((m) => SETUP_LABELS[m] || m)
                    .join(", ")}.`}
          </div>
          <Btn
            variant={published ? "danger" : "primary"}
            disabled={publishMutation.isPending || (!published && !ready)}
            onClick={() => publishMutation.mutate(!published)}
          >
            {published ? "Remove from list" : "List for residents"}
          </Btn>
      </div>

      <div style={{ ...bentoCard, marginBottom: 12 }}>
          <div style={bentoCardTitle}>Public info</div>
          <div style={{ marginBottom: 10 }}>
            <div style={label}>Short line residents see</div>
            <input
              style={input}
              maxLength={120}
              value={form.tagline}
              onChange={(e) => set("tagline", e.target.value)}
              placeholder="Fresh vegetables and fruits, daily"
            />
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={label}>Public phone</div>
            <input
              style={input}
              value={form.publicPhone}
              onChange={(e) => set("publicPhone", e.target.value)}
              placeholder="9876543210"
            />
            <div style={{ ...help, marginTop: 4 }}>
              Leave blank to keep the owner&rsquo;s number private.
            </div>
          </div>
          <div>
            <div style={label}>About this shop</div>
            <textarea
              style={{ ...input, minHeight: 66, resize: "vertical" }}
              maxLength={2000}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
      </div>

      <div style={bentoCard}>
          <div style={bentoCardTitle}>Opening hours</div>
          <div style={{ display: "grid", gap: 6 }}>
        {days.map((d, i) => (
          <div
            key={d.dayOfWeek}
            style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
          >
            <div style={{ width: 96, fontSize: 12.5, color: "var(--cx-fg-2)" }}>
              {DAYS[i].label}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={!d.isClosed}
                onChange={(e) =>
                  setDays((prev) =>
                    prev.map((x, xi) => (xi === i ? { ...x, isClosed: !e.target.checked } : x)),
                  )
                }
              />
              Open
            </label>
            <input
              type="time"
              style={{ ...input, width: 118 }}
              disabled={d.isClosed}
              value={d.opensAt}
              onChange={(e) =>
                setDays((prev) =>
                  prev.map((x, xi) => (xi === i ? { ...x, opensAt: e.target.value } : x)),
                )
              }
            />
            <span style={help}>to</span>
            <input
              type="time"
              style={{ ...input, width: 118 }}
              disabled={d.isClosed}
              value={d.closesAt}
              onChange={(e) =>
                setDays((prev) =>
                  prev.map((x, xi) => (xi === i ? { ...x, closesAt: e.target.value } : x)),
                )
              }
            />
            {d.split && (
              <span style={{ ...help, color: "var(--cx-warning)" }}>
                this day has a break set — saving here replaces it with one range
              </span>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={form.manualClosed}
            onChange={(e) => set("manualClosed", e.target.checked)}
          />
          Closed until further notice (overrides the hours above)
        </label>
        {form.manualClosed && (
          <input
            style={{ ...input, marginTop: 8 }}
            maxLength={160}
            value={form.manualClosedNote}
            onChange={(e) => set("manualClosedNote", e.target.value)}
            placeholder="Closed for renovation, reopening 20 August"
          />
        )}
      </div>
      </div>
      </div>

      <div style={{ display: tab === "orders" ? "block" : "none" }}>
      <div style={bentoCard}>
          <div style={bentoCardTitle}>Orders &amp; payment</div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={form.pickupEnabled}
            onChange={(e) => set("pickupEnabled", e.target.checked)}
          />
          Pickup from the shop
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={form.deliveryEnabled}
            onChange={(e) => set("deliveryEnabled", e.target.checked)}
          />
          Delivery inside the society
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
          <input
            type="checkbox"
            checked={form.serviceOnly}
            onChange={(e) => set("serviceOnly", e.target.checked)}
          />
          This is a service — no pickup or delivery applies
        </label>
      </div>
      {form.serviceOnly && (
        <div style={{ ...help, marginTop: 8 }}>
          Residents visit or book you directly (salon, tutor, repair, etc.) — nothing to pick
          up or deliver. You can still say how they pay below.
        </div>
      )}

      {form.deliveryEnabled && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
          <div>
            <div style={label}>Delivery note for residents</div>
            <input
              style={input}
              maxLength={240}
              value={form.deliveryNote}
              onChange={(e) => set("deliveryNote", e.target.value)}
              placeholder="Delivered within 30 minutes, Wing A to D only"
            />
          </div>
          <div>
            <div style={label}>Minimum order (₹)</div>
            <input
              style={input}
              type="number"
              min={0}
              value={form.minOrderAmount}
              onChange={(e) => set("minOrderAmount", e.target.value)}
              placeholder="Leave blank for none"
            />
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={label}>How residents pay</div>
        {availableMethods.length === 0 ? (
          <div style={help}>
            Turn on pickup or delivery first &mdash; payment options depend on how the order
            reaches the resident.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {availableMethods.map((m) => (
              <label
                key={m.value}
                style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}
              >
                <input
                  type="checkbox"
                  checked={form.offlinePaymentMethods.includes(m.value)}
                  onChange={() => toggleMethod(m.value)}
                />
                {m.label}
              </label>
            ))}
          </div>
        )}
        <div style={{ ...help, marginTop: 6 }}>
          Orders are paid to the shop directly. The society does not collect this money and
          it never appears on a maintenance bill.
        </div>
      </div>
      </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <Btn variant="primary" disabled={saveMutation.isPending} onClick={save}>
          {saveMutation.isPending ? "Saving…" : "Save what residents see"}
        </Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tab panels
// One panel per drawer tab (PageClient.js's Drawer). Each is a thin wrapper
// so the drawer only has to know tab names, not the fields inside them.

export function OwnerAccessTab({ shop, onBanner }) {
  return (
    <div>
      <div style={{ ...help, marginBottom: 4 }}>
        A resident owner keeps their existing login and gains a Shop profile. A
        non-resident owner gets their own login. The flat record never changes.
      </div>
      <OwnerInvite shop={shop} onBanner={onBanner} />
    </div>
  );
}

