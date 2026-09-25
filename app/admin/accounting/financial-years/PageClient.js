"use client";

/**
 * Financial Years — create the year the books live in.
 *
 * ## The one thing this page must get right
 *
 * Its reader has kept society accounts on paper for twenty years and has never
 * been asked to "create a Financial Year" — because on paper you do not. You
 * take a new book down off the shelf in April.
 *
 * So the page opens by saying that, and the common case is one button. The
 * service already defaults label and dates from getFinancialYearRange(), so
 * asking for dates up front would be asking for information the system already
 * has, from the person least able to supply it. Custom dates stay available
 * behind a link for the society whose year genuinely differs.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import notify from "@/lib/notify";

const STATUS_TONE = {
  Draft: { bg: "var(--bg-subtle, #f3f4f6)", fg: "var(--fg-3)", says: "Open — entries can be recorded" },
  Reviewed: { bg: "#e0f2fe", fg: "#075985", says: "Checked, awaiting the auditor" },
  "Auditor Review": { bg: "#fef3c7", fg: "#92400e", says: "With the auditor" },
  Approved: { bg: "#dcfce7", fg: "#166534", says: "Approved" },
  Locked: { bg: "#e5e7eb", fg: "#374151", says: "Closed — no further entries" },
};

// Same 5-state chain FinancialYearService enforces server-side — shown here
// only so the checklist reads as "step 3 of 4", not a bare word.
const CHAIN = ["Draft", "Reviewed", "Auditor Review", "Approved", "Locked"];

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })
    : "—";

/** April-to-March label for a date, e.g. "2026-27". */
function suggestLabel(now = new Date()) {
  const y = now.getFullYear();
  const startYear = now.getMonth() >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export default function PageClient() {
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState({ label: "", startDate: "", endDate: "" });

  // Lock/unlock checklist — Draft -> Reviewed -> Auditor Review -> Approved
  // -> Locked. The backend (FinancialClosingService) has always had this;
  // nothing here existed to trigger it from, so a year sat in Draft forever
  // with no way to move it forward short of calling the API by hand.
  const [openId, setOpenId] = useState(null);
  const [checklists, setChecklists] = useState({}); // yearId -> checklist | "loading" | error string
  const [advancing, setAdvancing] = useState(null);

  const toggleChecklist = useCallback(async (id) => {
    setOpenId((cur) => (cur === id ? null : id));
    if (checklists[id]) return; // already fetched once — don't re-fetch on every toggle
    setChecklists((c) => ({ ...c, [id]: "loading" }));
    try {
      const res = await fetch(`/api/accounting/financial-years/${id}/closing-checklist`, { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the checklist");
      setChecklists((c) => ({ ...c, [id]: json.checklist }));
    } catch (e) {
      setChecklists((c) => ({ ...c, [id]: e.message }));
    }
  }, [checklists]);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/financial-years", {
        credentials: "include",
        signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load Financial Years");
      setYears(json.financialYears || []);
    } catch (e) {
      if (e?.name !== "AbortError") setError(e.message);
    } finally {
      // A StrictMode double-mount (dev only) aborts the first of two calls to
      // this load() — without this guard its `finally` still clears loading
      // right away, flashing the empty state before the second, real fetch
      // resolves seconds later.
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  const advance = useCallback(async (id) => {
    setAdvancing(id);
    try {
      const res = await fetch(`/api/accounting/financial-years/${id}/transition`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not move it forward");
      notify.success(`Now "${json.financialYear.status}".`);
      setChecklists((c) => ({ ...c, [id]: undefined })); // stale — refetch next open
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setAdvancing(null);
    }
  }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  async function create(body) {
    setCreating(true);
    try {
      const res = await fetch("/api/accounting/financial-years", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not create the Financial Year");
      notify.success(`Financial Year ${json.financialYear?.label || ""} created`);
      setCustom(false);
      setDraft({ label: "", startDate: "", endDate: "" });
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setCreating(false);
    }
  }

  const suggested = suggestLabel();
  const alreadyHaveSuggested = years.some((y) => y.label === suggested);

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "24px 20px 56px" }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Financial Years</h1>
      <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--fg-4)" }}>
        The year your books cover — 1 April {suggested.slice(0, 4)} to 31 March
        20{suggested.slice(5)} for the current one
      </p>

      <div style={INTRO}>
        <strong>In plain words:</strong> this is the account book for one year.
        On paper you would take a new book down off the shelf every April — this
        is the same thing. Everything else in Accounting (opening balances,
        bills, receipts, the final statements) is recorded inside one of these.
        You need at least one before anything else will work.
      </div>

      {/* ── create ─────────────────────────────────────────────────────── */}
      <section style={CARD}>
        <h2 style={H2}>Start a year</h2>
        {alreadyHaveSuggested ? (
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--fg-4)" }}>
            {suggested} already exists — it is in the list below. You only need a
            new one when the next April comes round.
          </p>
        ) : (
          <>
            <p style={{ margin: "8px 0 14px", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.6 }}>
              Going by today&apos;s date, the year you want is{" "}
              <strong>{suggested}</strong> — 1 April {suggested.slice(0, 4)} to 31
              March 20{suggested.slice(5)}. That is the normal choice for a
              housing society.
            </p>
            <button type="button" disabled={creating} onClick={() => create({})} style={PRIMARY}>
              {creating ? "Creating…" : `Create Financial Year ${suggested}`}
            </button>
          </>
        )}

        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            onClick={() => setCustom((v) => !v)}
            style={LINKBTN}
          >
            {custom ? "Never mind" : "My society's year runs on different dates"}
          </button>
        </div>

        {custom ? (
          <div style={{ marginTop: 14, display: "grid", gap: 10, maxWidth: 420 }}>
            <Field label="Name it" hint="For example 2026-27">
              <input
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder={suggested}
                style={INPUT}
              />
            </Field>
            <Field label="First day">
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
                style={INPUT}
              />
            </Field>
            <Field label="Last day">
              <input
                type="date"
                value={draft.endDate}
                onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
                style={INPUT}
              />
            </Field>
            <button
              type="button"
              disabled={creating || !draft.startDate || !draft.endDate}
              onClick={() => create(draft)}
              style={{ ...PRIMARY, opacity: creating || !draft.startDate || !draft.endDate ? 0.5 : 1 }}
            >
              {creating ? "Creating…" : "Create this year"}
            </button>
            <p style={{ margin: 0, fontSize: 12, color: "var(--fg-5)", lineHeight: 1.5 }}>
              Years cannot overlap each other. If the dates you pick cover a
              period an existing year already covers, the system will say so and
              nothing will be created.
            </p>
          </div>
        ) : null}
      </section>

      {/* ── list ───────────────────────────────────────────────────────── */}
      <section style={{ ...CARD, marginTop: 18 }}>
        <h2 style={H2}>Years on record</h2>

        {loading ? (
          <p style={MUTED}>Loading…</p>
        ) : error ? (
          <p style={{ ...MUTED, color: "var(--danger, #b91c1c)" }}>{error}</p>
        ) : years.length === 0 ? (
          <p style={MUTED}>
            None yet. Create one above — nothing else in Accounting can be
            recorded until there is a year to record it in.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {years.map((y) => {
              const tone = STATUS_TONE[y.status] || STATUS_TONE.Draft;
              const status = y.status || "Draft";
              const stepIndex = CHAIN.indexOf(status);
              const nextStatus = stepIndex >= 0 ? CHAIN[stepIndex + 1] : null;
              const isOpen = openId === y._id;
              const checklist = checklists[y._id];
              return (
                <div key={y._id} style={{ ...ROW, flexDirection: "column", alignItems: "stretch", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 14 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600 }}>{y.label}</div>
                      <div style={{ fontSize: 12.5, color: "var(--fg-4)", marginTop: 2 }}>
                        {fmtDate(y.startDate)} to {fmtDate(y.endDate)}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--fg-4)", marginTop: 4 }}>
                        {y.openingBalancesConfirmed ? (
                          <>✓ Last year&apos;s closing figures carried in</>
                        ) : (
                          <>
                            Opening figures not entered —{" "}
                            <Link href="/admin/opening-balances" style={{ color: "var(--accent)" }}>
                              enter them
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <span style={{ ...PILL, background: tone.bg, color: tone.fg }}>
                        {status}
                      </span>
                      <div style={{ fontSize: 11.5, color: "var(--fg-5)", marginTop: 5, maxWidth: 190 }}>
                        {tone.says}
                      </div>
                    </div>
                  </div>

                  {/* Lock/unlock checklist — step N of the chain, what's
                      blocking the next one, and the button to move it. */}
                  {nextStatus ? (
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                      <button type="button" onClick={() => toggleChecklist(y._id)} style={LINKBTN}>
                        {isOpen ? "Hide the checklist" : `What's needed to move to "${nextStatus}"?`}
                      </button>
                      {isOpen ? (
                        checklist === "loading" ? (
                          <p style={{ ...MUTED, marginTop: 8 }}>Checking…</p>
                        ) : typeof checklist === "string" ? (
                          <p style={{ ...MUTED, marginTop: 8, color: "var(--danger, #b91c1c)" }}>{checklist}</p>
                        ) : checklist ? (
                          <div style={{ marginTop: 10 }}>
                            <div style={{ display: "grid", gap: 6 }}>
                              {checklist.items.map((item) => (
                                <div key={item.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5 }}>
                                  <span style={{ color: item.passed ? "#166534" : item.blocking ? "#b91c1c" : "var(--fg-5)" }}>
                                    {item.passed ? "✓" : item.blocking ? "✕" : "•"}
                                  </span>
                                  <span style={{ color: item.passed ? "var(--fg-3)" : "var(--fg-2)" }}>
                                    {item.label}
                                    {!item.passed && !item.blocking ? " (not required to move forward)" : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <button
                              type="button"
                              disabled={!checklist.readyToClose || advancing === y._id}
                              onClick={() => advance(y._id)}
                              style={{ ...PRIMARY, marginTop: 12, padding: "8px 14px", fontSize: 12.5, opacity: !checklist.readyToClose || advancing === y._id ? 0.5 : 1 }}
                              title={checklist.readyToClose ? undefined : "Outstanding blocking items above must pass first"}
                            >
                              {advancing === y._id ? "Moving…" : `Move to "${nextStatus}"`}
                            </button>
                          </div>
                        ) : null
                      ) : null}
                    </div>
                  ) : (
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, fontSize: 12, color: "var(--fg-5)" }}>
                      Locked. Reopening a closed year is a SuperAdmin exception, done from the SuperAdmin console.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p style={{ margin: "20px 0 0", fontSize: 13, textAlign: "center" }}>
        <Link href="/admin/accounting" style={{ color: "var(--accent)" }}>
          ← Back to the accounting checklist
        </Link>
      </p>
    </main>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--fg-3)", marginBottom: 4 }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ display: "block", fontSize: 11.5, color: "var(--fg-5)", marginTop: 3 }}>{hint}</span>
      ) : null}
    </label>
  );
}

const CARD = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 20,
  marginTop: 18,
};
const INTRO = {
  marginTop: 16,
  padding: "13px 15px",
  borderRadius: 10,
  background: "var(--bg-subtle, #f8fafc)",
  border: "1px solid var(--border)",
  fontSize: 13.5,
  color: "var(--fg-3)",
  lineHeight: 1.65,
};
const H2 = { margin: 0, fontSize: 15, fontWeight: 700 };
const MUTED = { margin: "10px 0 0", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.6 };
const ROW = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 14,
  padding: "13px 15px",
  border: "1px solid var(--border)",
  borderRadius: 10,
};
const PILL = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 700,
};
const PRIMARY = {
  padding: "10px 18px",
  borderRadius: 8,
  border: "none",
  background: "var(--accent)",
  color: "var(--on-solid)",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
};
const LINKBTN = {
  border: "none",
  background: "none",
  padding: 0,
  color: "var(--accent)",
  fontSize: 13,
  cursor: "pointer",
  textDecoration: "underline",
};
const INPUT = {
  width: "100%",
  padding: "8px 11px",
  borderRadius: 8,
  fontSize: 13,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-input, var(--bg-surface))",
  color: "var(--fg-2)",
  outline: "none",
  fontFamily: "inherit",
};
