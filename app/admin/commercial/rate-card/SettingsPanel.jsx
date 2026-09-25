"use client";
// app/admin/commercial/rate-card/SettingsPanel.jsx
//
// The "Rules" tab of the shop & office rate card.
//
// Everything here is a SOCIETY-WIDE decision that applies to every shop and
// office, because you asked for one rate card for all units and no per-unit
// overrides. There is deliberately no override screen anywhere in this build.
//
// Covers: GST, interest, society-managed electricity, sinking & repair funds,
// non-occupancy charge, and whether a business profile is required before a
// shop can be billed.
//
// Every control states, in a sentence, what it does to the bill. No admin
// should have to guess what "threshold basis" means.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { Card, CardHead, Btn, Pill } from "../_ui";

/* ------------------------------------------------------------------ atoms */

const L = ({ children, hint }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cx-fg-1)" }}>{children}</div>
    {hint && (
      <div style={{ fontSize: 12, color: "var(--cx-fg-3)", lineHeight: 1.5, marginTop: 2 }}>
        {hint}
      </div>
    )}
  </div>
);

const inputStyle = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--cx-border)",
  background: "var(--cx-bg-1)",
  color: "var(--cx-fg-1)",
  fontSize: 13,
};

const Num = ({ value, onChange, suffix, min = 0, step = "any", disabled }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <input
      type="number"
      min={min}
      step={step}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      style={{ ...inputStyle, maxWidth: 150, opacity: disabled ? 0.5 : 1 }}
    />
    {suffix && <span style={{ fontSize: 12, color: "var(--cx-fg-3)" }}>{suffix}</span>}
  </div>
);

const Sel = ({ value, onChange, options, disabled }) => (
  <select
    value={value ?? ""}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    style={{ ...inputStyle, maxWidth: 320, opacity: disabled ? 0.5 : 1 }}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

const Check = ({ checked, onChange, label, hint }) => (
  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onChange(e.target.checked)}
      style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }}
    />
    <span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cx-fg-1)" }}>{label}</span>
      {hint && (
        <span
          style={{ display: "block", fontSize: 12, color: "var(--cx-fg-3)", lineHeight: 1.5, marginTop: 2 }}
        >
          {hint}
        </span>
      )}
    </span>
  </label>
);

const Section = ({ title, sub, children, right }) => (
  <Card style={{ marginBottom: 14 }}>
    <CardHead title={title} sub={sub} right={right} />
    <div style={{ display: "grid", gap: 16, marginTop: 4 }}>{children}</div>
  </Card>
);

const Row = ({ children }) => (
  <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
    {children}
  </div>
);

const Note = ({ tone = "info", children }) => {
  const c =
    tone === "warn"
      ? { bg: "var(--cx-warn-bg,var(--bg-muted))", bd: "var(--cx-warn,var(--warning))" }
      : { bg: "var(--cx-info-bg,var(--primary-tint))", bd: "var(--cx-info,var(--accent))" };
  return (
    <div
      style={{
        background: c.bg,
        borderLeft: `3px solid ${c.bd}`,
        borderRadius: 6,
        padding: "9px 12px",
        fontSize: 12.5,
        lineHeight: 1.6,
        color: "var(--cx-fg-2)",
      }}
    >
      {children}
    </div>
  );
};

/* ------------------------------------------------------------------ main */

