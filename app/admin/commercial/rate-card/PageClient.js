"use client";
import notify from "@/lib/notify";
// app/admin/commercial/rate-card/page.js
//
// FULL REWRITE — commercial fix 2026-08-07.
//
// What was wrong with the old page (and why an admin could not fill it in):
//
//  1. THE CALCULATOR LOOKED LIKE A SETTING. The bottom card said "What one shop
//     would be charged / Area (sq ft)" next to a big rupee figure. Admins typed
//     their rate into the AREA box and assumed they had set a rate. Nothing on
//     screen said the box was a throwaway what-if. It is now an explicit
//     "Test on a real shop" panel that picks an ACTUAL unit from the society and
//     states, in words, that it changes nothing.
//  2. NO SAVE FEEDBACK. Rates saved silently on blur. There was no confirmation,
//     no error surface, no way to know whether Rs 1,120 had actually stuck.
//  3. NO STARTING POINT. The page opened as an empty table and expected the
//     admin to invent "Sinking Fund", "Per Sq Ft", "is this a service charge?"
//     unaided. There is now a one-click standard Indian society starter pack.
//  4. UNEXPLAINED JARGON. "Service charge?", "Non-occ eligible?" and
//     "Percentage" were bare column headers. Each is now labelled in plain
//     language with an inline explanation of what ticking it does to the bill.
//  5. NO DELETE, NO ORDER. A head added by mistake was permanent, and the
//     evaluation order of percentage heads silently depended on alphabetical
//     name order.
//  6. NO READINESS CHECK. Nothing told the admin that half their shops had no
//     carpet area recorded, so per-sq-ft heads would quietly bill Rs 0.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardHead, Pill, Segmented, Btn, Icon } from "../_ui";
import SettingsPanel from "./SettingsPanel";
import { selectHeadsForShop } from "@/lib/commercial/shopChargeApplicability";

const TABS = ["Shop", "Office"];
const GST_THRESHOLD = 7500; // CBIC Circular 109/28/2019 — per unit, per month

const CALC_TYPES = [
  {
    value: "Fixed",
    label: "Fixed amount",
    hint: "Same rupee amount every month, whatever the size of the unit. Use for security, water, housekeeping.",
    unit: "₹ / month",
  },
  {
    value: "Per Sq Ft",
    label: "Per sq ft",
    hint: "Amount is multiplied by the unit's carpet area. Use for maintenance, sinking fund, repair fund.",
    unit: "₹ / sq ft / month",
  },
  {
    value: "Percentage",
    label: "Percentage",
    hint: "A percentage of all the fixed and per-sq-ft charges above. Use for a surcharge on the base bill.",
    unit: "% of base",
  },
];

const calcMeta = (t) => CALC_TYPES.find((c) => c.value === t) || CALC_TYPES[0];
const inr = (n) =>
  Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function Field({ label, hint, children, error }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--cx-fg-2)", marginBottom: 4 }}>{label}</div>
      {children}
      {error ? (
        <div style={{ fontSize: 11, color: "var(--cx-danger)", marginTop: 4 }}>{error}</div>
      ) : hint ? (
        <div style={{ fontSize: 11, color: "var(--cx-fg-4)", marginTop: 4 }}>{hint}</div>
      ) : null}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--cx-border)",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  background: "var(--cx-surface)",
  color: "var(--cx-fg-1)",
};

