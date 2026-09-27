"use client";

import { useEffect } from "react";
import { attemptRefresh } from "@/lib/session-refresh";

// Landing spot when the short-lived access cookie has lapsed but the refresh
// cookie is still good. Refresh once, then return to the page that was asked
// for; only a real session end goes to the login screen.
export default function ResumePage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("next") || "/admin/dashboard";
    const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/admin/dashboard";
    let cancelled = false;
    (async () => {
      let res = await attemptRefresh();
      if (!res.ok && res.transient) res = await attemptRefresh();
      if (cancelled) return;
      window.location.replace(res.ok ? next : "/auth/login");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <p>Restoring your session…</p>
    </main>
  );
}
