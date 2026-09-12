"use client";
import { useEffect, useState } from "react";
import { hiddenNavGroups, moduleForPath } from "@/lib/entitlements/modules";
import {
  LayoutDashboard,
  Download,
  Settings,
  Database,
  UserPlus,
  Users,
  FileText,
  Upload,
  Eye,
  FileSpreadsheet,
  ClipboardList,
  BookOpen,
  CreditCard,
  AlertTriangle,
  BarChart3,
  Wallet,
  Megaphone,
  MessageSquare,
  UserCheck,
  FileEdit,
  Zap,
  TrendingUp,
  ClipboardCheck,
  FlaskConical,
  Shield,
  KeyRound,
  Repeat,
  ShieldCheck,
  Table,
  History,
  Package,
  PiggyBank,
  Landmark,
  Banknote,
  SlidersHorizontal,
  Layers,
  HelpCircle,
} from "lucide-react";

// Shared between app/admin/layout.js and app/my-access/page.js — the latter
// is intentionally outside /admin (it must render even for a role granted
// nothing yet) but still needs the same sidebar chrome/nav.
export const ADMIN_NAVIGATION = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", path: "/admin/dashboard", pageKey: "dashboard", icon: <LayoutDashboard size={16} /> },
      // pageKey: null — always visible, like the page itself is always
      // reachable. A society must not lose the ability to collect its own
      // records because of a permission-set change, and this link is the only
      // way to find that page from inside the app. The page shows an empty
      // state when there is nothing waiting, which is the normal case.
      { name: "My Society Data", path: "/admin/data-handover", pageKey: null, icon: <Download size={16} /> },
      // pageKey: null — help must stay reachable regardless of the caller's
      // permission set (same reasoning as "My Society Data" above). See
      // docs/ux-overhaul/2026-09-01-faq-docs-hub-design.md.
      { name: "Help & FAQ", path: "/admin/help", pageKey: null, icon: <HelpCircle size={16} /> },
    ],
  },
  {
    title: "Configuration",
    items: [
      { name: "Society Config", path: "/admin/society-config", pageKey: "societyConfig", icon: <Settings size={16} /> },
      { name: "DB Manager", path: "/admin/database-manager", pageKey: "databaseManager", icon: <Database size={16} /> },
    ],
  },
  {
    title: "Members",
    items: [
      { name: "Import Members", path: "/admin/import-members", pageKey: "importMembers", icon: <UserPlus size={16} /> },
      { name: "View Members", path: "/admin/view-members", pageKey: "viewMembers", icon: <Users size={16} /> },
      { name: "Tenant Requests", path: "/admin/tenant-requests", pageKey: "tenantRequests", icon: <UserCheck size={16} /> },
      { name: "Profile Changes", path: "/admin/profile-edit-requests", pageKey: "profileEditRequests", icon: <FileEdit size={16} /> },
    ],
  },
  {
    title: "Billing",
    items: [
      { name: "Billing Template", path: "/admin/bill-template", pageKey: "billTemplate", icon: <FileText size={16} /> },
      { name: "Import Bills", path: "/admin/import-bills", pageKey: "importBills", icon: <Upload size={16} /> },
      { name: "Billing Config", path: "/admin/billing-config", pageKey: "billingConfig", icon: <Settings size={16} /> },
      { name: "View Bills", path: "/admin/view-bills", pageKey: "viewBills", icon: <Eye size={16} /> },
      { name: "Generate Bills", path: "/admin/generate-bills", pageKey: "generateBills", icon: <FileSpreadsheet size={16} /> },
      { name: "Audit Report", path: "/admin/audit", pageKey: "auditReport", icon: <ClipboardList size={16} /> },
    ],
  },
  {
    title: "tests",
    items: [
      { name: "Test Page", path: "/admin/accounting-lab", pageKey: "systemTests", icon: <ClipboardList size={16} /> },
      { name: "Load Test Lab", path: "/admin/loadtest-lab", pageKey: "systemTests", icon: <FlaskConical size={16} /> },
    ],
  },
  // The accounting UI/UX revamp: exactly 6 rail entries, one page each, no
  // sidebar sprawl. Everything small (financial years, book checks, posting
  // rules, fiscal mappings, guided setup) lives INLINE on page 1
  // (Configuration) as accordion sections — not its own nav row, not a
  // drawer overlay. Statements (Full Pack / Income & Expenditure / Balance
  // Sheet / Trial Balance / Year-End Close) live as tabs INSIDE page 6
  // (Generate Balance Sheet) — one nav row, not five. Every one of the 6
  // pages carries a StepRail (components/accounting/StepRail.jsx) so a
  // missed earlier step is flagged with a direct jump, cross-page, wherever
  // you are. See docs/accounting-module-audit-and-consolidation-plan.md.
  {
    title: "Accounting",
    items: [
      { name: "Configuration", path: "/admin/accounting", pageKey: "accountingOverview", icon: <Settings size={16} /> },
      { name: "Account Heads", path: "/admin/accounting/chart-of-accounts", pageKey: "chartOfAccounts", icon: <BookOpen size={16} /> },
      { name: "Assets & Liabilities", path: "/admin/accounting/registers", pageKey: "assets", icon: <Package size={16} /> },
      { name: "Cash Flow Setup", path: "/admin/accounting/cash-flow", pageKey: "bankAccounts", icon: <Banknote size={16} /> },
      { name: "Balance Sheet Format", path: "/admin/accounting/format", pageKey: "schedules", icon: <Layers size={16} /> },
      { name: "Generate Balance Sheet", path: "/admin/accounting/statements", pageKey: "statementsWorkspace", icon: <Zap size={16} /> },
    ],
  },
  // Not part of the 6-page cluster above (these are day-to-day transaction
  // entry and audit, not one-time setup/configuration) — kept as their own
  // minimal rows, same as before.
  {
    title: "Books & Audit",
    items: [
      { name: "The Books", path: "/admin/accounting/books", pageKey: "books", icon: <BookOpen size={16} /> },
      { name: "Opening Balances", path: "/admin/opening-balances", pageKey: "openingBalances", icon: <Database size={16} /> },
      { name: "Auditor Workspace", path: "/admin/accounting/auditor", pageKey: "auditorWorkspace", icon: <ShieldCheck size={16} /> },
    ],
  },
  {
    title: "Transactions",
    items: [
      { name: "Ledger", path: "/admin/ledger", pageKey: "ledger", icon: <BookOpen size={16} /> },
      { name: "Payments", path: "/admin/payments", pageKey: "payments", icon: <CreditCard size={16} /> },
      { name: "Receipts", path: "/admin/receipts", pageKey: "receipts", icon: <FileText size={16} /> },
      { name: "Late Payments", path: "/admin/late-payment", pageKey: "latePayment", icon: <AlertTriangle size={16} /> },
      // Was labeled "Balance Sheet" — it isn't one (no ledger, no Assets=
      // Liabilities+Equity). It's a monthly billing/collection dashboard
      // with manual accrual-entry add/remove. Renamed so it stops being
      // mistaken for the real statutory Balance Sheet at
      // /admin/assets-liabilities. See docs/accounting-module-audit-and-
      // consolidation-plan.md §3 item 5 — full fold-in into Statements is
      // follow-up work, not done here.
      { name: "Billing & Accrual Entries", path: "/admin/balance-sheet", pageKey: "balanceSheet", icon: <BarChart3 size={16} /> },
      { name: "Expenditure", path: "/admin/expenditure", pageKey: "expenditure", icon: <Wallet size={16} /> },
    ],
  },
  {
    title: "Communication",
    items: [
      { name: "Notices", path: "/admin/notices", pageKey: "notices", icon: <Megaphone size={16} /> },
      { name: "Complaints", path: "/admin/complaints", pageKey: "complaints", icon: <MessageSquare size={16} /> },
    ],
  },
  {
    title: "Security",
    items: [
      { name: "Visitors", path: "/admin/visitors", pageKey: "visitors", icon: "🚪" },
      { name: "Active Visitors", path: "/admin/visitors/active", pageKey: "visitorsActive", icon: "🟢" },
      { name: "Visitor Log", path: "/admin/visitors/log", pageKey: "visitorsLog", icon: "📋" },
      { name: "Security Guards", path: "/admin/security-guards", pageKey: "securityGuards", icon: "👮" },
      { name: "Offline Audit", path: "/admin/visitors/audit", pageKey: "visitorsAudit", icon: "🗂️" },
      { name: "Watchlist", path: "/admin/blacklist", pageKey: "blacklist", icon: "⛔" },
    ],
  },
  {
    title: "Amenities",
    items: [
      { name: "Overview", path: "/admin/amenities", pageKey: "amenities", icon: "🏠" },
      { name: "Categories", path: "/admin/amenities/categories", pageKey: "amenities", icon: "🗂️" },
      { name: "All Amenities", path: "/admin/amenities/list", pageKey: "amenities", icon: "🏊" },
      { name: "Maintenance", path: "/admin/amenities/maintenance", pageKey: "amenities", icon: "🔧" },
      { name: "Attendance", path: "/admin/amenities/attendance", pageKey: "amenities", icon: "✅" },
      { name: "Events", path: "/admin/amenities/events", pageKey: "amenities", icon: "🎉" },
      { name: "Analytics", path: "/admin/amenities/analytics", pageKey: "amenities", icon: "📊" },
      { name: "Incidents", path: "/admin/amenities/incidents", pageKey: "amenities", icon: "⚠️" },
      { name: "Settings", path: "/admin/amenities/settings", pageKey: "amenities", icon: "⚙️" },
    ],
  },
  {
    title: "Administration",
    items: [
      { name: "Roles & Access", path: "/admin/rbac/roles", pageKey: "roleManager", icon: <Shield size={16} /> },
      // Always visible — every authenticated user (including a role granted
      // nothing yet) can see their own access here. Not gated by pageKey.
      { name: "My Access", path: "/my-access", pageKey: null, icon: <KeyRound size={16} /> },
    ],
  },
];

