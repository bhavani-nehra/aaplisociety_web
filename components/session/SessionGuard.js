"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { installApiFetchInterceptor } from "@/lib/api-fetch-interceptor";
import { installButtonPending } from "@/lib/button-pending";
import { attemptRefresh } from "@/lib/session-refresh";
import { installIdleTracking, getLastInteractionAt, resetIdleClock, IDLE_WINDOW_MS } from "@/lib/idle-tracker";
import SessionExpiredDialog from "./SessionExpiredDialog";

// Plan 05 Part A, step 6 — warn 2 minutes before the idle window lapses.
// Checked on an interval rather than a single setTimeout because the window
// keeps moving forward on real activity (see lib/idle-tracker.js); a fixed
// timer set once at mount would fire even after the user came back.
const WARNING_LEAD_MS = 2 * 60 * 1000;
const WARNING_AT_MS = IDLE_WINDOW_MS - WARNING_LEAD_MS;
const CHECK_INTERVAL_MS = 30 * 1000;

/**
 * Mounts the global /api/* fetch interceptor exactly once, as early as the
 * client runtime allows. Also owns Plan 05 §A5 (the session-expired dialog)
 * and §A6 (the "you'll be signed out soon" warning toast), so everything
 * about session lifetime lives in one component rather than scattered.
 *
 * Renders nothing itself besides <SessionExpiredDialog/> — the interceptor
 * has to patch window.fetch before any page component starts fetching, and a
 * root-layout client component is the earliest place in the App Router that
 * can happen for every route at once.
 *
 * The interceptor install is idempotent, so React strict mode's double
 * effect invocation in development cannot double-patch — which would
 * matter, because a double-patched fetch refreshes twice and the
 * rotate-on-use refresh token would invalidate its own replacement.
 */
export default function SessionGuard() {
  const warnedForRef = useRef(null);

  useEffect(() => {
    installApiFetchInterceptor();
    installButtonPending();
    installIdleTracking();

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return; // nothing to warn if nobody's looking
      const lastAt = getLastInteractionAt();
      const idleMs = Date.now() - lastAt;
      // Guard against warning again for the SAME stale interaction moment —
      // `warnedForRef` only resets once a genuinely NEW interaction happens.
      if (idleMs >= WARNING_AT_MS && idleMs < IDLE_WINDOW_MS && warnedForRef.current !== lastAt) {
        warnedForRef.current = lastAt;
        toast.warning("You'll be signed out in 2 minutes due to inactivity.", {
          duration: WARNING_LEAD_MS,
          action: {
            label: "Stay signed in",
            onClick: () => {
              resetIdleClock();
              attemptRefresh();
            },
          },
        });
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return <SessionExpiredDialog />;
}