function Banner({ tone = "info", title, children, action }) {
  const colors = {
    info: { bg: "var(--cx-surface-2)", border: "var(--cx-border)", fg: "var(--cx-fg-2)" },
    warn: { bg: "var(--cx-surface-2)", border: "var(--cx-warning)", fg: "var(--cx-warning)" },
    error: { bg: "var(--cx-surface-2)", border: "var(--cx-danger)", fg: "var(--cx-danger)" },
    ok: { bg: "var(--cx-surface-2)", border: "var(--cx-success, var(--success))", fg: "var(--cx-success, var(--success))" },
  }[tone];
  return (
    <div
      role="status"
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        marginBottom: 14,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div style={{ fontSize: 13, fontWeight: 700, color: colors.fg, marginBottom: children ? 3 : 0 }}>
            {title}
          </div>
        )}
        {children && <div style={{ fontSize: 12.5, color: "var(--cx-fg-2)", lineHeight: 1.5 }}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One editable charge row                                             */
/* ------------------------------------------------------------------ */

function HeadRow({ head, tab, index, total, onSave, onDelete, onMove, saving }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState(null);

  const value = draft !== null ? draft : head;
  const meta = calcMeta(value.calculationType);
  const rate = value.rate?.[tab];
  const blank = rate === null || rate === undefined || rate === "";
  const patch = (p) => setDraft({ ...value, ...p });

  // Everything commits through here so the card never holds unsaved edits.
  const commit = async (override) => {
    const next = override ? { ...value, ...override } : draft;
    if (!next) return;
    setErr(null);
    const num = next.rate?.[tab];
    if (next.calculationType === "Percentage" && Number(num) > 100) {
      setErr(
        `${num}% is more than 100%. If you meant a flat \u20b9${num}, switch "How it is worked out" to Fixed amount.`,
      );
      return;
    }
    try {
      await onSave(head.id, {
        headName: String(next.headName || "").trim(),
        calculationType: next.calculationType,
        rate: { ...head.rate, [tab]: num === "" || num === null ? null : Number(num) },
        isServiceCharge: next.isServiceCharge,
        nonOccupancyEligible: next.nonOccupancyEligible,
        applicability: next.applicability || "All",
        // Only meaningful for a Quantity head; cleared otherwise so a leftover
        // label can never confuse the unit form.
        quantityLabel:
          next.applicability === "Quantity"
            ? String(next.quantityLabel || "").trim() || null
            : null,
      });
      setDraft(null);
    } catch (e) {
      setErr(e?.message || "Could not save this charge. Check your connection and try again.");
    }
  };

  const money =
    value.calculationType === "Percentage"
      ? blank
        ? "--"
        : `${rate}%`
      : blank
        ? "--"
        : `\u20b9${Number(rate).toLocaleString("en-IN")}`;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        border: `1px solid ${blank ? "var(--cx-danger)" : open || hover ? "var(--cx-brand)" : "var(--cx-border)"}`,
        borderRadius: 12,
        background: head.isActive ? "var(--cx-surface)" : "var(--cx-surface-2)",
        opacity: head.isActive ? 1 : 0.7,
        // The lift. transform + shadow only -- nothing that reflows the grid.
        transform: open ? "none" : hover ? "translateY(-2px)" : "none",
        boxShadow: open
          ? "0 6px 24px rgba(15,23,42,0.10)"
          : hover
            ? "0 4px 14px rgba(15,23,42,0.08)"
            : "0 1px 2px rgba(15,23,42,0.04)",
        transition: "transform .16s ease, box-shadow .16s ease, border-color .16s ease",
        overflow: "hidden",
      }}
    >
      {/* ---- Collapsed face: tap anywhere to open ---------------------- */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        style={{ padding: "13px 15px", cursor: "pointer", userSelect: "none" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: "var(--cx-fg-1)", lineHeight: 1.3 }}>
            {value.headName || "Untitled charge"}
          </div>
          <div
            className="cx-num"
            style={{
              fontSize: 17,
              fontWeight: 700,
              whiteSpace: "nowrap",
              color: blank ? "var(--cx-danger)" : "var(--cx-fg-1)",
            }}
          >
            {money}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
          <div style={{ fontSize: 11.5, color: "var(--cx-fg-4)" }}>{meta.unit}</div>
          <div style={{ fontSize: 11, color: "var(--cx-fg-4)" }}>
            {open ? "Tap to close" : "Tap to edit"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {!head.isActive && <Pill tone="draft">Switched off</Pill>}
          {blank && <Pill tone="overdue">No amount</Pill>}
          {value.applicability === "OptIn" && <Pill tone="partial">Opt-in only</Pill>}
          {value.applicability === "Quantity" && (
            <Pill tone="partial">Per {value.quantityLabel || "item allotted"}</Pill>
          )}
          {value.isServiceCharge && <Pill tone="info">Service charge</Pill>}
          {value.nonOccupancyEligible && <Pill tone="neutral">Non-occupancy</Pill>}
        </div>
      </div>

      {/* ---- Expanded body --------------------------------------------- */}
      {open && (
        <div style={{ padding: "0 15px 14px", borderTop: "1px solid var(--cx-border)" }}>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <label style={{ display: "block" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--cx-fg-2)", marginBottom: 4 }}>
                Name on the bill
              </div>
              <input
                style={{ ...inputStyle, fontWeight: 600 }}
                value={value.headName}
                onChange={(e) => patch({ headName: e.target.value })}
                onBlur={() => commit()}
              />
            </label>

            <label style={{ display: "block" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--cx-fg-2)", marginBottom: 4 }}>
                How it is worked out
              </div>
              <select
                style={inputStyle}
                value={value.calculationType}
                onChange={(e) => {
                  patch({ calculationType: e.target.value });
                  commit({ calculationType: e.target.value });
                }}
              >
                {CALC_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "var(--cx-fg-4)", marginTop: 4, lineHeight: 1.5 }}>
                {meta.hint}
              </div>
            </label>

            <label style={{ display: "block" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--cx-fg-2)", marginBottom: 4 }}>
                {tab} amount
              </div>
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 12,
                    color: "var(--cx-fg-4)",
                  }}
                >
                  {value.calculationType === "Percentage" ? "%" : "\u20b9"}
                </span>
                <input
                  style={{ ...inputStyle, paddingLeft: 24 }}
                  type="number"
                  step="0.01"
                  value={rate ?? ""}
                  placeholder="Not set"
                  onChange={(e) =>
                    patch({ rate: { ...value.rate, [tab]: e.target.value } })
                  }
                  onBlur={() => commit()}
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--cx-fg-4)", marginTop: 4 }}>{meta.unit}</div>
            </label>

            {/* Who this charge lands on. Without it, every active head was
                billed to every shop of the class — signage to shops with no
                board, parking to shops with no slot. */}
            <label style={{ display: "block" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--cx-fg-2)", marginBottom: 4 }}>
                Who pays this
              </div>
              <select
                style={inputStyle}
                value={value.applicability || "All"}
                onChange={(e) => {
                  patch({ applicability: e.target.value });
                  commit({ applicability: e.target.value });
                }}
              >
                <option value="All">Every {tab.toLowerCase()} in the society</option>
                <option value="OptIn">Only units that opt in</option>
                <option value="Quantity">Per item allotted to the unit</option>
              </select>
              <div style={{ fontSize: 11, color: "var(--cx-fg-4)", marginTop: 4, lineHeight: 1.5 }}>
                {(value.applicability || "All") === "All"
                  ? "Charged on every bill for this unit type."
                  : (value.applicability === "Quantity"
                      ? "Charged as the amount above x the number recorded on each unit's Charges section. Units with none recorded are not charged."
                      : "Charged only to units you tick on their own Charges section. Nobody is charged until you tick them.")}
              </div>
            </label>

            {value.applicability === "Quantity" && (
              <label style={{ display: "block" }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--cx-fg-2)", marginBottom: 4 }}>
                  What is being counted
                </div>
                <input
                  style={inputStyle}
                  value={value.quantityLabel || ""}
                  placeholder="e.g. reserved parking slots"
                  onChange={(e) => patch({ quantityLabel: e.target.value })}
                  onBlur={() => commit()}
                />
                <div style={{ fontSize: 11, color: "var(--cx-fg-4)", marginTop: 4 }}>
                  Shown next to the number box on each unit.
                </div>
              </label>
            )}

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={!!value.isServiceCharge}
                onChange={(e) => {
                  patch({ isServiceCharge: e.target.checked });
                  commit({ isServiceCharge: e.target.checked });
                }}
              />
              <span style={{ lineHeight: 1.5 }}>
                <b>Counts as a service charge.</b> Non-occupancy is capped at 10% of these.
              </span>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={!!value.nonOccupancyEligible}
                onChange={(e) => {
                  patch({ nonOccupancyEligible: e.target.checked });
                  commit({ nonOccupancyEligible: e.target.checked });
                }}
              />
              <span style={{ lineHeight: 1.5 }}>
                <b>Attracts non-occupancy.</b> Only when the unit is rented out.
              </span>
            </label>
          </div>

          {err && (
            <div
              style={{
                marginTop: 10,
                padding: "8px 10px",
                borderRadius: 7,
                fontSize: 12,
                lineHeight: 1.5,
                background: "var(--cx-danger-soft,var(--danger-bg))",
                border: "1px solid var(--cx-danger)",
                color: "var(--cx-fg-1)",
              }}
            >
              {err}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
              marginTop: 12,
              paddingTop: 10,
              borderTop: "1px solid var(--cx-border)",
            }}
          >
            <div style={{ display: "flex", gap: 4 }}>
              <Btn
                variant="ghost"
                disabled={index === 0}
                onClick={() => onMove(index, -1)}
                title="Move up -- this is the order it prints on the bill"
              >
                Up
              </Btn>
              <Btn
                variant="ghost"
                disabled={index === total - 1}
                onClick={() => onMove(index, 1)}
                title="Move down"
              >
                Down
              </Btn>
            </div>
            <Btn
              variant="danger"
              disabled={saving}
              onClick={async () => {
                if (
                  await notify.confirm(
                    `Remove "${head.headName}" from the rate card?\n\nBills already generated keep it. It just stops appearing on new ones.`,
                    { tone: "danger" },
                  )
                )
                  onDelete(head.id);
              }}
            >
              {saving ? "Removing\u2026" : "Remove"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function CommercialRateCardPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("Shop");
  // "rates"  = the per-charge amounts (this table)
  // "rules"  = GST, interest, funds, non-occupancy, electricity, billing gate
  // Kept as a SEPARATE piece of state from `tab` on purpose: `tab` is passed to
  // the billing-heads API as the unit scope, and it must never become "Rules".
  const [view, setView] = useState("rates");
  const [toast, setToast] = useState(null);
  const [adding, setAdding] = useState(false);
  const [testUnitId, setTestUnitId] = useState("");
  const [newHead, setNewHead] = useState({
    headName: "",
    calculationType: "Fixed",
    rate: "",
    isServiceCharge: true,
    applicability: "All",
    quantityLabel: "",
  });
  const [addErr, setAddErr] = useState(null);

  const flash = (tone, text) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 4000);
  };

  const headsQ = useQuery({
    queryKey: ["commercial-billing-heads"],
    queryFn: () => apiClient.get("/api/commercial/billing-heads"),
    retry: false,
  });
  const flagsQ = useQuery({
    queryKey: ["commercial-flags"],
    queryFn: () => apiClient.get("/api/commercial/flags"),
    retry: false,
  });
  const readyQ = useQuery({
    queryKey: ["commercial-readiness"],
    queryFn: () => apiClient.get("/api/commercial/readiness"),
    retry: false,
  });
  // Shops, not Members — this used to read /api/commercial/units, which is
  // the retired flatType-classification list (see [[units-page-retired]]).
  // A shop's area lives on its own record now, never on a flat, so testing
  // against the old member list picked up stale/wrong units with no area.
  const unitsQ = useQuery({
    queryKey: ["commercial-shops", "billable"],
    queryFn: () => apiClient.get("/api/commercial/shops?billable=1"),
    retry: false,
    // Charge opt-ins are edited on the Shops screen and this preview is
    // exactly where an admin comes back to check "did that take effect?" —
    // a cached answer here is the one place it must never be stale.
    refetchOnMount: "always",
    staleTime: 0,
  });
  // Sinking & repair funds bill from here, not from a rate-card head's own
  // rate — see [[shopChargeApplicability.isFundHead]]. The preview below
  // needs the real number, or it goes back to showing a figure the bill
  // will never actually charge.
  const settingsQ = useQuery({
    queryKey: ["commercial-settings"],
    queryFn: () => apiClient.get("/api/commercial/settings"),
    retry: false,
  });
  const commercialSettings = settingsQ.data?.settings ?? null;

  const allHeads = headsQ.data?.heads ?? [];
  const heads = allHeads.filter((h) => h.categoryScope?.includes(tab));
  const billingOn = flagsQ.data?.flags?.commercialBillingEnabled === true;
  const moduleOff =
    /not enabled/i.test(flagsQ.error?.message || "") || flagsQ.data?.flags?.enabled === false;

  const units = (unitsQ.data?.shops ?? []).filter((u) => u.unitKind === tab);
  const testUnit =
    units.find((u) => String(u.memberId ?? u.id ?? "") === testUnitId) ||
    units[0] ||
    null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["commercial-billing-heads"] });
    qc.invalidateQueries({ queryKey: ["commercial-readiness"] });
  };

  const save = async (id, patch) => {
    const res = await apiClient.put(`/api/commercial/billing-heads/${id}`, patch);
    invalidate();
    flash("ok", "Saved.");
    return res;
  };

  const del = useMutation({
    mutationFn: (id) => apiClient.request(`/api/commercial/billing-heads/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      flash("ok", "Charge removed. Bills already generated are unchanged.");
    },
    onError: (e) => flash("error", e?.message || "Could not remove this charge."),
  });

  const seed = useMutation({
    mutationFn: () => apiClient.post("/api/commercial/billing-heads/seed", { scope: tab }),
    onSuccess: (r) => {
      invalidate();
      flash(
        "ok",
        `Added ${r.created} standard ${tab.toLowerCase()} charge(s). Now check each amount against what your society actually charges.`,
      );
    },
    onError: (e) => flash("error", e?.message || "Could not add the standard charges."),
  });

  const reorder = useMutation({
    mutationFn: (order) => apiClient.request("/api/commercial/billing-heads/reorder", {
      method: "PATCH",
      body: JSON.stringify({ order }),
    }),
    onSuccess: invalidate,
    onError: (e) => flash("error", e?.message || "Could not change the order."),
  });

  const create = useMutation({
    mutationFn: (payload) => apiClient.post("/api/commercial/billing-heads", payload),
    onSuccess: () => {
      setNewHead({
        headName: "",
        calculationType: "Fixed",
        rate: "",
        isServiceCharge: true,
        applicability: "All",
        quantityLabel: "",
      });
      setAdding(false);
      setAddErr(null);
      invalidate();
      flash("ok", "Charge added.");
    },
    onError: (e) => setAddErr(e?.message || "Could not add this charge."),
  });

  const move = (index, delta) => {
    const next = [...heads];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next.map((h, i) => ({ id: h.id, sortOrder: (i + 1) * 10 })));
  };

  // ---- Live estimate on a REAL unit, using the same two-pass rule the
  //      server engine uses (fixed + per-sq-ft first, then percentages on
  //      that base). Order-independent, so it always matches the bill.
  //
  //      Head selection goes through the SAME helper the two server engines
  //      use, so this preview can no longer promise a charge the bill will not
  //      raise (or hide one it will). It also surfaces every head it left off
  //      and why, instead of silently dropping it.
  const estimate = useMemo(() => {
    const area = Number(testUnit?.areaSqft ?? 0);
    const { heads: selected, skipped } = selectHeadsForShop(heads, testUnit, tab);
    const lines = [];
    // SET_IN_RULES_AND_TAX heads (Sinking/Repair) are not really "not
    // charged" — they're charged from Rules & Tax instead of a head rate.
    // The block below adds their real line, so they'd otherwise show up
    // twice: once here saying "excluded", once below with a real amount.
    const notCharged = skipped
      .filter((sk) => sk.code !== "SET_IN_RULES_AND_TAX")
      .map((sk) => ({ name: sk.headName, reason: sk.message }));
    let base = 0;

    for (const { head: h, quantity } of selected) {
      if (h.calculationType === "Percentage") continue;
      const rate = h.rate?.[tab];
      if (rate === null || rate === undefined || rate === "") {
        notCharged.push({
          name: h.headName,
          reason: `No ${tab} amount filled in on the rate card yet.`,
        });
        continue;
      }
      const times = quantity > 1 ? ` × ${quantity}` : "";
      if (h.calculationType === "Per Sq Ft") {
        if (area <= 0) {
          lines.push({ name: h.headName, amount: 0, note: "no carpet area recorded for this unit" });
          continue;
        }
        const amt = Math.round(area * Number(rate) * quantity * 100) / 100;
        lines.push({ name: h.headName, amount: amt, note: `${area} sq ft × ₹${rate}${times}` });
        base += amt;
      } else {
        const amt = Math.round(Number(rate) * quantity * 100) / 100;
        lines.push({ name: h.headName, amount: amt, note: quantity > 1 ? `₹${rate}${times}` : "flat monthly" });
        base += amt;
      }
    }
    for (const { head: h } of selected) {
      if (h.calculationType !== "Percentage") continue;
      const pct = h.rate?.[tab];
      if (pct === null || pct === undefined || pct === "") {
        notCharged.push({
          name: h.headName,
          reason: `No ${tab} percentage filled in on the rate card yet.`,
        });
        continue;
      }
      const amt = Math.round(base * (Number(pct) / 100) * 100) / 100;
      lines.push({ name: h.headName, amount: amt, note: `${pct}% of ₹${inr(base)}` });
    }
    // Sinking & repair are excluded from the head loop above (they are
    // "SET_IN_RULES_AND_TAX" in `skipped`) and added here from the same
    // settings.funds config the real engine bills from — see
    // shopChargeApplicability.isFundHead and lib/commercial/shopBillEngine.js
    // fundLine(). This is the one place these two numbers come from, so the
    // preview can never again show a rate-card figure the bill won't charge.
    for (const [fundKey, label] of [
      ["sinking", "Sinking Fund"],
      ["repair", "Repair & Maintenance Fund"],
    ]) {
      const fund = commercialSettings?.funds?.[fundKey];
      if (!fund?.enabled) {
        notCharged.push({
          name: label,
          reason: `Switched off under Rules & Tax, so ${tab.toLowerCase()}s are not charged this.`,
        });
        continue;
      }
      const value = Number(fund.value) || 0;
      if (value <= 0) continue;
      let amt = 0;
      let note = "";
      if (fund.method === "PerSqFt") {
        if (area <= 0) {
          lines.push({ name: label, amount: 0, note: "no carpet area recorded for this unit" });
          continue;
        }
        amt = Math.round(area * value * 100) / 100;
        note = `${area} sq ft × ₹${value} (Rules & Tax)`;
      } else if (fund.method === "Percent") {
        amt = Math.round(base * (value / 100) * 100) / 100;
        note = `${value}% of ₹${inr(base)} (Rules & Tax)`;
      } else {
        amt = value;
        note = "flat monthly (Rules & Tax)";
      }
      lines.push({ name: label, amount: amt, note });
    }

    const total = lines.reduce((s, l) => s + l.amount, 0);
    return { area, lines, notCharged, total };
  }, [heads, tab, testUnit, commercialSettings]);

  const blockers = (readyQ.data?.issues ?? []).filter((i) => i.severity === "blocker");
  const warnings = (readyQ.data?.issues ?? []).filter((i) => i.severity === "warning");

  return (
    <div className="commercial-scope cx-fade" style={{ padding: "1.75rem 2rem", maxWidth: 1100 }}>
      {/* ---- Header ---------------------------------------------------- */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            fontWeight: 700,
            color: "var(--cx-fg-4)",
            
            letterSpacing: "0.8px",
            marginBottom: 8,
          }}
        >
          <Icon name="indian-rupee" size={11} /> Step 1 of 3 · Shops &amp; offices
        </div>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: "var(--cx-fg-1)", letterSpacing: "-0.018em" }}>
          What your shops and offices pay each month
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--cx-fg-3)", maxWidth: 720, lineHeight: 1.6 }}>
          Add each charge once here, with its amount. Every shop and office bill is
          built from this list. Residential flats are not affected — they keep using{" "}
          <Link href="/admin/billing-config" style={{ color: "var(--cx-brand)", fontWeight: 600 }}>
            Billing Config
          </Link>
          .
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <Btn href="/admin/commercial/shops" variant="secondary" icon="building">
            Step 2 · Check shop areas
          </Btn>
          <Btn href="/admin/generate-bills" variant="primary">
            Step 3 · Generate commercial bills
          </Btn>
        </div>
      </div>

      {/* ---- Switch-level blockers ------------------------------------- */}
      {moduleOff && (
        <Banner
          tone="error"
          title="The commercial module is switched off"
          action={<Btn href="/admin/society-config" variant="primary">Open Society Config</Btn>}
        >
          Nothing you set here will be used until the module is turned on.
        </Banner>
      )}
      {!moduleOff && !billingOn && (
        <Banner
          tone="warn"
          title="Commercial billing is switched off — shops are still billed at residential rates"
          action={<Btn href="/admin/society-config" variant="primary">Open Society Config</Btn>}
        >
          Your rates below are saved, but until you tick <b>Charge shops and offices differently</b>{" "}
          in Society Config, every shop and office keeps getting the normal flat bill.
        </Banner>
      )}

      {/* ---- Readiness ------------------------------------------------- */}
      {blockers.map((i) => (
        <Banner
          key={i.code}
          tone="error"
          title={i.title}
          action={i.fixHref ? <Btn href={i.fixHref} variant="secondary">Fix this</Btn> : null}
        >
          {i.detail} <b>{i.fix}</b>
        </Banner>
      ))}
      {warnings.map((i) => (
        <Banner key={i.code} tone="warn" title={i.title}>
          {i.detail} <b>{i.fix}</b>
        </Banner>
      ))}

      {toast && (
        <Banner tone={toast.tone === "ok" ? "ok" : "error"} title={toast.text} />
      )}

      {/* ---- Shop / Office ---------------------------------------------- */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14, flexWrap: "wrap" }}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "rates", label: "Charges" },
            { value: "rules", label: "Rules & tax" },
          ]}
        />
        {view === "rates" && (
          <>
            <Segmented value={tab} onChange={setTab} options={TABS.map((t) => ({ value: t, label: `${t}s` }))} />
            <span style={{ fontSize: 12, color: "var(--cx-fg-4)" }}>
              {readyQ.data?.counts
                ? `${tab === "Shop" ? readyQ.data.counts.shops : readyQ.data.counts.offices} ${tab.toLowerCase()}(s) in this society`
                : ""}
            </span>
          </>
        )}
      </div>

      {view === "rules" && <SettingsPanel />}

      {view === "rates" && (
        <>

      {/* ---- Empty state with a real starting point --------------------- */}
      {!headsQ.isLoading && heads.length === 0 && (
        <Card style={{ marginBottom: 16, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--cx-fg-1)", marginBottom: 6 }}>
            No {tab.toLowerCase()} charges yet
          </div>
          <p style={{ fontSize: 13, color: "var(--cx-fg-3)", maxWidth: 520, margin: "0 auto 18px", lineHeight: 1.6 }}>
            Start from the charges most housing societies in Maharashtra raise on a{" "}
            {tab.toLowerCase()} — maintenance, sinking fund, repair fund, water, common
            electricity, security, housekeeping{tab === "Shop" ? ", signage" : ", lift"}. You can
            then change any amount, or remove what does not apply.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <Btn variant="primary" icon="plus" disabled={seed.isPending} onClick={() => seed.mutate()}>
              {seed.isPending ? "Adding…" : `Use standard ${tab.toLowerCase()} charges`}
            </Btn>
            <Btn variant="secondary" onClick={() => setAdding(true)}>
              Start from scratch
            </Btn>
          </div>
        </Card>
      )}

      {/* ---- The list --------------------------------------------------- */}
      {heads.length > 0 && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
              gap: 12,
              marginBottom: 14,
              alignItems: "start",
            }}
          >
            {heads.map((h, i) => (
              <HeadRow
                key={h.id}
                head={h}
                tab={tab}
                index={i}
                total={heads.length}
                onSave={save}
                onDelete={(id) => del.mutate(id)}
                onMove={move}
                saving={del.isPending && del.variables === h.id}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <Btn variant="secondary" icon="plus" onClick={() => setAdding((v) => !v)}>
              {adding ? "Cancel" : "Add another charge"}
            </Btn>
            <Btn variant="ghost" disabled={seed.isPending} onClick={() => seed.mutate()}>
              Add any missing standard charges
            </Btn>
          </div>
        </>
      )}

      {/* ---- Add form --------------------------------------------------- */}
      {adding && (
        <Card style={{ marginBottom: 16 }}>
          <CardHead
            title={`New ${tab.toLowerCase()} charge`}
            sub="It will appear on every shop/office bill from the next generation onwards."
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 14 }}>
            <Field label="Charge name" hint="Exactly as it should print on the bill.">
              <input
                style={inputStyle}
                placeholder="e.g. Signage Charges"
                value={newHead.headName}
                onChange={(e) => setNewHead({ ...newHead, headName: e.target.value })}
              />
            </Field>

            <Field label="How is it worked out?" hint={calcMeta(newHead.calculationType).hint}>
              <select
                style={inputStyle}
                value={newHead.calculationType}
                onChange={(e) => setNewHead({ ...newHead, calculationType: e.target.value })}
              >
                {CALC_TYPES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label={`Amount (${calcMeta(newHead.calculationType).unit})`}
              hint={
                newHead.calculationType === "Per Sq Ft"
                  ? "This is the rate per square foot, not the total."
                  : newHead.calculationType === "Percentage"
                    ? "A percentage of the fixed and per-sq-ft charges above."
                    : "The whole amount charged each month."
              }
            >
              <input
                style={inputStyle}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0"
                value={newHead.rate}
                onChange={(e) => setNewHead({ ...newHead, rate: e.target.value })}
              />
            </Field>
          </div>

          <div style={{ marginTop: 14 }}>
            <Field
              label="Who pays this?"
              hint={
                newHead.applicability === "All"
                  ? "Charged on every bill for this unit type."
                  : newHead.applicability === "Quantity"
                    ? "Charged as the amount above x the number recorded on each unit. Units with none recorded are not charged."
                    : "Charged only to units you tick on their own Charges section. Nobody is charged until you tick them."
              }
            >
              <select
                style={inputStyle}
                value={newHead.applicability}
                onChange={(e) => setNewHead({ ...newHead, applicability: e.target.value })}
              >
                <option value="All">Every {tab.toLowerCase()} in the society</option>
                <option value="OptIn">Only units that opt in</option>
                <option value="Quantity">Per item allotted to the unit</option>
              </select>
            </Field>
          </div>

          {newHead.applicability === "Quantity" && (
            <div style={{ marginTop: 14 }}>
              <Field
                label="What is being counted?"
                hint="Shown next to the number box on each unit, e.g. reserved parking slots."
              >
                <input
                  style={inputStyle}
                  placeholder="reserved parking slots"
                  value={newHead.quantityLabel}
                  onChange={(e) => setNewHead({ ...newHead, quantityLabel: e.target.value })}
                />
              </Field>
            </div>
          )}

          <label
            style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: "var(--cx-fg-2)", marginTop: 14, cursor: "pointer" }}
          >
            <input
              type="checkbox"
              checked={newHead.isServiceCharge}
              onChange={(e) => setNewHead({ ...newHead, isServiceCharge: e.target.checked })}
            />
            <span>
              <b>Counts as a service charge</b>
              <span style={{ color: "var(--cx-fg-4)" }}>
                {" "}— tick for maintenance, water, security, housekeeping, common electricity.
                Non-occupancy charges on rented units are capped at 10% of these.
              </span>
            </span>
          </label>

          {addErr && (
            <div style={{ fontSize: 12.5, color: "var(--cx-danger)", marginTop: 12 }}>{addErr}</div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Btn
              variant="primary"
              disabled={create.isPending || newHead.headName.trim().length < 2 || newHead.rate === ""}
              onClick={() =>
                create.mutate({
                  headName: newHead.headName.trim(),
                  categoryScope: [tab],
                  calculationType: newHead.calculationType,
                  rate: { [tab]: Number(newHead.rate) || 0 },
                  isServiceCharge: newHead.isServiceCharge,
                  nonOccupancyEligible: newHead.isServiceCharge,
                  applicability: newHead.applicability,
                  quantityLabel:
                    newHead.applicability === "Quantity"
                      ? newHead.quantityLabel.trim() || null
                      : null,
                  sortOrder: (heads.length + 1) * 10,
                })
              }
            >
              {create.isPending ? "Adding…" : `Add to ${tab.toLowerCase()}s`}
            </Btn>
            <Btn variant="ghost" onClick={() => { setAdding(false); setAddErr(null); }}>
              Cancel
            </Btn>
          </div>
        </Card>
      )}

      {/* ---- Test on a REAL unit --------------------------------------- */}
      {heads.length > 0 && (
        <Card>
          <CardHead
            title="Check it on a real unit"
            sub="A preview only. Nothing on this panel changes any rate or any bill."
          />

          {units.length === 0 ? (
            <Banner tone="warn" title={`No ${tab.toLowerCase()}s are set up in this society yet`}>
              Commercial billing only picks up units on the Shops screen.{" "}
              <Link href="/admin/commercial/shops" style={{ color: "var(--cx-brand)", fontWeight: 600 }}>
                Add a {tab.toLowerCase()}
              </Link>{" "}
              so it can be billed.
            </Banner>
          ) : (
            <>
              <div style={{ maxWidth: 340, marginBottom: 16 }}>
                <Field
                  label={`Pick a ${tab.toLowerCase()}`}
                  hint="The area comes from the shop's own record, not from anything you type here."
                >
                  <select
                    style={inputStyle}
                    value={testUnitId || String(testUnit?.memberId ?? testUnit?.id ?? "")}
                    onChange={(e) => setTestUnitId(e.target.value)}
                  >
                    {units.map((u) => {
                      const uid = String(u.memberId ?? u.id ?? "");
                      return (
                        <option key={uid} value={uid}>
                          {`${u.wing || ""}-${u.shopNo || "?"} · ${u.ownerName || ""}`}
                        </option>
                      );
                    })}
                  </select>
                </Field>
              </div>

              {estimate.area <= 0 && heads.some((h) => h.calculationType === "Per Sq Ft") && (
                <Banner tone="error" title="This unit has no area recorded">
                  Every per-sq-ft charge below will bill ₹0 for it.{" "}
                  <Link href="/admin/commercial/shops" style={{ color: "var(--cx-brand)", fontWeight: 600 }}>
                    Add the area
                  </Link>{" "}
                  before you generate bills.
                </Banner>
              )}

              <div style={{ border: "1px solid var(--cx-border)", borderRadius: 10, overflow: "hidden" }}>
                {estimate.lines.map((l) => (
                  <div
                    key={l.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "9px 14px",
                      borderBottom: "1px solid var(--cx-border)",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ color: "var(--cx-fg-2)" }}>
                      {l.name}
                      <span style={{ color: "var(--cx-fg-4)", fontSize: 11.5 }}> · {l.note}</span>
                    </span>
                    <span className="cx-num" style={{ fontWeight: 600, color: "var(--cx-fg-1)" }}>
                      ₹{inr(l.amount)}
                    </span>
                  </div>
                ))}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    background: "var(--cx-surface-2)",
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: "var(--cx-fg-1)" }}>
                    Monthly bill for {testUnit ? `${testUnit.wing || ""}-${testUnit.shopNo}` : "this unit"}
                    {estimate.area > 0 ? ` (${estimate.area} sq ft)` : ""}
                  </span>
                  <span className="cx-num" style={{ color: "var(--cx-brand)" }}>₹{inr(estimate.total)}</span>
                </div>
              </div>

              {estimate.notCharged.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    border: "1px solid var(--cx-border)",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "8px 12px",
                      background: "var(--cx-surface-2)",
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--cx-fg-2)",
                    }}
                  >
                    Not charged to this unit ({estimate.notCharged.length})
                  </div>
                  {estimate.notCharged.map((n, i) => (
                    <div
                      key={`${n.name}-${i}`}
                      style={{
                        display: "flex",
                        gap: 10,
                        padding: "8px 12px",
                        borderTop: "1px solid var(--cx-border)",
                        fontSize: 12.5,
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "var(--cx-fg-2)", minWidth: 150 }}>
                        {n.name}
                      </span>
                      <span style={{ color: "var(--cx-fg-3)" }}>{n.reason}</span>
                    </div>
                  ))}
                </div>
              )}

              <p style={{ fontSize: 11.5, color: "var(--cx-fg-4)", marginTop: 10, lineHeight: 1.6 }}>
                Arrears and interest are not shown here — they are added when the bill is
                generated. Non-occupancy charge for a rented-out unit is set on that unit&apos;s
occupancy status, using the rate you set under <b>Rules &amp; tax</b>, and is
                always capped at 10% of its service charges.
              </p>

              {estimate.total > GST_THRESHOLD && (
                <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill tone="partial" dot={false}>GST may apply</Pill>
                  <span style={{ fontSize: 12.5, color: "var(--cx-fg-2)" }}>
                    This unit crosses ₹{inr(GST_THRESHOLD)} per month. No tax line is added
                    automatically — if your society is GST-registered, add a GST charge above.
                  </span>
                </div>
              )}
            </>
          )}
        </Card>
      )}
        </>
      )}
    </div>
  );
}
