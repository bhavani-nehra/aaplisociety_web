"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

async function adminFetch(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
  } catch {
    const err = new Error("Can't reach the server. Retrying…");
    err.network = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const STATUS_COPY = {
  awaiting_consent: "Waiting for the society admin to respond…",
  pending_otp: "The society admin is confirming with a code sent to their email…",
  denied: "The society admin denied this request.",
  expired: "This request expired before it was confirmed.",
  revoked: "This session has ended.",
};

const MAX_CONSECUTIVE_NETWORK_FAILURES = 5;

// Opened in a new tab from the superadmin ticket page's "Open dashboard"
// link. Polls the claim endpoint until the grant is active — the first
// successful poll after activation sets the impersonation token as this
// tab's own `token` cookie (server-side, via Set-Cookie on the claim
// response) and this page then hands off to the real dashboard. See
// docs/superpowers/specs/2026-09-11-society-takeover-design.md.
export default function TakeoverClaimPage() {
  const { id } = useParams();
  const [status, setStatus] = useState("polling");
  const [fatalError, setFatalError] = useState(null); // stops polling for good
  const [transientNotice, setTransientNotice] = useState(null); // shown but keeps retrying
  const failuresRef = useRef(0);
  const aliveRef = useRef(true);
  const timerRef = useRef(null);

  const poll = useCallback(async () => {
    try {
      const { grant } = await adminFetch(`/api/superadmin/takeover/${id}/claim`, { method: "POST" });
      if (!aliveRef.current) return;
      failuresRef.current = 0;
      setTransientNotice(null);

      if (grant.status === "active") {
        window.location.href = "/admin/dashboard";
        return;
      }
      setStatus(grant.status);
      if (["denied", "expired", "revoked"].includes(grant.status)) return; // terminal, stop polling
    } catch (err) {
      if (!aliveRef.current) return;

      if (err.status === 404) {
        setFatalError("This request no longer exists.");
        return;
      }
      if (err.status === 401 || err.status === 403) {
        setFatalError("Your superadmin session isn't valid here. Log in again in the other tab, then reopen this one.");
        return;
      }

      // Network hiccup or a transient 5xx — keep retrying, but stop
      // eventually rather than poll forever against a server that's
      // actually down.
      failuresRef.current += 1;
      if (failuresRef.current >= MAX_CONSECUTIVE_NETWORK_FAILURES) {
        setFatalError("Lost connection to the server. Check your connection and reload this page.");
        return;
      }
      setTransientNotice(err.message);
    }
    timerRef.current = setTimeout(poll, 2000);
  }, [id]);

  useEffect(() => {
    aliveRef.current = true;
    poll();
    return () => {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
    };
  }, [poll]);

  const retry = () => {
    setFatalError(null);
    failuresRef.current = 0;
    poll();
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div style={{ textAlign: "center", maxWidth: 380 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
        {fatalError ? (
          <>
            <p style={{ color: "var(--danger)", marginBottom: 12 }}>{fatalError}</p>
            <button
              onClick={retry}
              style={{ padding: "0.5rem 1.25rem", borderRadius: 6, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 700, cursor: "pointer" }}
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <p style={{ color: "var(--fg-3)" }}>{STATUS_COPY[status] || "Checking…"}</p>
            {transientNotice && (
              <p style={{ color: "var(--warning, #b45309)", fontSize: 12, marginTop: 8 }}>{transientNotice}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
