/**
 * /admin/accounting/setup-books — "Set up your books" (accounting
 * consolidation plan §4.3). One page, sections in the order a person does
 * them; each section mounts the existing screen only when opened.
 */
import { requirePagePermissionAny } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermissionAny([
    "accounting.overview.view",
    "accounting.setup.view",
    "accounting.financialYears.view",
    "accounting.chartOfAccounts.view",
    "statements.openingBalances.view",
    "accounting.schedules.view",
  ]);
  return <PageClient />;
}
