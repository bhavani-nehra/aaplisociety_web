/**
 * AapliSociety RBAC — Page → granular permission expansion
 * ============================================================================
 * The Roles & Access UI only ever asks "NONE / VIEW / MANAGE" per page (see
 * page-catalog.js). Underneath, authorize()/requirePagePermission() and the
 * 120 already-wired API routes still check the ORIGINAL granular permission
 * ids from permissions-catalog.js — nothing about the enforcement layer
 * changed, only what the admin is asked to configure. This map is the
 * translation between the two: VIEW/MANAGE -> concrete leaf ids, expanded
 * into Role.permissions[] at save time (mirrors what registry.expand() used
 * to do for wildcards, just driven by this table instead of naming
 * convention, since the two don't always line up 1:1).
 * ============================================================================
 */

/** @type {Record<string, { view: string[], manage: string[] }>} */
export const PAGE_ACCESS_MAP = {
  dashboard: {
    view: ["dashboard.admin.view", "dashboard.stats.view"],
    manage: ["dashboard.admin.view", "dashboard.stats.view"],
  },
  societyConfig: {
    view: ["society.config.view"],
    manage: ["society.config.view", "society.config.update"],
  },
  societyContacts: {
    view: ["society.contacts.view"],
    manage: ["society.contacts.view", "society.contacts.update"],
  },
  databaseManager: {
    view: ["society.databaseManager.view", "society.data.view"],
    manage: [
      "society.databaseManager.view",
      "society.data.view",
      "society.data.import",
      "society.data.export",
      "society.data.reset",
      "society.data.delete",
    ],
  },
  viewMembers: {
    view: ["member.viewMembers.view", "member.member.view"],
    manage: [
      "member.viewMembers.view",
      "member.member.view",
      "member.member.create",
      "member.member.update",
      "member.member.delete",
      "member.member.downloadCredentials",
      "member.member.resetPassword",
      "member.member.export",
    ],
  },
  importMembers: {
    view: ["member.importMembers.view"],
    manage: [
      "member.importMembers.view",
      "member.member.import",
      "member.member.downloadCredentials",
    ],
  },
  tenantRequests: {
    view: ["member.tenantRequests.view", "member.tenantRequest.view"],
    manage: [
      "member.tenantRequests.view",
      "member.tenantRequest.view",
      "member.tenantRequest.approve",
      "member.tenantRequest.reject",
      "member.tenantRequest.confirmMoveOut",
    ],
  },
  profileEditRequests: {
    view: ["member.profileEditRequests.view", "member.profileEditRequest.view"],
    manage: [
      "member.profileEditRequests.view",
      "member.profileEditRequest.view",
      "member.profileEditRequest.approve",
      "member.profileEditRequest.reject",
    ],
  },
  billTemplate: {
    view: ["billing.template.view"],
    manage: ["billing.template.view", "billing.template.update", "billing.template.upload"],
  },
  importBills: {
    view: ["billing.importBills.view"],
    manage: ["billing.importBills.view", "billing.bill.import"],
  },
  billingConfig: {
    view: ["billing.config.view", "billing.head.view"],
    manage: [
      "billing.config.view",
      "billing.head.view",
      "billing.config.update",
      "billing.head.create",
      "billing.head.update",
      "billing.head.delete",
    ],
  },
  viewBills: {
    view: ["billing.viewBills.view", "billing.bill.view"],
    manage: [
      "billing.viewBills.view",
      "billing.bill.view",
      "billing.bill.update",
      "billing.bill.delete",
      "billing.bill.markOverdue",
      "billing.bill.download",
      "billing.bill.export",
    ],
  },
  generateBills: {
    view: ["billing.dashboard.view"],
    manage: ["billing.dashboard.view", "billing.bill.generate"],
  },
  generatedBills: {
    view: ["billing.generatedBills.view"],
    manage: ["billing.generatedBills.view"],
  },
  balanceSheet: {
    view: ["billing.balanceSheet.view"],
    manage: [
      "billing.balanceSheet.view",
      "billing.balanceSheet.export",
      "finance.societyEntry.create",
      "finance.societyEntry.delete",
    ],
  },
  billingSimulator: {
    view: ["billing.simulator.view"],
    manage: ["billing.simulator.view", "billing.simulator.run", "billing.bill.generate", "finance.payment.record"],
  },
  fyRunner: {
    view: ["billing.fyRunner.view"],
    manage: ["billing.fyRunner.view", "billing.bill.generate", "finance.payment.record"],
  },
  ledger: {
    view: ["finance.ledger.view"],
    manage: [
      "finance.ledger.view",
      "finance.ledger.transaction",
      "finance.ledger.calculateInterest",
      "finance.ledger.export",
      "finance.societyEntry.view",
      "finance.societyEntry.create",
      "finance.societyEntry.delete",
    ],
  },
  payments: {
    view: ["finance.payments.view", "finance.payment.view"],
    manage: [
      "finance.payments.view",
      "finance.payment.view",
      "finance.payment.record",
      "finance.payment.upload",
      "finance.payment.delete",
      "finance.payment.export",
    ],
  },
  receipts: {
    view: ["finance.receipts.view", "finance.receipt.view", "finance.receipt.download"],
    manage: ["finance.receipts.view", "finance.receipt.view", "finance.receipt.download"],
  },
  latePayment: {
    view: ["finance.latePayment.view"],
    manage: ["finance.latePayment.view", "finance.payment.record"],
  },
  expenditure: {
    view: ["finance.expenditure.view"],
    manage: ["finance.expenditure.view", "finance.expenditure.create", "finance.expenditure.update", "finance.expenditure.delete"],
  },
  paymentsReceived: {
    view: ["finance.paymentsReceived.view"],
    manage: ["finance.paymentsReceived.view"],
  },
  // Read-only by nature: the overview reports state and links elsewhere, it
  // changes nothing. manage === view, so levelFor() correctly never reports
  // it as "manage".
  accountingOverview: {
    view: ["accounting.overview.view"],
    manage: ["accounting.overview.view"],
  },
  accountingSetup: {
    view: ["accounting.setup.view"],
    manage: ["accounting.setup.view", "accounting.setup.run"],
  },
  chartOfAccounts: {
    view: ["accounting.chartOfAccounts.view"],
    manage: [
      "accounting.chartOfAccounts.view",
      "accounting.chartOfAccounts.create",
      "accounting.chartOfAccounts.update",
      "accounting.chartOfAccounts.deactivate",
      "accounting.chartOfAccounts.delete",
    ],
  },
  // Read-only registries: the shared default tier cannot be patched by a
  // society, so manage === view and levelFor() never reports them as manage.
  postingRules: {
    view: ["accounting.postingRules.view"],
    manage: ["accounting.postingRules.view", "accounting.postingRules.override", "accounting.postingRules.seedDefaults"],
  },
  validationRules: {
    view: ["accounting.validationRules.view"],
    manage: ["accounting.validationRules.view", "accounting.validationRules.override", "accounting.validationRules.seedDefaults"],
  },
  schedules: {
    view: ["accounting.schedules.view"],
    manage: ["accounting.schedules.view", "accounting.schedules.override", "accounting.schedules.seedDefaults"],
  },
  // Both read-only: a posted figure is corrected by an offsetting entry, never
  // rewritten, so manage === view and levelFor() never reports them as manage.
  journalEntries: {
    view: ["accounting.journalEntries.view"],
    manage: ["accounting.journalEntries.view"],
  },
  auditTrail: {
    view: ["accounting.auditTrail.view"],
    manage: ["accounting.auditTrail.view"],
  },
  funds: {
    view: ["accounting.funds.view"],
    manage: [
      "accounting.funds.view",
      "accounting.funds.create",
      "accounting.funds.contribute",
      "accounting.funds.withdraw",
      "accounting.funds.transfer",
    ],
  },
  liabilities: {
    view: ["accounting.liabilities.view"],
    manage: ["accounting.liabilities.view", "accounting.liabilities.incur", "accounting.liabilities.pay"],
  },
  bankAccounts: {
    view: ["accounting.bankAccounts.view"],
    manage: [
      "accounting.bankAccounts.view",
      "accounting.bankAccounts.create",
      "accounting.bankAccounts.importStatement",
      "accounting.bankAccounts.match",
    ],
  },
  fiscalConfig: {
    view: ["accounting.fiscalConfig.view"],
    manage: ["accounting.fiscalConfig.view", "accounting.fiscalConfig.update"],
  },
  assets: {
    view: ["accounting.assets.view"],
    manage: [
      "accounting.assets.view",
      "accounting.assets.register",
      "accounting.assets.depreciate",
      "accounting.assets.transfer",
      "accounting.assets.dispose",
    ],
  },
  vouchers: {
    view: ["accounting.vouchers.view"],
    manage: [
      "accounting.vouchers.view",
      "accounting.vouchers.create",
      "accounting.vouchers.submit",
      "accounting.vouchers.approve",
      "accounting.vouchers.reject",
      "accounting.vouchers.cancel",
      "accounting.vouchers.reverse",
    ],
  },
  financialYears: {
    view: ["accounting.financialYears.view"],
    manage: [
      "accounting.financialYears.view",
      "accounting.financialYears.create",
      "accounting.financialYears.close",
      "accounting.financialYears.reopen",
    ],
  },
  openingBalances: {
    view: ["statements.openingBalances.view"],
    manage: ["statements.openingBalances.view", "statements.openingBalances.update"],
  },
  generateStatements: {
    view: ["statements.generateStatements.view"],
    manage: [
      "statements.generateStatements.view",
      "statements.generateStatements.generate",
      "statements.generateStatements.export",
    ],
  },
  incomeExpenditure: {
    view: ["statements.incomeExpenditure.view"],
    manage: ["statements.incomeExpenditure.view", "statements.incomeExpenditure.export"],
  },
  assetsLiabilities: {
    view: ["statements.assetsLiabilities.view"],
    manage: ["statements.assetsLiabilities.view", "statements.assetsLiabilities.export"],
  },
  otherStatements: {
    view: ["statements.otherStatements.view"],
    manage: ["statements.otherStatements.view", "statements.otherStatements.export"],
  },
  // The merged shell page (design doc §12 Phase 5) — reaching it needs only
  // this; each tab still gates itself on its own resource's permission above.
  statementsWorkspace: {
    view: ["statements.workspace.view"],
    manage: ["statements.workspace.view"],
  },
  auditorWorkspace: {
    view: ["auditor.workspace.view"],
    manage: ["auditor.workspace.view", "auditor.workspace.raiseQuery", "auditor.workspace.resolveQuery"],
  },
  notices: {
    view: ["notice.admin.view", "notice.notice.view"],
    manage: ["notice.admin.view", "notice.notice.view", "notice.notice.create", "notice.notice.update", "notice.notice.delete"],
  },
  complaints: {
    view: ["complaint.admin.view", "complaint.complaint.view"],
    manage: [
      "complaint.admin.view",
      "complaint.complaint.view",
      "complaint.complaint.reply",
      "complaint.complaint.approve",
      "complaint.complaint.reject",
      "complaint.complaint.close",
    ],
  },
  visitors: {
    view: ["visitor.admin.view", "visitor.visitor.view"],
    manage: ["visitor.admin.view", "visitor.visitor.view", "visitor.visitor.exit"],
  },
  visitorsActive: {
    view: ["visitor.active.view"],
    manage: ["visitor.active.view", "visitor.visitor.exit"],
  },
  visitorsLog: {
    view: ["visitor.log.view"],
    manage: ["visitor.log.view"],
  },
  visitorsAudit: {
    view: ["visitor.audit.view"],
    manage: ["visitor.audit.view"],
  },
  securityGuards: {
    view: ["security.guards.view", "security.guard.view"],
    manage: [
      "security.guards.view",
      "security.guard.view",
      "security.guard.create",
      "security.guard.update",
      "security.guard.delete",
      "security.guard.resetPin",
    ],
  },
  blacklist: {
    view: ["visitor.blacklist.view"],
    manage: ["visitor.blacklist.view", "visitor.blacklist.add", "visitor.blacklist.remove"],
  },
  commercial: {
    view: ["commercial.admin.view"],
    manage: ["commercial.admin.view", "commercial.admin.create", "commercial.admin.update", "commercial.admin.delete"],
  },
  amenities: {
    view: ["amenities.admin.view"],
    manage: ["amenities.admin.view", "amenities.admin.create", "amenities.admin.update", "amenities.admin.delete"],
  },
  // Admin-only card custody. VIEW can find and identify a card; only MANAGE
  // can revoke one, because a revocation is what stops a resident getting into
  // the pool tomorrow morning.
  amenityCards: {
    view: ["amenities.memberCard.view"],
    manage: ["amenities.memberCard.view", "amenities.memberCard.revoke"],
  },
  // The Clubhouse Manager bundle. VIEW is a read-only desk (dashboard, live
  // occupancy, attendance, slots, capacity as a number). MANAGE adds the
  // operational verbs. Neither level contains amenities.admin.* — an operations
  // role never inherits the configuration page — and there is deliberately no
  // capacity leaf at either level.
  clubhouseOps: {
    view: ["amenities.clubhouse.view"],
    manage: [
      "amenities.clubhouse.view",
      "amenities.clubhouse.checkIn",
      "amenities.clubhouse.operate",
      "amenities.clubhouse.maintenance",
      "amenities.clubhouse.incident",
      "amenities.clubhouse.notice",
    ],
  },
  auditReport: {
    view: ["audit.page.view", "audit.log.read"],
    manage: ["audit.page.view", "audit.log.read", "audit.report.view", "audit.report.create", "audit.log.export"],
  },
  roleManager: {
    view: [
      "rbac.roleManager.view",
      "rbac.role.view",
      "rbac.assignment.view",
      "rbac.user.view",
    ],
    manage: [
      "rbac.roleManager.view",
      "rbac.role.view",
      "rbac.role.create",
      "rbac.role.update",
      "rbac.role.clone",
      "rbac.role.delete",
      "rbac.role.restoreDefaults",
      "rbac.assignment.view",
      "rbac.assignment.assign",
      "rbac.assignment.unassign",
      "rbac.user.view",
      "rbac.user.create",
      "rbac.user.suspend",
      "rbac.user.reactivate",
    ],
  },
  systemTests: {
    view: ["society.systemTests.view"],
    manage: ["society.systemTests.view", "society.systemTests.update"],
  },
};

