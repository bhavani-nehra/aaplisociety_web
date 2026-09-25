"use client";
import { useEffect, useState } from "react";
import { SESSION_ENDED_EVENT } from "@/lib/session-refresh";

// Plan 05 Part A, step 5. Modal and non-dismissable on purpose — the app
// behind it is dead, and a dismissable dialog claiming that would be a lie.
// Setting window.__aapliSessionDialogMounted (below) is what stops
// lib/session-refresh.js's fallbackRedirect() from also firing a hard
// navigation once this dialog exists to show the reason first instead.
const REASON_COPY = {
  SESSION_IDLE_EXPIRED: "Signed out after 2 hours of inactivity.",
  SESSION_MAX_AGE: "Daily sign-in required.",
  SESSION_REVOKED: "Your access changed. Please sign in again.",
  ACCOUNT_DISABLED: "This login has been switched off. Please contact your society office.",
  LOGIN_PAUSED: "This login is temporarily paused. Please contact your society office.",
};
const DEFAULT_MESSAGE = "Your session has ended. Please sign in again.";

// Only ever a same-site path — an open redirect on the way back INTO a
// session dialog is exactly the kind of thing a login page's own `next`
// handling already guards against (app/auth/login/page.js's
// isSafeInternalPath), but this constructs that URL, so it holds the same
// rule rather than trusting window.location blindly.
function safeReturnPath() {
  const path = window.location.pathname + window.location.search;
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export default function SessionExpiredDialog() {
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    window.__aapliSessionDialogMounted = true;
    function onEnded(event) {
      setDetail(event.detail || {});
    }
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, []);

  if (!detail) return null;

  const message = detail.userMessage || REASON_COPY[detail.code] || detail.message || DEFAULT_MESSAGE;

  function handleSignIn() {
    const next = safeReturnPath();
    window.location.href = `/auth/login?next=${encodeURIComponent(next)}&expired=1`;
  }

  // Minimalist register (final_audit_fix_plan/06-skills-and-execution-tooling.md
  // §13): "infrequent, high-consequence screens — maximum legibility, zero
  // decoration." Flat --bg-surface, no gradient, no animation (the
  // component renders with no entrance transition at all — "never animate a
  // failure the user did not cause", docs/motion-system.md). The prior
  // version used --warning (the solid/button color, 2.15:1 on white — fails
  // AA) as a TEXT color; --warning-fg is the token this triad ships
  // specifically for text-on-light-background use (7.09:1), same pairing
  // .badge-warning already uses correctly.
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      aria-describedby="session-expired-message"
      style={{
        position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.6)", backdropFilter: "blur(2px)",
        zIndex: 30000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "var(--spacing-lg)",
      }}
    >
      <div
        style={{
          background: "var(--bg-surface)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--spacing-xl)",
          width: 420, maxWidth: "100%", color: "var(--fg-1)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
      >
        <h3
          id="session-expired-title"
          style={{ margin: "0 0 var(--spacing-sm)", fontSize: "var(--font-lg)", color: "var(--warning-fg)", fontWeight: 700 }}
        >
          Session expired
        </h3>
        <p
          id="session-expired-message"
          style={{ margin: "0 0 var(--spacing-lg)", fontSize: "var(--font-sm)", color: "var(--fg-3)", lineHeight: 1.6 }}
        >
          {message}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            autoFocus
            onClick={handleSignIn}
            className="btn btn-primary"
          >
            Sign in again
          </button>
        </div>
      </div>
    </div>
  );
}
