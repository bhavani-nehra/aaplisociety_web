"use client";
/**
 * Page 3 of the 6-page accounting environment: Assets & Liabilities.
 * Fixed Assets, Funds and Liabilities — configure and manage, all inline as
 * stacked accordion sections on one page, not tabs hiding one behind
 * another. Bank Accounts moved out to its own page (Cash Flow Setup, page
 * 4) per the revamp spec: "Assets & Liabilities" and "Cash Flow Setup" are
 * two separate pages, not the same tab set. Old `?tab=` links to
 * assets/funds/liabilities still land here and open the right section;
 * `?tab=bank-accounts` redirects to the new page instead.
 */
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader, Icon, RevampSkeleton, Accordion } from "@/components/revamp";
import AssetsPage from "../assets/PageClient";
import FundsPage from "../funds/PageClient";
import LiabilitiesPage from "../liabilities/PageClient";
import BankAccountsPage from "../bank-accounts/PageClient";

const SECTIONS = [
  { key: "assets", icon: "package", title: "Fixed Assets", sub: "What the society owns — register, depreciate, transfer, dispose", Body: AssetsPage },
  { key: "funds", icon: "piggy-bank", title: "Funds", sub: "Reserve, Sinking and Repair — the society's own set-aside money", Body: FundsPage },
  { key: "liabilities", icon: "landmark", title: "Liabilities", sub: "Vendor bills, loans, deposits — what the society owes", Body: LiabilitiesPage },
  { key: "bank-accounts", icon: "banknote", title: "Bank accounts & cash flow", sub: "Cash in hand vs bank, and reconciling each account with its statement", Body: BankAccountsPage },
];

function RegistersPageInner() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("tab");
  const [openKey, setOpenKey] = useState(SECTIONS.some((s) => s.key === initial) ? initial : "assets");

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="wallet" size={11} /> Registers</>}
        title="What we own & owe"
        sub="Everything the society owns and owes, configured and managed in one place — feeds the Balance Sheet directly."
      />
      {SECTIONS.map((s) => (
        <Accordion key={s.key} icon={s.icon} title={s.title} sub={s.sub} defaultOpen={s.key === openKey}>
          <s.Body />
        </Accordion>
      ))}
    </div>
  );
}

export default function RegistersPage() {
  return (
    <Suspense fallback={<div style={{ display: "grid", gap: 12 }}><RevampSkeleton h={90} /><RevampSkeleton h={220} /></div>}>
      <RegistersPageInner />
    </Suspense>
  );
}