export default function SettingsPanel() {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [toast, setToast] = useState(null);
  const [issues, setIssues] = useState([]);

  const settingsQ = useQuery({
    queryKey: ["commercial-settings"],
    queryFn: () => apiClient.get("/api/commercial/settings"),
  });

  const basisQ = useQuery({
    queryKey: ["society-area-basis"],
    queryFn: () => apiClient.get("/api/society/area-basis"),
  });

  useEffect(() => {
    if (settingsQ.data?.settings && !draft) setDraft(settingsQ.data.settings);
  }, [settingsQ.data, draft]);

  const flash = (tone, text) => {
    setToast({ tone, text });
    setTimeout(() => setToast(null), 6000);
  };

  const save = useMutation({
    mutationFn: (payload) => apiClient.put("/api/commercial/settings", payload),
    onSuccess: (r) => {
      setIssues([]);
      qc.invalidateQueries({ queryKey: ["commercial-settings"] });
      qc.invalidateQueries({ queryKey: ["commercial-readiness"] });
      flash("ok", r?.nextStep || "Rules saved. They apply from your next bill run.");
    },
    onError: (e) => {
      const body = e?.body || e?.data || {};
      setIssues(Array.isArray(body.issues) ? body.issues : []);
      flash("error", body.error || e?.message || "Could not save these rules.");
    },
  });

  const basisSave = useMutation({
    mutationFn: (areaBasis) => apiClient.put("/api/society/area-basis", { areaBasis }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["society-area-basis"] });
      flash("ok", r?.nextStep || "Saved.");
    },
    onError: (e) => {
      const body = e?.body || e?.data || {};
      flash("error", [body.error, body.hint, body.fix].filter(Boolean).join(" "));
    },
  });

  if (settingsQ.isLoading || !draft) {
    return (
      <Card>
        <div style={{ padding: 28, textAlign: "center", color: "var(--cx-fg-3)", fontSize: 13 }}>
          Loading your billing rules…
        </div>
      </Card>
    );
  }

  if (settingsQ.error) {
    return (
      <Card>
        <div style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--cx-fg-1)" }}>
            Could not load your billing rules
          </div>
          <p style={{ fontSize: 13, color: "var(--cx-fg-3)", lineHeight: 1.6, marginBottom: 14 }}>
            The rules could not be fetched. Nothing has been changed. This is usually a
            connection problem rather than a problem with your data.
          </p>
          <Btn variant="primary" onClick={() => settingsQ.refetch()}>
            Try again
          </Btn>
        </div>
      </Card>
    );
  }

  // immutably set a nested value: set("gst.ratePercent", 18)
  const set = (path, value) => {
    setDraft((prev) => {
      const next = structuredClone(prev);
      const keys = path.split(".");
      let node = next;
      for (const k of keys.slice(0, -1)) {
        node[k] = node[k] ?? {};
        node = node[k];
      }
      node[keys.at(-1)] = value;
      return next;
    });
  };

  const g = draft.gst ?? {};
  const i = draft.interest ?? {};
  const no = draft.nonOccupancy ?? {};
  const noc = no.commercial ?? {};
  const el = draft.electricity ?? {};
  const f = draft.funds ?? {};
  const sink = f.sinking ?? {};
  const rep = f.repair ?? {};

  const issueFor = (field) => issues.find((x) => x.field === field)?.message;

  const Err = ({ field }) => {
    const m = issueFor(field);
    if (!m) return null;
    return (
      <div style={{ fontSize: 12, color: "var(--cx-danger,var(--danger))", marginTop: 4 }}>{m}</div>
    );
  };

  const basis = basisQ.data?.areaBasis || "carpet";
  const cov = basisQ.data?.coverage;

  return (
    <div>
      {toast && (
        <div
          style={{
            marginBottom: 14,
            padding: "11px 14px",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.6,
            background: toast.tone === "ok" ? "var(--cx-ok-bg,var(--success-bg))" : "var(--cx-danger-bg,var(--danger-bg))",
            border: `1px solid ${toast.tone === "ok" ? "var(--cx-ok,var(--success))" : "var(--cx-danger,var(--danger))"}`,
            color: "var(--cx-fg-1)",
          }}
        >
          {toast.text}
        </div>
      )}

      <Note>
        These rules apply to <b>every shop and office</b> in this society. There are no per-unit
        rate overrides anywhere in this system — one rate card, one set of rules, so a bill can
        always be explained from this page alone. Residential flats are not affected by anything
        on this tab.
      </Note>

      <div style={{ height: 14 }} />

      {/* ---------------------------------------------------------- GST */}
      <Section
        title="GST"
        sub="Whether GST is added on top of a shop's bill"
        right={<Pill tone={g.mode === "None" ? "neutral" : "active"}>{g.mode || "None"}</Pill>}
      >
        <div>
          <L hint="Most societies do not charge GST until they cross the registration limit. If you are unsure, leave this off and ask your auditor.">
            When should GST be added?
          </L>
          <Sel
            value={g.mode}
            onChange={(v) => set("gst.mode", v)}
            options={[
              { value: "None", label: "Never — do not add GST to shop bills" },
              { value: "AboveThreshold", label: "Only when a unit's charges cross a monthly limit" },
              { value: "Always", label: "Always — add GST to every shop bill" },
            ]}
          />
          <Err field="gst.mode" />
        </div>

        {g.mode !== "None" && (
          <>
            <Row>
              <div>
                <L hint="18% is the standard rate on society maintenance.">GST rate</L>
                <Num value={g.ratePercent} onChange={(v) => set("gst.ratePercent", v)} suffix="%" />
                <Err field="gst.ratePercent" />
              </div>
              <div>
                <L hint="Your society's GSTIN, printed on the bill.">Society GSTIN</L>
                <input
                  value={g.societyGstin ?? ""}
                  onChange={(e) => set("gst.societyGstin", e.target.value.toUpperCase())}
                  placeholder="27ABCDE1234F1Z5"
                  style={inputStyle}
                />
                <Err field="gst.societyGstin" />
              </div>
            </Row>

            {g.mode === "AboveThreshold" && (
              <Row>
                <div>
                  <L hint="Per unit, per month. The common figure used by societies is ₹7,500.">
                    Limit before GST applies
                  </L>
                  <Num
                    value={g.thresholdPerUnitPerMonth}
                    onChange={(v) => set("gst.thresholdPerUnitPerMonth", v)}
                    suffix="₹ / month"
                  />
                  <Err field="gst.thresholdPerUnitPerMonth" />
                </div>
                <div>
                  <L hint="Which figure is compared against the limit.">Compare the limit against</L>
                  <Sel
                    value={g.thresholdBasis}
                    onChange={(v) => set("gst.thresholdBasis", v)}
                    options={[
                      { value: "ServiceChargesOnly", label: "Service charges only" },
                      { value: "WholeBill", label: "The whole bill" },
                    ]}
                  />
                </div>
              </Row>
            )}
          </>
        )}
      </Section>

      {/* ----------------------------------------------------- interest */}
      <Section
        title="Late payment interest"
        sub="Charged on what a shop still owes from earlier months"
        right={<Pill tone={i.enabled ? "active" : "neutral"}>{i.enabled ? "On" : "Off"}</Pill>}
      >
        <Check
          checked={i.enabled}
          onChange={(v) => set("interest.enabled", v)}
          label="Charge interest on overdue shop bills"
          hint="Turn this off and shop bills will never carry an interest line, whatever the residential setting is."
        />
        {i.enabled && (
          <Row>
            <div>
              <L hint="21% a year is the maximum most bye-laws allow.">Interest rate</L>
              <Num
                value={i.annualRatePercent}
                onChange={(v) => set("interest.annualRatePercent", v)}
                suffix="% per year"
              />
              <Err field="interest.annualRatePercent" />
            </div>
            <div>
              <L hint="Simple interest does not charge interest on unpaid interest. Bye-laws expect simple.">
                Method
              </L>
              <Sel
                value={i.method}
                onChange={(v) => set("interest.method", v)}
                options={[
                  { value: "SIMPLE", label: "Simple interest (recommended)" },
                  { value: "COMPOUND", label: "Compound interest" },
                ]}
              />
            </div>
            <div>
              <L hint="Days after the due date before interest starts.">Grace period</L>
              <Num value={i.graceDays} onChange={(v) => set("interest.graceDays", v)} suffix="days" />
            </div>
          </Row>
        )}
      </Section>

      {/* -------------------------------------------------- electricity */}
      <Section
        title="Electricity"
        sub="Only for societies that supply shops through a common meter"
        right={
          <Pill tone={el.societyManagedEnabled ? "active" : "neutral"}>
            {el.societyManagedEnabled ? "Society-managed" : "Shops pay direct"}
          </Pill>
        }
      >
        <Note>
          By default every shop pays its own electricity bill directly to the supply company and
          nothing appears on the society bill. Only switch this on if your society holds a common
          meter and recovers usage from shops through sub-meters.
        </Note>

        <Check
          checked={el.societyManagedEnabled}
          onChange={(v) => set("electricity.societyManagedEnabled", v)}
          label="Society-managed electricity billing (common meter with sub-meter recovery)"
          hint="When on, each shop set to 'Society-managed sub-meter' gets an electricity line built from its meter reading."
        />

        {el.societyManagedEnabled && (
          <>
            <Row>
              <div>
                <L hint="What you charge a shop for each unit consumed.">Rate per unit</L>
                <Num value={el.ratePerUnit} onChange={(v) => set("electricity.ratePerUnit", v)} suffix="₹ / unit" />
                <Err field="electricity.ratePerUnit" />
              </div>
              <div>
                <L hint="Added every month regardless of usage. Leave 0 if you do not charge one.">
                  Fixed monthly charge
                </L>
                <Num
                  value={el.fixedMonthlyCharge}
                  onChange={(v) => set("electricity.fixedMonthlyCharge", v)}
                  suffix="₹"
                />
              </div>
            </Row>
            <Check
              checked={el.requireMeterReading}
              onChange={(v) => set("electricity.requireMeterReading", v)}
              label="Refuse to generate a bill if the meter reading is missing"
              hint="Recommended. Otherwise a shop with no reading is billed only the fixed charge, and nobody notices for months."
            />
          </>
        )}
      </Section>

      {/* --------------------------------------------------------- funds */}
      <Section title="Sinking fund & repair fund" sub="The two statutory funds, charged to shops as well">
        <Note>
          These work exactly like the residential funds, but with their own amounts for shops. Set
          the unit for each one: a rate per sq ft, a percentage of the shop&apos;s other charges, or a
          flat amount.
        </Note>

        <div>
          <Check
            checked={sink.enabled}
            onChange={(v) => set("funds.sinking.enabled", v)}
            label="Charge a sinking fund on shops"
            hint="Bye-law 13(c) suggests 0.25% a year of construction cost. Most societies convert this to a per-sq-ft monthly figure."
          />
          {sink.enabled && (
            <div style={{ marginTop: 10, marginLeft: 26 }}>
              <Row>
                <div>
                  <L>How is it calculated?</L>
                  <Sel
                    value={sink.method}
                    onChange={(v) => set("funds.sinking.method", v)}
                    options={[
                      { value: "PerSqFt", label: "Rupees per sq ft, per month" },
                      { value: "Percent", label: "Percentage of the shop's other charges" },
                      { value: "Fixed", label: "Flat amount per month" },
                    ]}
                  />
                </div>
                <div>
                  <L>Amount</L>
                  <Num
                    value={sink.value}
                    onChange={(v) => set("funds.sinking.value", v)}
                    suffix={sink.method === "Percent" ? "%" : sink.method === "PerSqFt" ? "₹ / sq ft" : "₹"}
                  />
                  <Err field="funds.sinking.value" />
                </div>
              </Row>
            </div>
          )}
        </div>

        <div>
          <Check
            checked={rep.enabled}
            onChange={(v) => set("funds.repair.enabled", v)}
            label="Charge a repair fund on shops"
            hint="Bye-law 13(b) suggests 0.75% a year of construction cost."
          />
          {rep.enabled && (
            <div style={{ marginTop: 10, marginLeft: 26 }}>
              <Row>
                <div>
                  <L>How is it calculated?</L>
                  <Sel
                    value={rep.method}
                    onChange={(v) => set("funds.repair.method", v)}
                    options={[
                      { value: "PerSqFt", label: "Rupees per sq ft, per month" },
                      { value: "Percent", label: "Percentage of the shop's other charges" },
                      { value: "Fixed", label: "Flat amount per month" },
                    ]}
                  />
                </div>
                <div>
                  <L>Amount</L>
                  <Num
                    value={rep.value}
                    onChange={(v) => set("funds.repair.value", v)}
                    suffix={rep.method === "Percent" ? "%" : rep.method === "PerSqFt" ? "₹ / sq ft" : "₹"}
                  />
                  <Err field="funds.repair.value" />
                </div>
              </Row>
            </div>
          )}
        </div>
      </Section>

      {/* ------------------------------------------------- non-occupancy */}
      <Section
        title="Non-occupancy charge"
        sub="Extra charge when the owner has rented the unit out"
        right={<Pill tone={no.enabled ? "active" : "neutral"}>{no.enabled ? "On" : "Off"}</Pill>}
      >
        <Check
          checked={no.enabled}
          onChange={(v) => set("nonOccupancy.enabled", v)}
          label="Charge non-occupancy on rented units"
          hint="Applied only to units marked as 'Rented out'. Owner-occupied and vacant units are never charged."
        />

        {no.enabled && (
          <>
            <div>
              <L hint="Choose which units this applies to.">Apply to</L>
              <Sel
                value={no.appliesTo}
                onChange={(v) => set("nonOccupancy.appliesTo", v)}
                options={[
                  { value: "Commercial", label: "Shops and offices only" },
                  { value: "Residential", label: "Residential flats only" },
                  { value: "Both", label: "Both flats and shops" },
                ]}
              />
            </div>

            {no.appliesTo !== "Residential" && (
              <>
                <Row>
                  <div>
                    <L>How is the shop charge calculated?</L>
                    <Sel
                      value={noc.method}
                      onChange={(v) => set("nonOccupancy.commercial.method", v)}
                      options={[
                        { value: "Percent", label: "Percentage of the shop's service charges" },
                        { value: "Rupees", label: "Flat amount in rupees" },
                      ]}
                    />
                  </div>
                  <div>
                    <L>Value</L>
                    <Num
                      value={noc.value}
                      onChange={(v) => set("nonOccupancy.commercial.value", v)}
                      suffix={noc.method === "Percent" ? "%" : "₹"}
                    />
                    <Err field="nonOccupancy.commercial.value" />
                  </div>
                  <div>
                    <L hint="A hard ceiling. Courts have held 10% of service charges to be the limit.">
                      Never exceed
                    </L>
                    <Num
                      value={noc.capPercentOfServiceCharges}
                      onChange={(v) => set("nonOccupancy.commercial.capPercentOfServiceCharges", v)}
                      suffix="% of service charges"
                    />
                  </div>
                </Row>
                <Note tone="warn">
                  Whatever you enter above, the charge is capped at{" "}
                  <b>{noc.capPercentOfServiceCharges ?? 10}% of the shop&apos;s service charges</b>. This
                  ceiling comes from the Bombay High Court ruling and the Maharashtra government
                  circular on non-occupancy charges, and the system will not let a bill exceed it.
                </Note>
              </>
            )}
          </>
        )}
      </Section>

      {/* ------------------------------------------- before-billing gate */}
      <Section title="Before a shop can be billed" sub="What the system insists on having first">
        <Check
          checked={draft.requireBusinessProfileBeforeBilling}
          onChange={(v) => set("requireBusinessProfileBeforeBilling", v)}
          label="Require the business details before generating a shop's bill"
          hint="Business name and category. Turn this on if you want a complete commercial register; leave it off if you would rather start billing immediately and fill the details later."
        />
        <div>
          <L hint="Shop bill numbers look like C-2026-08-A-103, so a shop bill can never be mistaken for a flat bill.">
            Shop bill number prefix
          </L>
          <input
            value={draft.billNumberPrefix ?? "C"}
            onChange={(e) => set("billNumberPrefix", e.target.value.toUpperCase().slice(0, 4))}
            style={{ ...inputStyle, maxWidth: 120 }}
          />
          <Err field="billNumberPrefix" />
        </div>
      </Section>

      {/* --------------------------------------------- residential basis */}
      <Section
        title="How flats are measured"
        sub="Residential only — shops always use their own recorded area"
      >
        <Note>
          This is the one setting on this page that affects <b>residential</b> bills. Your society
          records both carpet and built-up areas, so the system needs to be told which one the
          money is based on. Changing it re-prices every future residential bill immediately.
          Bills you have already generated keep the area printed on them.
        </Note>

        <div>
          <L>Residential bills are calculated on</L>
          <Sel
            value={basis}
            disabled={basisSave.isPending}
            onChange={(v) => basisSave.mutate(v)}
            options={[
              { value: "carpet", label: "Carpet area" },
              { value: "builtup", label: "Built-up area" },
            ]}
          />
          {cov && (
            <div style={{ fontSize: 12, color: "var(--cx-fg-3)", marginTop: 8, lineHeight: 1.6 }}>
              Of {cov.total} flats: {cov.withCarpet} have a carpet area, {cov.withBuiltUp} have a
              built-up area.
              {basis === "carpet" && cov.missingIfCarpet > 0 && (
                <b> {cov.missingIfCarpet} have no carpet area and would bill ₹0 on per-sq-ft charges.</b>
              )}
              {basis === "builtup" && cov.missingIfBuiltUp > 0 && (
                <b> {cov.missingIfBuiltUp} have no built-up area and fall back to carpet area.</b>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ---------------------------------------------------------- save */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: "12px 0",
          background: "var(--cx-bg-0)",
          borderTop: "1px solid var(--cx-border)",
        }}
      >
        <Btn variant="primary" disabled={save.isPending} onClick={() => save.mutate(draft)}>
          {save.isPending ? "Saving…" : "Save these rules"}
        </Btn>
        <Btn
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            setDraft(settingsQ.data?.settings ?? null);
            setIssues([]);
            flash("ok", "Changes discarded.");
          }}
        >
          Discard changes
        </Btn>
        <span style={{ fontSize: 12, color: "var(--cx-fg-3)" }}>
          Nothing here changes a bill that has already been generated.
        </span>
      </div>
    </div>
  );
}
