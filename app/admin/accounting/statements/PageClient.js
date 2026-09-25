"use client";
/**
 * Statements workspace — four tabs, one route. Design doc §12 Phase 4/5's
 * route shrink: this used to be four separate pages
 * (/admin/generate-statements, /income-expenditure, /assets-liabilities,
 * /other-statements). Each tab is that same PageClient mounted unchanged —
 * it still fetches its own data against its own permission-gated API, so a
 * role with only one of the four underlying view permissions still reaches
 * this page and simply finds only that tab loading real data.
 *
 * Exported as `StatementsWorkspace` (not just the page's default) so the
 * Auditor workspace's "Statements" tab (design doc §8) can embed the exact
 * same four tabs read-only, rather than re-implementing them.
 *
 * Old routes now redirect here with `?tab=` set (see each folder's page.js).
 */
import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader, Tabs, Icon, RevampSkeleton } from "@/components/revamp";
import GenerateStatementsScreen from "./FullPackScreen";
import IncomeExpenditureScreen from "./IncomeExpenditureScreen";
import AssetsLiabilitiesScreen from "./BalanceSheetScreen";
import OtherStatementsScreen from "./TrialBalanceScreen";
import YearEndClose from "./YearEndClose";
import YearEndSheets from "@/components/accounting/YearEndSheets";

// Labels were wrong before this fix: "generate" is the flagship live-build
// page — Income, Expenditure, Assets, Liabilities AND Validation typed out
// together in one combined pack — not a Balance Sheet on its own. The real,
// standalone, statutory-format Balance Sheet (Liabilities | Assets T-format)
// is the "assets-liabilities" tab. Both were labeled backwards, which sent
// anyone clicking "Balance Sheet" to the wrong screen.
const TABS = [
  { key: "print", label: "Print & Save", icon: "printer" },
  { key: "generate", label: "Full Statement Pack", icon: "file-text" },
  { key: "income-expenditure", label: "Income & Expenditure", icon: "trending-up" },
  { key: "assets-liabilities", label: "Balance Sheet", icon: "scale" },
  { key: "trial-balance", label: "Trial Balance & Checks", icon: "check-square" },
  { key: "year-end", label: "Year-End Close", icon: "flag" },
];

export function StatementsWorkspace({ initialTab, showHeader = true, basePath = "/admin/accounting/statements" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get("tab");
  const [tab, setTab] = useState(TABS.some((t) => t.key === (initialTab || fromUrl)) ? (initialTab || fromUrl) : "print");

  const changeTab = useCallback((key) => {
    setTab(key);
    router.replace(`${basePath}?tab=${key}`, { scroll: false });
  }, [router, basePath]);

  return (
    <div style={{ maxWidth: 1280, margin: showHeader ? "0 auto" : 0 }}>
      {showHeader ? (
        <PageHeader
          eyebrow={<><Icon name="file-text" size={11} /> Year-end sheets</>}
          title="Balance Sheet & I&E"
          sub="Both sheets as they print, the full statement pack, the Books check and the year-end close."
        />
      ) : null}
      <Tabs value={tab} onChange={changeTab} tabs={TABS} />
      {tab === "print" ? <YearEndSheets /> : null}
      {tab === "generate" ? <GenerateStatementsScreen /> : null}
      {tab === "income-expenditure" ? <IncomeExpenditureScreen /> : null}
      {tab === "assets-liabilities" ? <AssetsLiabilitiesScreen /> : null}
      {tab === "trial-balance" ? <OtherStatementsScreen /> : null}
      {tab === "year-end" ? <YearEndClose /> : null}
    </div>
  );
}

export default function StatementsPage() {
  return (
    <Suspense fallback={<div style={{ display: "grid", gap: 12 }}><RevampSkeleton h={90} /><RevampSkeleton h={220} /></div>}>
      <StatementsWorkspace />
    </Suspense>
  );
}
