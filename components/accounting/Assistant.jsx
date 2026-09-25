"use client";
/**
 * Accounting Assistant — offline, rule-based, this-society-only. §7.14 of
 * docs/accounting-module-audit-and-consolidation-plan.md, scoped down per
 * explicit direction: a real LLM has per-call cost this project doesn't have
 * budget for, so this is NOT a chatbot and takes no free-text input. It's a
 * fixed set of buttons, each backed by a deterministic handler that reads
 * this society's real data through APIs already built and verified
 * elsewhere in this module. No network call to any AI provider, ever —
 * every answer is computed here from real numbers, fetched when the panel
 * opens (loadCtx) and re-derived per question from that one snapshot.
 *
 * Grown from an original 5 questions to a full catalogue across every major
 * accounting sub-area (year-end, funds, liabilities, bank & reconciliation,
 * balance sheet, ledger health, billing/dues, opening balances, financial
 * years) — organized into categories because a flat 30+ button list reads
 * worse than the 5-button version it replaced. Categories are picked first,
 * then questions within it; "Ask something else" always returns to the
 * question list, not all the way to categories.
 *
 * Adding a new question: find (or add) its category in CATEGORIES, add one
 * entry with an `answer(ctx)` function. If it needs data not already in
 * `ctx`, add a fetch to loadCtx (catch to null — a missing permission or a
 * 404 for "no data yet" must never crash the whole panel, just make that
 * one question say it couldn't check).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Icon, Btn } from "@/components/revamp";

// Which categories are front-and-center on which accounting page — asked
// for explicitly: don't dump the full 9-category catalogue on every page,
// surface what's relevant to where the admin actually is first. Every
// category still reachable via "All categories"; this only picks what's
// on top by default.
// Every real route under /admin/accounting (per components/adminNavigation.js
// and the app/admin/accounting/* route folders) gets its own entry — the
// fallback for anything missed is deliberately a SMALL default, not "every
// category," so a route this list hasn't caught up with yet still narrows
// instead of dumping the full catalogue.
const RELEVANT_BY_PATH = [
  { prefix: "/admin/accounting/statements", categories: ["yearend", "surplus", "trial", "fy"] },
  { prefix: "/admin/accounting/registers", categories: ["funds", "liabilities", "bank", "assets"] },
  { prefix: "/admin/accounting/books", categories: ["trial", "config"] },
  { prefix: "/admin/accounting/auditor", categories: ["trial", "surplus", "yearend"] },
  { prefix: "/admin/accounting/setup", categories: ["config", "fy"] },
  { prefix: "/admin/accounting/chart-of-accounts", categories: ["trial", "config"] },
  { prefix: "/admin/accounting/cash-flow", categories: ["bank", "funds"] },
  { prefix: "/admin/accounting/format", categories: ["config", "surplus"] },
  { prefix: "/admin/accounting/financial-years", categories: ["fy"] },
  { prefix: "/admin/accounting/posting-rules", categories: ["config"] },
  { prefix: "/admin/accounting/validation-rules", categories: ["trial", "config"] },
  { prefix: "/admin/accounting/fiscal-config", categories: ["config"] },
  { prefix: "/admin/accounting/funds", categories: ["funds"] },
  { prefix: "/admin/accounting/liabilities", categories: ["liabilities"] },
  { prefix: "/admin/accounting/bank-accounts", categories: ["bank"] },
  { prefix: "/admin/accounting/assets", categories: ["assets"] },
  { prefix: "/admin/accounting/vouchers", categories: ["trial"] },
  { prefix: "/admin/accounting/journal-entries", categories: ["trial"] },
  { prefix: "/admin/accounting/schedules", categories: ["config"] },
  { prefix: "/admin/accounting/audit-trail", categories: ["trial"] },
  { prefix: "/admin/opening-balances", categories: ["openbal", "fy"] },
  // The Configuration dashboard itself (/admin/accounting exactly) — checked
  // last and matched exactly, not by prefix, since every other entry above
  // is also technically a prefix match of a path starting "/admin/accounting".
  { prefix: "/admin/accounting", exact: true, categories: ["yearend", "config", "fy", "trial"] },
];

// Small, deliberate — not "everything" — for any route not yet in the list
// above.
const DEFAULT_RELEVANT = ["yearend", "config"];

function matchRelevant(pathname) {
  if (!pathname) return new Set(DEFAULT_RELEVANT);
  const hit = RELEVANT_BY_PATH.find((r) => (r.exact ? pathname === r.prefix : pathname.startsWith(r.prefix)));
  return new Set(hit ? hit.categories : DEFAULT_RELEVANT);
}

const RESOLVE_HREF = {
  trialBalanceBalanced: "/admin/accounting/statements?tab=trial-balance",
  accountsMissingScheduleCode: "/admin/accounting/books?tab=schedules",
  defaultAccountMappingsConfigured: "/admin/accounting?drawer=fiscal-config",
  draftVouchersPending: "/admin/accounting/books?tab=entries",
  depreciationPosted: "/admin/accounting/registers?tab=assets",
  bankStatementLinesUnmatched: "/admin/accounting/registers?tab=bank-accounts",
  liabilitiesOverdue: "/admin/accounting/registers?tab=liabilities",
};

const inr = (n) => `₹${Math.abs(Number(n) || 0).toLocaleString("en-IN")}`;

const CATEGORIES = [
  {
    key: "yearend",
    label: "Year-end close",
    icon: "flag",
    questions: [
      {
        key: "pending",
        label: "What's pending before I close the year?",
        answer: (ctx) => {
          const open = (ctx.checks || []).filter((c) => !c.passed);
          if (!open.length) return { text: "Nothing — every check passes. You're clear to close the year.", actions: [] };
          return {
            text: `${open.length} item${open.length === 1 ? "" : "s"} outstanding:`,
            list: open.map((c) => c.message || c.rule),
            actions: open.slice(0, 3).map((c) => ({ label: `Fix: ${c.message?.slice(0, 40) || c.rule}`, href: RESOLVE_HREF[c.rule] })).filter((a) => a.href),
          };
        },
      },
      {
        key: "fixnonblocking",
        label: "What non-blocking issues are open?",
        answer: (ctx) => {
          const soft = (ctx.checks || []).filter((c) => !c.passed && !c.blocking);
          if (!soft.length) return { text: "None — every non-blocking check passes too.", actions: [] };
          return {
            text: `${soft.length} non-blocking item${soft.length === 1 ? "" : "s"} — won't stop a statement printing, but worth clearing:`,
            list: soft.map((c) => c.message || c.rule),
            actions: soft.slice(0, 3).map((c) => ({ label: `Review: ${c.message?.slice(0, 40) || c.rule}`, href: RESOLVE_HREF[c.rule] })).filter((a) => a.href),
          };
        },
      },
      {
        key: "agm",
        label: "What do I need for the AGM?",
        answer: () => ({
          text: "The AGM pack needs, side by side with last year's figures: Income & Expenditure, Balance Sheet, Receipts & Payments, Schedules A–J, Trial Balance, and the member dues position. All of these come from one Financial Year once it's closed.",
          actions: [
            { label: "Open Year-End Close", href: "/admin/accounting/statements?tab=year-end" },
            { label: "Open Statements", href: "/admin/accounting/statements" },
          ],
        }),
      },
      {
        key: "readiness",
        label: "Am I ready to close this Financial Year?",
        answer: (ctx) => {
          const r = ctx.health?.financialYearReadiness;
          if (!r) return { text: "Couldn't check readiness — the health dashboard needs a Financial Year to be selected first.", actions: [] };
          if (r.readyToClose) return { text: `Yes — status is "${r.status}". You can move to closing this year.`, actions: [{ label: "Open Year-End Close", href: "/admin/accounting/statements?tab=year-end" }] };
          return { text: `Not yet — current status is "${r.status}", next is "${r.nextStatus}". ${(ctx.health?.pendingTasks || []).length} blocking task(s) remain.`, actions: [{ label: "Open Year-End Close", href: "/admin/accounting/statements?tab=year-end" }] };
        },
      },
      {
        key: "blockingtasks",
        label: "What's actually blocking the close (not just a warning)?",
        answer: (ctx) => {
          const tasks = ctx.health?.pendingTasks || [];
          if (!tasks.length) return { text: "Nothing blocking — every mandatory close task is done.", actions: [] };
          return { text: `${tasks.length} blocking task${tasks.length === 1 ? "" : "s"}:`, list: tasks.map((t) => t.message || t.label || t.rule || String(t)), actions: [] };
        },
      },
      {
        key: "healthscore",
        label: "What's my accounting health score right now?",
        answer: (ctx) => {
          if (ctx.health?.healthScore == null) return { text: "Couldn't compute a health score — needs a Financial Year selected.", actions: [] };
          const failed = (ctx.health.components || []).filter((c) => !c.passed);
          return {
            text: `${ctx.health.healthScore}/100 for ${ctx.health.financialYearLabel || "this year"}.${failed.length ? ` ${failed.length} component${failed.length === 1 ? "" : "s"} dragging it down:` : " Every component passes."}`,
            list: failed.map((c) => c.reason || c.label),
            actions: failed.slice(0, 3).map((c) => ({ label: `Fix: ${c.label}`, href: c.navigationTarget })).filter((a) => a.href),
          };
        },
      },
    ],
  },
  {
    key: "fy",
    label: "Financial years",
    icon: "calendar-range",
    questions: [
      {
        key: "fy",
        label: "What financial year am I in, and what's its status?",
        answer: (ctx) => {
          const fy = ctx.setupState?.financialYear;
          if (!fy) return { text: "No Financial Year exists yet.", actions: [{ label: "Create one", href: "/admin/accounting?drawer=financial-years" }] };
          return { text: `${fy.label || "This year"} — status: ${fy.status || "unknown"}.`, actions: [{ label: "Financial Years", href: "/admin/accounting?drawer=financial-years" }] };
        },
      },
      {
        key: "fylist",
        label: "How many Financial Years does this society have?",
        answer: (ctx) => {
          const years = ctx.financialYears || [];
          if (!years.length) return { text: "None yet — this society hasn't opened its first Financial Year.", actions: [{ label: "Financial Years", href: "/admin/accounting?drawer=financial-years" }] };
          return {
            text: `${years.length}, most recent first:`,
            list: years.slice(0, 8).map((y) => `${y.label || y.name} — ${y.status || "unknown"}`),
            actions: [{ label: "Financial Years", href: "/admin/accounting?drawer=financial-years" }],
          };
        },
      },
      {
        key: "fyopen",
        label: "Is there more than one open Financial Year?",
        answer: (ctx) => {
          const open = (ctx.financialYears || []).filter((y) => (y.status || "").toLowerCase() === "open");
          if (open.length <= 1) return { text: open.length === 1 ? `Just one — ${open[0].label || open[0].name}. That's normal.` : "No open Financial Year right now.", actions: [] };
          return { text: `${open.length} are marked open at once — usually only the current year should be. Worth checking these aren't left open by mistake:`, list: open.map((y) => y.label || y.name), actions: [{ label: "Financial Years", href: "/admin/accounting?drawer=financial-years" }] };
        },
      },
    ],
  },
  {
    key: "trial",
    label: "Trial balance & ledger",
    icon: "scale",
    questions: [
      {
        key: "tbbalanced",
        label: "Is the Trial Balance balanced right now?",
        answer: (ctx) => {
          const c = (ctx.health?.components || []).find((x) => x.key === "trialBalance");
          if (!c) return { text: "Couldn't check — needs a Financial Year selected.", actions: [{ label: "Open Trial Balance", href: "/admin/accounting/statements?tab=trial-balance" }] };
          return { text: c.reason, actions: c.passed ? [] : [{ label: "Open Trial Balance", href: "/admin/accounting/statements?tab=trial-balance" }] };
        },
      },
      {
        key: "draftvouchers",
        label: "Are there draft vouchers waiting to be posted?",
        answer: (ctx) => {
          const c = (ctx.checks || []).find((x) => x.rule === "draftVouchersPending");
          if (!c) return { text: "No draft-voucher check registered for this society.", actions: [] };
          return { text: c.message, actions: c.passed ? [] : [{ label: "Open Entries", href: "/admin/accounting/books?tab=entries" }] };
        },
      },
      {
        key: "schedulecoverage",
        label: "Do all accounts have a schedule code assigned?",
        answer: (ctx) => {
          const c = (ctx.checks || []).find((x) => x.rule === "accountsMissingScheduleCode");
          if (!c) return { text: "No schedule-coverage check registered for this society.", actions: [] };
          return { text: c.message, actions: c.passed ? [] : [{ label: "Open Schedules", href: "/admin/accounting/books?tab=schedules" }] };
        },
      },
      {
        key: "glaccounts",
        label: "How many accounts have any activity this year?",
        answer: (ctx) => {
          const rows = ctx.glSummary?.accounts || ctx.glSummary || [];
          if (!Array.isArray(rows) || !rows.length) return { text: "Couldn't read the General Ledger summary — needs a Financial Year selected.", actions: [{ label: "Open General Ledger", href: "/admin/accounting/registers?tab=general-ledger" }] };
          return { text: `${rows.length} accounts have at least one posting this Financial Year.`, actions: [{ label: "Open General Ledger", href: "/admin/accounting/registers?tab=general-ledger" }] };
        },
      },
    ],
  },
  {
    key: "surplus",
    label: "Income, surplus & balance sheet",
    icon: "trending-up",
    questions: [
      {
        key: "surplus",
        label: "What's this year's surplus or deficit?",
        answer: (ctx) => {
          if (ctx.surplus === null) return { text: "Couldn't read the Income & Expenditure statement — check a Financial Year exists.", actions: [] };
          const kind = ctx.surplus >= 0 ? "surplus" : "deficit";
          return {
            text: `${inr(ctx.surplus)} ${kind} for the year, from the Income & Expenditure statement.`,
            actions: [
              { label: "View Income & Expenditure", href: "/admin/accounting/statements?tab=income-expenditure" },
              ...(ctx.surplus > 0 ? [{ label: "Appropriate to a fund", href: "/admin/accounting/registers?tab=funds" }] : []),
            ],
          };
        },
      },
      {
        key: "totalassets",
        label: "What are total assets right now?",
        answer: (ctx) => {
          if (ctx.balanceSheet?.totalAssetsCurrent == null) return { text: "Couldn't read the Balance Sheet — needs a Financial Year selected.", actions: [{ label: "Open Balance Sheet", href: "/admin/accounting/statements?tab=balance-sheet" }] };
          const prior = ctx.balanceSheet.totalAssetsPrior;
          const change = prior != null ? ` (${ctx.balanceSheet.totalAssetsCurrent >= prior ? "up" : "down"} from ${inr(prior)} last year)` : "";
          return { text: `${inr(ctx.balanceSheet.totalAssetsCurrent)}${change}.`, actions: [{ label: "Open Balance Sheet", href: "/admin/accounting/statements?tab=balance-sheet" }] };
        },
      },
      {
        key: "totalliabilities",
        label: "What are total liabilities right now?",
        answer: (ctx) => {
          if (ctx.balanceSheet?.totalLiabilitiesCurrent == null) return { text: "Couldn't read the Balance Sheet — needs a Financial Year selected.", actions: [{ label: "Open Balance Sheet", href: "/admin/accounting/statements?tab=balance-sheet" }] };
          return { text: `${inr(ctx.balanceSheet.totalLiabilitiesCurrent)}.`, actions: [{ label: "Open Balance Sheet", href: "/admin/accounting/statements?tab=balance-sheet" }] };
        },
      },
      {
        key: "equity",
        label: "What's total equity/reserves including this year's surplus?",
        answer: (ctx) => {
          if (ctx.balanceSheet?.totalEquityInclSurplusCurrent == null) return { text: "Couldn't read the Balance Sheet — needs a Financial Year selected.", actions: [{ label: "Open Balance Sheet", href: "/admin/accounting/statements?tab=balance-sheet" }] };
          return { text: `${inr(ctx.balanceSheet.totalEquityInclSurplusCurrent)}.`, actions: [{ label: "Open Balance Sheet", href: "/admin/accounting/statements?tab=balance-sheet" }] };
        },
      },
      {
        key: "doesbalance",
        label: "Do assets actually equal liabilities plus equity?",
        answer: (ctx) => {
          const bs = ctx.balanceSheet;
          if (!bs || bs.totalAssetsCurrent == null) return { text: "Couldn't read the Balance Sheet — needs a Financial Year selected.", actions: [{ label: "Open Balance Sheet", href: "/admin/accounting/statements?tab=balance-sheet" }] };
          const rhs = (bs.totalLiabilitiesCurrent || 0) + (bs.totalEquityInclSurplusCurrent || 0);
          const diff = Math.round((bs.totalAssetsCurrent - rhs) * 100) / 100;
          if (Math.abs(diff) < 1) return { text: `Yes — Assets ${inr(bs.totalAssetsCurrent)} = Liabilities + Equity ${inr(rhs)}.`, actions: [] };
          return { text: `No — off by ${inr(diff)}. Assets ${inr(bs.totalAssetsCurrent)} vs Liabilities + Equity ${inr(rhs)}.`, actions: [{ label: "Open Trial Balance", href: "/admin/accounting/statements?tab=trial-balance" }] };
        },
      },
    ],
  },
  {
    key: "funds",
    label: "Funds & reserves",
    icon: "piggy-bank",
    questions: [
      {
        key: "fundcount",
        label: "How many funds does this society maintain?",
        answer: (ctx) => {
          const funds = ctx.funds || [];
          if (!funds.length) return { text: "No funds set up yet (e.g. Sinking Fund, Repair Fund).", actions: [{ label: "Open Funds", href: "/admin/accounting/registers?tab=funds" }] };
          return { text: `${funds.length}, with current balances:`, list: funds.map((f) => `${f.name} — ${inr(f.balance)}`), actions: [{ label: "Open Funds", href: "/admin/accounting/registers?tab=funds" }] };
        },
      },
      {
        key: "biggestfund",
        label: "Which fund has the largest balance?",
        answer: (ctx) => {
          const funds = ctx.funds || [];
          if (!funds.length) return { text: "No funds set up yet.", actions: [] };
          const top = [...funds].sort((a, b) => (b.balance || 0) - (a.balance || 0))[0];
          return { text: `${top.name} — ${inr(top.balance)}.`, actions: [{ label: "Open Funds", href: "/admin/accounting/registers?tab=funds" }] };
        },
      },
      {
        key: "emptyfunds",
        label: "Are any funds at zero balance?",
        answer: (ctx) => {
          const zero = (ctx.funds || []).filter((f) => !f.balance);
          if (!zero.length) return { text: "No — every fund has a positive balance.", actions: [] };
          return { text: `${zero.length} fund${zero.length === 1 ? "" : "s"} at zero:`, list: zero.map((f) => f.name), actions: [{ label: "Open Funds", href: "/admin/accounting/registers?tab=funds" }] };
        },
      },
    ],
  },
  {
    key: "liabilities",
    label: "Liabilities & dues",
    icon: "alert-octagon",
    questions: [
      {
        key: "liaboverdue",
        label: "Are any liabilities overdue?",
        answer: (ctx) => {
          const c = (ctx.checks || []).find((x) => x.rule === "liabilitiesOverdue");
          const overdue = (ctx.liabilities || []).filter((l) => l.status === "Open" && l.dueDate && new Date(l.dueDate) < new Date());
          if (!overdue.length) return { text: c?.message || "No overdue liabilities right now.", actions: [] };
          return {
            text: `${overdue.length} overdue:`,
            list: overdue.map((l) => `${l.name} — ${inr(l.outstandingAmount ?? l.amount)}, due ${new Date(l.dueDate).toLocaleDateString("en-IN")}`),
            actions: [{ label: "Open Liabilities", href: "/admin/accounting/registers?tab=liabilities" }],
          };
        },
      },
      {
        key: "liabopen",
        label: "How many liabilities are still open?",
        answer: (ctx) => {
          const open = (ctx.liabilities || []).filter((l) => l.status === "Open");
          if (!open.length) return { text: "None — every recorded liability is closed.", actions: [] };
          const total = open.reduce((s, l) => s + (l.outstandingAmount ?? l.amount ?? 0), 0);
          return { text: `${open.length}, totalling ${inr(total)} outstanding.`, actions: [{ label: "Open Liabilities", href: "/admin/accounting/registers?tab=liabilities" }] };
        },
      },
    ],
  },
  {
    key: "bank",
    label: "Bank reconciliation",
    icon: "landmark",
    questions: [
      {
        key: "bankunmatched",
        label: "Are there unmatched bank statement lines?",
        answer: (ctx) => {
          const c = (ctx.checks || []).find((x) => x.rule === "bankStatementLinesUnmatched" || x.rule === "bankStatementsUnmatched");
          if (!c) return { text: "No bank-reconciliation check registered for this society.", actions: [] };
          return { text: c.message, actions: c.passed ? [] : [{ label: "Open Bank Accounts", href: "/admin/accounting/registers?tab=bank-accounts" }] };
        },
      },
      {
        key: "bankcount",
        label: "How many bank accounts does this society have on record?",
        answer: (ctx) => {
          const accts = ctx.bankAccounts || [];
          if (!accts.length) return { text: "None added yet.", actions: [{ label: "Open Bank Accounts", href: "/admin/accounting/registers?tab=bank-accounts" }] };
          const active = accts.filter((a) => a.isActive !== false).length;
          return { text: `${accts.length} on record, ${active} active.`, list: accts.map((a) => `${a.bankName || a.name}${a.accountNumber ? ` ••${String(a.accountNumber).slice(-4)}` : ""}`), actions: [{ label: "Open Bank Accounts", href: "/admin/accounting/registers?tab=bank-accounts" }] };
        },
      },
    ],
  },
  {
    key: "assets",
    label: "Fixed assets & depreciation",
    icon: "package",
    questions: [
      {
        key: "depposted",
        label: "Has this year's depreciation been posted?",
        answer: (ctx) => {
          const c = (ctx.checks || []).find((x) => x.rule === "depreciationPosted" || x.rule === "assetsMissingDepreciationThisYear");
          if (!c) return { text: "No depreciation check registered for this society.", actions: [] };
          return { text: c.message, actions: c.passed ? [] : [{ label: "Open Assets", href: "/admin/accounting/registers?tab=assets" }] };
        },
      },
    ],
  },
  {
    key: "openbal",
    label: "Opening balances",
    icon: "door-open",
    questions: [
      {
        key: "openingconfirmed",
        label: "Have opening balances been confirmed for this year?",
        answer: (ctx) => {
          const c = (ctx.health?.components || []).find((x) => x.key === "openingBalance");
          if (!c) return { text: "Couldn't check — needs a Financial Year selected.", actions: [{ label: "Open Opening Balances", href: "/admin/opening-balances" }] };
          return { text: c.reason, actions: c.passed ? [] : [{ label: "Open Opening Balances", href: "/admin/opening-balances" }] };
        },
      },
    ],
  },
  {
    key: "config",
    label: "Setup & configuration",
    icon: "settings-2",
    questions: [
      {
        key: "mappings",
        label: "Are default account mappings configured?",
        answer: (ctx) => {
          const c = (ctx.checks || []).find((x) => x.rule === "defaultAccountMappingsConfigured");
          if (!c) return { text: "No account-mapping check registered for this society.", actions: [] };
          return { text: c.message, actions: c.passed ? [] : [{ label: "Open Fiscal Config", href: "/admin/accounting?drawer=fiscal-config" }] };
        },
      },
      {
        key: "otherfailed",
        label: "What other validation checks are failing?",
        answer: (ctx) => {
          const c = (ctx.health?.components || []).find((x) => x.key === "otherValidations");
          const failed = c?.failedChecks || [];
          if (!failed.length) return { text: c ? c.reason : "No other validation checks registered.", actions: [] };
          return { text: `${failed.length} failing:`, list: failed.map((f) => f.message || f.label), actions: failed.slice(0, 3).map((f) => ({ label: `Fix: ${f.label}`, href: f.navigationTarget })).filter((a) => a.href) };
        },
      },
    ],
  },
];

export default function Assistant() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState(null);
  // Two different loading flags on purpose. `prefetching` runs silently the
  // instant the panel opens (so the first question asked is instant) and
  // must never block the UI — it used to share one `loading` flag with the
  // "answer" flow, which meant opening the panel always flashed the
  // category list -> "Checking your society's books..." -> category list
  // again, every single time, even though nothing had been clicked yet.
  // `asking` is the only one that renders a loading state, and it's true
  // only between a question click and its answer.
  const [prefetching, setPrefetching] = useState(false);
  const [asking, setAsking] = useState(false);
  const [category, setCategory] = useState(null); // CATEGORIES[i] | null
  const [answer, setAnswer] = useState(null); // { question, result } | null
  const [showAllCategories, setShowAllCategories] = useState(false);

  const relevantKeys = useMemo(() => matchRelevant(pathname), [pathname]);
  const relevantCategories = relevantKeys ? CATEGORIES.filter((c) => relevantKeys.has(c.key)) : CATEGORIES;
  const otherCategories = relevantKeys ? CATEGORIES.filter((c) => !relevantKeys.has(c.key)) : [];

  // A page navigation while the panel is open shouldn't leave it defaulted
  // to "show everything" from the last page.
  useEffect(() => { setShowAllCategories(false); }, [pathname]);

  const loadCtx = useCallback(async () => {
    if (ctx) return ctx;
    setPrefetching(true);
    try {
      const getJson = (url) => fetch(url, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const [setupRes, checksRes, funds, liabilities, bankAccounts, financialYears] = await Promise.all([
        getJson("/api/accounting/setup-state"),
        getJson("/api/accounting/validation/run"),
        getJson("/api/accounting/funds"),
        getJson("/api/accounting/liabilities"),
        getJson("/api/accounting/bank-accounts"),
        getJson("/api/accounting/financial-years"),
      ]);
      const fyId = setupRes?.financialYear?._id;
      const [ieRes, healthRes, balanceSheetRes, glSummaryRes] = fyId
        ? await Promise.all([
          getJson(`/api/accounting/financial-statements/income-expenditure?financialYearId=${fyId}`),
          getJson(`/api/accounting/health-dashboard?financialYearId=${fyId}`),
          getJson(`/api/accounting/financial-statements/balance-sheet?financialYearId=${fyId}`),
          getJson(`/api/accounting/general-ledger/summary?financialYearId=${fyId}`),
        ])
        : [null, null, null, null];
      const next = {
        setupState: setupRes || null,
        checks: checksRes?.results || checksRes?.checks || [],
        surplus: ieRes?.statement?.surplusOrDeficitCurrent ?? null,
        health: healthRes?.dashboard || null,
        balanceSheet: balanceSheetRes?.statement || null,
        glSummary: glSummaryRes?.summary || null,
        funds: funds?.funds || [],
        liabilities: liabilities?.liabilities || [],
        bankAccounts: bankAccounts?.bankAccounts || [],
        financialYears: financialYears?.financialYears || [],
      };
      setCtx(next);
      return next;
    } finally {
      setPrefetching(false);
    }
  }, [ctx]);

  // Prefetch the moment the panel opens, before any question is picked, so
  // browsing categories doesn't feel gated behind a spinner every time. Runs
  // silently — `prefetching` isn't read by the render below, only `asking`
  // is, so this never interrupts whatever the admin is looking at.
  useEffect(() => {
    if (open) loadCtx();
  }, [open, loadCtx]);

  const ask = useCallback(async (q) => {
    setAsking(true);
    try {
      const c = await loadCtx();
      setAnswer({ question: q.label, result: q.answer(c) });
    } finally {
      setAsking(false);
    }
  }, [loadCtx]);

  const closeAll = () => { setOpen(false); setCategory(null); setAnswer(null); };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Accounting Assistant"
        style={{
          position: "fixed", bottom: 22, right: 22, zIndex: 60, width: 46, height: 46, borderRadius: 999,
          background: "var(--r-brand)", color: "var(--r-brand-ink)", border: "none", cursor: "pointer",
          boxShadow: "0 6px 18px rgba(0,0,0,0.22)", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <Icon name="help-circle" size={20} />
      </button>
    );
  }

  return (
    <div style={{
      position: "fixed", bottom: 22, right: 22, zIndex: 60, width: 360, maxHeight: "76vh",
      background: "var(--r-surface)", border: "1px solid var(--r-hairline)", borderRadius: 12,
      boxShadow: "0 12px 32px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--r-hairline)" }}>
        <Icon name="help-circle" size={16} color="var(--r-brand)" />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>Accounting Assistant</div>
        <button type="button" onClick={closeAll} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--r-fg-4)", display: "flex" }}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--r-fg-4)", lineHeight: 1.5, borderBottom: "1px solid var(--r-hairline)" }}>
        Answers your society&apos;s own data, live, offline — pick a question, no free typing. Not a chatbot.
      </div>
      <div style={{ overflowY: "auto", padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        {answer ? (
          <div>
            <button type="button" onClick={() => setAnswer(null)} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--r-brand)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 8 }}>
              <Icon name="chevron-left" size={12} /> Ask something else
            </button>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-1)", marginBottom: 6 }}>{answer.question}</div>
            <div style={{ fontSize: 12.5, color: "var(--r-fg-2)", lineHeight: 1.6 }}>{answer.result.text}</div>
            {answer.result.list?.length ? (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--r-fg-3)", lineHeight: 1.7 }}>
                {answer.result.list.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            ) : null}
            {answer.result.actions?.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {answer.result.actions.map((a) => (
                  <Btn key={a.href} size="sm" variant="primary" onClick={() => { closeAll(); router.push(a.href); }}>
                    {a.label}
                  </Btn>
                ))}
              </div>
            ) : null}
          </div>
        ) : asking ? (
          <div style={{ fontSize: 12, color: "var(--r-fg-4)", padding: "8px 2px" }}>Checking your society&apos;s books…</div>
        ) : category ? (
          <div>
            <button type="button" onClick={() => setCategory(null)} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--r-brand)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 8 }}>
              <Icon name="chevron-left" size={12} /> All categories
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--r-fg-1)", marginBottom: 8 }}>
              <Icon name={category.icon} size={13} color="var(--r-brand)" /> {category.label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {category.questions.map((q) => (
                <button
                  key={q.key}
                  type="button"
                  onClick={() => ask(q)}
                  style={{
                    textAlign: "left", padding: "9px 10px", borderRadius: 8, fontSize: 12.5,
                    background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)", color: "var(--r-fg-1)", cursor: "pointer",
                  }}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {relevantKeys ? (
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--r-fg-4)", margin: "2px 0 2px 2px" }}>
                For this page
              </div>
            ) : null}
            {relevantCategories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setCategory(cat)}
                style={{
                  display: "flex", alignItems: "center", gap: 9,
                  textAlign: "left", padding: "10px 11px", borderRadius: 8, fontSize: 12.5, fontWeight: 500,
                  background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)", color: "var(--r-fg-1)", cursor: "pointer",
                }}
              >
                <Icon name={cat.icon} size={14} color="var(--r-brand)" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{cat.label}</span>
                <span style={{ fontSize: 10.5, color: "var(--r-fg-4)", flexShrink: 0 }}>{cat.questions.length}</span>
                <Icon name="chevron-right" size={13} color="var(--r-fg-5)" style={{ flexShrink: 0 }} />
              </button>
            ))}
            {otherCategories.length > 0 && !showAllCategories ? (
              <button
                type="button"
                onClick={() => setShowAllCategories(true)}
                style={{
                  textAlign: "left", padding: "8px 11px", borderRadius: 8, fontSize: 11.5,
                  background: "none", border: "1px dashed var(--r-hairline)", color: "var(--r-fg-4)", cursor: "pointer", marginTop: 2,
                }}
              >
                + {otherCategories.length} more categor{otherCategories.length === 1 ? "y" : "ies"} (all accounting pages)
              </button>
            ) : null}
            {showAllCategories ? otherCategories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setCategory(cat)}
                style={{
                  display: "flex", alignItems: "center", gap: 9,
                  textAlign: "left", padding: "10px 11px", borderRadius: 8, fontSize: 12.5, fontWeight: 500,
                  background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)", color: "var(--r-fg-1)", cursor: "pointer",
                }}
              >
                <Icon name={cat.icon} size={14} color="var(--r-fg-4)" style={{ flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{cat.label}</span>
                <span style={{ fontSize: 10.5, color: "var(--r-fg-4)", flexShrink: 0 }}>{cat.questions.length}</span>
                <Icon name="chevron-right" size={13} color="var(--r-fg-5)" style={{ flexShrink: 0 }} />
              </button>
            )) : null}
          </div>
        )}
      </div>
    </div>
  );
}
