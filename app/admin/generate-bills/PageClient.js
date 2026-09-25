"use client";
// app/admin/generate-bills/page.js
//
// Thin segment switch. All wizard logic lives in ./BillGenerationFlow, which
// is rendered once per segment (Residential | Commercial) with the matching
// config from ./segments. The key={activeSegment} is deliberate: it forces a
// full unmount/remount so the two segments never share in-flight local state.
import { useEffect, useState } from "react";
import BillGenerationFlow from "./BillGenerationFlow";
import ScheduledBillCard from "./ScheduledBillCard";
import { SEGMENTS } from "./segments";

export default function GenerateBillsPage() {
  const [activeSegment, setActiveSegment] = useState("residential");
  const [residentialComplete, setResidentialComplete] = useState(false);
  // A society without the Commercial module has no shops to bill, so the
  // segment switch is not disabled or greyed — it is absent, along with the
  // "continue to Commercial" prompt. A greyed-out control is an advertisement
  // and an invitation; a control that was never there is neither.
  //
  // Cosmetic only: /api/commercial/* already 404s for them in middleware, and
  // the bill-generation route refuses a COMMERCIAL billSeries regardless of
  // what this page rendered.
  const [hasCommercial, setHasCommercial] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/entitlements", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setHasCommercial(d?.modules?.commercial === true);
      })
      // Unknown renders the switch — the server refuses the work anyway, and
      // hiding a control from a society that paid for it is the worse error.
      .catch(() => alive && setHasCommercial(true));
    return () => {
      alive = false;
    };
  }, []);

  const segments = hasCommercial === false ? ["residential"] : ["residential", "commercial"];
  const showSwitch = segments.length > 1;

  return (
    <>
      {showSwitch && (
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "1rem 1.5rem 0" }}>
        <div style={{ display: "inline-flex", padding: 3, background: "var(--accent-tint)", borderRadius: 10, gap: 2 }}>
          {segments.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveSegment(key)}
              style={{
                padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                fontWeight: 700, fontSize: "0.82rem",
                background: activeSegment === key ? "var(--bg-surface)" : "transparent",
                color: activeSegment === key ? "var(--primary)" : "var(--fg-4)",
                boxShadow: activeSegment === key ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {SEGMENTS[key].label}
            </button>
          ))}
        </div>
      </div>
      )}

      <ScheduledBillCard
        billSeries={activeSegment === "commercial" ? "COMMERCIAL" : "RESIDENTIAL"}
      />

      {activeSegment === "residential" && residentialComplete && hasCommercial !== false && (
        <div style={{ margin: "0 1.5rem 1rem", padding: "1rem 1.25rem", background: "var(--success-bg)", border: "1px solid var(--success)", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
          <span style={{ color: "var(--success-fg)", fontWeight: 600, fontSize: "0.88rem" }}>
            Residential billing complete for this cycle. Continue to Commercial billing?
          </span>
          <button
            type="button"
            onClick={() => setActiveSegment("commercial")}
            style={{ padding: "0.5rem 1rem", borderRadius: 8, border: "none", background: "var(--success)", color: "var(--on-solid)", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}
          >
            Continue to Commercial →
          </button>
        </div>
      )}

      <BillGenerationFlow
        key={activeSegment}
        segment={SEGMENTS[activeSegment]}
        onSegmentComplete={() => {
          if (activeSegment === "residential") setResidentialComplete(true);
        }}
      />
    </>
  );
}
