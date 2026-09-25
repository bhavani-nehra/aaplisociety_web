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
 * Client layout (not server) because StepRail reads the current pathname.
 * {children} is also wrapped in its own Suspense: statements/registers/
 * books/auditor's PageClients all call useSearchParams(), and with no
 * boundary above them, client-side navigation into any of the four threw
 * Next's "missing-suspense-with-csr-bailout" error overlay on every nav
 * click — the sidebar link worked, the page just never rendered.
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
      <Suspense fallback={null}>{children}</Suspense>
      <Assistant />
    </>
  );
}
