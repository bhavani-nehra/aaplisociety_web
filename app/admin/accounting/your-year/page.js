/**
 * /admin/accounting/your-year — the "Your year" guide (accounting
 * consolidation plan §5): first login to a printed Balance Sheet, one step at
 * a time, with a permanent Books check.
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
