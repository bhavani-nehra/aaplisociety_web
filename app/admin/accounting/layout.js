"use client";
/**
 * Layout for every /admin/accounting/* page — mounts StepRail (the 6-page
 * setup guide) once, above whatever page renders below, instead of each
 * page repeating `<StepRail currentKey="...">` by hand.
 *
 * QuickBar (search + "New / Quick actions") used to mount here too, stacked
 * next to StepRail — but the admin shell's own CommandBar
 * (components/global/CommandBar.jsx, mounted for every /admin/* page via
 * components/DashboardLayout.js) already renders that same search-box +
 * quick-actions-button pair, and both bound the same "/" and "n" keydown
 * shortcuts globally — so every accounting page carried two visibly
 * overlapping search/quick-action bars, one of which silently ate the
 * other's keystrokes depending on mount order. Removed; CommandBar is the
 * one search/quick-actions bar for the whole admin area, accounting
 * included. (QuickBar's accounting-only reach — account-head search, the
 * validation-inbox bell, "continue unfinished wizard" — has no CommandBar
 * equivalent yet; that gap is real, but folding it into CommandBar's
 * extraPages/recordSources/inboxFetcher is a separate follow-up, not a
 * revert of this fix.)
 *
 * Client layout (not server) because StepRail reads the current pathname;
 * Suspense here is defensive — none of the pages below currently require it
 * for this layout specifically, but a shared layout is exactly the place a
 * future page using useSearchParams would need one anyway.
 */
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import StepRail, { STEP_RAIL_PAGES } from "@/components/accounting/StepRail";
import Assistant from "@/components/accounting/Assistant";

/** Longest-href-first so "/admin/accounting" (the Configuration page itself)
 *  doesn't shadow every other page it's a prefix of. */
const RAIL_PAGES_BY_HREF_LENGTH = [...STEP_RAIL_PAGES].sort((a, b) => b.href.length - a.href.length);

function currentRailKey(pathname) {
  const hit = RAIL_PAGES_BY_HREF_LENGTH.find((p) => pathname === p.href || pathname.startsWith(p.href + "/"));
  return hit?.key ?? null;
}

export default function AccountingLayout({ children }) {
  const pathname = usePathname();
  // No outer padding here — DashboardLayout (components/DashboardLayout, via
  // app/admin/layout.js) already provides the page gutter; adding another
  // would double it.
  return (
    <>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
        <Suspense fallback={null}>
          <StepRail currentKey={currentRailKey(pathname)} />
        </Suspense>
      </div>
      {children}
      <Assistant />
    </>
  );
}