/** Expand a {pageKey, level} list (level: "view"|"manage") into concrete leaf permission ids. */
export function expandPageAccess(pageAccessList = []) {
  const out = new Set(["rbac.myAccess.view"]); // implicit, every authenticated user
  for (const { pageKey, level } of pageAccessList) {
    const entry = PAGE_ACCESS_MAP[pageKey];
    if (!entry) continue;
    const ids = level === "manage" ? entry.manage : entry.view;
    for (const id of ids || []) out.add(id);
  }
  return [...out];
}

/**
 * Reverse: given a role's stored granular permissions[], infer the
 * {pageKey, level} the wizard should show as pre-selected. A page reads as
 * MANAGE if every manage-id it needs is present, VIEW if just the view-ids
 * are present, otherwise NONE (omitted).
 */
/**
 * For a handful of pages there is no separate write-action permission id in
 * the legacy catalog (Dashboard, Generated Bills, Late Payment, Active
 * Visitors, Visitor Log, Offline Audit, Receipts) — `manage` and `view` are
 * literally the same id list. Checking "manage" membership first (the
 * original bug) meant holding VIEW always also satisfied that identical
 * MANAGE check, so every one of these pages displayed as "Manage" no matter
 * what was actually granted. Only report "manage" when the manage list has
 * at least one id beyond what view already covers — otherwise the safe,
 * accurate label is "view".
 */
function levelFor(held, view, manage) {
  const manageOnly = manage.filter((id) => !view.includes(id));
  if (manageOnly.length && manageOnly.every((id) => held.has(id))) {
    return "manage";
  }
  if (view.length && view.every((id) => held.has(id))) return "view";
  return "none";
}

export function reduceToPageAccess(permissions = []) {
  const held = new Set(permissions);
  const out = [];
  for (const [pageKey, { view, manage }] of Object.entries(PAGE_ACCESS_MAP)) {
    const level = levelFor(held, view, manage);
    if (level !== "none") out.push({ pageKey, level });
  }
  return out;
}

/**
 * Full NONE/VIEW/MANAGE summary for every catalog page, for a resolved
 * permission Set (from resolveEffectivePermissions). Powers /my-access and
 * the sidebar filter — the only two consumers that need "what can I see".
 */
export function summarizePageAccess(permSet) {
  const held = permSet instanceof Set ? permSet : new Set(permSet || []);
  return Object.entries(PAGE_ACCESS_MAP).map(([pageKey, { view, manage }]) => ({
    pageKey,
    level: levelFor(held, view, manage),
  }));
}

export default PAGE_ACCESS_MAP;
