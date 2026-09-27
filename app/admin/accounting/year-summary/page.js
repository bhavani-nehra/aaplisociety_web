/**
 * /admin/accounting/year-summary — the year at a glance: bills, interest,
 * payments, spend and what is left. Read-only; every card links to its page.
 */
import { requirePagePermissionAny } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermissionAny([
    "accounting.overview.view",
    "dashboard.stats.view",
    "finance.payment.view",
    "finance.payments.view",
  ]);
  return <PageClient />;
}
