"use client";
/**
 * Money hub — everything about money coming in and going out, as tabs.
 * Only the active tab is mounted, so each tab fetches on first open and
 * nothing else loads. The tab bodies are the existing pages, unchanged.
 */
import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Tabs, Icon, RevampSkeleton } from "@/components/revamp";
import MoneyOverview from "@/components/money/MoneyOverviewBoard";
import PaymentsPage from "../payments/PageClient";
import ReceiptsPage from "../receipts/PageClient";
import LatePaymentsPage from "../late-payment/PageClient";
import PassbookPage from "../ledger/PageClient";
import ExpensesPage from "../expenditure/PageClient";

const TABS = [
  { key: "overview", label: "Overview", icon: "layout-dashboard", Body: MoneyOverview },
  { key: "payments", label: "Payments", icon: "credit-card", Body: PaymentsPage },
  { key: "receipts", label: "Receipts", icon: "file-text", Body: ReceiptsPage },
  { key: "late", label: "Late payments", icon: "alert-triangle", Body: LatePaymentsPage },
  { key: "passbook", label: "Passbook", icon: "book-open", Body: PassbookPage },
  { key: "expenses", label: "Expenses", icon: "wallet", Body: ExpensesPage },
];

function MoneyPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initial = searchParams.get("tab");
  const [tab, setTab] = useState(TABS.some((t) => t.key === initial) ? initial : "overview");

  const changeTab = useCallback((key) => {
    setTab(key);
    router.replace(`/admin/money?tab=${key}`, { scroll: false });
  }, [router]);

  const Active = TABS.find((t) => t.key === tab).Body;
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="wallet" size={11} /> Money</>}
        title="Money"
        sub="Payments received, receipts, who is late, each member's passbook and the society's expenses — one place."
      />
      <Tabs value={tab} onChange={changeTab} tabs={TABS.map(({ key, label, icon }) => ({ key, label, icon }))} />
      <Active onOpenTab={changeTab} />
    </div>
  );
}

export default function MoneyPage() {
  return (
    <Suspense fallback={<div style={{ display: "grid", gap: 12 }}><RevampSkeleton h={90} /><RevampSkeleton h={220} /></div>}>
      <MoneyPageInner />
    </Suspense>
  );
}
