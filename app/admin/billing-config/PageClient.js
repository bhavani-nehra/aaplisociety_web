"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import notify from "@/lib/notify";
import {
  PageHeader, Icon, Btn, RevampSkeleton, Card, Tabs, EmptyState,
  Select, SearchInput, ToggleSwitch, Pill, Modal, DataTable,
} from "@/components/revamp";

// ─── Calm/minimal register (06-skills-and-execution-tooling.md §13) ──────────
// Config is "infrequent, high-consequence" — maximum legibility, zero
// decoration. Same --r-* tokens as the warmer Operations pages, just less
// ornament: no brand-tinted icon chips, no colored row accents beyond the
// warning tint that flags an actually-unsaved grid edit.
const thStyle = {
  textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 700,
  color: "var(--r-fg-4)", 
  borderBottom: "1px solid var(--r-hairline)", whiteSpace: "nowrap",
  background: "var(--r-surface)",
};
const tdStyle = {
  padding: "9px 14px", borderBottom: "1px solid var(--r-hairline)",
  color: "var(--r-fg-2)", whiteSpace: "nowrap",
};
const iconBtnStyle = {
  background: "none", border: "none", cursor: "pointer", display: "inline-flex",
  alignItems: "center", justifyContent: "center", color: "var(--r-fg-4)", padding: 2,
};
const cellInputStyle = {
  width: 90, padding: "5px 7px", border: "1px solid var(--r-hairline)", borderRadius: 6,
  background: "var(--r-surface-2)", color: "var(--r-fg-1)", fontSize: 12.5, fontFamily: "inherit",
};

function SectionHead({ icon, title, sub, right }) {
  // Was a flat neutral-grey badge ("no brand-tinted icon chips" — a
  // deliberate zero-decoration choice from this page's original Calm
  // register pass). Given direct feedback that the page reads as flat and
  // washed out, section icons now carry the brand tint every other Card-
  // based page already uses — still one colour, still Restrained, just no
  // longer colourless.
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, background: "var(--r-brand-soft)", color: "var(--r-brand)",
          display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0, marginTop: 1,
        }}>
          <Icon name={icon} size={15} />
        </div>
        <div>
          <h2 style={{ fontSize: 14.5, fontWeight: 700, color: "var(--r-fg-1)", margin: 0 }}>{title}</h2>
          {sub ? <p style={{ fontSize: 12.5, color: "var(--r-fg-4)", margin: "3px 0 0", maxWidth: 560, lineHeight: 1.5 }}>{sub}</p> : null}
        </div>
      </div>
      {right}
    </div>
  );
}

