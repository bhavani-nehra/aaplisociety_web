"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import ExcelPreviewGrid from "../../components/ExcelPreviewGrid";
import notify from "@/lib/notify";
// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) => (Number(n) || 0).toFixed(2);
const periodOf = (m, y) => `${y}-${String(m + 1).padStart(2, "0")}`;
const tw = (n) => parseFloat((Number(n) || 0).toFixed(2));
// ─── shared bill calc (pure) ─────────────────────────────────────────────────
// Returns per-member expected bill breakdown given live DB balance data
function calcExpected({ member, prevData, heads, parkingRates, interestRate, serviceTaxRate }) {
  const area = Number(member.carpetAreaSqft ?? member.builtUpAreaSqft ?? 0);
  const principalBase = prevData.principalBalance ?? 0;
  const remInt = prevData.remInt ?? 0;
  const currInt = principalBase > 0 ? tw((principalBase * interestRate) / 1200) : 0;
  const interestAmount = tw(remInt + currInt);
  const billableSlots = (member.parkingSlots ?? []).filter(s => s.monthlyBilling !== false && s.type !== "Stilt");
  const charges = [];
  heads.forEach(head => {
    if (!head.headName?.trim() || head.isActive === false) return;
    const hl = head.headName.trim().toLowerCase();
    if (hl.includes("parking") || hl.includes("two-wheeler") || hl.includes("four-wheeler") || hl.includes("two wheeler") || hl.includes("four wheeler")) return;
    const rate = parseFloat(head.defaultAmount) || 0;
    if (head.calculationType === "Per Sq Ft") {
      charges.push({ name: head.headName, amount: area * rate, formula: `${area} sqft × ₹${rate} = ₹${area * rate}` });
    } else if (head.calculationType === "Percentage") {
      const base = charges.reduce((s, c) => s + c.amount, 0);
      const amt = tw(base * (rate / 100));
      charges.push({ name: head.headName, amount: amt, formula: `${rate}% of ₹${fmt(base)} = ₹${fmt(amt)}` });
    } else {
      charges.push({ name: head.headName, amount: rate, formula: `Fixed ₹${rate}` });
    }
  });
  billableSlots.forEach(slot => {
    const key = `${slot.type}-${slot.vehicleType}`;
    const amount = parkingRates[key] ?? 0;
    if (amount > 0) charges.push({ name: `${slot.type} Parking - ${slot.vehicleType} (${slot.slotNumber})`, amount, formula: `Fixed ₹${amount}` });
  });
  const subtotal = charges.reduce((s, c) => s + c.amount, 0);
  const serviceTax = serviceTaxRate > 0 ? tw(subtotal * serviceTaxRate / 100) : 0;
  const currentBillTotal = subtotal + serviceTax;
  const advanceCredit = prevData.advanceCredit || 0;
  const rawTotal = (prevData.balance || 0) + currInt + currentBillTotal;
  const grandTotal = tw(Math.max(0, rawTotal - advanceCredit));
  return {
    area, principalBase, remInt, currInt, interestAmount, charges, subtotal, serviceTax,
    currentBillTotal, advanceCredit, rawTotal, grandTotal,
    prevBalance: prevData.balance || 0,
    unpaidBills: prevData.unpaidBills || [],
  };
}
// ─── Expected Bill Panel ──────────────────────────────────────────────────────
function ExpectedPanel({ members, heads, parkingRates, interestRate, serviceTaxRate, billMonth, billYear, label }) {
  const [prevBalances, setPrevBalances] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const fetch_ = useCallback(async () => {
    if (!members.length) return;
    setLoading(true);
    try {
      const res = await apiClient.post("/api/bills/get-previous-balances", {
        memberIds: members.map(m => m._id),
        billMonth: billMonth + 1,
        billYear,
        billDate: `${billYear}-${String(billMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`,
      });
      setPrevBalances(res.balances || {});
    } finally {
      setLoading(false);
    }
  }, [members, billMonth, billYear]);
  useEffect(() => { fetch_(); }, [billMonth, billYear]);
  const member = members.find(m => m._id === selectedId) || members[0];
  const prevData = (prevBalances && member) ? (prevBalances[member._id] || {}) : {};
  const calc = member && prevBalances ? calcExpected({ member, prevData, heads, parkingRates, interestRate, serviceTaxRate }) : null;
  return (
    <div style={{ background: "var(--fg-1)", borderRadius: 12, padding: "1.25rem", height: "100%", minHeight: 400 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <span style={{ color: "var(--accent)", fontSize: "0.75rem", fontWeight: 700, letterSpacing: 1 }}>
          EXPECTED — {label || periodOf(billMonth, billYear)}
        </span>
        <button onClick={fetch_} disabled={loading} style={{ background: "var(--primary)", color: "var(--fg-5)", border: "none", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: "0.7rem" }}>
          {loading ? "..." : "Refresh"}
        </button>
      </div>
      <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid var(--fg-3)", background: "var(--fg-2)", color: "var(--border)", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
        {members.map(m => <option key={m._id} value={m._id}>{m.wing}-{m.flatNo} {m.ownerName}</option>)}
      </select>
      {!calc && <div style={{ color: "var(--fg-3)", fontSize: "0.75rem" }}>{loading ? "Loading..." : "No data"}</div>}
      {calc && (
        <div style={{ fontSize: "0.75rem" }}>
          {/* Previous balance */}
          <div style={{ background: "var(--fg-2)", borderRadius: 8, padding: "0.6rem 0.75rem", marginBottom: "0.5rem" }}>
            <div style={{ color: "var(--fg-4)", marginBottom: 4, fontSize: "0.65rem", fontWeight: 700 }}>CARRY-FORWARD</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--fg-5)" }}>Opening principal</span>
              <span style={{ color: "var(--warning)", fontWeight: 700 }}>₹{fmt(calc.principalBase)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--fg-5)" }}>Carried interest</span>
              <span style={{ color: "var(--danger)" }}>₹{fmt(calc.remInt)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, borderTop: "1px solid var(--fg-3)", paddingTop: 4 }}>
              <span style={{ color: "var(--border-strong)" }}>Prev balance (total owed)</span>
              <span style={{ color: calc.prevBalance > 0 ? "var(--danger)" : "var(--success)", fontWeight: 700 }}>₹{fmt(calc.prevBalance)}</span>
            </div>
          </div>
          {/* Interest this month */}
          <div style={{ background: "var(--fg-2)", borderRadius: 8, padding: "0.6rem 0.75rem", marginBottom: "0.5rem" }}>
            <div style={{ color: "var(--fg-4)", marginBottom: 4, fontSize: "0.65rem", fontWeight: 700 }}>INTEREST THIS MONTH</div>
            {calc.currInt > 0 ? (
              <div style={{ color: "var(--warning)", fontFamily: "monospace" }}>
                ₹{fmt(calc.principalBase)} × {interestRate}% ÷ 12 = ₹{fmt(calc.currInt)}
              </div>
            ) : (
              <div style={{ color: "var(--fg-3)" }}>₹0 (no outstanding principal)</div>
            )}
            {calc.remInt > 0 && (
              <div style={{ color: "var(--fg-5)", marginTop: 2 }}>+ carried ₹{fmt(calc.remInt)} = total ₹{fmt(calc.interestAmount)}</div>
            )}
          </div>
          {/* Current charges */}
          <div style={{ background: "var(--fg-2)", borderRadius: 8, padding: "0.6rem 0.75rem", marginBottom: "0.5rem" }}>
            <div style={{ color: "var(--fg-4)", marginBottom: 4, fontSize: "0.65rem", fontWeight: 700 }}>CURRENT CHARGES ({calc.area} sqft)</div>
            {calc.charges.map((c, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                <span style={{ color: "var(--fg-5)", maxWidth: "65%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.formula}>{c.name}</span>
                <span style={{ color: "var(--border)" }}>₹{fmt(c.amount)}</span>
              </div>
            ))}
            {calc.serviceTax > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--fg-5)" }}>
                <span>Service tax ({serviceTaxRate}%)</span>
                <span>₹{fmt(calc.serviceTax)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--fg-3)", marginTop: 4, paddingTop: 4 }}>
              <span style={{ color: "var(--border-strong)" }}>Current bill total</span>
              <span style={{ color: "var(--accent)", fontWeight: 700 }}>₹{fmt(calc.currentBillTotal)}</span>
            </div>
          </div>
          {/* Grand total formula */}
          <div style={{ background: "var(--primary-press)", borderRadius: 8, padding: "0.75rem", border: "1px solid var(--primary-hover)" }}>
            <div style={{ color: "var(--accent-tint)", fontSize: "0.65rem", fontWeight: 700, marginBottom: 6 }}>GRAND TOTAL FORMULA</div>
            <div style={{ color: "var(--primary-tint)", fontFamily: "monospace", lineHeight: 1.8 }}>
              {calc.prevBalance > 0 && <div>prev ₹{fmt(calc.prevBalance)}</div>}
              {calc.currInt > 0 && <div>+ interest ₹{fmt(calc.currInt)}</div>}
              <div>+ current ₹{fmt(calc.currentBillTotal)}</div>
              {calc.advanceCredit > 0 && <div style={{ color: "var(--success)" }}>− advance ₹{fmt(calc.advanceCredit)}</div>}
              <div style={{ borderTop: "1px solid var(--primary-hover)", marginTop: 4, paddingTop: 4, color: "var(--accent)", fontWeight: 700, fontSize: "0.9rem" }}>
                = ₹{fmt(calc.grandTotal)}
              </div>
            </div>
          </div>
          {/* Unpaid bills list */}
          {calc.unpaidBills.length > 0 && (
            <div style={{ marginTop: "0.5rem", background: "var(--fg-2)", borderRadius: 8, padding: "0.6rem 0.75rem" }}>
              <div style={{ color: "var(--fg-4)", fontSize: "0.65rem", fontWeight: 700, marginBottom: 4 }}>UNPAID BILLS</div>
              {calc.unpaidBills.map((b, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ color: "var(--fg-5)" }}>{b.billPeriodId} ({b.status})</span>
                  <span style={{ color: "var(--danger)" }}>₹{fmt(b.balanceAmount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// ─── Parking Config Panel ─────────────────────────────────────────────────────
function ParkingConfigPanel({ members, heads, parkingRates, interestRate, serviceTaxRate, billMonth, billYear, onSaved }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [editSlots, setEditSlots] = useState([]); // working copy
  const [carpetArea, setCarpetArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [previewBal, setPreviewBal] = useState(null); // prevBalances for this member
  const member = members.find(m => m._id === selectedId);
  // Load member & their balance when selected
  useEffect(() => {
    if (!member) return;
    setEditSlots(member.parkingSlots ? member.parkingSlots.map(s => ({ ...s })) : []);
    setCarpetArea(member.carpetAreaSqft ?? "");
    setPreviewBal(null);
    // fetch their prev balance for live preview
    apiClient.post("/api/bills/get-previous-balances", {
      memberIds: [member._id],
      billMonth: billMonth + 1,
      billYear,
      billDate: `${billYear}-${String(billMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`,
    }).then(r => setPreviewBal(r.balances?.[member._id] || {})).catch(() => {});
  }, [member?._id, billMonth, billYear]);
  const addSlot = () => {
    setEditSlots(prev => [...prev, { slotNumber: "", type: "Open", vehicleType: "Two-Wheeler", monthlyBilling: true, _new: true }]);
  };
  const removeSlot = (idx) => setEditSlots(prev => prev.filter((_, i) => i !== idx));
  const updateSlot = (idx, field, val) =>
    setEditSlots(prev => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  // Live preview calc using editSlots & carpetArea
  const previewMember = member ? { ...member, parkingSlots: editSlots, carpetAreaSqft: Number(carpetArea) || member.carpetAreaSqft } : null;
  const previewCalc = previewMember && previewBal != null
    ? calcExpected({ member: previewMember, prevData: previewBal, heads, parkingRates, interestRate, serviceTaxRate })
    : null;
  const origCalc = member && previewBal != null
    ? calcExpected({ member, prevData: previewBal, heads, parkingRates, interestRate, serviceTaxRate })
    : null;
  const diff = previewCalc && origCalc ? tw(previewCalc.grandTotal - origCalc.grandTotal) : null;
  const save = async () => {
    if (!member) return;
    const hasEmpty = editSlots.some(s => !s.slotNumber?.trim());
    if (hasEmpty) { setMsg({ type: "err", text: "All slots need a slot number" }); return; }
    setBusy(true); setMsg(null);
    try {
      const fullPayload = {
        memberId: member._id,
        flatNo: member.flatNo, wing: member.wing, ownerName: member.ownerName,
        contactNumber: member.contactNumber, carpetAreaSqft: Number(carpetArea) || member.carpetAreaSqft,
        flatType: member.flatType, ownershipType: member.ownershipType,
        parkingSlots: editSlots.map(({ _new, ...s }) => s),
        isActive: member.isActive ?? true, membershipStatus: member.membershipStatus ?? "Active",
        hasVotingRights: member.hasVotingRights ?? true, emailPrimary: member.emailPrimary,
        permanentAddress: member.permanentAddress ?? { country: "India" },
        billingPreferences: member.billingPreferences ?? { emailBill: true, whatsappBill: false, printedBill: false },
        customMaintenanceConfig: member.customMaintenanceConfig ?? { isCustom: false },
        securityDeposit: member.securityDeposit ?? { amount: 0, status: "Pending" },
        specialDiscount: member.specialDiscount ?? { percentage: 0 },
        openingPrincipal: member.openingPrincipal ?? 0, openingInterest: member.openingInterest ?? 0,
        openingBalance: member.openingBalance ?? 0, advanceCredit: member.advanceCredit ?? 0,
        familyMembers: member.familyMembers ?? [], ownerHistory: member.ownerHistory ?? [], tenantHistory: member.tenantHistory ?? [],
      };
      await apiClient.put("/api/members/update", fullPayload);
      await queryClient.invalidateQueries(["members-list"]);
      setMsg({ type: "ok", text: "Saved!" });
      onSaved?.();
    } catch (e) {
      setMsg({ type: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const typeOptions = ["Open", "Covered", "Stilt"];
  const vehicleOptions = ["Two-Wheeler", "Four-Wheeler"];
  return (
    <div style={{ background: "var(--bg-surface)", border: "2px solid var(--bg-muted)" /* TODO: unmapped color, needs design review */, borderRadius: 12, padding: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9rem", color: "var(--danger-fg)" /* TODO: unmapped color, needs design review */ }}>Parking & Area Config</h3>
        {msg && (
          <span style={{ fontSize: "0.75rem", padding: "3px 10px", borderRadius: 5, background: msg.type === "ok" ? "var(--success-bg)" : "var(--danger-bg)", color: msg.type === "ok" ? "var(--success-fg)" : "var(--danger-fg)" }}>
            {msg.text}
          </span>
        )}
      </div>
      {/* Member select */}
      <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setMsg(null); }} style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border-strong)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
        <option value="">-- select member --</option>
        {members.filter(m => !m.isDeleted).map(m => (
          <option key={m._id} value={m._id}>{m.wing}-{m.flatNo} {m.ownerName}</option>
        ))}
      </select>
      {member && (
        <>
          {/* Carpet area */}
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ fontSize: "0.75rem", color: "var(--fg-4)", display: "block", marginBottom: 3 }}>Carpet Area (sqft)</label>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input type="number" value={carpetArea} onChange={e => setCarpetArea(e.target.value)} style={{ flex: 1, padding: "5px 8px", border: "1px solid var(--border-strong)", borderRadius: 6, fontSize: "0.85rem" }} />
              {origCalc && Number(carpetArea) !== member.carpetAreaSqft && (
                <span style={{ fontSize: "0.7rem", color: "var(--warning)" }}>
                  was {member.carpetAreaSqft} sqft
                </span>
              )}
            </div>
          </div>
          {/* Parking slots editor */}
          <div style={{ marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <label style={{ fontSize: "0.75rem", color: "var(--fg-4)", fontWeight: 600 }}>Parking Slots ({editSlots.length})</label>
              <button onClick={addSlot} style={{ fontSize: "0.7rem", padding: "3px 10px", background: "#ec4899" /* TODO: unmapped color, needs design review */, color: "white", border: "none", borderRadius: 5, cursor: "pointer" }}>
                + Add Slot
              </button>
            </div>
            {editSlots.length === 0 && (
              <div style={{ fontSize: "0.75rem", color: "var(--fg-5)", padding: "0.5rem", background: "var(--bg-sunken)", borderRadius: 6, textAlign: "center" }}>No parking slots</div>
            )}
            {editSlots.map((slot, idx) => (
              <div key={idx} style={{ background: slot._new ? "var(--bg-sunken)" /* TODO: unmapped color, needs design review */ : "var(--bg-sunken)", border: `1px solid ${slot._new ? "var(--danger-bg)" /* TODO: unmapped color, needs design review */ : "var(--border)"}`, borderRadius: 8, padding: "0.6rem 0.75rem", marginBottom: "0.4rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto auto", gap: "0.4rem", alignItems: "center" }}>
                  <input
                    value={slot.slotNumber}
                    onChange={e => updateSlot(idx, "slotNumber", e.target.value)}
                    placeholder="P-A-101"
                    style={{ padding: "4px 6px", border: "1px solid var(--border-strong)", borderRadius: 4, fontSize: "0.75rem" }}
                  />
                  <select value={slot.type} onChange={e => updateSlot(idx, "type", e.target.value)} style={{ padding: "4px 6px", border: "1px solid var(--border-strong)", borderRadius: 4, fontSize: "0.75rem" }}>
                    {typeOptions.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <select value={slot.vehicleType} onChange={e => updateSlot(idx, "vehicleType", e.target.value)} style={{ padding: "4px 6px", border: "1px solid var(--border-strong)", borderRadius: 4, fontSize: "0.75rem" }}>
                    {vehicleOptions.map(t => <option key={t}>{t}</option>)}
                  </select>
                  <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: "0.7rem", cursor: "pointer", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={slot.monthlyBilling !== false} onChange={e => updateSlot(idx, "monthlyBilling", e.target.checked)} />
                    Billed
                  </label>
                  <button onClick={() => removeSlot(idx)} style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "none", borderRadius: 4, padding: "3px 7px", cursor: "pointer", fontSize: "0.75rem" }}>✕</button>
                </div>
                {/* Rate preview for this slot */}
                {slot.type !== "Stilt" && slot.monthlyBilling !== false && (
                  <div style={{ marginTop: 3, fontSize: "0.65rem", color: "var(--fg-4)" }}>
                    Rate: ₹{parkingRates[`${slot.type}-${slot.vehicleType}`] ?? 0}/month
                  </div>
                )}
              </div>
            ))}
          </div>
          {/* Live diff preview */}
          {previewCalc && origCalc && (
            <div style={{ background: "var(--accent-tint)", border: "1px solid var(--accent-tint)", borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem", fontSize: "0.78rem" }}>
              <div style={{ fontWeight: 700, color: "var(--accent)", marginBottom: 6, fontSize: "0.7rem" }}>BILL IMPACT PREVIEW</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", textAlign: "center" }}>
                {[
                  ["Before", origCalc.grandTotal, "var(--fg-3)"],
                  ["After", previewCalc.grandTotal, "var(--accent)"],
                  ["Change", diff, diff > 0 ? "var(--danger)" : diff < 0 ? "var(--success)" : "var(--fg-3)"],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background: "var(--bg-surface)", borderRadius: 6, padding: "0.4rem" }}>
                    <div style={{ fontSize: "0.6rem", color: "var(--fg-5)" }}>{l}</div>
                    <div style={{ fontWeight: 700, color: c, fontSize: "0.95rem" }}>{diff !== null && l === "Change" ? (diff > 0 ? "+" : "") : ""}₹{fmt(v)}</div>
                  </div>
                ))}
              </div>
              {/* Changed charges */}
              {previewCalc.charges.map(c => {
                const orig = origCalc.charges.find(o => o.name === c.name);
                if (!orig || orig.amount === c.amount) return null;
                return <div key={c.name} style={{ marginTop: 4, color: "var(--accent)", fontSize: "0.7rem" }}>{c.name}: ₹{fmt(orig.amount)} → ₹{fmt(c.amount)}</div>;
              })}
              {/* New charges */}
              {previewCalc.charges.filter(c => !origCalc.charges.find(o => o.name === c.name)).map(c => (
                <div key={c.name} style={{ marginTop: 4, color: "var(--success)", fontSize: "0.7rem" }}>+ {c.name}: ₹{fmt(c.amount)}</div>
              ))}
              {/* Removed charges */}
              {origCalc.charges.filter(c => !previewCalc.charges.find(o => o.name === c.name)).map(c => (
                <div key={c.name} style={{ marginTop: 4, color: "var(--danger)", fontSize: "0.7rem" }}>− {c.name}: ₹{fmt(c.amount)}</div>
              ))}
            </div>
          )}
          <button onClick={save} disabled={busy} style={{ width: "100%", padding: "8px", background: "#be185d" /* TODO: unmapped color, needs design review */, color: "white", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: "0.85rem", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Saving..." : "Save Member Config"}
          </button>
        </>
      )}
    </div>
  );
}
// ─── Member Stats Bar ─────────────────────────────────────────────────────────
function MemberStatsBar({ members, onRefresh }) {
  return (
    <div style={{ background: "var(--fg-2)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <span style={{ color: "var(--fg-5)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: 1 }}>LIVE MEMBER BALANCES</span>
        <button onClick={onRefresh} style={{ background: "var(--fg-3)", color: "var(--border)", border: "none", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: "0.7rem" }}>Refresh</button>
      </div>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
        {members.map(m => (
          <div key={m._id} style={{ background: "var(--fg-1)", borderRadius: 7, padding: "0.5rem 0.75rem", minWidth: 150 }}>
            <div style={{ color: "var(--bg-canvas)", fontWeight: 700, fontSize: "0.75rem", marginBottom: 3 }}>{m.wing}-{m.flatNo} {m.ownerName}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[["P", m.openingPrincipal ?? 0, "var(--warning)"], ["I", m.openingInterest ?? 0, "var(--danger)"], ["Adv", m.advanceCredit ?? 0, "var(--success)"]].map(([l, v, c]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: "0.55rem", color: "var(--fg-3)" }}>{l}</div>
                  <div style={{ fontSize: "0.8rem", fontWeight: 700, color: c }}>₹{fmt(v)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
// ─── Ledger Strip ─────────────────────────────────────────────────────────────
function LedgerStrip({ members }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!members?.length) return;
    setLoading(true);
    try {
      const ids = members.map(m => m._id);
      const results = await Promise.all(
        ids.map(id => apiClient.get(`/api/ledger?memberId=${id}&limit=5`).catch(() => ({ transactions: [] })))
      );
      const flat = [];
      ids.forEach((id, i) => {
        const m = members.find(mb => mb._id === id);
        (results[i]?.transactions || []).forEach(t => flat.push({ ...t, memberLabel: `${m?.wing}-${m?.flatNo}` }));
      });
      flat.sort((a, b) => new Date(b.date || b.createdAt) - new Date(a.date || a.createdAt));
      setRows(flat.slice(0, 20));
    } finally { setLoading(false); }
  }, [members]);
  useEffect(() => { load(); }, [members]);
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem", marginTop: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h4 style={{ margin: 0, fontSize: "0.8rem", color: "var(--fg-3)" }}>Ledger (last 20)</h4>
        <button onClick={load} disabled={loading} style={{ fontSize: "0.7rem", padding: "3px 8px", border: "1px solid var(--border-strong)", borderRadius: 5, cursor: "pointer", background: "var(--bg-sunken)" }}>{loading ? "..." : "Refresh"}</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
          <thead>
            <tr style={{ background: "var(--bg-muted)" }}>
              {["Date", "Member", "Type", "Description", "Amount", "Balance"].map(h => (
                <th key={h} style={{ padding: "5px 8px", textAlign: "left", border: "1px solid var(--border)", color: "var(--fg-3)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-sunken)" }}>
                <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", whiteSpace: "nowrap" }}>{new Date(r.date || r.createdAt).toLocaleDateString("en-IN")}</td>
                <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", fontWeight: 600 }}>{r.memberLabel}</td>
                <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)" }}>
                  <span style={{ background: r.type === "Debit" ? "var(--danger-bg)" : "var(--success-bg)", color: r.type === "Debit" ? "var(--danger)" : "var(--success)", padding: "1px 5px", borderRadius: 3 }}>{r.type}</span>
                </td>
                <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.description}</td>
                <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "right", fontWeight: 600, color: r.type === "Debit" ? "var(--danger)" : "var(--success)" }}>
                  {r.type === "Debit" ? "+" : "-"}₹{fmt(r.amount)}
                </td>
                <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "right", fontWeight: 700 }}>₹{fmt(r.balanceAfterTransaction)}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && <tr><td colSpan={6} style={{ padding: "1rem", textAlign: "center", color: "var(--fg-5)", fontSize: "0.75rem" }}>No ledger entries</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
// ─── Bills Table ──────────────────────────────────────────────────────────────
function BillsTable({ members, refreshTick }) {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/api/billing/generated");
      setBills(res.bills || []);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [refreshTick]);
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "1rem", marginTop: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <h4 style={{ margin: 0, fontSize: "0.8rem", color: "var(--fg-3)" }}>All Bills ({bills.length})</h4>
        <button onClick={load} disabled={loading} style={{ fontSize: "0.7rem", padding: "3px 8px", border: "1px solid var(--border-strong)", borderRadius: 5, cursor: "pointer", background: "var(--bg-sunken)" }}>{loading ? "..." : "Refresh"}</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
          <thead>
            <tr style={{ background: "var(--bg-muted)" }}>
              {["Period", "Member", "PrevBal", "Interest", "CurrTotal", "Total", "Paid", "Balance", "Due", "Status"].map(h => (
                <th key={h} style={{ padding: "5px 8px", textAlign: "right", border: "1px solid var(--border)", color: "var(--fg-3)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bills.map((b, i) => {
              const pop = b.memberId?._id ? b.memberId : null;
              const rawId = pop?._id || b.memberId;
              const mem = members.find(m => String(m._id) === String(rawId));
              const label = pop ? `${pop.wing}-${pop.flatNo}` : mem ? `${mem.wing}-${mem.flatNo}` : "?";
              const sc = b.status === "Paid" ? "var(--success)" : b.status === "Partial" ? "var(--warning)" : b.status === "Overdue" ? "var(--danger)" : "var(--fg-4)";
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? "var(--bg-surface)" : "var(--bg-sunken)" }}>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", fontWeight: 600 }}>{b.billPeriodId}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", fontWeight: 600 }}>{label}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "right", color: Number(b.previousBalance) > 0 ? "var(--danger)" : "var(--fg-3)" }}>₹{fmt(b.previousBalance)}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "right" }}>₹{fmt(b.interestAmount)}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "right" }}>₹{fmt(b.currentBillTotal)}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "right", fontWeight: 700 }}>₹{fmt(b.totalAmount)}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "right", color: "var(--success)" }}>₹{fmt(b.amountPaid)}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "right", fontWeight: 700, color: Number(b.balanceAmount) > 0 ? "var(--danger)" : "var(--success)" }}>₹{fmt(b.balanceAmount)}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "right" }}>{b.dueDate ? new Date(b.dueDate).toLocaleDateString("en-IN") : "-"}</td>
                  <td style={{ padding: "4px 8px", border: "1px solid var(--bg-muted)", textAlign: "center" }}>
                    <span style={{ background: sc, color: "#fff", padding: "1px 6px", borderRadius: 3, fontWeight: 600 }}>{b.status}</span>
                  </td>
                </tr>
              );
            })}
            {bills.length === 0 && !loading && <tr><td colSpan={10} style={{ padding: "1rem", textAlign: "center", color: "var(--fg-5)" }}>No bills yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
// ─── Main ─────────────────────────────────────────────────────────────────────
export default function BillingTestPage() {
  const queryClient = useQueryClient();
  const NOW = new Date();
  const [billMonth, setBillMonth] = useState(NOW.getMonth());
  const [billYear, setBillYear] = useState(NOW.getFullYear());
  const [phase, setPhase] = useState("idle");
  const [previewData, setPreviewData] = useState(null);
  const [excelValidation, setExcelValidation] = useState(null);
  const [billGrid, setBillGrid] = useState(null);
  const [payGrid, setPayGrid] = useState(null);
  const [payBatchKey, setPayBatchKey] = useState(null);
  const [statusLog, setStatusLog] = useState([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [approvedDiffs, setApprovedDiffs] = useState(new Set());
  const [showBills, setShowBills] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [rightPanel, setRightPanel] = useState("expected"); // "expected" | "parking"
  const fileRef = useRef();
  const log = (msg, type = "info") =>
    setStatusLog(prev => [{ msg, type, t: new Date().toLocaleTimeString() }, ...prev].slice(0, 50));
  const { data: societyData } = useQuery({ queryKey: ["society-config"], queryFn: () => apiClient.get("/api/society/config") });
  const { data: membersData, refetch: refetchMembers } = useQuery({ queryKey: ["members-list"], queryFn: () => apiClient.get("/api/members/list?limit=1000") });
  const { data: billingHeadsData } = useQuery({ queryKey: ["billing-heads"], queryFn: () => apiClient.get("/api/billing-heads/list") });
  const society = societyData?.society || {};
  const config = society.config || {};
  const members = (membersData?.members || []).filter(m => !m.isDeleted);
  const heads = billingHeadsData?.heads || [];
  const periodLabel = periodOf(billMonth, billYear);
  const parkingRates = config.parkingRates ?? { "Open-Two-Wheeler": 100, "Open-Four-Wheeler": 150, "Covered-Two-Wheeler": 200, "Covered-Four-Wheeler": 300 };
  const interestRate = parseFloat(config.interestRate) || 0;
  const serviceTaxRate = parseFloat(config.serviceTaxRate) || 0;
  const dueDate = new Date(billYear, billMonth + 1, config.billDueDay || 10).toISOString().split("T")[0];
  // ── build preview ─────────────────────────────────────────────────────────
  const buildPreview = useCallback(async () => {
    setPhase("previewing"); log("Fetching previous balances...");
    try {
      const res = await apiClient.post("/api/bills/get-previous-balances", {
        memberIds: members.map(m => m._id), billMonth: billMonth + 1, billYear,
        billDate: `${billYear}-${String(billMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`,
      });
      const prevBal = res.balances || {};
      const preview = members.map(member => {
        const prevData = prevBal[member._id] || {};
        const calc = calcExpected({ member, prevData, heads, parkingRates, interestRate, serviceTaxRate });
        return {
          memberId: member._id,
          member: `${member.wing}-${member.flatNo}`,
          memberName: member.ownerName,
          ...calc,
          unpaidBills: calc.unpaidBills,
          recentTransactions: prevData.recentTransactions || [],
        };
      });
      preview.sort((a, b) => {
        const wc = (a.member.split("-")[0] ?? "").localeCompare(b.member.split("-")[0] ?? "");
        return wc !== 0 ? wc : Number(a.member.split("-")[1]) - Number(b.member.split("-")[1]);
      });
      setPreviewData(preview);
      setPhase("bill-ready");
      log(`Preview ready for ${preview.length} members`, "ok");
    } catch (e) { log("Preview failed: " + e.message, "err"); setPhase("idle"); }
  }, [members, billMonth, billYear, heads, interestRate, serviceTaxRate, parkingRates]);
  // ── generate bills ────────────────────────────────────────────────────────
  const generateBills = useCallback(async (force = false) => {
    if (!previewData) return;
    setPhase("previewing"); log("Generating bills...");
    const payload = {
      billMonth, billYear, dueDate,
      bills: previewData.map(b => ({
        memberId: b.memberId, totalAmount: b.grandTotal,
        previousBalance: b.prevBalance || 0, interestAmount: b.interestAmount || 0,
        subtotal: b.subtotal || 0, serviceTax: b.serviceTax || 0,
        currentBillTotal: b.currentBillTotal || 0,
        breakdown: Object.fromEntries(b.charges.map(c => [c.name, c.amount])),
        unpaidBills: b.unpaidBills, recentTransactions: b.recentTransactions,
      })),
      ...(force ? { forceRegenerate: true } : {}),
    };
    try {
      const res = await apiClient.post("/api/bills/generate-final", payload);
      log(`Generated ${res.billsGenerated ?? res.count ?? 0} bills for ${periodLabel}`, "ok");
      setPhase("done-gen"); setRefreshTick(t => t + 1);
    } catch (e) {
      if (e.status === 409 || e.message?.includes("already exist")) {
        if (await notify.confirm(`Bills for ${periodLabel} already exist. Force regenerate?`, { tone: "danger" })) generateBills(true);
        else setPhase("bill-ready");
      } else { log("Generate failed: " + e.message, "err"); setPhase("bill-ready"); }
    }
  }, [previewData, billMonth, billYear, dueDate, periodLabel]);
  // ── download template ─────────────────────────────────────────────────────
  const downloadTemplate = useCallback(async () => {
    setPhase("downloading"); log("Downloading template...");
    try {
      const res = await fetch(`/api/billing/excel-template?month=${billMonth + 1}&year=${billYear}&memberIds=${encodeURIComponent(members.map(m => m._id).join(","))}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `BillTemplate_${periodLabel}.xlsx`; a.click();
      URL.revokeObjectURL(url);
      log("Template downloaded", "ok"); setPhase("done-gen");
    } catch (e) { log("Download failed: " + e.message, "err"); setPhase("done-gen"); }
  }, [members, billMonth, billYear, periodLabel]);
  // ── validate excel ────────────────────────────────────────────────────────
  const runValidation = useCallback(async (file) => {
    setPhase("validating"); setBillGrid(null); setPayGrid(null); setExcelValidation(null); setApprovedDiffs(new Set());
    log("Validating file...");
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("month", String(billMonth + 1)); fd.append("year", String(billYear));
      const res = await fetch("/api/billing/validate-excel", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      setExcelValidation(data);
      if (data.gridRows && data.gridColumns) setBillGrid({ gridRows: data.gridRows, columns: data.gridColumns });
      // Mode is per-row now: data.bills = rows to generate, data.alreadyBilledRows
      // = rows already billed (payment-only). A file can contain both.
      const isPaymentOnly = (data.bills?.length ?? 0) === 0 && (data.alreadyBilledRows?.length ?? 0) > 0;
      log(`Validation: generate=${data.bills?.length ?? 0} alreadyBilled=${data.alreadyBilledRows?.length ?? 0}, errors=${data.errorCount}`, data.errorCount > 0 ? "err" : "ok");
      setPhase(isPaymentOnly ? "payment-preview-ready" : "validated");
      // if every row is already billed, auto-send to payment preview
      if (isPaymentOnly) {
        const fd2 = new FormData(); fd2.append("file", file);
        const r2 = await fetch("/api/billing/upload-payments?action=preview", { method: "POST", body: fd2, credentials: "include" });
        const d2 = await r2.json();
        if (r2.ok) {
          setPayBatchKey(d2.batchKey);
          if (d2.gridRows && d2.gridColumns) setPayGrid({ gridRows: d2.gridRows, columns: d2.gridColumns });
          log(`Payment preview ready: ${d2.count ?? d2.gridRows?.length ?? 0} rows`, "ok");
          setPhase("payment-preview");
        }
      }
    } catch (e) { log("Validation error: " + e.message, "err"); setPhase("done-gen"); }
  }, [billMonth, billYear]);
  // ── generate from excel ───────────────────────────────────────────────────
  const generateFromExcel = useCallback(async (force = false) => {
    if (!excelValidation?.bills?.length) return;
    setPhase("previewing"); log("Generating from Excel...");
    try {
      const res = await apiClient.post("/api/billing/generate-from-excel", { billMonth, billYear, dueDate, bills: excelValidation.bills, ...(force ? { forceRegenerate: true } : {}) });
      log(`Generated ${res.count} bills from Excel`, "ok");
      setPhase("done-gen"); setRefreshTick(t => t + 1); setExcelValidation(null); setBillGrid(null);
    } catch (e) {
      if (e.status === 409 || e.message?.includes("already exist")) {
        if (await notify.confirm(`Bills for ${periodLabel} exist. Force?`, { tone: "danger" })) generateFromExcel(true);
        else setPhase("validated");
      } else { log("Excel gen failed: " + e.message, "err"); setPhase("validated"); }
    }
  }, [excelValidation, billMonth, billYear, dueDate, periodLabel]);
  // ── confirm payments ──────────────────────────────────────────────────────
  const confirmPayments = useCallback(async () => {
    if (!payBatchKey) return;
    setPhase("confirming"); log("Confirming payments...");
    try {
      const res = await fetch("/api/billing/upload-payments?action=confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchKey: payBatchKey, notes: "" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      log(`Payments confirmed: ${data.processed ?? data.count ?? ""} processed`, "ok");
      setPhase("payments-done"); setRefreshTick(t => t + 1); await refetchMembers();
    } catch (e) { log("Confirm failed: " + e.message, "err"); setPhase("payment-preview"); }
  }, [payBatchKey, refetchMembers]);
  // ── auto generate next month ──────────────────────────────────────────────
  const autoGenNext = useCallback(async () => {
    const nextDate = new Date(billYear, billMonth + 1, 1);
    const nm = nextDate.getMonth(), ny = nextDate.getFullYear();
    const nextPeriod = periodOf(nm, ny);
    const nextDue = new Date(ny, nm + 1, config.billDueDay || 10).toISOString().split("T")[0];
    setPhase("previewing"); log(`Auto-generating ${nextPeriod}...`);
    try {
      const prevRes = await apiClient.post("/api/bills/get-previous-balances", {
        memberIds: members.map(m => m._id), billMonth: nm + 1, billYear: ny,
        billDate: `${ny}-${String(nm + 1).padStart(2, "0")}-01T00:00:00.000Z`,
      });
      const prevBal = prevRes.balances || {};
      const bills = members.map(member => {
        const prevData = prevBal[member._id] || {};
        const calc = calcExpected({ member, prevData, heads, parkingRates, interestRate, serviceTaxRate });
        return {
          memberId: member._id, totalAmount: calc.grandTotal, previousBalance: calc.prevBalance,
          advanceCredit: calc.advanceCredit, interestAmount: calc.interestAmount,
          subtotal: calc.subtotal, serviceTax: calc.serviceTax, currentBillTotal: calc.currentBillTotal,
          breakdown: Object.fromEntries(calc.charges.map(c => [c.name, c.amount])),
          unpaidBills: calc.unpaidBills, recentTransactions: prevData.recentTransactions || [],
        };
      });
      await apiClient.post("/api/bills/generate-final", { billMonth: nm, billYear: ny, dueDate: nextDue, bills });
      log(`Auto-generated ${bills.length} bills for ${nextPeriod}`, "ok");
      setBillMonth(nm); setBillYear(ny);
      setPhase("done-gen"); setPreviewData(null); setExcelValidation(null); setBillGrid(null); setPayGrid(null);
      setRefreshTick(t => t + 1);
    } catch (e) { log("Auto-gen failed: " + e.message, "err"); setPhase("payments-done"); }
  }, [members, billMonth, billYear, heads, interestRate, serviceTaxRate, parkingRates, config]);
  // ── export ────────────────────────────────────────────────────────────────
  const exportBills = useCallback(async () => {
    log("Exporting...");
    try {
      const res = await fetch("/api/bills/export?format=excel", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `AllBills_${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
      URL.revokeObjectURL(url); log("Exported", "ok");
    } catch (e) { log("Export failed: " + e.message, "err"); }
  }, []);
  const phaseLabel = { idle: "Ready", previewing: "Working...", "bill-ready": "Preview Ready", downloading: "Downloading", "done-gen": "Bills Generated", validating: "Validating...", validated: "Validated", "payment-preview-ready": "Payment Ready", "payment-preview": "Payment Preview", confirming: "Confirming...", "payments-done": "Payments Done" }[phase] || phase;
  const phaseColor = ["previewing", "downloading", "validating", "confirming"].includes(phase) ? "var(--warning)" : ["done-gen", "payments-done"].includes(phase) ? "var(--success)" : ["bill-ready", "validated", "payment-preview-ready", "payment-preview"].includes(phase) ? "var(--primary)" : "var(--fg-4)";
  const diffIssues = excelValidation?.issues?.filter(i => i.type === "diff") || [];
  const allDiffsApproved = diffIssues.length === 0 || diffIssues.every(d => approvedDiffs.has(d.memberId));
  const canGenFromExcel = allDiffsApproved && excelValidation?.canProceed !== false && (excelValidation?.bills?.length ?? 0) > 0;
  return (
    <div style={{ maxWidth: 1600, margin: "0 auto", padding: 0 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.3rem", color: "var(--fg-2)" }}>Billing Test Console</h1>
          <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "var(--fg-4)" }}>
            {society.name || "—"} | {periodLabel} | IR: {interestRate}% | ST: {serviceTaxRate}%
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ background: phaseColor, color: "var(--on-solid)", padding: "3px 12px", borderRadius: 20, fontSize: "0.75rem", fontWeight: 700 }}>{phaseLabel}</span>
          <button onClick={() => setShowBills(s => !s)} style={{ padding: "5px 12px", border: `2px solid var(--success)`, background: showBills ? "var(--success)" : "white", color: showBills ? "white" : "var(--success)", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: "0.75rem" }}>Bills</button>
          <button onClick={() => setShowLedger(s => !s)} style={{ padding: "5px 12px", border: `2px solid var(--warning)`, background: showLedger ? "var(--warning)" : "white", color: showLedger ? "white" : "var(--warning)", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: "0.75rem" }}>Ledger</button>
          <button onClick={exportBills} style={{ padding: "5px 12px", border: "2px solid var(--fg-3)", background: "white", color: "var(--fg-3)", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: "0.75rem" }}>Export Excel</button>
        </div>
      </div>
      {/* ── Member Stats ── */}
      <MemberStatsBar members={members} onRefresh={refetchMembers} />
      {/* ── Main 2-column layout ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "0.75rem", alignItems: "start" }}>
        {/* ── LEFT: Flow panel ── */}
        <div style={{ background: "var(--bg-surface)", border: "2px solid var(--accent-tint)", borderRadius: 12, padding: "1.25rem" }}>
          {/* Period selector + step buttons */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: "0.95rem", color: "var(--primary)" }}>Flow — {periodLabel}</h2>
            <select value={billMonth} onChange={e => { setBillMonth(parseInt(e.target.value)); setPhase("idle"); setPreviewData(null); }} style={{ padding: "4px 7px", border: "1px solid var(--border-strong)", borderRadius: 5, fontSize: "0.8rem" }}>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i}>{new Date(2000, i).toLocaleString("default", { month: "long" })}</option>
              ))}
            </select>
            <input type="number" value={billYear} onChange={e => { setBillYear(parseInt(e.target.value)); setPhase("idle"); setPreviewData(null); }} min={2020} max={2035} style={{ width: 75, padding: "4px 7px", border: "1px solid var(--border-strong)", borderRadius: 5 }} />
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {[
              ["1. Preview Bills", buildPreview, "var(--primary)", phase === "previewing"],
              ["2. Generate Bills", () => generateBills(false), "var(--success)", !previewData || phase === "previewing"],
              ["3. Download Template", downloadTemplate, "#7c3aed" /* TODO: unmapped color, needs design review */, phase === "downloading"],
            ].map(([label, fn, bg, disabled]) => (
              <button key={label} onClick={fn} disabled={disabled}
                style={{ padding: "7px 14px", background: bg, color: "white", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", opacity: disabled ? 0.45 : 1 }}>
                {label}
              </button>
            ))}
            <label style={{ padding: "7px 14px", background: "#0891b2" /* TODO: unmapped color, needs design review */, color: "var(--on-solid)", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", display: "inline-flex", alignItems: "center" }}>
              4. Upload Template
              <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} ref={fileRef} onChange={e => { const f = e.target.files?.[0]; if (f) { runValidation(f); e.target.value = ""; } }} />
            </label>
            {phase === "payment-preview" && payBatchKey && (
              <button onClick={confirmPayments} disabled={phase === "confirming"}
                style={{ padding: "7px 14px", background: "var(--warning)", color: "var(--on-solid)", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: "0.8rem", opacity: phase === "confirming" ? 0.6 : 1 }}>
                5. Confirm Payments
              </button>
            )}
            {(phase === "payments-done" || phase === "done-gen") && (
              <button onClick={autoGenNext} style={{ padding: "7px 14px", background: "var(--danger)", color: "var(--on-solid)", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: "0.8rem" }}>
                Auto-Gen Next Month →
              </button>
            )}
          </div>
          {/* Preview table */}
          {previewData && (
            <div style={{ overflowX: "auto", marginBottom: "0.75rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
                <thead>
                  <tr style={{ background: "var(--accent-tint)" }}>
                    {["Member", "Area", "PrevBal", "PrevInt", "CurrInt", "Subtotal", "Tax", "CurrTotal", "Advance", "Grand Total"].map(h => (
                      <th key={h} style={{ padding: "5px 8px", border: "1px solid var(--accent-tint)", color: "var(--primary)", textAlign: "right", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.map((b, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? "var(--bg-surface)" : "var(--accent-tint)" }}>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", fontWeight: 600, whiteSpace: "nowrap" }}>{b.member} {b.memberName}</td>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", textAlign: "right" }}>{b.area}</td>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", textAlign: "right", color: b.prevBalance > 0 ? "var(--danger)" : "var(--fg-3)" }}>₹{fmt(b.prevBalance)}</td>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", textAlign: "right" }}>₹{fmt(b.remInt)}</td>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", textAlign: "right" }}>₹{fmt(b.currInt)}</td>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", textAlign: "right" }}>₹{fmt(b.subtotal)}</td>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", textAlign: "right" }}>₹{fmt(b.serviceTax)}</td>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", textAlign: "right" }}>₹{fmt(b.currentBillTotal)}</td>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", textAlign: "right", color: "var(--success)" }}>₹{fmt(b.advanceCredit)}</td>
                      <td style={{ padding: "4px 8px", border: "1px solid var(--accent-tint)", textAlign: "right", fontWeight: 700, color: "var(--info)" }}>₹{fmt(b.grandTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Validation results */}
          {excelValidation && (
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                {[["Errors", "var(--danger)", excelValidation.errorCount], ["Warnings", "var(--warning)", excelValidation.warningCount], ["Dups", "#7c3aed" /* TODO: unmapped color, needs design review */, excelValidation.duplicateCount]].map(([l, c, v]) => (
                  <span key={l} style={{ border: `2px solid ${c}`, color: c, padding: "3px 10px", borderRadius: 5, fontWeight: 700, fontSize: "0.8rem", background: "white" }}>{v} {l}</span>
                ))}
                <span style={{ border: "2px solid var(--success)", color: "var(--success-fg)", padding: "3px 10px", borderRadius: 5, fontWeight: 700, fontSize: "0.8rem", background: "var(--success-bg)" }}>
                  gen={excelValidation.bills?.length ?? 0} alreadyBilled={excelValidation.alreadyBilledRows?.length ?? 0}
                </span>
                {canGenFromExcel && (
                  <button onClick={() => generateFromExcel(false)} style={{ padding: "5px 14px", background: "var(--success)", color: "var(--on-solid)", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.8rem" }}>
                    Generate Bills from Excel
                  </button>
                )}
              </div>
              {diffIssues.length > 0 && (
                <div style={{ background: "var(--warning-bg)", border: "2px solid var(--warning)", borderRadius: 8, padding: "0.75rem" }}>
                  <div style={{ fontWeight: 700, color: "var(--warning-fg)", marginBottom: "0.4rem", fontSize: "0.8rem" }}>{diffIssues.length} Mismatches — approve each:</div>
                  {diffIssues.map((issue, i) => (
                    <label key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.3rem", cursor: "pointer", fontSize: "0.78rem" }}>
                      <input type="checkbox" checked={approvedDiffs.has(issue.memberId)} onChange={e => setApprovedDiffs(prev => { const n = new Set(prev); e.target.checked ? n.add(issue.memberId) : n.delete(issue.memberId); return n; })} />
                      <strong>{issue.flat}</strong> — Excel: ₹{issue.excelTotal} | System: ₹{issue.autoTotal} | Diff: ₹{issue.diff}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          {billGrid && (
            <ExcelPreviewGrid title={`Template Preview — ${periodLabel}`} columns={billGrid.columns} rows={billGrid.gridRows}
              onReupload={() => { setExcelValidation(null); setBillGrid(null); setApprovedDiffs(new Set()); }}
              onContinue={() => {}}
              onCancel={() => { setExcelValidation(null); setBillGrid(null); setApprovedDiffs(new Set()); }} />
          )}
          {payGrid && (
            <div style={{ marginTop: "0.75rem" }}>
              <ExcelPreviewGrid title="Payment Upload Preview" columns={payGrid.columns} rows={payGrid.gridRows}
                onReupload={() => { setPayGrid(null); setPayBatchKey(null); setPhase("done-gen"); }}
                onContinue={confirmPayments}
                onCancel={() => { setPayGrid(null); setPayBatchKey(null); setPhase("done-gen"); }} />
            </div>
          )}
          {/* Status log */}
          <div style={{ background: "var(--fg-1)", borderRadius: 8, padding: "0.75rem", maxHeight: 130, overflowY: "auto", marginTop: "0.75rem" }}>
            <div style={{ color: "var(--fg-3)", fontSize: "0.65rem", marginBottom: "0.3rem", fontWeight: 700 }}>LOG</div>
            {statusLog.length === 0 && <div style={{ color: "var(--fg-3)", fontSize: "0.7rem" }}>No events yet</div>}
            {statusLog.map((e, i) => (
              <div key={i} style={{ fontSize: "0.7rem", color: e.type === "err" ? "var(--danger)" : e.type === "ok" ? "var(--success)" : "var(--fg-4)", marginBottom: 1 }}>
                <span style={{ color: "var(--fg-3)", marginRight: 6 }}>{e.t}</span>{e.msg}
              </div>
            ))}
          </div>
        </div>
        {/* ── RIGHT: Expected + Parking tabs ── */}
        <div>
          {/* Tab switcher */}
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }}>
            {[["expected", "Expected Bill"], ["parking", "Parking Config"]].map(([key, label_]) => (
              <button key={key} onClick={() => setRightPanel(key)}
                style={{ flex: 1, padding: "6px", border: `2px solid ${rightPanel === key ? "var(--primary)" : "var(--accent-tint)"}`, background: rightPanel === key ? "var(--primary)" : "var(--accent-tint)", color: rightPanel === key ? "white" : "var(--primary)", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: "0.78rem" }}>
                {label_}
              </button>
            ))}
          </div>
          {rightPanel === "expected" && (
            <ExpectedPanel
              members={members}
              heads={heads}
              parkingRates={parkingRates}
              interestRate={interestRate}
              serviceTaxRate={serviceTaxRate}
              billMonth={billMonth}
              billYear={billYear}
              label={periodLabel}
            />
          )}
          {rightPanel === "parking" && (
            <ParkingConfigPanel
              members={members}
              heads={heads}
              parkingRates={parkingRates}
              interestRate={interestRate}
              serviceTaxRate={serviceTaxRate}
              billMonth={billMonth}
              billYear={billYear}
              onSaved={refetchMembers}
            />
          )}
        </div>
      </div>
      {/* ── Bills Table ── */}
      {showBills && <BillsTable members={members} refreshTick={refreshTick} />}
      {/* ── Ledger ── */}
      {showLedger && <LedgerStrip members={members} />}
    </div>
  );
}
