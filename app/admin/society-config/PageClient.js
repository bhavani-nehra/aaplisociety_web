"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { produce } from "immer";
import {
  PageHeader, Card, CardHead, Btn, Icon, RevampSkeleton, Toast,
} from "@/components/revamp";

// Config group register (final_audit_fix_plan/06-skills-and-execution-tooling.md
// §13): "Calm/minimal — infrequent, high-consequence screens, maximum
// legibility, zero decoration." Rewritten onto components/revamp with the
// same restraint as app/my-access/page.js (the Run 19 exemplar for this
// register) — plain Cards, no tinted panels, no icon-in-a-box treatments,
// quiet section labels instead of colored banner blocks. Business logic
// (queries, mutations, validate, handleChange, handleSubmit) is untouched.
export default function SocietyConfigPage() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: "",
    registrationNo: "",
    address: "",
    config: {
      interestRate: 0,
      serviceTaxRate: 0,
      billGenerationDay: 1,
      paymentUploadDay: 30,
      billDueDay: 30,
      interestAfterDays: 15,
    },
  });
  const [errors, setErrors] = useState({});
  const [successMessage, setSuccessMessage] = useState("");

  // ---- Commercial module (additive) ------------------------------------
  // Separate query + mutation on purpose: the flags save instantly on toggle
  // and are NOT part of the society form's Save button, so this cannot affect
  // the existing config submit path in any way.
  const { data: commercialData } = useQuery({
    queryKey: ["commercial-flags"],
    queryFn: () => apiClient.get("/api/commercial/flags"),
    retry: false,
  });
  const commercialFlags = commercialData?.flags || {
    enabled: false,
    directoryEnabled: false,
    ownerEditingEnabled: false,
    commercialBillingEnabled: false,
  };
  const commercialMutation = useMutation({
    mutationFn: (patch) => apiClient.post("/api/commercial/flags", patch),
    onSuccess: (res) => {
      queryClient.invalidateQueries(["commercial-flags"]);
      // The sidebar reads the flags once when the admin shell mounts, so
      // reload when the master switch changes to make the Commercial group
      // appear or disappear immediately.
      if (res?.flags?.enabled !== commercialFlags.enabled) {
        window.location.reload();
      }
    },
  });
  const { data: societyData, isLoading } = useQuery({
    queryKey: ["society-config"],
    queryFn: () => apiClient.get("/api/society/config"),
  });
  useEffect(() => {
    if (societyData?.society) {
      const c = societyData.society.config || {};
      setFormData({
        name: societyData.society.name || "",
        registrationNo: societyData.society.registrationNo || "",
        address: societyData.society.address || "",
        config: {
          interestRate: c.interestRate ?? 0,
          serviceTaxRate: c.serviceTaxRate ?? 0,
          billGenerationDay: c.billGenerationDay ?? 1,
          paymentUploadDay: c.paymentUploadDay ?? 30,
          billDueDay: c.billDueDay ?? 30,
          interestAfterDays: c.interestAfterDays ?? 15,
        },
      });
    }
  }, [societyData]);
  const updateMutation = useMutation({
    mutationFn: (data) => apiClient.put("/api/society/update", data),
    onSuccess: (data) => {
      setSuccessMessage("Society configuration updated successfully!");
      // ✅ UPDATE FORM STATE WITH SERVER RESPONSE
      if (data.society) {
        const c = data.society.config || {};
        setFormData({
          name: data.society.name || "",
          registrationNo: data.society.registrationNo || "",
          address: data.society.address || "",
          config: {
            interestRate: c.interestRate ?? 0,
            serviceTaxRate: c.serviceTaxRate ?? 0,
            billGenerationDay: c.billGenerationDay ?? 1,
            paymentUploadDay: c.paymentUploadDay ?? 30,
            billDueDay: c.billDueDay ?? 30,
            interestAfterDays: c.interestAfterDays ?? 15,
          },
        });
      }
      queryClient.invalidateQueries(["society-config"]);
      setTimeout(() => setSuccessMessage(""), 5000);
    },
    onError: (error) => {
      setErrors({ submit: error.message });
    },
  });
  const handleChange = (path, value) => {
    setFormData((prev) =>
      produce(prev, (draft) => {
        const keys = path.split(".");
        let current = draft;
        // Navigate to the parent of the target key
        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) {
            current[keys[i]] = {}; // Create if doesn't exist
          }
          current = current[keys[i]];
        }
        // Set the final value
        current[keys[keys.length - 1]] = value;
        console.log(`✅ Updated ${path} to:`, value);
      }),
    );
    if (errors[path]) {
      setErrors((prev) => ({ ...prev, [path]: "" }));
    }
  };
  const validate = () => {
    const newErrors = {};
    if (!formData.name || formData.name.trim().length < 2)
      newErrors.name = "Society name must be at least 2 characters";
    if (formData.config.interestRate < 0 || formData.config.interestRate > 100)
      newErrors.interestRate = "Interest rate must be between 0 and 100";
    if (
      formData.config.serviceTaxRate < 0 ||
      formData.config.serviceTaxRate > 100
    )
      newErrors.serviceTaxRate = "Service tax rate must be between 0 and 100";
    for (const [key, label] of [
      ["billGenerationDay", "Bill creation day"],
      ["paymentUploadDay", "Payment upload day"],
      ["billDueDay", "Bill due day"],
    ]) {
      const value = Number(formData.config[key]);
      if (!Number.isInteger(value) || value < 1 || value > 31)
        newErrors[key] = `${label} must be a whole number from 1 to 31`;
    }
    const afterDays = formData.config.interestAfterDays;
    if (afterDays === undefined || afterDays < 0 || afterDays > 365)
      newErrors.interestAfterDays = "Interest after days must be 0–365";
    return newErrors;
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    try {
      await updateMutation.mutateAsync({
        ...formData,
      });
      // ✅ CRITICAL: Update state with response data
      // This ensures the form shows the saved values
      console.log("✅ Save successful, state updated");
    } catch (error) {
      console.error("❌ Save failed:", error);
      setErrors({ submit: error.message });
    }
  };

  if (isLoading) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <RevampSkeleton h={64} style={{ marginBottom: 14 }} />
        <RevampSkeleton h={220} style={{ marginBottom: 14 }} />
        <RevampSkeleton h={280} />
      </div>
    );
  }

  // Was a bare `maxWidth: 760` with no centering — on anything wider than
  // that (every real monitor) the form sat flush left with a dead gap
  // filling the rest of the content frame, which is what read as the page
  // stopping short partway across ("cuts at 90%"). Centered and widened
  // slightly; still a single readable column, just not orphaned on one side.
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      <form onSubmit={handleSubmit}>
        <PageHeader
          eyebrow="Config"
          title="Society Configuration"
          sub="Society details and financial parameters"
          right={
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="ghost" icon="rotate-ccw" onClick={() => window.location.reload()}>
                Reset changes
              </Btn>
              <Btn
                variant="primary"
                icon={updateMutation.isPending ? undefined : "save"}
                type="submit"
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? "Saving…" : "Save configuration"}
              </Btn>
            </div>
          }
        />

        {errors.submit && (
          <Card style={{ marginBottom: 16, borderColor: "var(--r-danger)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <Icon name="alert-circle" size={16} color="var(--r-danger)" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-1)" }}>Update failed</div>
                <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 2 }}>{errors.submit}</div>
              </div>
            </div>
          </Card>
        )}

        <Card style={{ marginBottom: 16 }}>
          <CardHead title="Basic information" />
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <label className="label">Society name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange("name", e.target.value)}
                className={`input ${errors.name ? "input-error" : ""}`}
                placeholder="Green Valley Apartments"
              />
              {errors.name && <p className="error-text">{errors.name}</p>}
            </div>
            <div>
              <label className="label">Registration number</label>
              <input
                type="text"
                value={formData.registrationNo}
                onChange={(e) => handleChange("registrationNo", e.target.value)}
                className="input"
                placeholder="REG/2024/1234"
              />
            </div>
            <div>
              <label className="label">Address</label>
              <textarea
                value={formData.address}
                onChange={(e) => handleChange("address", e.target.value)}
                className="input"
                rows="3"
                placeholder="Complete society address"
              />
            </div>
          </div>
        </Card>

        <Card style={{ marginBottom: 16 }}>
          <CardHead title="Financial parameters" />
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
              <div>
                <label className="label">Interest rate on arrears (% p.a.) *</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.config.interestRate}
                  onChange={(e) => handleChange("config.interestRate", parseFloat(e.target.value) || 0)}
                  className={`input ${errors.interestRate ? "input-error" : ""}`}
                  placeholder="21.00"
                />
                {errors.interestRate ? (
                  <p className="error-text">{errors.interestRate}</p>
                ) : (
                  <p style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 6 }}>
                    Annual interest rate on overdue payments (e.g., 21% p.a.)
                  </p>
                )}
              </div>
              <div>
                <label className="label">Service tax rate (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.config.serviceTaxRate}
                  onChange={(e) => handleChange("config.serviceTaxRate", parseFloat(e.target.value) || 0)}
                  className={`input ${errors.serviceTaxRate ? "input-error" : ""}`}
                  placeholder="2.00"
                />
                {errors.serviceTaxRate ? (
                  <p className="error-text">{errors.serviceTaxRate}</p>
                ) : (
                  <p style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 6 }}>
                    Tax applied on total charges (e.g., GST 2%)
                  </p>
                )}
              </div>
              <div>
                <label className="label">Interest rounding</label>
                <select
                  value={formData.config.interestRounding || "TWO_DECIMAL"}
                  onChange={(e) => handleChange("config.interestRounding", e.target.value)}
                  className="input"
                >
                  <option value="TWO_DECIMAL">2 decimal (e.g. 10.256 → 10.26)</option>
                  <option value="ROUND_UP">Round up to whole rupee (e.g. 10.001 → 11)</option>
                </select>
                <p style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 6 }}>
                  Society never spares even ₹0.01 — use Round Up
                </p>
              </div>
              <div>
                <label className="label">Interest use mode</label>
                <select
                  value={formData.config.interestUseMode || "OLDEST_FIRST"}
                  onChange={(e) => handleChange("config.interestUseMode", e.target.value)}
                  className="input"
                >
                  <option value="OLDEST_FIRST">Oldest first — clear oldest period&rsquo;s interest first</option>
                  <option value="TOTAL">Total pool — treat all interest as one bucket</option>
                </select>
              </div>
            </div>

            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={formData.config.memberPaymentBreakdownVisible !== false}
                onChange={(e) => handleChange("config.memberPaymentBreakdownVisible", e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: "var(--r-fg-1)" }}>
                  Member payment breakdown visible
                </span>
                <span style={{ display: "block", fontSize: 12, color: "var(--r-fg-4)", marginTop: 2 }}>
                  Show members how much goes to interest vs principal
                </span>
              </span>
            </label>

            <div style={{ borderTop: "1px solid var(--r-hairline)", paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-2)", marginBottom: 4 }}>
                Monthly billing schedule
              </div>
              <p style={{ fontSize: 12, color: "var(--r-fg-4)", marginBottom: 14 }}>
                Enter only a day number. Example: 30 means the 30th of every month. February
                automatically uses its last day. Admins receive email and in-app reminders one day
                before bill creation and payment upload.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16 }}>
                {[
                  ["billGenerationDay", "Bill creation day", "Create monthly bills by this day"],
                  ["paymentUploadDay", "Payment upload day", "Upload the payment Excel by this day"],
                  ["billDueDay", "Bill due day", "Members should pay by this day"],
                ].map(([key, label, help]) => (
                  <div key={key}>
                    <label className="label">{label}</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      step="1"
                      value={formData.config[key]}
                      onChange={(e) => handleChange(`config.${key}`, Number(e.target.value))}
                      className={`input ${errors[key] ? "input-error" : ""}`}
                    />
                    <p style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 6 }}>{help}</p>
                    {errors[key] && <p className="error-text">{errors[key]}</p>}
                  </div>
                ))}
              </div>

              {/* Live timeline built from the three day-numbers above — grounds
                  three lonely input boxes in what they actually mean for a
                  real month, instead of leaving the admin to do the mental
                  math themselves. Updates as the fields change. */}
              <div style={{
                display: "flex", alignItems: "center", marginTop: 20, padding: "14px 4px",
                overflowX: "auto",
              }}>
                {[
                  { day: formData.config.billGenerationDay, label: "Bills created", icon: "file-spreadsheet" },
                  { day: formData.config.paymentUploadDay, label: "Payments uploaded", icon: "upload" },
                  { day: formData.config.billDueDay, label: "Due date", icon: "flag" },
                  { day: (Number(formData.config.billDueDay) || 0) + (Number(formData.config.interestAfterDays) || 0), label: "Interest begins", icon: "percent", wraps: true },
                ].map((step, i, arr) => (
                  <div key={step.label} style={{ display: "flex", alignItems: "center", flex: i < arr.length - 1 ? 1 : "0 0 auto", minWidth: 92 }}>
                    <div style={{ textAlign: "center", flexShrink: 0 }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: "50%", margin: "0 auto 8px",
                        background: "var(--r-brand-soft)", color: "var(--r-brand)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <Icon name={step.icon} size={15} />
                      </div>
                      <div className="revamp-num" style={{ fontSize: 15, fontWeight: 700, color: "var(--r-fg-1)" }}>
                        {step.wraps && step.day > 31 ? `+${Number(formData.config.interestAfterDays) || 0}d` : `Day ${step.day || "—"}`}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--r-fg-4)", marginTop: 2, whiteSpace: "nowrap" }}>{step.label}</div>
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{ flex: 1, height: 1, background: "var(--r-border)", margin: "0 4px 26px" }} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--r-hairline)", paddingTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--r-fg-2)", marginBottom: 10 }}>
                Interest info
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: "var(--r-fg-3)", whiteSpace: "nowrap" }}>
                  Interest starts after due date
                </label>
                <input
                  type="number"
                  min="0"
                  max="365"
                  value={formData.config.interestAfterDays}
                  onChange={(e) => handleChange("config.interestAfterDays", parseInt(e.target.value) || 0)}
                  className="input"
                  style={{ width: 80, textAlign: "center" }}
                />
                <span style={{ fontSize: 13, color: "var(--r-fg-4)" }}>days after the recurring bill due day</span>
                {errors.interestAfterDays && (
                  <span style={{ fontSize: 12, color: "var(--r-danger)" }}>{errors.interestAfterDays}</span>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Commercial module. Always visible to admins - this is the only
            place the module can be switched on. Every flag defaults to off. */}
        <Card>
          <CardHead
            title="Commercial module"
            sub="Directory of the shops and offices inside this society. Changes save immediately — the Save button above does not apply to this section. Turning the master switch off hides the module instantly for members and admins. No data is deleted."
          />
          {commercialMutation.isError && (
            <div style={{ marginBottom: 14, fontSize: 12.5, color: "var(--r-danger)" }}>
              Could not update: {commercialMutation.error?.message}
            </div>
          )}
          <div style={{ display: "grid", gap: 14 }}>
            {[
              ["enabled", "Enable commercial module",
                "Master switch. Off means nothing commercial exists for this society."],
              ["directoryEnabled", "Show the directory in the member app",
                "Members can browse published shops. Off keeps listings admin-only."],
              ["ownerEditingEnabled", "Let shop owners edit their own listing",
                "Owners edit details; publishing and suspending stay with the admin."],
              ["commercialBillingEnabled", "Allow charges restricted to shops/offices",
                "Lets a billing head target specific unit types. Off means every head applies to everyone, exactly as today."],
            ].map(([key, label, help]) => {
              const locked = key !== "enabled" && !commercialFlags.enabled;
              return (
                <label
                  key={key}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    opacity: locked ? 0.5 : 1,
                    cursor: locked ? "not-allowed" : "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!commercialFlags[key]}
                    disabled={locked || commercialMutation.isPending}
                    onChange={(e) => commercialMutation.mutate({ [key]: e.target.checked })}
                    style={{ marginTop: 3 }}
                  />
                  <span>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: "var(--r-fg-1)" }}>
                      {label}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--r-fg-4)", marginTop: 2 }}>
                      {help}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {commercialFlags.enabled && (
            <p style={{ marginTop: 14, fontSize: 12, color: "var(--r-fg-4)" }}>
              Manage listings under Commercial in the sidebar.
            </p>
          )}
        </Card>
      </form>

      <Toast
        toast={successMessage ? { message: successMessage, type: "success" } : null}
        onClose={() => setSuccessMessage("")}
      />
    </div>
  );
}