export default function BillingConfigPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("charges");
  // ─── CHARGES TAB STATE ───────────────────────────────────────────────────────
  const [customCharges, setCustomCharges] = useState([]);
  // ─── MATRIX / GRID SHARED STATE ──────────────────────────────────────────────
  // ─── BILLING GRID TAB STATE ──────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedWing, setSelectedWing] = useState("all");
  const [gridData, setGridData] = useState({});
  const [modifiedRows, setModifiedRows] = useState(new Set());
  const [gridCustomColumns, setGridCustomColumns] = useState([]);
  const [showGridPreview, setShowGridPreview] = useState(false);
  const [previewMemberIndex, setPreviewMemberIndex] = useState(0);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  // ─── DATA FETCHING ────────────────────────────────────────────────────────────
  const { data: societyData } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });
  const { data: billingHeadsData, isLoading: billingHeadsLoading } = useQuery({
    queryKey: ["billing-heads"],
    queryFn: () => apiClient.get("/api/billing-heads/list"),
  });
  // Commercial billing is opt-in per society. When it is off this query fails
  // or returns false and the extra column simply never renders.
  const { data: commercialFlagsData } = useQuery({
    queryKey: ["commercial-flags"],
    queryFn: () => apiClient.get("/api/commercial/flags"),
    retry: false,
  });
  const commercialBilling =
    commercialFlagsData?.flags?.commercialBillingEnabled === true;
  // An empty list means "every unit" - the behaviour of every head that
  // existed before this feature, and the default for every new one.
  const chargeAppliesTo = (charge, member) => {
    const list = charge.appliesToUnitClasses;
    if (!Array.isArray(list) || list.length === 0) return true;
    const flatType = member?.flatType;
    const unitClass =
      flatType === "Shop" ? "Shop" : flatType === "Office" ? "Office" : "Residential";
    return list.includes(unitClass);
  };
  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ["members-list"],
    queryFn: () => apiClient.get("/api/members/list?limit=1000"),
  });
  const { data: templateData } = useQuery({
    queryKey: ["bill-template"],
    queryFn: () => apiClient.get("/api/billing/template"),
  });
  const society = societyData?.society;
  const members = membersData?.members ?? [];
  const billTemplate = templateData?.template;
  // ─── LOAD BILLING HEADS INTO customCharges ────────────────────────────────────
  useEffect(() => {
    if (billingHeadsData?.heads) {
      const active = billingHeadsData.heads
        .filter((h) => !h.isDeleted)
        .map((h) => ({
          id: String(h._id),
          name: h.headName ?? "",
          calculationType: h.calculationType ?? "Fixed",
          defaultAmount: Number(h.defaultAmount ?? 0),
          isActive: h.isActive !== false,
          appliesToUnitClasses: Array.isArray(h.appliesToUnitClasses)
            ? h.appliesToUnitClasses.map(String)
            : [],
          isExisting: true,
        }));
      setCustomCharges(active);
    }
  }, [billingHeadsData]);
  // ─── LIVE PREVIEW (matrix) auto-update ───────────────────────────────────────
  const livePreview = useMemo(() => {
    if (!members?.length) return [];
    return members.map((member) => {
      const area = Number(
        member.carpetAreaSqft ?? member.builtUpAreaSqft ?? member.areaSqFt ?? 0,
      );
      const flatNo = member.roomNo ?? member.flatNo;
      const calculations = {};
      customCharges.forEach((charge) => {
        if (!charge.name?.trim() || charge.isActive === false) return;
        if (!chargeAppliesTo(charge, member)) return;
        const amount = parseFloat(charge.defaultAmount) || 0;
        const chargeName = charge.name.trim().toLowerCase();
        const isParkingCharge =
          chargeName.includes("parking") ||
          chargeName.includes("two-wheeler") ||
          chargeName.includes("four-wheeler") ||
          chargeName.includes("two wheeler") ||
          chargeName.includes("four wheeler");
        if (isParkingCharge && charge.calculationType === "Fixed") {
          const slots = member.parkingSlots ?? [];
          const matchingCount = slots.filter((slot) => {
            if (slot.type === "Stilt" || slot.monthlyBilling === false)
              return false;
            const slotType = slot.type?.toLowerCase();
            const slotVehicle = slot.vehicleType?.toLowerCase();
            return (
              chargeName.includes(slotType) &&
              (chargeName.includes(slotVehicle) ||
                chargeName.includes(slotVehicle?.replace("-", " ")) ||
                chargeName.includes(slotVehicle?.replace(" ", "-")))
            );
          }).length;
          if (matchingCount > 0)
            calculations[charge.name] = amount * matchingCount;
        } else if (charge.calculationType === "Fixed") {
          calculations[charge.name] = amount;
        } else if (charge.calculationType === "Per Sq Ft") {
          calculations[charge.name] = area * amount;
        } else if (charge.calculationType === "Percentage") {
          const base = Object.values(calculations).reduce((s, v) => s + v, 0);
          calculations[charge.name] = base * (amount / 100);
        }
      });
      const total = Object.values(calculations).reduce(
        (sum, val) => sum + val,
        0,
      );
      return {
        member: `${member.wing ?? ""}-${flatNo}`,
        memberName: member.ownerName ?? "Unknown",
        area,
        ...calculations,
        total,
      };
    });
  }, [customCharges, members]);
  // ─── CHARGES: SAVE ────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      for (const charge of customCharges) {
        if (!charge.name?.trim()) continue;
        if (charge.isExisting) {
          await apiClient.put(`/api/billing-heads/${charge.id}/update`, {
            headName: charge.name.trim(),
            calculationType: charge.calculationType,
            defaultAmount: parseFloat(charge.defaultAmount) || 0,
            isActive: charge.isActive !== false,
            appliesToUnitClasses: charge.appliesToUnitClasses ?? [],
          });
        } else {
          await apiClient.post("/api/billing-heads/create", {
            headName: charge.name.trim(),
            calculationType: charge.calculationType,
            defaultAmount: parseFloat(charge.defaultAmount) || 0,
            isActive: true,
            appliesToUnitClasses: charge.appliesToUnitClasses ?? [],
          });
        }
      }
    },
    onSuccess: () => {
      notify.success("Configuration saved!");
      queryClient.invalidateQueries({ queryKey: ["society-config"] });
      queryClient.invalidateQueries({ queryKey: ["billing-heads"] });
    },
    onError: (error) => notify.error(`Failed to save: ${error.message}`),
  });
  const addCustomCharge = () =>
    setCustomCharges([
      ...customCharges,
      {
        id: `temp-${Date.now()}`,
        name: "",
        calculationType: "Fixed",
        defaultAmount: 0,
        isActive: true,
        appliesToUnitClasses: [],
        isExisting: false,
      },
    ]);
  const updateCharge = (id, field, value) =>
    setCustomCharges(
      customCharges.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
    );
  const deleteCharge = async (id) => {
    const charge = customCharges.find((c) => c.id === id);
    if (charge?.isExisting) {
      if (!(await notify.confirm(`Delete "${charge.name}"?`, { tone: "danger" })))
        return;
      try {
        await apiClient.delete(`/api/billing-heads/${charge.id}/delete`);
        queryClient.invalidateQueries({ queryKey: ["billing-heads"] });
      } catch (error) {
        notify.error(`Failed to delete: ${error.message}`);
      }
    }
    setCustomCharges(customCharges.filter((c) => c.id !== id));
  };
  // ─── BILLING GRID: helpers ────────────────────────────────────────────────────
  const wings = useMemo(() => {
    const uniqueWings = [...new Set((members ?? []).map((m) => m.wing))].filter(
      Boolean,
    );
    return uniqueWings.sort();
  }, [members]);
  const filteredMembers = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return (members ?? [])
      .filter((member) => {
        const matchesSearch =
          (member.flatNo ?? "").toLowerCase().includes(term) ||
          (member.ownerName ?? "").toLowerCase().includes(term) ||
          (member.wing ?? "").toLowerCase().includes(term);
        const matchesWing =
          selectedWing === "all" || member.wing === selectedWing;
        return matchesSearch && matchesWing;
      })
      .sort((a, b) => {
        const wA = (a.wing ?? "").toUpperCase();
        const wB = (b.wing ?? "").toUpperCase();
        if (wA < wB) return -1;
        if (wA > wB) return 1;
        return Number(a.flatNo ?? 0) - Number(b.flatNo ?? 0);
      });
  }, [members, searchTerm, selectedWing]);
  const calculateRowTotal = useCallback(
    (memberId, member) => {
      const rowData = gridData[memberId] ?? {};
      const areaSqFt = Number(
        member.carpetAreaSqft ?? member.builtUpAreaSqft ?? 0,
      );
      const baseCalculations = {};
      customCharges.forEach((charge) => {
        if (!charge.name?.trim || charge.isActive === false) return;
        if (!chargeAppliesTo(charge, member)) return;
        const amount = parseFloat(charge.defaultAmount) || 0;
        const chargeName = charge.name.trim().toLowerCase();
        // Detect if this is a parking charge by matching against member's actual slots
        const isParkingCharge =
          chargeName.includes("parking") ||
          chargeName.includes("two-wheeler") ||
          chargeName.includes("four-wheeler") ||
          chargeName.includes("two wheeler") ||
          chargeName.includes("four wheeler");
        if (isParkingCharge && charge.calculationType === "Fixed") {
          // Count matching slots — skip Stilt (one-time, never billed monthly)
          const slots = member.parkingSlots ?? [];
          const matchingCount = slots.filter((slot) => {
            if (slot.type === "Stilt" || slot.monthlyBilling === false)
              return false;
            // Match charge name against slot type + vehicleType
            const slotLabel =
              `${slot.type} Parking - ${slot.vehicleType}`.toLowerCase();
            const slotType = slot.type?.toLowerCase();
            const slotVehicle = slot.vehicleType?.toLowerCase();
            return (
              chargeName.includes(slotType) &&
              (chargeName.includes(slotVehicle) ||
                chargeName.includes(slotVehicle?.replace("-", " ")) ||
                chargeName.includes(slotVehicle?.replace(" ", "-")))
            );
          }).length;
          if (matchingCount > 0)
            baseCalculations[charge.name] = amount * matchingCount;
          // else: don't add this charge at all for this member
        } else if (charge.calculationType === "Fixed") {
          baseCalculations[charge.name] = amount;
        } else if (charge.calculationType === "Per Sq Ft") {
          baseCalculations[charge.name] = areaSqFt * amount;
        } else if (charge.calculationType === "Percentage") {
          const base = Object.values(baseCalculations).reduce(
            (s, v) => s + v,
            0,
          );
          baseCalculations[charge.name] = base * (amount / 100);
        }
      });
      const oneTimeTotal = gridCustomColumns.reduce(
        (sum, col) => sum + (Number(rowData[col.id]) || 0),
        0,
      );
      const baseTotal = Object.values(baseCalculations).reduce(
        (s, v) => s + v,
        0,
      );
      const subtotal = baseTotal + oneTimeTotal;
      const serviceTax =
        subtotal * ((society?.config?.serviceTaxRate ?? 0) / 100);
      const total = Math.round((subtotal + serviceTax) * 100) / 100;
      return {
        subtotal,
        serviceTax,
        total,
        breakdown: {
          ...baseCalculations,
          ...gridCustomColumns.reduce(
            (acc, col) => ({
              ...acc,
              [col.name]: Number(rowData[col.id]) || 0,
            }),
            {},
          ),
        },
      };
    },
    [gridData, customCharges, gridCustomColumns, society],
  );
  const handleAddGridColumn = async () => {
    const name = await notify.prompt("Enter column name");
    if (name?.trim())
      setGridCustomColumns([
        ...gridCustomColumns,
        { id: `custom-${Date.now()}`, name: name.trim() },
      ]);
  };
  const handleEditGridColumn = async (colId) => {
    const col = gridCustomColumns.find((c) => c.id === colId);
    if (col) {
      const newName = await notify.prompt("Enter new column name", col.name);
      if (newName?.trim())
        setGridCustomColumns(
          gridCustomColumns.map((c) =>
            c.id === colId ? { ...c, name: newName.trim() } : c,
          ),
        );
    }
  };
  const handleDeleteGridColumn = async (colId) => {
    if (!(await notify.confirm("Delete this column?", { tone: "danger" })))
      return;
    setGridCustomColumns(gridCustomColumns.filter((c) => c.id !== colId));
    const newGridData = { ...gridData };
    Object.keys(newGridData).forEach(
      (memberId) => delete newGridData[memberId][colId],
    );
    setGridData(newGridData);
  };
  const handleCellChange = useCallback((memberId, colId, value) => {
    const numValue = parseFloat(value) || 0;
    setGridData((prev) => ({
      ...prev,
      [memberId]: { ...prev[memberId], [colId]: numValue },
    }));
    setModifiedRows((prev) => new Set(prev.add(memberId)));
  }, []);
  const generateGridBillsMutation = useMutation({
    mutationFn: (data) => apiClient.post("api/billing/generate", data),
    onSuccess: (data) => {
      notify.success(`Generated ${data.billsGenerated} bills!`);
      setShowGridPreview(false);
      setGridData({});
      setModifiedRows(new Set());
      queryClient.invalidateQueries({ queryKey: ["generated-bills"] });
    },
    onError: (error) => notify.error(`Error: ${error.message}`),
  });
  const handleGridGenerate = async () => {
    if (
      !(await notify.confirm(
        `Generate bills for ${filteredMembers.length} members for ${year}-${String(month).padStart(2, "0")}?`,
        { tone: "warning" },
      ))
    )
      return;
    const billsData = filteredMembers.map((member) => {
      const mid = String(member._id ?? member.id);
      const calc = calculateRowTotal(mid, member);
      return {
        memberId: mid,
        breakdown: calc.breakdown,
        totalAmount: calc.total,
      };
    });
    generateGridBillsMutation.mutate({ year, month, bills: billsData });
  };
  const renderGridBillPreview = () => {
    if (!billTemplate || !filteredMembers.length) return null;
    const member = filteredMembers[previewMemberIndex];
    const mid = String(member._id ?? member.id);
    const calc = calculateRowTotal(mid, member);
    let html = billTemplate.html ?? "";
    const replacements = {
      "{{societyName}}": society?.name ?? "",
      "{{societyAddress}}": society?.address ?? "",
      "{{memberName}}": member.ownerName ?? "",
      "{{memberWing}}": member.wing ?? "",
      "{{memberRoomNo}}": member.roomNo ?? "",
      "{{memberArea}}": member.carpetAreaSqft ?? member.builtUpAreaSqft ?? "",
      "{{memberContact}}": member.contact ?? "",
      "{{billPeriod}}": `${year}-${String(month).padStart(2, "0")}`,
      "{{billDate}}": new Date().toLocaleDateString("en-IN"),
      "{{dueDate}}": new Date(year, month - 1, 10).toLocaleDateString("en-IN"),
      "{{totalAmount}}": calc.total.toLocaleString("en-IN"),
      "{{previousBalance}}": "0",
      "{{currentBalance}}": calc.total.toLocaleString("en-IN"),
    };
    Object.entries(replacements).forEach(([key, value]) => {
      html = html.replace(new RegExp(key, "g"), value);
    });
    const tableHtml = `<table style="width:100%;border-collapse:collapse;margin:20px 0">
      <thead><tr style="background-color:var(--bg-muted)">
        <th style="border:1px solid var(--fg-1);padding:8px;text-align:left">Sr.</th>
        <th style="border:1px solid var(--fg-1);padding:8px;text-align:left">Description</th>
        <th style="border:1px solid var(--fg-1);padding:8px;text-align:right">Amount</th>
      </tr></thead>
      <tbody>
        ${Object.entries(calc.breakdown)
          .map(
            ([desc, amt], idx) => `
          <tr><td style="border:1px solid var(--border);padding:8px">${idx + 1}</td>
          <td style="border:1px solid var(--border);padding:8px">${desc}</td>
          <td style="border:1px solid var(--border);padding:8px;text-align:right">${amt.toFixed(2)}</td></tr>`,
          )
          .join("")}
        <tr style="font-weight:bold;background-color:var(--bg-sunken)">
          <td colspan="2" style="border:1px solid var(--fg-1);padding:8px;text-align:right">TOTAL</td>
          <td style="border:1px solid var(--fg-1);padding:8px;text-align:right">${calc.total.toLocaleString("en-IN")}</td>
        </tr>
      </tbody></table>`;
    html = html.replace("{{BILLING_TABLE}}", tableHtml);
    return html;
  };
  // ─── MATRIX: DataTable columns (dynamic on active billing heads) ─────────────
  const matrixTableCols = useMemo(() => {
    const activeCharges = customCharges.filter(
      (c) => c.name?.trim() && c.isActive !== false,
    );
    return [
      { key: "member", label: "Member", render: (r) => <strong>{r.member}</strong> },
      { key: "memberName", label: "Name" },
      { key: "area", label: "Area", render: (r) => `${r.area} sq ft` },
      ...activeCharges.map((c) => ({
        key: c.id,
        label: c.name,
        align: "right",
        render: (r) => <span className="revamp-num">{r[c.name]?.toFixed(2) ?? "0.00"}</span>,
      })),
      {
        key: "total",
        label: "Total",
        align: "right",
        render: (r) => <strong className="revamp-num">{r.total?.toFixed(2)}</strong>,
      },
    ];
  }, [customCharges]);
  // ─── TAB NAV ──────────────────────────────────────────────────────────────────
  const tabs = [
    { key: "charges", label: "Charge Structure", icon: "sliders-horizontal" },
    { key: "matrix", label: "Live Matrix", icon: "grid-3x3" },
    { key: "grid", label: "Billing Grid", icon: "table" },
  ];
  const activeGridCharges = customCharges.filter(
    (c) => c.isActive !== false && c.name?.trim(),
  );
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* ── HEADER ── */}
      <PageHeader
        eyebrow={<><Icon name="receipt" size={11} /> Config · Accounting</>}
        title="Billing configuration"
        sub="Configure charges, review the live matrix, and enter dynamic billing amounts."
        right={
          activeTab === "charges" ? (
            <Btn
              variant="primary"
              icon="save"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : "Save configuration"}
            </Btn>
          ) : null
        }
      />
      {/* ── TAB BAR ── */}
      <Tabs value={activeTab} onChange={setActiveTab} tabs={tabs} />
      {/* ════════════════════════════════════════════════════════════════════════
          TAB 1 — CHARGE STRUCTURE
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "charges" && (
        <Card>
          <SectionHead
            icon="list-checks"
            title="Billing heads"
            sub="All charges — Per Sq Ft, Fixed, and Custom — managed as unified billing heads. Changes here reflect live in Matrix & Templates."
            right={
              <Btn variant="secondary" icon="plus" onClick={addCustomCharge}>
                Add charge
              </Btn>
            }
          />
          {billingHeadsLoading ? (
            // Charges hadn't loaded yet, not "there are none" — showing
            // the empty state here used to read as the society's billing
            // heads had vanished for the 1-2s the request was in flight,
            // then everything popped in at once.
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
              {Array.from({ length: 6 }).map((_, i) => <RevampSkeleton key={i} h={104} />)}
            </div>
          ) : customCharges.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px" }}>
              <Icon name="inbox" size={26} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
              <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--r-fg-4)" }}>
                No billing heads yet. Import from society config or add manually.
              </p>
              <div style={{ marginTop: 16 }}>
                <Btn
                  variant="primary"
                  icon="download"
                  onClick={async () => {
                    try {
                      await apiClient.post(
                        "api/billing-heads/setup-defaults",
                        {},
                      );
                      await queryClient.invalidateQueries({
                        queryKey: ["billing-heads"],
                      });
                      await queryClient.refetchQueries({
                        queryKey: ["billing-heads"],
                      });
                    } catch (e) {
                      notify.error("Failed: " + e.message);
                    }
                  }}
                >
                  Import from society config
                </Btn>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              {customCharges.map((charge, index) => (
                <div
                  key={charge.id}
                  style={{
                    border: "1px solid var(--r-hairline)",
                    borderRadius: 10,
                    padding: 14,
                    background: "var(--r-surface)",
                    opacity: charge.isActive === false ? 0.55 : 1,
                    transition: "opacity 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div style={{
                      width: 20, flexShrink: 0, fontSize: 11.5, fontWeight: 600,
                      color: "var(--r-fg-5)", fontVariantNumeric: "tabular-nums",
                    }}>
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <input
                      type="text"
                      placeholder="Charge name (e.g. Parking, Amenities)"
                      value={charge.name}
                      onChange={(e) =>
                        updateCharge(charge.id, "name", e.target.value)
                      }
                      className="input"
                      style={{ flex: 1 }}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: 30 }}>
                    <Select
                      value={charge.calculationType}
                      onChange={(v) =>
                        updateCharge(charge.id, "calculationType", v)
                      }
                      size="sm"
                      style={{ minWidth: 138 }}
                    >
                      <option value="Fixed">Fixed (per flat)</option>
                      <option value="Per Sq Ft">Per Sq Ft</option>
                    </Select>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 130 }}>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Amount"
                        value={charge.defaultAmount}
                        onChange={(e) =>
                          updateCharge(
                            charge.id,
                            "defaultAmount",
                            e.target.value,
                          )
                        }
                        className="input"
                        style={{ width: "100%" }}
                      />
                      <span
                        style={{
                          fontSize: "0.7rem",
                          color: "var(--r-fg-5)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {charge.calculationType === "Per Sq Ft"
                          ? "/sqft"
                          : "/flat"}
                      </span>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--r-fg-3)", flexShrink: 0 }}>
                      <ToggleSwitch
                        on={charge.isActive !== false}
                        onChange={(v) => updateCharge(charge.id, "isActive", v)}
                        title="Active"
                      />
                      Active
                    </label>
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="trash-2"
                      title="Delete charge"
                      onClick={() => deleteCharge(charge.id)}
                      style={{ color: "var(--r-danger)" }}
                    />
                  </div>
                  {commercialBilling && (
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        flexWrap: "wrap",
                        fontSize: 12,
                        color: "var(--r-fg-3)",
                        marginTop: 10,
                        marginLeft: 30,
                        paddingTop: 10,
                        borderTop: "1px solid var(--r-hairline)",
                      }}
                    >
                      <span style={{ color: "var(--r-fg-4)" }}>
                        Applies to{" "}
                        <a
                          href="/admin/commercial/rate-card"
                          style={{ fontWeight: 400, color: "var(--r-brand)" }}
                          title="Set a different amount for shops and offices"
                        >
                          (rates)
                        </a>:
                      </span>
                      {["Residential", "Shop", "Office"].map((cls) => {
                        const list = charge.appliesToUnitClasses ?? [];
                        const all = list.length === 0;
                        return (
                          <label
                            key={cls}
                            style={{ display: "flex", alignItems: "center", gap: 4 }}
                            title={
                              all
                                ? "Currently applies to every unit"
                                : `Applies to: ${list.join(", ")}`
                            }
                          >
                            <input
                              type="checkbox"
                              checked={all || list.includes(cls)}
                              onChange={(e) => {
                                const base = all
                                  ? ["Residential", "Shop", "Office"]
                                  : [...list];
                                const next = e.target.checked
                                  ? [...new Set([...base, cls])]
                                  : base.filter((c) => c !== cls);
                                // All three ticked is the same as no
                                // restriction, so store it as the empty
                                // list and keep legacy heads legacy.
                                updateCharge(
                                  charge.id,
                                  "appliesToUnitClasses",
                                  next.length === 3 ? [] : next,
                                );
                              }}
                            />
                            {cls === "Residential" ? "Flats" : cls}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {/* ════════════════════════════════════════════════════════════════════════
          TAB 2 — LIVE MATRIX
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "matrix" && (
        <Card>
          <SectionHead
            icon="grid-3x3"
            title="Live billing matrix"
            sub="Auto-calculated from current billing heads. Save charges first to update."
            right={<Pill tone="neutral" dot={false}>{livePreview.length} members</Pill>}
          />
          {livePreview.length === 0 ? (
            <EmptyState
              icon="inbox"
              title="No members found"
              sub="Import members first, or add billing heads in the Charge Structure tab."
            />
          ) : (
            <>
              <DataTable cols={matrixTableCols} rows={livePreview.slice(0, 50)} />
              {livePreview.length > 50 && (
                <p style={{ textAlign: "center", padding: "12px 0 0", fontSize: 12, color: "var(--r-fg-4)" }}>
                  Showing 50 of {livePreview.length} members
                </p>
              )}
            </>
          )}
        </Card>
      )}
      {/* ════════════════════════════════════════════════════════════════════════
          TAB 3 — BILLING GRID
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "grid" && (
        <div>
          <SectionHead
            icon="table"
            title="Billing grid"
            sub="Enter dynamic or one-time charges per member before generating bills."
            right={
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="secondary" icon="plus" onClick={handleAddGridColumn}>
                  Add column
                </Btn>
                <Btn
                  variant="primary"
                  icon="eye"
                  disabled={!filteredMembers.length}
                  onClick={() => {
                    setPreviewMemberIndex(0);
                    setShowGridPreview(true);
                  }}
                >
                  Preview bills
                </Btn>
              </div>
            }
          />
          {/* Month/Year + Filter bar */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Select value={month} onChange={(v) => setMonth(parseInt(v))} style={{ width: 148 }}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {new Date(2000, i).toLocaleString("default", {
                      month: "long",
                    })}
                  </option>
                ))}
              </Select>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="input"
                style={{ width: 94 }}
                min={2020}
                max={2035}
              />
              <SearchInput
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Search by room, name, or wing…"
                style={{ flex: 1, minWidth: 200 }}
              />
              <Select value={selectedWing} onChange={setSelectedWing} style={{ width: 148 }}>
                <option value="all">All wings</option>
                {wings.map((wing) => (
                  <option key={wing} value={wing}>
                    Wing {wing}
                  </option>
                ))}
              </Select>
              <Pill tone="neutral" dot={false}>{filteredMembers.length} members</Pill>
            </div>
          </Card>
          {/* Grid Table */}
          {membersLoading ? (
            <RevampSkeleton h={240} />
          ) : (
            <Card padded={false} style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, zIndex: 1 }}>
                    <th style={thStyle}>Wing</th>
                    <th style={thStyle}>Room</th>
                    <th style={thStyle}>Owner</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Area sq.ft</th>
                    {activeGridCharges.map((c) => (
                      <th key={c.id} style={{ ...thStyle, textAlign: "right" }}>{c.name}</th>
                    ))}
                    {gridCustomColumns.map((col) => (
                      <th key={col.id} style={thStyle}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            justifyContent: "space-between",
                          }}
                        >
                          <span>{col.name}</span>
                          <div style={{ display: "flex", gap: 2 }}>
                            <button
                              onClick={() => handleEditGridColumn(col.id)}
                              aria-label="Edit column"
                              style={iconBtnStyle}
                            >
                              <Icon name="pencil" size={12} />
                            </button>
                            <button
                              onClick={() => handleDeleteGridColumn(col.id)}
                              aria-label="Delete column"
                              style={{ ...iconBtnStyle, color: "var(--r-danger)" }}
                            >
                              <Icon name="x" size={12} />
                            </button>
                          </div>
                        </div>
                      </th>
                    ))}
                    <th style={{ ...thStyle, textAlign: "right" }}>Subtotal</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Tax</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map((member, idx) => {
                    const mid = String(member._id ?? member.id);
                    const calc = calculateRowTotal(mid, member);
                    const isModified = modifiedRows.has(mid);
                    return (
                      <tr
                        key={mid || idx}
                        style={{
                          backgroundColor: isModified
                            ? "var(--r-warning-soft)"
                            : "transparent",
                        }}
                      >
                        <td style={tdStyle}>{member.wing}-</td>
                        <td style={tdStyle}>
                          <strong>{member.flatNo}</strong>
                        </td>
                        <td style={tdStyle}>{member.ownerName}</td>
                        <td style={{ ...tdStyle, textAlign: "right" }} className="revamp-num">
                          {member.carpetAreaSqft ??
                            member.builtUpAreaSqft ??
                            "-"}
                        </td>
                        {activeGridCharges.map((c) => (
                          <td key={c.id} style={{ ...tdStyle, textAlign: "right" }} className="revamp-num">
                            {(calc.breakdown[c.name] ?? 0).toFixed(2)}
                          </td>
                        ))}
                        {gridCustomColumns.map((col) => (
                          <td key={col.id} style={tdStyle}>
                            <input
                              type="number"
                              value={gridData[mid]?.[col.id] ?? ""}
                              onChange={(e) =>
                                handleCellChange(mid, col.id, e.target.value)
                              }
                              placeholder="0"
                              style={cellInputStyle}
                            />
                          </td>
                        ))}
                        <td style={{ ...tdStyle, textAlign: "right" }} className="revamp-num">
                          {calc.subtotal.toFixed(2)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }} className="revamp-num">
                          {calc.serviceTax.toFixed(2)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <strong className="revamp-num">{calc.total.toFixed(2)}</strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
          {/* Bottom actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <Btn
              variant="primary"
              size="lg"
              icon="receipt"
              disabled={
                generateGridBillsMutation.isPending || !filteredMembers.length
              }
              onClick={handleGridGenerate}
              style={{ minWidth: 220 }}
            >
              {generateGridBillsMutation.isPending
                ? "Generating…"
                : `Generate ${filteredMembers.length} bills`}
            </Btn>
          </div>
          {/* Grid Preview Modal */}
          <Modal
            open={showGridPreview}
            onClose={() => setShowGridPreview(false)}
            title={`Bill preview — ${year}-${String(month).padStart(2, "0")}`}
            sub={`Member ${previewMemberIndex + 1} of ${filteredMembers.length}`}
            width={880}
          >
            <div
              dangerouslySetInnerHTML={{
                __html:
                  renderGridBillPreview() ??
                  '<p style="color:var(--r-fg-4);text-align:center">No template configured. Set up a template in Bill Templates first.</p>',
              }}
            />
            <div
              style={{
                position: "sticky",
                bottom: -22,
                marginLeft: -22,
                marginRight: -22,
                marginTop: 24,
                padding: "14px 22px",
                background: "var(--r-surface)",
                borderTop: "1px solid var(--r-hairline)",
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <Btn
                variant="secondary"
                onClick={() =>
                  setPreviewMemberIndex(Math.max(0, previewMemberIndex - 1))
                }
                disabled={previewMemberIndex === 0}
              >
                ← Previous
              </Btn>
              <Btn
                variant="secondary"
                onClick={() =>
                  setPreviewMemberIndex(
                    Math.min(
                      filteredMembers.length - 1,
                      previewMemberIndex + 1,
                    ),
                  )
                }
                disabled={previewMemberIndex === filteredMembers.length - 1}
              >
                Next →
              </Btn>
              <div style={{ flex: 1 }} />
              <Btn variant="secondary" onClick={() => setShowGridPreview(false)}>
                Cancel
              </Btn>
              <Btn
                variant="primary"
                disabled={generateGridBillsMutation.isPending}
                onClick={handleGridGenerate}
                style={{ minWidth: 180 }}
              >
                {generateGridBillsMutation.isPending
                  ? "Generating…"
                  : `Generate ${filteredMembers.length} bills`}
              </Btn>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}
