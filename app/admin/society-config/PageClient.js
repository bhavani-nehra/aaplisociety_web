"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { produce } from "immer";
import Link from "next/link";
import { RevampSkeleton, Toast } from "@/components/revamp";
import "@/components/money/money.css";

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
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <RevampSkeleton h={80} style={{ marginBottom: 14 }} />
        <RevampSkeleton h={260} />
      </div>
    );
  }

  const c = formData.config;
  const dueDay = Number(c.billDueDay) || 0;
  const example = (100000 * (Number(c.interestRate) || 0)) / 1200;
  const steps = [
    ["Bills created", c.billGenerationDay],
    ["Payments uploaded", c.paymentUploadDay],
    ["Due date", c.billDueDay],
    ["Interest begins", dueDay + (Number(c.interestAfterDays) || 0)],
  ];
  const field = (label, help, error, control) => (
    <label className="mn-field"><span className="l">{label}</span>{control}{error ? <small className="err">{error}</small> : help ? <small>{help}</small> : null}</label>
  );
  const num = (k, min, max, step, err) => (
    <input
      type="number" min={min} max={max} step={step} value={c[k]} className={`mn-input ${err ? "bad" : ""}`}
      onChange={(e) => handleChange(`config.${k}`, step ? parseFloat(e.target.value) || 0 : Number(e.target.value))}
    />
  );

  return (
    <div className="mn" style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 14 }}>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
        <div className="mn-card mn-h" style={{ flexWrap: "wrap", padding: "16px 24px" }}>
          <div>
            <div className="mn-lbl">Config</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: "var(--mn-navy)", marginTop: 4 }} className="mn-ov-title">Society configuration</div>
            <div className="mn-sub">Society details, interest rules and the monthly billing calendar.</div>
          </div>
          <div className="mn-row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="mn-btn" onClick={() => window.location.reload()}>Reset changes</button>
            <button type="submit" className="mn-btn solid" disabled={updateMutation.isPending}>{updateMutation.isPending ? "Saving…" : "Save configuration"}</button>
          </div>
          <style>{`:root[data-theme="dark"] .mn-ov-title{color:var(--mn-ink)!important}`}</style>
        </div>

        {errors.submit && <div className="mn-card" style={{ borderColor: "var(--mn-bad)" }}><b style={{ color: "var(--mn-bad)" }}>Update failed</b><div className="mn-sub" style={{ marginTop: 4 }}>{errors.submit}</div></div>}

        <div className="mn-grid">
          <div className="mn-s8" style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <div className="mn-card">
              <div className="mn-lbl">Society</div>
              <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                {field("Society name *", null, errors.name,
                  <input type="text" className={`mn-input ${errors.name ? "bad" : ""}`} value={formData.name} onChange={(e) => handleChange("name", e.target.value)} placeholder="Green Valley Apartments" />)}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                  {field("Registration number", null, null,
                    <input type="text" className="mn-input" value={formData.registrationNo} onChange={(e) => handleChange("registrationNo", e.target.value)} placeholder="REG/2024/1234" />)}
                  {field("Address", null, null,
                    <textarea rows="2" className="mn-input" value={formData.address} onChange={(e) => handleChange("address", e.target.value)} placeholder="Complete society address" />)}
                </div>
              </div>
            </div>

            <div className="mn-card">
              <div className="mn-lbl">Money rules</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginTop: 14 }}>
                {field("Interest on arrears (% a year) *", "Charged on overdue dues, e.g. 21.", errors.interestRate, num("interestRate", "0", "100", "0.01", errors.interestRate))}
                {field("Service tax (%)", "Applied on total charges, e.g. 2.", errors.serviceTaxRate, num("serviceTaxRate", "0", "100", "0.01", errors.serviceTaxRate))}
                {field("Interest rounding", "Use Round up if the society never spares even ₹0.01.", null,
                  <select className="mn-input" value={c.interestRounding || "TWO_DECIMAL"} onChange={(e) => handleChange("config.interestRounding", e.target.value)}>
                    <option value="TWO_DECIMAL">2 decimals (10.256 becomes 10.26)</option>
                    <option value="ROUND_UP">Round up to a whole rupee (10.001 becomes 11)</option>
                  </select>)}
                {field("Interest use mode", "Which interest a payment clears first.", null,
                  <select className="mn-input" value={c.interestUseMode || "OLDEST_FIRST"} onChange={(e) => handleChange("config.interestUseMode", e.target.value)}>
                    <option value="OLDEST_FIRST">Oldest first</option>
                    <option value="TOTAL">One pool for all interest</option>
                  </select>)}
              </div>
              <label className="mn-switch" style={{ marginTop: 14 }}>
                <input type="checkbox" checked={c.memberPaymentBreakdownVisible !== false} onChange={(e) => handleChange("config.memberPaymentBreakdownVisible", e.target.checked)} />
                <span className="knob" />
                <span><b>Members see the payment breakdown</b><small>Shows how much of a payment went to interest and how much to dues.</small></span>
              </label>
            </div>

            <div className="mn-card">
              <div className="mn-h" style={{ flexWrap: "wrap" }}><span className="mn-lbl">Monthly billing calendar</span><span className="mn-sub">Day numbers only. February uses its last day.</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginTop: 14 }}>
                {field("Bill creation day", "Create monthly bills by this day.", errors.billGenerationDay, num("billGenerationDay", "1", "31", null, errors.billGenerationDay))}
                {field("Payment upload day", "Upload the payment Excel by this day.", errors.paymentUploadDay, num("paymentUploadDay", "1", "31", null, errors.paymentUploadDay))}
                {field("Bill due day", "Members should pay by this day.", errors.billDueDay, num("billDueDay", "1", "31", null, errors.billDueDay))}
                {field("Interest starts after (days)", "Days after the due day.", errors.interestAfterDays,
                  <input type="number" min="0" max="365" className={`mn-input ${errors.interestAfterDays ? "bad" : ""}`} value={c.interestAfterDays} onChange={(e) => handleChange("config.interestAfterDays", parseInt(e.target.value) || 0)} />)}
              </div>
            </div>
          </div>

          <div className="mn-s4" style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <div className="mn-dk">
              <div className="mn-lbl">A month, as members live it</div>
              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                {steps.map(([l, day], i) => (
                  <div key={l} className="mn-row" style={{ gap: 12 }}>
                    <span className="mn-av" style={{ width: 34, height: 34, fontSize: 12 }}>{i + 1}</span>
                    <div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{l}</b></div>
                    <b className="mn-num" style={{ fontSize: 16 }}>{i === 3 && day > 31 ? `due + ${Number(c.interestAfterDays) || 0}d` : `Day ${day || "—"}`}</b>
                  </div>
                ))}
              </div>
            </div>
            <div className="mn-card">
              <div className="mn-lbl">What the interest rule means</div>
              <div className="mn-num" style={{ fontSize: 26, marginTop: 8 }}>₹{example.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
              <div className="mn-sub" style={{ marginTop: 4 }}>a month on ₹1,00,000 overdue, at {Number(c.interestRate) || 0}% a year.</div>
            </div>
            <div className="mn-card">
              <div className="mn-lbl">Related</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                <Link className="mn-btn" href="/admin/billing-config">Billing heads</Link>
                <Link className="mn-btn" href="/admin/bill-template">Bill template</Link>
                <Link className="mn-btn" href="/admin/rbac/roles">Roles &amp; access</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mn-card">
          <div className="mn-lbl">Commercial module</div>
          <div className="mn-sub" style={{ marginTop: 4 }}>Shops and offices inside this society. These switches save at once; the Save button above does not apply. Turning the master switch off hides the module. No data is deleted.</div>
          {commercialMutation.isError && <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--mn-bad)" }}>Could not update: {commercialMutation.error?.message}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, marginTop: 14 }}>
            {[
              ["enabled", "Enable commercial module", "Master switch. Off means nothing commercial exists here."],
              ["directoryEnabled", "Show the directory in the member app", "Members browse published shops. Off keeps listings admin-only."],
              ["ownerEditingEnabled", "Let shop owners edit their listing", "Publishing and suspending stay with the admin."],
              ["commercialBillingEnabled", "Allow charges limited to shops and offices", "Off means every billing head applies to everyone."],
            ].map(([key, label, help]) => {
              const locked = key !== "enabled" && !commercialFlags.enabled;
              return (
                <label key={key} className={`mn-switch ${locked ? "off" : ""}`}>
                  <input type="checkbox" checked={!!commercialFlags[key]} disabled={locked || commercialMutation.isPending} onChange={(e) => commercialMutation.mutate({ [key]: e.target.checked })} />
                  <span className="knob" />
                  <span><b>{label}</b><small>{help}</small></span>
                </label>
              );
            })}
          </div>
          {commercialFlags.enabled && <Link className="mn-link" href="/admin/commercial" style={{ display: "inline-block", marginTop: 12 }}>Open Shops &amp; offices ›</Link>}
        </div>
      </form>

      <Toast toast={successMessage ? { message: successMessage, type: "success" } : null} onClose={() => setSuccessMessage("")} />
    </div>
  );
}
