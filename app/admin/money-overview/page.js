/**
 * /admin/money-overview — the Money dashboard: this month's collection,
 * dues, advance, expenses, bank and cash, all from live data.
 */
import { requirePagePermissionAny } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermissionAny([
    "dashboard.stats.view",
    "finance.payments.view",
    "finance.payment.view",
    "finance.receipts.view",
    "finance.latePayment.view",
    "finance.ledger.view",
    "finance.expenditure.view",
  ]);
  return <PageClient />;
}
