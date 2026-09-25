"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import StatutoryStatements from "../../../components/accounting/StatutoryStatements";
import notify from "@/lib/notify";

// ══ ACCOUNTING LAB — MASTER TEST SIMULATOR ════════════════════════════════
// Exercises Phases 2.1 → 2.20 end to end, visibly, on one page:
//   1  Books setup      — FY, Chart of Accounts, posting/validation rules (2.1-2.7)
//   2  Society position — Share Capital, Funds, Fixed Assets, Investments,
//                         Deposits, Current Liabilities (2.10, 2.12, 2.13)
//   3  Depreciation     — on/off, straight-line or % per year (2.11)
//   4  Billing run      — ALL members, month by month, realistic payments
//                         (2.5, 2.6, 2.8, 2.9)
//   5  Statements       — Trial Balance + statutory Balance Sheet and
//                         Income & Expenditure (2.14-2.20)
// ════════════════════════════════════════════════════════════════════

const inr = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The society-side figures the Lab lets you fill, grouped exactly the way the
// statutory Balance Sheet prints them.
const OPENING_FORM = [
  {
    group: "Share Capital & Funds (Liabilities side)",
    fields: [
      { code: "3000", label: "Share Capital (Paid-up)", hint: "e.g. 415 shares × ₹50" },
      { code: "3002", label: "Reserve Fund" },
      { code: "3003", label: "Sinking Fund" },
      { code: "3004", label: "Building Repair & Development Fund" },
    ],
  },
  {
    group: "Current Liabilities",
    fields: [
      { code: "2010", label: "Audit Fee Payable" },
      { code: "2011", label: "Account Writing Payable" },
      { code: "2012", label: "Electricity Charges Payable" },
      { code: "2013", label: "Water Charges Payable" },
      { code: "2014", label: "Salary / Security Charges Payable" },
      { code: "2015", label: "TDS Payable" },
    ],
  },
  {
    group: "Fixed Assets & Investments (Assets side)",
    fields: [
      { code: "1020", label: "Land & Building" },
      { code: "1021", label: "Fixed Assets (at cost)" },
      { code: "1010", label: "Bank Fixed Deposit" },
      { code: "1030", label: "Security Deposit" },
      { code: "1031", label: "Property Tax Paid in Advance" },
    ],
  },
  {
    group: "Cash & Bank",
    fields: [
      { code: "1001", label: "Cash in Hand" },
      { code: "1002", label: "Cash at Bank" },
    ],
  },
];

// Mirrors the Expense accounts quick-setup seeds (codes 5001-5009) — lets the
// Lab put money OUT, not just in, so Income & Expenditure shows the same
// multi-line spread as the statutory reference format instead of just
// Maintenance/Interest Income with nothing on the Expenditure side.
// Widened from 9 heads to the ~20 the statutory reference Expenditure side
// actually prints, so the Lab's Income & Expenditure Account can carry the same
// detail as a real auditor-signed statement instead of a couple of rows.
// Depreciation (5020) is NOT here on purpose - it is charged in Step 3 from the
// Asset Register and broken out per asset, so a manual line would double-count.
const EXPENSE_FORM = [
  { code: "5001", label: "Rep. & Maint." },
  { code: "5002", label: "Property Tax" },
  { code: "5003", label: "Water Charges" },
  { code: "5004", label: "Electricity Charges" },
  { code: "5005", label: "Insurance Charges" },
  { code: "5006", label: "Salary & Wages / Security" },
  { code: "5007", label: "Audit Fee" },
  { code: "5008", label: "Bank Charges" },
  { code: "5009", label: "Misc. Exp." },
  { code: "5010", label: "Printing & Stationery" },
  { code: "5011", label: "AGM Exp." },
  { code: "5012", label: "Function" },
  { code: "5013", label: "Discount to Members" },
  { code: "5014", label: "TDS" },
  { code: "5015", label: "Computer Exp." },
  { code: "5016", label: "Professional Charges" },
  { code: "5017", label: "Gardening" },
  { code: "5018", label: "Postage" },
  { code: "5019", label: "C.C.TV Exp." },
  { code: "5021", label: "Medical Exp." },
  { code: "5022", label: "Accounts Writing" },
  { code: "5023", label: "Inverter" },
];

