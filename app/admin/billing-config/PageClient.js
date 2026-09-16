"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import styles from "@/styles/BillingConfig.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";
import { apiClient } from "@/lib/api-client";
import notify from "@/lib/notify";
import { PageHeader, Icon, Btn, RevampSkeleton } from "@/components/revamp";
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
  // ─── MATRIX: column names ─────────────────────────────────────────────────────
  const matrixColumns = useMemo(() => {
    const cols = ["Member", "Name", "Area"];
    customCharges.forEach((c) => {
      if (c.name?.trim() && c.isActive !== false) cols.push(c.name);
    });
    cols.push("Total");
    return cols;
  }, [customCharges]);
  // ─── TAB NAV ──────────────────────────────────────────────────────────────────
  const tabs = [
    { id: "charges", label: "Charge Structure", icon: "sliders-horizontal" },
    { id: "matrix", label: "Live Matrix", icon: "grid-3x3" },
    { id: "grid", label: "Billing Grid", icon: "table" },
  ];
  return (
    <div className={styles.container}>
      {/* ── HEADER ── */}
      <PageHeader
        eyebrow={<><Icon name="receipt" size={11} /> Accounting</>}
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
              {saveMutation.isPending ? "Saving…" : "Save Configuration"}
            </Btn>
          ) : null
        }
      />
      {/* ── TAB BAR ── */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--r-hairline)", marginBottom: 20 }}>
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "10px 16px", border: "none", background: "none",
                borderBottom: active ? "2px solid var(--r-brand)" : "2px solid transparent",
                fontWeight: active ? 600 : 500,
                color: active ? "var(--r-brand)" : "var(--r-fg-3)",
                cursor: "pointer", fontSize: 13.5, fontFamily: "inherit",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              <Icon name={tab.icon} size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>
      {/* ════════════════════════════════════════════════════════════════════════
          TAB 1 — CHARGE STRUCTURE
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "charges" && (
        <div className={styles.configSections}>
          <div className={styles.section}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem",
              }}
            >
              <div>
                <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name="list-checks" size={17} /> Billing Heads
                </h2>
                <p
                  style={{
                    color: "var(--fg-4)",
                    fontSize: "0.875rem",
                    marginTop: "0.25rem",
                  }}
                >
                  All charges — Per Sq Ft, Fixed, and Custom — managed as
                  unified billing heads. Changes here reflect live in Matrix
                  &amp; Templates.
                </p>
              </div>
              <button onClick={addCustomCharge} className="btn btn-success">
                + Add Charge
              </button>
            </div>
            {billingHeadsLoading ? (
              // Charges hadn't loaded yet, not "there are none" — showing
              // the empty state here used to read as the society's billing
              // heads had vanished for the 1-2s the request was in flight,
              // then everything popped in at once.
              <div className={styles.customChargesList}>
                {Array.from({ length: 6 }).map((_, i) => <RevampSkeleton key={i} h={128} />)}
              </div>
            ) : customCharges.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <p style={{ color: "var(--fg-4)", marginBottom: "1rem" }}>
                  No billing heads yet. Import from society config or add
                  manually.
                </p>
                <button
                  className="btn btn-primary"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
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
                  <Icon name="download" size={14} /> Import from Society Config
                </button>
              </div>
            ) : (
              <div className={styles.customChargesList}>
                {customCharges.map((charge, index) => (
                  <div
                    key={charge.id}
                    className={styles.customChargeRow}
                    style={{ opacity: charge.isActive === false ? 0.5 : 1 }}
                  >
                    <div className={styles.customChargeRowHead}>
                      <div className={styles.rowNumber}>{index + 1}</div>
                      <input
                        type="text"
                        placeholder="Charge name (e.g. Parking, Amenities)"
                        value={charge.name}
                        onChange={(e) =>
                          updateCharge(charge.id, "name", e.target.value)
                        }
                        className={styles.input}
                        style={{ flex: 1 }}
                      />
                    </div>
                    <div className={styles.customChargeRowFields}>
                      <select
                        value={charge.calculationType}
                        onChange={(e) =>
                          updateCharge(
                            charge.id,
                            "calculationType",
                            e.target.value,
                          )
                        }
                        className={styles.select}
                        style={{ flex: 1 }}
                      >
                        <option value="Fixed">Fixed (per flat)</option>
                        <option value="Per Sq Ft">Per Sq Ft</option>
                      </select>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", flex: 1 }}>
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
                          className={styles.input}
                          style={{ width: "100%" }}
                        />
                        <span
                          style={{
                            fontSize: "0.7rem",
                            color: "var(--fg-5)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {charge.calculationType === "Per Sq Ft"
                            ? "/sqft"
                            : "/flat"}
                        </span>
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "var(--fg-3)", flexShrink: 0 }}>
                        <input
                          type="checkbox"
                          checked={charge.isActive !== false}
                          onChange={(e) =>
                            updateCharge(charge.id, "isActive", e.target.checked)
                          }
                        />
                        Active
                      </label>
                      <button
                        onClick={() => deleteCharge(charge.id)}
                        className={styles.deleteBtn}
                        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                        aria-label="Delete charge"
                      >
                        <Icon name="trash-2" size={14} />
                      </button>
                    </div>
                    {commercialBilling && (
                      <div
                        style={{
                          display: "flex",
                          gap: "0.75rem",
                          flexWrap: "wrap",
                          fontSize: "0.75rem",
                          color: "var(--fg-3)",
                        }}
                      >
                        <span style={{ color: "var(--fg-4)" }}>
                          Applies to{" "}
                          <a
                            href="/admin/commercial/rate-card"
                            style={{ fontWeight: 400 }}
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
                              style={{ display: "flex", alignItems: "center", gap: 3 }}
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
          </div>
        </div>
      )}
      {/* ════════════════════════════════════════════════════════════════════════
          TAB 2 — LIVE MATRIX
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "matrix" && (
        <div className={styles.liveMatrixSection}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <div>
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="grid-3x3" size={17} /> Live Billing Matrix
              </h2>
              <p style={{ color: "var(--fg-4)", fontSize: "0.875rem" }}>
                Auto-calculated from current billing heads. Save charges first
                to update.
              </p>
            </div>
            <span
              style={{
                background: "var(--primary-tint)",
                color: "var(--primary-hover)",
                padding: "0.35rem 1rem",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: "0.875rem",
              }}
            >
              {livePreview.length} members
            </span>
          </div>
          {livePreview.length === 0 ? (
            <div
              style={{ textAlign: "center", padding: "3rem", color: "var(--fg-4)" }}
            >
              No members found. Import members first, or add billing heads in
              Charge Structure tab.
            </div>
          ) : (
            <>
              <div className={styles.tableWrapper}>
                <table className={styles.liveTable}>
                  <thead>
                    <tr>
                      {matrixColumns.map((col) => (
                        <th
                          key={col}
                          className={
                            col === "Total" ? styles.totalColumn : undefined
                          }
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {livePreview.slice(0, 50).map((row, idx) => (
                      <tr key={idx}>
                        <td>
                          <strong>{row.member}</strong>
                        </td>
                        <td>{row.memberName}</td>
                        <td>{row.area} sq ft</td>
                        {customCharges
                          .filter((c) => c.name?.trim() && c.isActive !== false)
                          .map((c) => (
                            <td key={c.id}>
                              {row[c.name]?.toFixed(2) ?? "0.00"}
                            </td>
                          ))}
                        <td className={styles.totalCell}>
                          <strong>{row.total?.toFixed(2)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {livePreview.length > 50 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "1rem",
                    color: "var(--fg-4)",
                  }}
                >
                  Showing 50 of {livePreview.length} members
                </div>
              )}
            </>
          )}
        </div>
      )}
      {/* ════════════════════════════════════════════════════════════════════════
          TAB 3 — BILLING GRID
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "grid" && (
        <div>
          {/* Grid Controls */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <div>
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="table" size={17} /> Billing Grid
              </h2>
              <p style={{ color: "var(--fg-4)", fontSize: "0.875rem" }}>
                Enter dynamic/one-time charges per member before generating
                bills.
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                onClick={handleAddGridColumn}
                className="btn btn-secondary"
              >
                + Add Column
              </button>
              <button
                onClick={() => {
                  setPreviewMemberIndex(0);
                  setShowGridPreview(true);
                }}
                className="btn btn-primary"
                disabled={!filteredMembers.length}
              >
                Preview Bills
              </button>
            </div>
          </div>
          {/* Month/Year + Filter bar */}
          <div
            className={styles.section}
            style={{ marginBottom: "1rem", padding: "1rem" }}
          >
            <div
              style={{
                display: "flex",
                gap: "1rem",
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value))}
                className="input"
                style={{ width: 140 }}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {new Date(2000, i).toLocaleString("default", {
                      month: "long",
                    })}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="input"
                style={{ width: 90 }}
                min={2020}
                max={2035}
              />
              <input
                type="text"
                placeholder="Search by room, name, or wing…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input"
                style={{ flex: 1, minWidth: 180 }}
              />
              <select
                value={selectedWing}
                onChange={(e) => setSelectedWing(e.target.value)}
                className="input"
                style={{ width: 150 }}
              >
                <option value="all">All Wings</option>
                {wings.map((wing) => (
                  <option key={wing} value={wing}>
                    Wing {wing}
                  </option>
                ))}
              </select>
              <span
                style={{
                  padding: "0.5rem 1rem",
                  background: "var(--primary-tint)",
                  borderRadius: 8,
                  fontWeight: 600,
                  color: "var(--primary-hover)",
                  whiteSpace: "nowrap",
                }}
              >
                {filteredMembers.length} MEMBERS
              </span>
            </div>
          </div>
          {/* Grid Table */}
          {membersLoading ? (
            <div
              style={{ textAlign: "center", padding: "3rem", color: "var(--fg-4)" }}
            >
              Loading members…
            </div>
          ) : (
            <div
              className={styles.section}
              style={{ padding: 0, overflowX: "auto" }}
            >
              <table className={gridStyles.billingTable}>
                <thead>
                  <tr>
                    <th>Wing</th>
                    <th>Room</th>
                    <th>Owner</th>
                    <th>Area sq.ft</th>
                    {customCharges
                      .filter((c) => c.isActive !== false && c.name?.trim())
                      .map((c) => (
                        <th key={c.id}>{c.name}</th>
                      ))}
                    {gridCustomColumns.map((col) => (
                      <th key={col.id}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>{col.name}</span>
                          <div style={{ display: "flex", gap: "0.25rem" }}>
                            <button
                              onClick={() => handleEditGridColumn(col.id)}
                              aria-label="Edit column"
                              style={{
                                background: "none", border: "none", cursor: "pointer",
                                display: "inline-flex", alignItems: "center",
                              }}
                            >
                              <Icon name="pencil" size={13} />
                            </button>
                            <button
                              onClick={() => handleDeleteGridColumn(col.id)}
                              aria-label="Delete column"
                              style={{
                                background: "none", border: "none", cursor: "pointer",
                                display: "inline-flex", alignItems: "center",
                                color: "var(--r-danger)",
                              }}
                            >
                              <Icon name="x" size={13} />
                            </button>
                          </div>
                        </div>
                      </th>
                    ))}
                    <th>Subtotal</th>
                    <th>Tax</th>
                    <th>Total</th>
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
                            ? "var(--warning-bg)"
                            : "transparent",
                        }}
                      >
                        <td>{member.wing}-</td>
                        <td>
                          <strong>{member.flatNo}</strong>
                        </td>
                        <td>{member.ownerName}</td>
                        <td>
                          {member.carpetAreaSqft ??
                            member.builtUpAreaSqft ??
                            "-"}
                        </td>
                        {customCharges
                          .filter((c) => c.isActive !== false && c.name?.trim())
                          .map((c) => (
                            <td key={c.id}>
                              {(calc.breakdown[c.name] ?? 0).toFixed(2)}
                            </td>
                          ))}
                        {gridCustomColumns.map((col) => (
                          <td key={col.id}>
                            <input
                              type="number"
                              value={gridData[mid]?.[col.id] ?? ""}
                              onChange={(e) =>
                                handleCellChange(mid, col.id, e.target.value)
                              }
                              className={gridStyles.cellInput}
                              placeholder="0"
                              style={{ width: 100 }}
                            />
                          </td>
                        ))}
                        <td>{calc.subtotal.toFixed(2)}</td>
                        <td>{calc.serviceTax.toFixed(2)}</td>
                        <td>
                          <strong style={{ color: "var(--danger)" }}>
                            {calc.total.toFixed(2)}
                          </strong>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {/* Bottom actions */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "1rem",
              gap: "0.75rem",
            }}
          >
            <button
              onClick={handleGridGenerate}
              disabled={
                generateGridBillsMutation.isPending || !filteredMembers.length
              }
              className="btn btn-success"
              style={{ minWidth: 220 }}
            >
              {generateGridBillsMutation.isPending
                ? "Generating…"
                : `Generate ${filteredMembers.length} Bills`}
            </button>
          </div>
          {/* Grid Preview Overlay */}
          {showGridPreview && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0,0,0,0.8)",
                zIndex: 9999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "2rem",
              }}
              onClick={() => setShowGridPreview(false)}
            >
              <div
                style={{
                  backgroundColor: "var(--bg-surface)",
                  borderRadius: 12,
                  maxWidth: 900,
                  width: "100%",
                  maxHeight: "90vh",
                  overflow: "auto",
                  position: "relative",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    padding: "1.5rem",
                    borderBottom: "2px solid var(--border)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    position: "sticky",
                    top: 0,
                    backgroundColor: "var(--bg-surface)",
                    zIndex: 1,
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0 }}>
                      Bill Preview {year}-{String(month).padStart(2, "0")}
                    </h2>
                    <p style={{ margin: "0.5rem 0 0 0", color: "var(--fg-4)" }}>
                      Member {previewMemberIndex + 1} of{" "}
                      {filteredMembers.length}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowGridPreview(false)}
                    aria-label="Close preview"
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      display: "inline-flex", alignItems: "center",
                      color: "var(--fg-5)",
                    }}
                  >
                    <Icon name="x" size={22} />
                  </button>
                </div>
                <div
                  style={{ padding: "2rem" }}
                  dangerouslySetInnerHTML={{
                    __html:
                      renderGridBillPreview() ??
                      '<p style="color:var(--fg-4);text-align:center">No template configured. Set up a template in Bill Templates first.</p>',
                  }}
                />
                <div
                  style={{
                    padding: "1.5rem",
                    borderTop: "2px solid var(--border)",
                    display: "flex",
                    gap: "1rem",
                    position: "sticky",
                    bottom: 0,
                    backgroundColor: "var(--bg-surface)",
                  }}
                >
                  <button
                    onClick={() =>
                      setPreviewMemberIndex(Math.max(0, previewMemberIndex - 1))
                    }
                    disabled={previewMemberIndex === 0}
                    className="btn btn-secondary"
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={() =>
                      setPreviewMemberIndex(
                        Math.min(
                          filteredMembers.length - 1,
                          previewMemberIndex + 1,
                        ),
                      )
                    }
                    disabled={previewMemberIndex === filteredMembers.length - 1}
                    className="btn btn-secondary"
                  >
                    Next →
                  </button>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => setShowGridPreview(false)}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGridGenerate}
                    disabled={generateGridBillsMutation.isPending}
                    className="btn btn-success"
                    style={{ minWidth: 200 }}
                  >
                    {generateGridBillsMutation.isPending
                      ? "Generating…"
                      : `Generate ${filteredMembers.length} Bills`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}