"use client";
/**
 * "Your year" — the 0-to-100 guide (plan §5). Eight steps, each with a
 * Done / Needs you / Later pill worked out from live data, a Do it for me
 * button where the system can run the step itself, and a Books check strip
 * that is always on screen.
 *
 * Data: /api/accounting/setup-state (setup steps + health) and
 * /api/admin/money/insights?view=guide (figures + the four Books checks).
 * "Do it for me" on step 2 runs the existing guided-setup engine
 * (/api/accounting/setup/run), one step at a time, in its own order.
 */
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import "@/components/money/money.css";
import { useMoneyInsights, inr, Skeleton, BandError } from "@/components/money/kit";

const DONE = "done";
const NEEDS = "needs";
const LATER = "later";

async function getJSON(url, init) {
  const res = await fetch(url, { credentials: "include", ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || "Request failed");
  return json;
}

function Pill({ s }) {
  if (s === DONE) return <span className="mn-chip">Done</span>;
  if (s === NEEDS) return <span className="mn-chip bad">Needs you</span>;
  return <span className="mn-chip mute">Later</span>;
}

const stepStatus = (st, key) => (st?.steps || []).find((x) => x.key === key)?.status;

function buildSteps(st, g) {
  const fy = st?.financialYear;
  const setupKeys = ["financialYear", "chartOfAccounts", "postingRules", "validationRules", "schedules"];
  const setupDone = setupKeys.every((k) => stepStatus(st, k) === DONE) && st?.accountingEnabled !== false;
  const opening = stepStatus(st, "openingBalances");
  const checksOk = (g?.checks || []).every((c) => c.ok);
  const ex = g?.expenses || {};
  const tm = g?.thisMonth || {};
  const members = g?.society?.members || 0;

  return [
    {
      n: 1,
      key: "society",
      title: "Your society",
      what: "Add the flats and their members, and the heads a bill is made of (maintenance, sinking fund, …).",
      status: members > 0 && g?.society?.heads > 0 ? DONE : NEEDS,
      fact: `${members} flat${members === 1 ? "" : "s"} · ${g?.society?.heads || 0} billing head${g?.society?.heads === 1 ? "" : "s"}`,
      links: [{ href: "/admin/view-members", label: "Members" }, { href: "/admin/billing-config", label: "Billing heads" }],
    },
    {
      n: 2,
      key: "books",
      title: "Turn on the books",
      what: "Creates the year, the account heads, the automatic entries, the checks and the sheet layout.",
      status: setupDone ? DONE : NEEDS,
      fact: setupDone ? `Books on for ${fy?.label || "this year"}` : `${setupKeys.filter((k) => stepStatus(st, k) === DONE).length} of ${setupKeys.length} parts ready`,
      doIt: !setupDone,
      links: [{ href: "/admin/accounting/setup-books?section=turn-on", label: "Open" }],
    },
    {
      n: 3,
      key: "opening",
      title: "Where you stood on 1 April",
      what: "One form: bank, cash, funds and what members owed. Members' dues come prefilled and the balancing figure fills itself.",
      status: opening === DONE ? DONE : opening === "blocked" ? LATER : NEEDS,
      fact: opening === DONE ? "Opening figures are in" : opening === "blocked" ? "Waits for step 2" : "Not entered yet",
      links: [{ href: "/admin/accounting/setup-books?section=opening", label: "Open the form" }],
    },
    {
      n: 4,
      key: "history",
      title: "Past months",
      what: "Bills from before you started here. Import them once so every passbook starts right. Skip it if you started on 1 April.",
      status: g?.history?.bills > 0 ? DONE : LATER,
      fact: g?.history?.bills ? `${g.history.bills} past bill${g.history.bills === 1 ? "" : "s"} imported` : "Nothing imported — optional",
      links: [{ href: "/admin/import-bills", label: "Import bills" }],
    },
    {
      n: 5,
      key: "month",
      title: `This month · ${tm.label || ""}`,
      what: "Generate the bills, then record what each member paid — less, in full, or in advance.",
      status: members && tm.bills >= members ? DONE : NEEDS,
      fact: `${tm.bills || 0} of ${members} bills raised · ${tm.payments || 0} payment${tm.payments === 1 ? "" : "s"} (${inr(tm.collected || 0)})`,
      links: [{ href: "/admin/generate-bills", label: "Generate bills" }, { href: "/admin/money?tab=payments", label: "Record payments" }],
    },
    {
      n: 6,
      key: "expenses",
      title: "Expenses",
      what: "One list per month — electricity, security, repairs. Each one posts to the books by itself.",
      status: ex.thisMonth > 0 && !ex.notPosted ? DONE : NEEDS,
      fact: `${ex.monthsWithEntries || 0} of ${ex.monthsElapsed || 0} months have entries${ex.notPosted ? ` · ${ex.notPosted} not in the books` : ""}`,
      links: [{ href: "/admin/money?tab=expenses", label: "Add expenses" }],
    },
    {
      n: 7,
      key: "check",
      title: "Books check",
      what: "Green ticks in plain words. A red one says what is off and links to where to fix it.",
      status: g ? (checksOk ? DONE : NEEDS) : LATER,
      fact: g ? `${(g.checks || []).filter((c) => c.ok).length} of ${(g.checks || []).length} checks pass` : "—",
      links: [{ href: "#books-check", label: "See the checks" }],
    },
    {
      n: 8,
      key: "yearend",
      title: "Year end",
      what: "Both sheets laid out like your printed ones. Print, save as PDF, and see what changed since opening.",
      status: fy?.status === "Locked" || fy?.status === "Closed" ? DONE : g && g.daysToYearEnd <= 31 ? NEEDS : LATER,
      fact: g ? (g.daysToYearEnd ? `${g.daysToYearEnd} days to 31 March` : "The year has ended") : "—",
      links: [{ href: "/admin/accounting/statements?tab=print", label: "Print & Save" }, { href: "/admin/accounting/statements?tab=year-end", label: "Close the year" }],
    },
  ];
}

export default function YourYearPage() {
  const qc = useQueryClient();
  const [run, setRun] = useState({ busy: false, log: [], error: null });

  const st = useQuery({
    queryKey: ["accounting-setup-state"],
    queryFn: () => getJSON("/api/accounting/setup-state"),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const g = useMoneyInsights("guide");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["accounting-setup-state"] });
    qc.invalidateQueries({ queryKey: ["money-insights"] });
  };

  // Runs every guided-setup step that is not done yet, in the engine's order.
  const turnOnBooks = async () => {
    setRun({ busy: true, log: [], error: null });
    try {
      const { steps, states } = await getJSON("/api/accounting/setup/run");
      for (const s of steps) {
        if (states?.[s.key]?.done) continue;
        setRun((r) => ({ ...r, log: [...r.log, `${s.title}…`] }));
        const out = await getJSON("/api/accounting/setup/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: s.key }),
        });
        setRun((r) => ({ ...r, log: [...r.log.slice(0, -1), `✓ ${s.title}${out.message ? ` — ${out.message}` : ""}`] }));
      }
      setRun((r) => ({ ...r, busy: false }));
    } catch (e) {
      setRun((r) => ({ ...r, busy: false, error: e.message }));
    } finally {
      refresh();
    }
  };

  if (st.isLoading || g.isLoading) {
    return <div className="mn mn-grid" style={{ maxWidth: 1280, margin: "0 auto" }}><Skeleton h={190} /><Skeleton h={90} /><Skeleton h={420} /></div>;
  }
  if (st.error && g.error) return <div style={{ maxWidth: 1280, margin: "0 auto" }}><BandError error={g.error} onRetry={refresh} /></div>;

  const data = g.data;
  const steps = buildSteps(st.data, data);
  const done = steps.filter((s) => s.status === DONE).length;
  const next = steps.find((s) => s.status === NEEDS);
  const pct = Math.round((done / steps.length) * 100);
  const health = (st.data?.health?.components || []).filter((h) => !h.passed);
  const checks = data?.checks || [];

  return (
    <div className="mn" style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 14 }}>
      <div className="mn-dk">
        <div className="mn-orb" style={{ width: 280, height: 280, top: -130, right: -70 }} />
        <div className="mn-h" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16, position: "relative" }}>
          <div style={{ minWidth: 0 }}>
            <div className="mn-lbl">Your year · FY {data?.fyLabel || st.data?.financialYear?.label || ""}</div>
            <div className="mn-num" style={{ fontSize: 34, marginTop: 6 }}>{done} of {steps.length} steps done</div>
            <div className="mn-sub" style={{ marginTop: 4 }}>From the first login to a printed Balance Sheet. Work top to bottom; every step says what it needs.</div>
          </div>
          <div className="mn-row" style={{ gap: 8 }}>
            <button className="mn-btn" onClick={refresh}>Check again</button>
            {next && next.links[0] && <Link className="mn-btn solid" href={next.links[0].href}>Next: {next.title.split(" · ")[0]}</Link>}
          </div>
        </div>
        <div style={{ marginTop: 18, position: "relative" }}>
          <div style={{ height: 10, borderRadius: 99, background: "rgba(245,248,255,.14)", overflow: "hidden" }}>
            <div style={{ width: "100%", height: "100%", borderRadius: 99, background: "linear-gradient(90deg, #93b0f5, #f5f8ff)", transform: `scaleX(${pct / 100})`, transformOrigin: "left", transition: "transform .4s ease" }} />
          </div>
          <div className="mn-row" style={{ gap: 4, marginTop: 10, flexWrap: "wrap" }}>
            {steps.map((s) => (
              <span key={s.key} title={s.title} style={{ flex: "1 1 0", minWidth: 60, height: 6, borderRadius: 99, background: s.status === DONE ? "#34c38f" : s.status === NEEDS ? "#f0b04a" : "rgba(245,248,255,.2)" }} />
            ))}
          </div>
        </div>
      </div>

      <div id="books-check" className="mn-card">
        <div className="mn-h" style={{ flexWrap: "wrap", gap: 8 }}>
          <span className="mn-lbl">Books check</span>
          <span className="mn-sub">{g.error ? g.error.message : checks.every((c) => c.ok) ? "Everything matches." : `${checks.filter((c) => !c.ok).length} to look at`}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginTop: 12 }}>
          {checks.map((c) => (
            <div key={c.key} style={{ padding: "12px 14px", borderRadius: 14, border: `1px solid ${c.ok ? "var(--mn-line)" : "var(--mn-bad)"}`, background: c.ok ? "var(--mn-card-2)" : "var(--mn-bad-bg)", minWidth: 0 }}>
              <div className="mn-row" style={{ gap: 8 }}>
                <span style={{ fontSize: 15, color: c.ok ? "var(--mn-ok)" : "var(--mn-bad)", fontWeight: 800 }}>{c.ok ? "✓" : "✗"}</span>
                <b style={{ fontSize: 13 }}>{c.label}</b>
              </div>
              <div className="mn-sub" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.45 }}>{c.detail}</div>
              {!c.ok && c.href && <Link href={c.href} className="mn-btn" style={{ marginTop: 8 }}>Fix it</Link>}
            </div>
          ))}
          {health.map((h) => (
            <div key={h.key} style={{ padding: "12px 14px", borderRadius: 14, border: "1px solid var(--mn-bad)", background: "var(--mn-bad-bg)", minWidth: 0 }}>
              <div className="mn-row" style={{ gap: 8 }}><span style={{ fontSize: 15, color: "var(--mn-bad)", fontWeight: 800 }}>✗</span><b style={{ fontSize: 13 }}>{h.label}</b></div>
              <div className="mn-sub" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.45 }}>{h.reason}</div>
              {h.navigationTarget && <Link href={h.navigationTarget} className="mn-btn" style={{ marginTop: 8 }}>Fix it</Link>}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 380px), 1fr))", gap: 14, alignItems: "start" }}>
        {steps.map((s) => (
          <div key={s.key} className="mn-card" style={{ borderColor: s === next ? "var(--mn-accent)" : undefined, boxShadow: s === next ? "0 0 0 2px var(--mn-tint)" : undefined }}>
            <div className="mn-h" style={{ alignItems: "flex-start" }}>
              <div className="mn-row" style={{ gap: 12, minWidth: 0 }}>
                <span className="mn-av" style={{ width: 34, height: 34, borderRadius: 12, fontSize: 14, background: s.status === DONE ? "var(--mn-ok-bg)" : undefined, color: s.status === DONE ? "var(--mn-ok)" : undefined }}>{s.status === DONE ? "✓" : s.n}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{s.title}</div>
                  <div className="mn-sub" style={{ fontSize: 12 }}>{s.fact}</div>
                </div>
              </div>
              <Pill s={s.status} />
            </div>
            <div className="mn-sub" style={{ fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>{s.what}</div>
            <div className="mn-row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {s.doIt && <button className="mn-btn solid" onClick={turnOnBooks} disabled={run.busy}>{run.busy ? "Working…" : "Do it for me"}</button>}
              {s.links.map((l) => <Link key={l.href} href={l.href} className="mn-btn">{l.label}</Link>)}
            </div>
            {s.doIt && (run.log.length > 0 || run.error) && (
              <div style={{ marginTop: 10, fontSize: 12, display: "grid", gap: 3 }}>
                {run.log.map((line, i) => <div key={i} className="mn-sub">{line}</div>)}
                {run.error && <div style={{ color: "var(--mn-bad)" }}>Stopped: {run.error}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
