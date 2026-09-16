"use client";
import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "components/DashboardLayout";
import { useVisibleAdminNavigation } from "components/adminNavigation";
import { Icon } from "@/components/revamp";
import { CHECK_RESOLVE } from "@/lib/accounting/checkResolve";

// The accounting module's own page directory — used to live as QuickBar's
// static MODULE_PAGES list (components/accounting/QuickBar.jsx, removed
// 2026-09-13 as a duplicate of this component). `icon` here is the plain
// lucide name string; wrapped in <Icon/> below when built into extraPages,
// since CommandBar's page-search rows render `icon` as a raw node (it may
// also be a JSX element from flattened nav), not an icon-name string.
const ACCOUNTING_PAGES = [
  { label: "Configuration (Overview)", icon: "settings", href: "/admin/accounting" },
  { label: "Guided Setup", icon: "zap", href: "/admin/accounting/setup" },
  { label: "Account Heads", icon: "book-open", href: "/admin/accounting/chart-of-accounts" },
  { label: "Financial Years", icon: "calendar", href: "/admin/accounting/financial-years" },
  { label: "Automatic Entries (Posting Rules)", icon: "repeat", href: "/admin/accounting/posting-rules" },
  { label: "Book Checks (Validation Rules)", icon: "shield-check", href: "/admin/accounting/validation-rules" },
  { label: "Fiscal Configuration", icon: "sliders-horizontal", href: "/admin/accounting/fiscal-config" },
  { label: "Vouchers", icon: "receipt", href: "/admin/accounting/books?tab=entries", perm: "accounting.vouchers.view" },
  { label: "The Books (Journal Entries)", icon: "book-open", href: "/admin/accounting/books?tab=books", perm: "accounting.journalEntries.view" },
  { label: "Corrections (Audit Trail)", icon: "history", href: "/admin/accounting/books?tab=corrections", perm: "accounting.auditTrail.view" },
  { label: "Fixed Assets", icon: "package", href: "/admin/accounting/registers?tab=assets", perm: "accounting.assets.view" },
  { label: "Funds", icon: "piggy-bank", href: "/admin/accounting/registers?tab=funds", perm: "accounting.funds.view" },
  { label: "Liabilities", icon: "landmark", href: "/admin/accounting/registers?tab=liabilities", perm: "accounting.liabilities.view" },
  { label: "Cash Flow Setup (Bank Accounts)", icon: "banknote", href: "/admin/accounting/cash-flow" },
  { label: "Balance Sheet Format", icon: "layers", href: "/admin/accounting/format" },
  { label: "Full Statement Pack", icon: "file-text", href: "/admin/accounting/statements?tab=generate" },
  { label: "Income & Expenditure", icon: "trending-up", href: "/admin/accounting/statements?tab=income-expenditure" },
  { label: "Balance Sheet", icon: "scale", href: "/admin/accounting/statements?tab=assets-liabilities" },
  { label: "Trial Balance & Checks", icon: "check-square", href: "/admin/accounting/statements?tab=trial-balance" },
  { label: "Year-End Close", icon: "flag", href: "/admin/accounting/statements?tab=year-end" },
  { label: "Auditor Workspace", icon: "shield", href: "/admin/accounting/auditor", perm: "auditor.workspace.view" },
];

// QuickBar's own QUICK_ACTIONS, appended to admin's existing list below.
const ACCOUNTING_QUICK_ACTIONS = [
  { label: "New Voucher", icon: "receipt", href: "/admin/accounting/books?tab=entries", perm: "accounting.vouchers.create" },
  { label: "Bank Reconciliation", icon: "banknote", href: "/admin/accounting/registers?tab=bank-accounts", perm: "accounting.bankAccounts.match" },
  { label: "Add Asset", icon: "package", href: "/admin/accounting/registers?tab=assets", perm: "accounting.assets.register" },
  { label: "Fund Transfer", icon: "piggy-bank", href: "/admin/accounting/registers?tab=funds", perm: "accounting.funds.transfer" },
  { label: "Record Liability", icon: "landmark", href: "/admin/accounting/registers?tab=liabilities", perm: "accounting.liabilities.incur" },
  { label: "Generate Statement", icon: "file-text", href: "/admin/accounting/statements", perm: "statements.incomeExpenditure.view" },
];

