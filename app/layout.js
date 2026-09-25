//app/layout.js
import { headers } from "next/headers";
import QueryProvider from "./providers/QueryProvider";
import "../styles/globals.css";
import { Inter } from "next/font/google";
import ToastProvider from "@/components/ui/ToastProvider";
import ConfirmDialogHost from "@/components/ui/ConfirmDialogHost";
import ActionLoader from "@/components/brand/ActionLoader";
import ScatterIntro from "@/components/brand/ScatterIntro";
import SessionGuard from "@/components/session/SessionGuard";
const inter = Inter({ subsets: ["latin"] });
export const metadata = {
  title: "AapliSociety",
  description: "Enterprise Society Management System",
};
// Runs before React hydrates, so the correct theme is on <html> before the
// very first paint — without this, the page would render light for a frame
// then flip to dark once lib/theme/store.js reads localStorage on mount.
// Wrapped in try/catch: private-mode/blocked localStorage falls back to
// light, matching lib/theme/store.js's own fallback.
const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem("app-theme");if(t==="dark")document.documentElement.setAttribute("data-theme","dark");}catch(e){}})();`;

export default async function RootLayout({ children }) {
  // Needed so this inline bootstrap script satisfies the app's own
  // nonce-based CSP (middleware.js) — an un-nonced inline <script> would
  // otherwise be blocked outright. middleware.js forwards its per-request
  // nonce on the "x-nonce" request header for exactly this case.
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script suppressHydrationWarning nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={inter.className}>
        {/* Global Aurora background — one mount for every route (was
            admin-dashboard-only; see styles/globals.css for the 4-layer
            stack and public/bg.svg + public/bg-dark.svg for the art).
            Static/server-rendered: the light↔dark swap is pure CSS via
            [data-theme], no client JS needed here. */}
        <div aria-hidden className="appBgLayer" />
        <div aria-hidden className="appBgDarkDepth" />
        <div aria-hidden className="appBgDarkRightFade" />
        <div aria-hidden className="appBgScrim" />
        {/* Patches window.fetch so every /api/* call in the app — including
            the 85 files that call fetch() directly rather than going through
            lib/api-client.js — gets one silent refresh-and-retry on a 401
            instead of surfacing it as a dead error mid-task. Renders nothing;
            mounted before children so the patch is in place first. */}
        <SessionGuard />
        <QueryProvider>{children}</QueryProvider>
        <ScatterIntro />
        <ActionLoader />
        <ToastProvider />
        <ConfirmDialogHost />
      </body>
    </html>
  );
}