export const COMMERCIAL_NAVIGATION = {
  title: "Commercial",
  items: [
    { name: "Shops & offices", path: "/admin/commercial/shops", pageKey: "commercial", icon: "🏪" },
    { name: "Rate card", path: "/admin/commercial/rate-card", pageKey: "commercial", icon: "💰" },
    { name: "Categories", path: "/admin/commercial/categories", pageKey: "commercial", icon: "🏷️" },
    { name: "Overview", path: "/admin/commercial", pageKey: "commercial", icon: "📊" },
  ],
};

/**
 * Fetches the caller's page-access set and returns the nav filtered to what
 * they can actually see. `null` while loading (nothing rendered, never a
 * flash of unauthorized links). Items with pageKey:null (e.g. "My Access")
 * always render — everyone can reach their own access page.
 */
// Module-level cache: every page on the admin side mounts this hook fresh on
// navigation. Without a shared cache, each nav re-fetched my-access from
// scratch and rendered the sidebar as empty (allowedPages=null) until it
// came back — the sidebar visibly disappeared and rebuilt on every click.
// Cached result hydrates instantly; a background revalidation keeps it
// correct after a role change without ever blanking the nav in between.
let navCache = null; // { allowedPages } | null
let navCachePromise = null;

// Entitlements get the same treatment as permissions, for the same reason: a
// per-navigation refetch made the sidebar blank and rebuild on every click.
// Cached module-wide, hydrated instantly, revalidated in the background.
let entCache = null; // { modules } | null
let entCachePromise = null;