// Non-member income. Members Contribution - Rep.& Maint. (4001) and Interest on
// Arrears (4002) are excluded because the billing run in Step 5 posts those from
// real bills; entering them by hand would invent income nobody was billed for.
const INCOME_FORM = [
  { code: "4005", label: "Members Contribution - Property Tax" },
  { code: "4006", label: "Members Contribution - Water Charges" },
  { code: "4007", label: "Members Contribution - Electricity" },
  { code: "4008", label: "Members Contribution - Service Charges" },
  { code: "4009", label: "Members Contribution - Insurance" },
  { code: "4010", label: "Parking Charges" },
  { code: "4011", label: "Non-occupancy Charges" },
  { code: "4003", label: "Bank Interest (S.B. A/c)" },
  { code: "4012", label: "Bank Interest (T.D.C.C. S.B. A/c)" },
  { code: "4013", label: "Scrap Sale" },
  { code: "4004", label: "Misc. Income" },
];

// How the society paid for something. Registering assets against Cash at Bank
// with only a small opening bank balance is what drove Bank to -2,25,000 in the
// first Lab run, so "General Fund" is the default for pre-owned assets.
const ASSET_FUNDING = [
  { code: "3001", label: "General Fund (society already owned them)" },
  { code: "1002", label: "Cash at Bank (bought this year)" },
  { code: "1001", label: "Cash in Hand (bought this year)" },
];

const SPEND_FUNDING = [
  { code: "1001", label: "Cash in Hand" },
  { code: "1002", label: "Cash at Bank" },
];

const DEFAULT_ASSETS = [
  { assetCode: "FA-001", name: "Water Pump", category: "Other", purchaseCost: 45000, usefulLifeYears: 10, ratePercent: 15 },
  { assetCode: "FA-002", name: "Electric Fixture", category: "Other", purchaseCost: 28000, usefulLifeYears: 10, ratePercent: 10 },
  { assetCode: "FA-003", name: "C.C.TV System", category: "Other", purchaseCost: 96000, usefulLifeYears: 8, ratePercent: 15 },
  { assetCode: "FA-004", name: "Furniture & Fixture", category: "Furniture", purchaseCost: 62000, usefulLifeYears: 10, ratePercent: 10 },
];

function Section({ step, title, subtitle, done, children }) {
  return (
    <section className="mb-6 rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
            done ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p>}
        </div>
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Btn({ children, onClick, disabled, variant = "primary", size = "md" }) {
  const base =
    "inline-flex items-center justify-center rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { md: "px-4 py-2 text-sm", sm: "px-3 py-1.5 text-xs" };
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    ghost: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {children}
    </button>
  );
}