export default function AdminLayout({ children }) {
  // Commercial module visibility. One cheap read of the society's flags; a
  // failure leaves the group hidden and never blocks the admin shell.
  const [commercialEnabled, setCommercialEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/commercial/flags", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.flags?.enabled) setCommercialEnabled(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const { visibleNavigation } = useVisibleAdminNavigation({ commercialEnabled });

  // Phase 1 of docs/ux-overhaul/2026-09-01-global-command-bar-design.md —
  // admin's first CommandBar config: page search over the nav above (via
  // DashboardLayout's flatten), a Members record search (same
  // /api/members/list every other admin page already uses — see
  // components/accounting/QuickBar.jsx for the pattern this generalizes),
  // and one minimal quick action. useMemo keeps the object's identity
  // stable across re-renders (e.g. when commercialEnabled flips) so
  // CommandBar's debounced-search effect, which depends on
  // `recordSources`, doesn't re-fire on unrelated parent re-renders.
  const commandBarConfig = useMemo(
    () => ({
      area: "admin",
      placeholder: "Search a member, flat, account head, or page… ( / )",
      extraPages: ACCOUNTING_PAGES.map((p) => ({ ...p, icon: <Icon name={p.icon} size={13} color="var(--r-fg-4)" /> })),
      recordSources: [
        {
          label: "Members",
          endpoint: "/api/members/list",
          query: "search",
          icon: "user",
          resultToHref: (m) => `/admin/ledger?memberId=${m._id}`,
          resultLabel: (m) => `${m.wing ? `${m.wing}-` : ""}${m.flatNo} — ${m.ownerName}`,
        },
        // No server-side text search on this endpoint (it only takes
        // type/includeInactive/withLock — app/api/accounting/chart-of-
        // accounts/route.js) — fetched once, filtered locally, same as
        // QuickBar's own ensureAccounts()/accountMatches did.
        {
          label: "Account heads",
          icon: "book-open",
          clientFetch: async () => {
            const res = await fetch("/api/accounting/chart-of-accounts", { credentials: "include" });
            const json = await res.json().catch(() => ({}));
            return json.accounts || [];
          },
          clientFilter: (items, needle) => {
            const n = needle.toLowerCase();
            return items.filter((a) => a.name?.toLowerCase().includes(n) || String(a.code).includes(n));
          },
          resultToHref: (a) => `/admin/accounting/chart-of-accounts?openLedger=${a._id}`,
          resultLabel: (a) => `${a.code} — ${a.name}`,
        },
      ],
      // "Accounting — N actions required" — the same 7 checks Year-End
      // Close shows, via lib/accounting/checkResolve.js's shared map, so
      // the two can never point at different places for the same check.
      inboxFetcher: async () => {
        const res = await fetch("/api/accounting/validation/run", { credentials: "include" });
        const json = await res.json().catch(() => ({}));
        const results = json.results || json.checks || [];
        return results.filter((c) => !c.passed).map((c) => {
          const r = CHECK_RESOLVE[c.rule];
          return { label: r?.label || c.message || c.rule, blocking: !!c.blocking, href: r?.href, fixLabel: r?.fix };
        });
      },
      inboxTitle: "Accounting actions required",
      // Scans for an accounting wizard this browser left mid-flow (see
      // YearEndClose.jsx's own localStorage keys) — same scan QuickBar ran.
      unfinishedCheck: () => {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (!key) continue;
          const val = window.localStorage.getItem(key);
          if (key.startsWith("accounting.yearEndWizard.") && Number(val) > 1) {
            return { label: "Continue closing the year", href: "/admin/accounting/statements?tab=year-end" };
          }
          if (key.startsWith("accounting.appropriationWizard.") && Number(val) > 1) {
            return { label: "Continue surplus appropriation", href: "/admin/accounting/statements?tab=year-end" };
          }
        }
        return null;
      },
      // Same 8 routes as the Dashboard's own "Quick actions" card
      // (app/admin/dashboard/PageClient.js quickLinks — "the eight routes
      // admins reach for most", already a vetted list, not a fresh guess),
      // plus Post Notice and View Members for the two most common non-
      // billing tasks. Every perm id below verified against
      // lib/rbac/page-access-map.js's `view` leaf for that pageKey — gate on
      // the real leaf, not a guess.
      quickActions: [
        { label: "Generate Bills", icon: "file-spreadsheet", href: "/admin/generate-bills", perm: "billing.dashboard.view" },
        { label: "Record Payment", icon: "credit-card", href: "/admin/payments", perm: "finance.payments.view" },
        { label: "View Bills", icon: "receipt", href: "/admin/view-bills", perm: "billing.viewBills.view" },
        // There is no standalone create-a-member page in this app — members
        // are onboarded via Import Members (bulk import, including
        // single-row imports), so "Add Member" links there.
        { label: "Add Member", icon: "user-plus", href: "/admin/import-members", perm: "member.importMembers.view" },
        { label: "View Members", icon: "users", href: "/admin/view-members", perm: "member.viewMembers.view" },
        { label: "Ledger", icon: "book-open", href: "/admin/ledger", perm: "finance.ledger.view" },
        { label: "Billing Config", icon: "settings", href: "/admin/billing-config", perm: "billing.config.view" },
        { label: "Bill Template", icon: "layout-template", href: "/admin/bill-template", perm: "billing.template.view" },
        { label: "Post Notice", icon: "megaphone", href: "/admin/notices", perm: "notice.notice.create" },
        { label: "Society Config", icon: "building-2", href: "/admin/society-config", perm: "society.config.view" },
        ...ACCOUNTING_QUICK_ACTIONS,
      ],
    }),
    [],
  );

  return (
    <DashboardLayout
      role="Admin"
      navigation={visibleNavigation}
      title="AapliSociety"
      subtitle="Admin Panel"
      commandBarConfig={commandBarConfig}
    >
      {children}
    </DashboardLayout>
  );
}
