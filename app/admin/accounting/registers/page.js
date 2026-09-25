/**
 * Page 3 of the 6-page accounting environment: Assets & Liabilities.
 * Fixed Assets + Funds + Liabilities, stacked accordion sections on one
 * page. Bank Accounts moved to its own page (Cash Flow Setup) — see
 * app/admin/accounting/cash-flow/. Guard list no longer includes
 * accounting.bankAccounts.view: a role with only that permission and none
 * of the other three has nothing to see here now.
 */
import { requirePagePermissionAny } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermissionAny([
    "accounting.assets.view",
    "accounting.funds.view",
    "accounting.liabilities.view",
    "accounting.bankAccounts.view",
  ]);
  return <PageClient />;
}
