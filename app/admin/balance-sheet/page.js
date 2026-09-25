/**
 * /admin/balance-sheet — removed (accounting consolidation plan §4.5, decision 1).
 * The year-end sheets live on Statements now; old links land on "Print & Save".
 */
import { redirect } from "next/navigation";

export default function BalanceSheetRedirect() {
  redirect("/admin/accounting/statements?tab=print");
}
