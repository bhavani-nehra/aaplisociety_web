/**
 * /admin/money — Payments, Receipts, Late payments, Passbook and Expenses in
 * one page (accounting consolidation plan §4.2). Any one of the underlying
 * view permissions gets you in; each tab still hits its own gated API.
 */
import { requirePagePermissionAny } from "@/lib/rbac/page-guard";
import PageClient from "./PageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePagePermissionAny([
    "finance.payments.view",
    "finance.receipts.view",
    "finance.latePayment.view",
    "finance.ledger.view",
    "finance.expenditure.view",
  ]);
  return <PageClient />;
}