function toAllowedPages(d) {
  if (!d || d.error) return new Set();
  if (d.bootstrapped === false) return "all";
  return new Set(
    (d.pages || [])
      .filter((p) => p.level === "view" || p.level === "manage")
      .map((p) => p.key),
  );
}

// A nav item whose path belongs to an unentitled module. Covers the items
// that live outside a module's own nav group — Tenant Requests sits under
// "Members", and hiding by group title alone would leave it visible.
function isModulePath(path, modules) {
  if (!path || !modules) return false;
  const mod = moduleForPath(path);
  return Boolean(mod) && modules[mod.key] !== true;
}

export function useVisibleAdminNavigation({ commercialEnabled = false } = {}) {
  const [allowedPages, setAllowedPages] = useState(
    navCache ? navCache.allowedPages : null,
  );
  useEffect(() => {
    let alive = true;
    if (!navCachePromise) {
      navCachePromise = fetch("/api/rbac/my-access", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const resolved = toAllowedPages(d);
          navCache = { allowedPages: resolved };
          return resolved;
        })
        .catch(() => {
          const resolved = new Set();
          navCache = { allowedPages: resolved };
          return resolved;
        });
    }
    navCachePromise.then((resolved) => {
      if (alive) setAllowedPages(resolved);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Phase 2 — hide what the society has not bought.
  //
  // Purely cosmetic. Every hidden route is already 404ing in middleware, which
  // reads a server-side snapshot and has never seen this response. Hiding is
  // what stops an admin clicking into a dead end; it is not what stops them
  // reaching the data.
  const [modules, setModules] = useState(entCache ? entCache.modules : null);
  useEffect(() => {
    let alive = true;
    if (!entCachePromise) {
      entCachePromise = fetch("/api/entitlements", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const resolved = d?.modules || {};
          entCache = { modules: resolved };
          return resolved;
        })
        .catch(() => {
          // A failed read must not blank the sidebar. Null means "unknown",
          // and unknown renders everything — the 404s remain the real gate.
          entCache = { modules: null };
          return null;
        });
    }
    entCachePromise.then((resolved) => {
      if (alive) setModules(resolved);
    });
    return () => {
      alive = false;
    };
  }, []);

  const baseNavigation = commercialEnabled
    ? [...ADMIN_NAVIGATION.slice(0, -1), COMMERCIAL_NAVIGATION, ADMIN_NAVIGATION[ADMIN_NAVIGATION.length - 1]]
    : ADMIN_NAVIGATION;

  // modules === null means the answer has not arrived (or failed). Render
  // everything rather than flashing a reduced menu that then grows back —
  // a menu that grows looks like a bug and invites the exact curiosity the
  // 404s exist to avoid.
  //
  // Item filtering must NOT be conditional on there being hidden groups. Two
  // modules (Tenancy, RBAC) own no nav group at all — their items live inside
  // base groups — so an early return on an empty hidden-set left Tenant
  // Requests visible to a society that never bought it.
  const hidden = modules ? hiddenNavGroups(modules) : new Set();
  const navigation = modules
    ? baseNavigation
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => !isModulePath(item.path, modules)),
        }))
        .filter((group) => !hidden.has(group.title) && group.items.length > 0)
    : baseNavigation;

  const visibleNavigation =
    allowedPages === null
      ? []
      : allowedPages === "all"
        ? navigation
        : navigation
            .map((group) => ({
              ...group,
              items: group.items.filter(
                (item) => item.pageKey === null || allowedPages.has(item.pageKey),
              ),
            }))
            .filter((group) => group.items.length > 0);

  return { visibleNavigation, loading: allowedPages === null };
}