export default function AccountingLabPage() {
  const [setup, setSetup] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Step 2 — society opening position
  const [opening, setOpening] = useState({});
  const [openingResult, setOpeningResult] = useState(null);

  // Step 3 — depreciation
  const [depEnabled, setDepEnabled] = useState(true);
  const [depMode, setDepMode] = useState("percent"); // "percent" | "life"
  const [depRate, setDepRate] = useState(15);
  const [depAssets, setDepAssets] = useState(DEFAULT_ASSETS);
  // Register and Charge are TWO separate operations and now keep TWO separate
  // results. They previously shared `depResult`, so whichever button was clicked
  // last wiped the other's outcome - which is why the order you clicked them in
  // appeared to change the result.
  const [assetResult, setAssetResult] = useState(null);
  const [depResult, setDepResult] = useState(null);

  const [expenses, setExpenses] = useState({});
  const [otherIncome, setOtherIncome] = useState({});
  const [spendFunding, setSpendFunding] = useState("1001");
  const [assetFunding, setAssetFunding] = useState("3001");
  const [expenseResult, setExpenseResult] = useState(null);

  // Step 4 — billing run
  const [members, setMembers] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]); // [] = all
  const [months, setMonths] = useState(12);
  const [startYear, setStartYear] = useState(2026);
  const [startMonth, setStartMonth] = useState(4);
  const [profile, setProfile] = useState("realistic");
  const [seed, setSeed] = useState(20260731);
  const [run, setRun] = useState(null);
  const [openPeriod, setOpenPeriod] = useState(null);

  // Step 5 — statements
  const [statements, setStatements] = useState(null);

  const api = useCallback(async (url, options) => {
    const res = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.details || `Request failed (${res.status})`);
    return data;
  }, []);

  const loadSetup = useCallback(async () => {
    try {
      setSetup(await api("/api/accounting/quick-setup"));
    } catch (e) {
      setError(e.message);
    }
  }, [api]);

  const loadMembers = useCallback(async () => {
    try {
      const data = await api("/api/billing-simulator/members");
      setMembers(data.members || []);
    } catch (e) {
      setError(e.message);
    }
  }, [api]);

  useEffect(() => {
    loadSetup();
    loadMembers();
  }, [loadSetup, loadMembers]);

  const guard = async (key, fn) => {
    setBusy(key);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const runSetup = () =>
    guard("setup", async () => {
      await api("/api/accounting/quick-setup", { method: "POST" });
      await loadSetup();
    });

  const postOpening = () =>
    guard("opening", async () => {
      const entries = Object.fromEntries(
        Object.entries(opening).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]),
      );
      setOpeningResult(await api("/api/accounting/lab/opening-balances", {
        method: "POST",
        body: JSON.stringify({ entries }),
      }));
    });

  const registerAssets = () =>
    guard("assets", async () => {
      const payload = depAssets.map((a) => ({
        ...a,
        purchaseDate: `${startYear}-04-01`,
        ratePercent: depMode === "percent" ? Number(depRate) : 0,
      }));
      setAssetResult(await api("/api/accounting/lab/depreciation", {
        method: "POST",
        body: JSON.stringify({ action: "register", assets: payload, fundingCode: assetFunding }),
      }));
    });

  const chargeDepreciation = () =>
    guard("depreciate", async () => {
      setDepResult(await api("/api/accounting/lab/depreciation", {
        method: "POST",
        body: JSON.stringify({ action: "run", enabled: depEnabled, periodMonths: 12, date: `${startYear + 1}-03-31` }),
      }));
    });

  const postExpenses = () =>
    guard("expenses", async () => {
      const entries = Object.fromEntries(
        Object.entries(expenses).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]),
      );
      const incomeEntries = Object.fromEntries(
        Object.entries(otherIncome).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]),
      );
      setExpenseResult(await api("/api/accounting/lab/expenses", {
        method: "POST",
        body: JSON.stringify({
          entries,
          incomeEntries,
          fundingCode: spendFunding,
          date: `${startYear + 1}-03-15`,
        }),
      }));
    });

  const runBilling = () =>
    guard("billing", async () => {
      const data = await api("/api/accounting/lab/generate-bills", {
        method: "POST",
        body: JSON.stringify({
          memberIds: selectedMembers,
          months: Number(months),
          startYear: Number(startYear),
          startMonth: Number(startMonth),
          paymentProfile: profile,
          seed: Number(seed),
        }),
      });
      setRun(data);
      setOpenPeriod(0);
    });

  const buildStatements = () =>
    guard("statements", async () => {
      // Always refetch fresh rather than trusting `setup` in React state —
      // several prior actions (billing run, asset registration, depreciation)
      // don't refresh it, so a stale `setup.financialYear._id` here silently
      // queries a Financial Year that may no longer be the current one.
      const fresh = await api("/api/accounting/quick-setup");
      setSetup(fresh);
      const fyId = fresh?.financialYear?._id;
      if (!fyId) throw new Error("No Financial Year yet — run Step 1 first.");
      const qs = `?financialYearId=${fyId}`;
      const [tb, bs, ie] = await Promise.all([
        api(`/api/accounting/trial-balance${qs}`).catch(() => null),
        api(`/api/accounting/financial-statements/balance-sheet${qs}`),
        api(`/api/accounting/financial-statements/income-expenditure${qs}`),
      ]);
      // Each route wraps its payload one level deep ({ trialBalance }, { statement }) —
      // unwrap here so StatutoryStatements gets flat fields, not the wrapper.
          setStatements({
      trialBalance: tb?.trialBalance ?? null,
      balanceSheet: bs?.statement ?? null,
      incomeExpenditure: ie?.statement ?? null,
    });
  });

// Exports exactly what Step 6 fetched — the unwrapped route payloads, with no
// reformatting. A regenerated file is therefore byte-comparable against a
// previous run, which is the only way to prove a change to the engine moved
// the numbers you expected and nothing else.
const downloadStatements = () => {
  if (!statements) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const payload = {
    exportedAt: new Date().toISOString(),
    financialYear: setup?.financialYear ?? null,
    billingRun: run ?? null,
    trialBalance: statements.trialBalance,
    balanceSheet: statements.balanceSheet,
    incomeExpenditure: statements.incomeExpenditure,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `accounting-lab-statements-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Without this the blob is retained for the lifetime of the page, so a
  // tester who regenerates and re-downloads a dozen times leaks every copy.
  URL.revokeObjectURL(href);
};

// Prints ONLY the statements. `window.print()` on its own emits the entire
// page — all six wizard steps, forms and buttons above the statements — which
// is useless as an auditor's document. The print stylesheet below hides
// everything, then re-shows just the statements block and lifts it to the top
// of the sheet.
const printStatements = () => {
  if (!statements) return;
  window.print();
};

const resetLab = () =>
    guard("reset", async () => {
      if (!(await notify.confirm("Delete all bills, receipts, vouchers and assets for this society? Setup is preserved.", { tone: "danger" }))) return;
      await api("/api/accounting/lab/reset", { method: "POST", body: JSON.stringify({ confirm: "RESET" }) });
      setRun(null);
      setStatements(null);
      setOpeningResult(null);
      setAssetResult(null);
      setDepResult(null);
      // Reset used to leave Step 4 showing a green "Posted ... totalling ..."
      // message even though the voucher had just been deleted, so it looked like
      // expenses were in the books when they were not — which is exactly why the
      // reference run's Income & Expenditure had no operating expenses on it
      // while the UI still claimed 10 lines were posted. Clear the step results
      // AND the typed figures so a scenario always starts from a true blank.
      setExpenseResult(null);
      setExpenses({});
      setOtherIncome({});
    });

  const openingTotals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const g of OPENING_FORM) {
      for (const f of g.fields) {
        const v = Number(opening[f.code]) || 0;
        if (f.code.startsWith("1")) dr += v;
        else cr += v;
      }
    }
    return { dr, cr, diff: dr - cr };
  }, [opening]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounting Lab — Master Test Simulator</h1>
          <p className="mt-1 text-sm text-gray-500">
            Set up books → enter the society&apos;s position → configure depreciation → run a full year of billing for
            every member → produce the statutory Balance Sheet. Real writes, every step visible.
          </p>
        </div>
        <Btn variant="danger" size="sm" onClick={resetLab} disabled={busy === "reset"}>
          {busy === "reset" ? "Resetting…" : "Reset simulator"}
        </Btn>
      </div>

      {error && (
        <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      {/* ── 1. Setup ────────────────────────────────────────────────────── */}
      <Section
        step={1}
        done={!!setup?.ready}
        title="Set up the books"
        subtitle="Financial Year, full Chart of Accounts, posting rules, validation rules, schedules (Phases 2.1–2.7)"
      >
        {setup?.ready ? (
          <p className="text-sm text-gray-700">
            Ready — Financial Year <strong>{setup.financialYear?.label || setup.financialYear?.name}</strong>, Chart of
            Accounts and rule registries are in place.
          </p>
        ) : (
          <div className="text-sm text-gray-700">
            <p>Not set up yet.</p>
            {setup?.missing?.length > 0 && (
              <p className="mt-1 text-xs text-amber-700">Missing accounts: {setup.missing.join(", ")}</p>
            )}
          </div>
        )}
        <div className="mt-3">
          <Btn onClick={runSetup} disabled={busy === "setup"}>
            {busy === "setup" ? "Setting up…" : setup?.ready ? "Re-run setup" : "Set up the books"}
          </Btn>
        </div>
      </Section>

      {/* ── 2. Society position ───────────────────────────────────────────── */}
      <Section
        step={2}
        done={!!openingResult?.posted}
        title="The society's own position"
        subtitle="Share Capital, Funds, Fixed Assets, Investments, Deposits and Current Liabilities — posted as one balanced opening voucher"
      >
        <div className="grid gap-6 md:grid-cols-2">
          {OPENING_FORM.map((g) => (
            <div key={g.group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.group}</h3>
              <div className="space-y-2">
                {g.fields.map((f) => (
                  <label key={f.code} className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-gray-700">
                      {f.label}
                      {f.hint && <span className="ml-1 text-xs text-gray-400">({f.hint})</span>}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={opening[f.code] ?? ""}
                      onChange={(e) => setOpening((p) => ({ ...p, [f.code]: e.target.value }))}
                      placeholder="0.00"
                      className="w-36 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-md bg-gray-50 px-4 py-3 text-sm">
          <span>Assets side: <strong>{inr(openingTotals.dr)}</strong></span>
          <span>Liabilities &amp; Funds side: <strong>{inr(openingTotals.cr)}</strong></span>
          <span className={Math.abs(openingTotals.diff) < 0.005 ? "text-green-700" : "text-amber-700"}>
            {Math.abs(openingTotals.diff) < 0.005
              ? "Balanced"
              : `Difference of ${inr(Math.abs(openingTotals.diff))} will post to General Fund`}
          </span>
        </div>

        <div className="mt-3">
          <Btn onClick={postOpening} disabled={busy === "opening" || !setup?.ready}>
            {busy === "opening" ? "Posting…" : "Post opening balances"}
          </Btn>
        </div>

        {openingResult?.posted && (
          <p className="mt-3 text-sm text-green-700">
            Posted {openingResult.lineCount} lines — debits {inr(openingResult.totalDebits)}, credits{" "}
            {inr(openingResult.totalCredits)}
            {openingResult.balancingEntry > 0 && `, ${inr(openingResult.balancingEntry)} squared off to General Fund`}.
          </p>
        )}
      </Section>

      {/* ── 3. Depreciation ──────────────────────────────────────────────── */}
      <Section
        step={3}
        done={!!depResult?.charged?.length}
        title="Fixed assets & depreciation"
        subtitle="Register the society's assets, then choose whether to depreciate and how (Phase 2.11)"
      >
        <div className="mb-4 flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={depEnabled} onChange={(e) => setDepEnabled(e.target.checked)} />
            <span>Charge depreciation this year</span>
          </label>

          {depEnabled && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={depMode === "percent"} onChange={() => setDepMode("percent")} />
                <span>Automate by % every year (WDV)</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={depMode === "life"} onChange={() => setDepMode("life")} />
                <span>Straight-line over useful life</span>
              </label>
              {depMode === "percent" && (
                <label className="flex items-center gap-2 text-sm">
                  <span>Rate</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={depRate}
                    onChange={(e) => setDepRate(e.target.value)}
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
                  />
                  <span>% p.a.</span>
                </label>
              )}
            </>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-2">Asset</th>
              <th className="py-2 text-right">Cost</th>
              <th className="py-2 text-right">Useful life (yrs)</th>
            </tr>
          </thead>
          <tbody>
            {depAssets.map((a, i) => (
              <tr key={a.assetCode} className="border-b border-gray-100">
                <td className="py-2">
                  <input
                    value={a.name}
                    onChange={(e) =>
                      setDepAssets((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                    }
                    className="w-full rounded-md border border-gray-200 px-2 py-1 text-sm"
                  />
                </td>
                <td className="py-2 text-right">
                  <input
                    type="number"
                    value={a.purchaseCost}
                    onChange={(e) =>
                      setDepAssets((p) =>
                        p.map((x, j) => (j === i ? { ...x, purchaseCost: Number(e.target.value) } : x)),
                      )
                    }
                    className="w-32 rounded-md border border-gray-200 px-2 py-1 text-right text-sm"
                  />
                </td>
                <td className="py-2 text-right">
                  <input
                    type="number"
                    value={a.usefulLifeYears}
                    onChange={(e) =>
                      setDepAssets((p) =>
                        p.map((x, j) => (j === i ? { ...x, usefulLifeYears: Number(e.target.value) } : x)),
                      )
                    }
                    className="w-24 rounded-md border border-gray-200 px-2 py-1 text-right text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 flex gap-2">
          <Btn variant="ghost" onClick={registerAssets} disabled={busy === "assets" || !setup?.ready}>
            {busy === "assets" ? "Registering…" : "Register assets"}
          </Btn>
          <Btn onClick={chargeDepreciation} disabled={busy === "depreciate" || !depEnabled}>
            {busy === "depreciate" ? "Charging…" : "Charge depreciation"}
          </Btn>
        </div>

        {assetResult && (
          <div className="mt-3 text-sm">
            {assetResult.created?.length > 0 && (
              <p className="text-green-700">
                Registered {assetResult.created.length} assets, funded from{" "}
                {ASSET_FUNDING.find((o) => o.code === assetResult.fundingCode)?.label || assetResult.fundingCode}.
              </p>
            )}
            {assetResult.skippedAssets?.length > 0 && (
              <p className="text-gray-600">
                {assetResult.skippedAssets.length} asset(s) already registered, so they were not
                re-purchased: {assetResult.skippedAssets.map((a) => a.assetCode).join(", ")}. Depreciation
                will still be charged on them.
              </p>
            )}
            {assetResult.created?.length === 0 && assetResult.skippedAssets?.length === 0 && (
              <p className="text-amber-700">No assets were registered — check the asset list above.</p>
            )}
            {assetResult.failed?.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
                {assetResult.failed.map((f, i) => (
                  <li key={i}>{f.name}: {f.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {depResult && (
          <div className="mt-2 text-sm">
            {/* Must be `=== true`. This used to be a bare truthiness check, and the
                register response carried a `skipped` ARRAY - which is truthy even
                when empty - so this line fired on every single run. */}
            {depResult.skipped === true && (
              <p className="text-gray-600">
                Depreciation skipped — {depResult.reason || "disabled for this run"}. Tick “Charge
                depreciation this year” to include it.
              </p>
            )}
            {depResult.charged?.length > 0 && (
              <p className="text-green-700">
                Charged {inr(depResult.totalDepreciation)} across {depResult.charged.length} assets:{" "}
                {depResult.charged.map((c) => `${c.asset} ${inr(c.amount)}`).join(" · ")}.
              </p>
            )}
            {depResult.skipped === false && depResult.charged?.length === 0 && (
              <p className="text-amber-700">
                Depreciation ran but charged nothing — {depResult.reason || "no depreciation was due."}
              </p>
            )}
            {depResult.failed?.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
                {depResult.failed.map((f, i) => (
                  <li key={i}>{f.asset || f.name}: {f.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      {/* ── 3.5 Operating expenses ───────────────────────────────────────── */}
      <Section
        step={4}
        done={!!expenseResult?.posted}
        title="Operating expenses & other income"
        subtitle="What the society actually spent and earned outside member billing — 22 expenditure heads plus Bank Interest, Parking, Non-occupancy, Scrap Sale etc., so both sides of the Income & Expenditure Account carry real detail"
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Expenditure</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {EXPENSE_FORM.map((f) => (
            <label key={f.code} className="flex items-center gap-3">
              <span className="flex-1 text-sm text-gray-700">{f.label}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={expenses[f.code] ?? ""}
                onChange={(e) => setExpenses((p) => ({ ...p, [f.code]: e.target.value }))}
                placeholder="0.00"
                className="w-36 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
              />
            </label>
          ))}
        </div>

        <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Other income (member billing income comes from Step 5)
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {INCOME_FORM.map((f) => (
            <label key={f.code} className="flex items-center gap-3">
              <span className="flex-1 text-sm text-gray-700">{f.label}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={otherIncome[f.code] ?? ""}
                onChange={(e) => setOtherIncome((p) => ({ ...p, [f.code]: e.target.value }))}
                placeholder="0.00"
                className="w-36 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
              />
            </label>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Money moves through</span>
            <select
              value={spendFunding}
              onChange={(e) => setSpendFunding(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              {SPEND_FUNDING.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <Btn onClick={postExpenses} disabled={busy === "expenses" || !setup?.ready}>
            {busy === "expenses" ? "Posting…" : "Post expenses & income"}
          </Btn>
        </div>

        {expenseResult?.posted && (
          <div className="mt-3 text-sm text-green-700">
            <p>
              Posted {expenseResult.lineCount} lines — expenditure{" "}
              {inr(expenseResult.expenseTotal ?? expenseResult.total)}, other income{" "}
              {inr(expenseResult.incomeTotal ?? 0)}, net{" "}
              {inr(Math.abs(expenseResult.netCashMovement ?? 0))}{" "}
              {(expenseResult.netCashMovement ?? 0) >= 0 ? "out of" : "into"}{" "}
              {expenseResult.fundingAccount || "Cash"}.
            </p>
            {expenseResult.idempotentHit && (
              <p className="mt-1 text-amber-700">
                This exact mix was already posted for this date — no second voucher was written. Change a
                figure or reset the simulator to post again.
              </p>
            )}
          </div>
        )}
      </Section>

      {/* ── 4. Billing run ───────────────────────────────────────────────── */}
      <Section
        step={5}
        done={!!run}
        title="Run the billing year — every member"
        subtitle="Bills raised, interest accrued, receipts allocated, arrears carried forward, month by month (Phases 2.5, 2.6, 2.8, 2.9)"
      >
        <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Months</span>
            <input
              type="number"
              min="1"
              max="36"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Start year</span>
            <input
              type="number"
              value={startYear}
              onChange={(e) => setStartYear(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Start month</span>
            <input
              type="number"
              min="1"
              max="12"
              value={startMonth}
              onChange={(e) => setStartMonth(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Payment behaviour</span>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5"
            >
              <option value="realistic">Realistic mix (full / short / advance / skipped)</option>
              <option value="full">Everyone pays in full</option>
              <option value="none">Nobody pays (pure arrears)</option>
            </select>
          </label>
        </div>

        <div className="mb-4">
          <span className="mb-1 block text-sm text-gray-600">
            Members — {selectedMembers.length === 0 ? `all ${members.length}` : `${selectedMembers.length} selected`}
          </span>
          <div className="flex flex-wrap gap-2">
            <Btn size="sm" variant="ghost" onClick={() => setSelectedMembers([])}>
              Bill all members
            </Btn>
            {members.slice(0, 24).map((m) => {
              const on = selectedMembers.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    setSelectedMembers((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))
                  }
                  className={`rounded-full border px-3 py-1 text-xs ${
                    on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-300 text-gray-600"
                  }`}
                >
                  {m.flat} {m.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Btn onClick={runBilling} disabled={busy === "billing" || !setup?.ready}>
            {busy === "billing" ? "Running…" : `Run ${months} months`}
          </Btn>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span>Seed</span>
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="w-28 rounded-md border border-gray-300 px-2 py-1"
            />
            <span>(same seed replays the same payment pattern)</span>
          </label>
        </div>

        {run && (
          <div className="mt-5">
            <div className="mb-4 grid gap-3 sm:grid-cols-4">
              {[
                ["Billed", run.totals.billed],
                ["Collected", run.totals.collected],
                ["Advance received", run.totals.advance],
              ].map(([label, val]) => (
                <div key={label} className="rounded-md bg-gray-50 px-3 py-2">
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="text-sm font-semibold text-gray-900">{inr(val)}</div>
                </div>
              ))}
              <div className="rounded-md bg-gray-50 px-3 py-2">
                <div className="text-xs text-gray-500">Members × months</div>
                <div className="text-sm font-semibold text-gray-900">
                  {run.memberCount} × {run.monthsRun}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {run.periods.map((p, i) => (
                <div key={p.label} className="rounded-md border border-gray-200">
                  <button
                    type="button"
                    onClick={() => setOpenPeriod(openPeriod === i ? null : i)}
                    className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-900">{p.label}</span>
                    <span className="text-xs text-gray-500">
                      {p.errorCount > 0 ? (
                        <span className="text-amber-700">
                          {p.errorCount} of {p.rows.length} failed (likely already billed)
                        </span>
                      ) : (
                        <>billed {inr(p.billedTotal)} · collected {inr(p.collectedTotal)} · {p.rows.length} members</>
                      )}
                    </span>
                  </button>

                  {openPeriod === i && (
                    <div className="overflow-x-auto border-t border-gray-100">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 text-left uppercase tracking-wide text-gray-500">
                            <th className="px-3 py-2">Member</th>
                            <th className="px-3 py-2 text-right">Opening</th>
                            <th className="px-3 py-2 text-right">Charges</th>
                            <th className="px-3 py-2 text-right">Interest</th>
                            <th className="px-3 py-2 text-right">Due</th>
                            <th className="px-3 py-2 text-right">Paid</th>
                            <th className="px-3 py-2">Behaviour</th>
                            <th className="px-3 py-2 text-right">Closing</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.rows.map((r) => (
                            <tr key={r.memberId} className="border-t border-gray-100">
                              <td className="px-3 py-2">{r.member}</td>
                              {r.error ? (
                                <td colSpan={7} className="px-3 py-2 text-amber-700">{r.error}</td>
                              ) : (
                                <>
                                  <td className="px-3 py-2 text-right">{inr(r.openingBalance)}</td>
                                  <td className="px-3 py-2 text-right">{inr(r.currentCharges)}</td>
                                  <td className="px-3 py-2 text-right">{inr(r.currentInterest)}</td>
                                  <td className="px-3 py-2 text-right">{inr(r.outstandingBeforePayment)}</td>
                                  <td className="px-3 py-2 text-right">{inr(r.paid)}</td>
                                  <td className="px-3 py-2 text-gray-600">{r.behaviour}</td>
                                  <td
                                    className={`px-3 py-2 text-right font-medium ${
                                      r.closingOutstanding > 0 ? "text-amber-700" : "text-green-700"
                                    }`}
                                  >
                                    {inr(r.closingOutstanding)}
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── 6. Statements ────────────────────────────────────────────────── */}
      <Section
        step={6}
        done={!!statements}
        title="Statutory statements"
        subtitle="Trial Balance, Balance Sheet and Income & Expenditure in the prescribed co-operative housing society format (Phases 2.14–2.20)"
      >
       <div className="flex flex-wrap items-center gap-2">
  <Btn onClick={buildStatements} disabled={busy === "statements" || !setup?.ready}>
    {busy === "statements" ? "Generating…" : "Generate statements"}
  </Btn>
  <Btn onClick={downloadStatements} disabled={!statements}>
    Download output (JSON)
  </Btn>
  <Btn onClick={() => window.print()} disabled={!statements}>
    Print Statements
  </Btn>
</div>

        {statements && (
          <div id="lab-print-area" className="mt-5">
            <StatutoryStatements
              balanceSheet={statements.balanceSheet}
              incomeExpenditure={statements.incomeExpenditure}
              trialBalance={statements.trialBalance}
            />
          </div>
        )}
      </Section>

      {/*
        `visibility: hidden` rather than `display: none`, deliberately. Collapsing
        ancestors with `display: none` would remove #lab-print-area from the
        layout along with them and print a blank page; `visibility` leaves the
        boxes in flow so the statements can still be re-shown and repositioned.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  body * { visibility: hidden !important; }
  #lab-print-area, #lab-print-area * { visibility: visible !important; }
  #lab-print-area {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  /* Keep each statement whole instead of splitting a Balance Sheet across
     two sheets mid-schedule. */
  #lab-print-area table { page-break-inside: avoid; }
  #lab-print-area tr { page-break-inside: avoid; }
  @page { margin: 12mm; }
}
`,
        }}
      />
    </div>
  );
}