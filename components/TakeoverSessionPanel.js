"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import notify from "@/lib/notify";

async function apiFetch(url, opts = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
  } catch {
    // Actual network failure (offline, DNS, CORS) — no response at all, so
    // there's no server error string to surface. Distinct from a server
    // error response, which always has one.
    const err = new Error("Can't reach the server. Check your connection and try again.");
    err.network = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code || null;
    err.data = data;
    throw err;
  }
  return data;
}

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

const barStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "0.6rem 1.25rem",
  fontSize: 13,
  fontWeight: 600,
  flexWrap: "wrap",
};

// Errors that mean the grant moved out from under the modal (someone else
// ended/denied it, the OTP finally expired, attempts ran out) — the modal
// should refresh its state immediately rather than wait for the next 5s
// poll, so the user isn't left staring at a form for a request that's
// already gone.
const TERMINAL_CODES = new Set([
  "GRANT_NOT_AWAITING_CONSENT",
  "GRANT_NOT_PENDING_OTP",
  "OTP_EXPIRED",
  "OTP_ATTEMPTS_EXHAUSTED",
]);

/**
 * Two independent pieces of UI, one component so both share the same poll:
 *
 * 1. A consent request from a superadmin, working a support ticket, asking
 *    to view/edit this society's dashboard. Shown only in a REAL admin
 *    session (never inside an impersonation session — you can't consent to
 *    your own access).
 * 2. A persistent "support session is live" bar, shown whenever one is
 *    active on this society — in a real admin's other tab/device, AND
 *    inside the impersonated session itself (there it reads straight off
 *    `user.takeover` from /api/auth/me, no polling needed).
 *
 * See docs/superpowers/specs/2026-09-11-society-takeover-design.md.
 */
export default function TakeoverSessionPanel({ user }) {
  const isImpersonated = Boolean(user?.takeover);
  const qc = useQueryClient();
  const [otp, setOtp] = useState("");
  const [duration, setDuration] = useState(30);
  const [step, setStep] = useState("review"); // "review" | "otp"
  const [otpError, setOtpError] = useState(null); // persistent inline error, not just a toast

  const { data, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["takeover-pending"],
    queryFn: () => apiFetch("/api/v1/takeover/pending"),
    // Only the real admin needs to discover a request — the impersonated
    // session already knows everything it needs from `user.takeover`.
    enabled: !isImpersonated,
    // No idle polling. A request is looked for when the panel opens and when
    // the tab is focused again; only while one is actually in progress (OTP
    // step, active grant) does it refresh every 5s so the admin sees the state
    // change. Idle admins cost zero requests.
    refetchInterval: (query) => {
      const d = query?.state?.data;
      return d?.grant || d?.activeGrant ? 5000 : false;
    },
    refetchOnWindowFocus: true,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const pending = data?.grant;
  const pendingTicket = data?.ticket;
  const activeGrant = data?.activeGrant;
  const activeTicket = data?.activeGrantTicket;

  useEffect(() => {
    setStep(pending?.status === "pending_otp" ? "otp" : "review");
    if (pending?.grantedDurationMinutes) setDuration(pending.grantedDurationMinutes);
    setOtpError(null);
    setOtp("");
  }, [pending?.status, pending?._id]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["takeover-pending"] });

  const approve = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/takeover/${pending._id}/approve`, {
        method: "POST",
        body: JSON.stringify({ grantedDurationMinutes: duration }),
      }),
    onSuccess: () => {
      notify.success("Code sent to your email.");
      refresh();
    },
    onError: (err) => {
      notify.error(err.message);
      if (TERMINAL_CODES.has(err.code)) refresh();
    },
  });

  const deny = useMutation({
    mutationFn: () => apiFetch(`/api/v1/takeover/${pending._id}/deny`, { method: "POST" }),
    onSuccess: () => {
      notify.info("Request denied.");
      refresh();
    },
    onError: (err) => {
      notify.error(err.message);
      refresh(); // deny failing because the grant already moved on is fine either way — resync
    },
  });

  const resend = useMutation({
    mutationFn: () => apiFetch(`/api/v1/takeover/${pending._id}/resend-otp`, { method: "POST" }),
    onSuccess: (res) => {
      notify.success(`New code sent.${res.resendsLeft != null ? ` ${res.resendsLeft} resend(s) left.` : ""}`);
      setOtpError(null);
      setOtp("");
    },
    onError: (err) => {
      setOtpError(err.message);
      if (TERMINAL_CODES.has(err.code)) refresh();
    },
  });

  const verify = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/takeover/${pending._id}/verify-otp`, {
        method: "POST",
        body: JSON.stringify({ otp }),
      }),
    onSuccess: () => {
      notify.success("Access granted.");
      setOtp("");
      setOtpError(null);
      refresh();
    },
    onError: (err) => {
      setOtpError(err.message);
      setOtp("");
      if (TERMINAL_CODES.has(err.code)) refresh();
    },
  });

  const endActive = useMutation({
    mutationFn: (grantId) => apiFetch(`/api/v1/takeover/${grantId}/end`, { method: "POST" }),
    onSuccess: (res) => {
      notify.info(res.alreadyEnded ? "Session had already ended." : "Support session ended.");
      if (isImpersonated) {
        window.location.href = "/superadmin/login";
      } else {
        refresh();
      }
    },
    onError: (err) => {
      notify.error(err.message);
      // A 404 here means the grant is simply gone (e.g. purged/invalid id)
      // — nothing left to retry against, so just resync either side's view.
      if (err.status === 404) refresh();
    },
  });

  // ── Impersonated session — read straight off the token claim, no poll ──
  if (isImpersonated) {
    return (
      <div style={{ ...barStyle, background: "var(--warning-bg, #fff7e6)", color: "var(--warning, #b45309)", borderBottom: "1px solid var(--warning, #b45309)" }}>
        <span>
          Support session — {user.takeover.ticketTitle ? `"${user.takeover.ticketTitle}" · ` : ""}
          {user.takeover.mode === "write" ? "view + edit" : "view only"} · expires {fmtTime(user.takeover.expiresAt)}
        </span>
        <button
          onClick={() => endActive.mutate(user.takeover.grantId)}
          disabled={endActive.isPending}
          style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 700, fontSize: 12 }}
        >
          {endActive.isPending ? "Ending…" : "End session"}
        </button>
      </div>
    );
  }

  return (
    <>
      {isError && (
        <div style={{ ...barStyle, background: "var(--danger-bg, #fee)", color: "var(--danger)", borderBottom: "1px solid var(--danger)" }}>
          <span>Couldn't check for support requests: {error.message}</span>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 700, fontSize: 12 }}
          >
            {isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {activeGrant && (
        <div style={{ ...barStyle, background: "var(--info-bg)", color: "var(--info)", borderBottom: "1px solid var(--info)" }}>
          <span>
            Support is currently {activeGrant.scope === "write" ? "viewing + editing" : "viewing"} your dashboard
            {activeTicket ? ` (ticket: ${activeTicket.title})` : ""} · expires {fmtTime(activeGrant.expiresAt)}
          </span>
          <button
            onClick={() => endActive.mutate(activeGrant._id)}
            disabled={endActive.isPending}
            style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 700, fontSize: 12 }}
          >
            {endActive.isPending ? "Ending…" : "End session"}
          </button>
        </div>
      )}

      {pending && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
          <div style={{ background: "var(--bg-surface)", borderRadius: 12, maxWidth: 440, width: "100%", padding: "1.75rem" }}>
            <h2 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 8 }}>Support access request</h2>
            <p style={{ fontSize: 13, color: "var(--fg-3)", marginBottom: "1rem" }}>
              <strong>{pending.requestedByName}</strong> is asking to{" "}
              <strong>{pending.scope === "write" ? "view and edit" : "view"}</strong> your dashboard
              {pendingTicket ? <> for ticket "<strong>{pendingTicket.title}</strong>"</> : null}.
            </p>

            {step === "review" ? (
              <>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  Grant for
                </label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  style={{ width: "100%", padding: "0.5rem", borderRadius: 6, border: "1px solid var(--border)", marginBottom: "1rem" }}
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>60 minutes</option>
                  <option value={120}>2 hours</option>
                </select>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => approve.mutate()}
                    disabled={approve.isPending}
                    style={{ flex: 1, padding: "0.6rem", borderRadius: 6, border: "none", background: "var(--primary)", color: "var(--on-solid)", fontWeight: 700, cursor: "pointer" }}
                  >
                    {approve.isPending ? "Sending code…" : "Approve"}
                  </button>
                  <button
                    onClick={() => deny.mutate()}
                    disabled={deny.isPending}
                    style={{ flex: 1, padding: "0.6rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--fg-3)", cursor: "pointer" }}
                  >
                    {deny.isPending ? "Denying…" : "Deny"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "var(--fg-3)", marginBottom: "0.75rem" }}>
                  Enter the code emailed to you to confirm.
                </p>
                <input
                  value={otp}
                  onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 6)); setOtpError(null); }}
                  placeholder="6-digit code"
                  inputMode="numeric"
                  autoFocus
                  style={{
                    width: "100%", padding: "0.6rem", borderRadius: 6,
                    border: `1px solid ${otpError ? "var(--danger)" : "var(--border)"}`,
                    marginBottom: otpError ? 6 : "1rem", fontSize: 18, letterSpacing: 4, textAlign: "center", boxSizing: "border-box",
                  }}
                />
                {otpError && (
                  <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 0, marginBottom: "0.75rem" }}>{otpError}</p>
                )}
                <div style={{ display: "flex", gap: 10, marginBottom: "0.75rem" }}>
                  <button
                    onClick={() => verify.mutate()}
                    disabled={verify.isPending || otp.length !== 6}
                    style={{ flex: 1, padding: "0.6rem", borderRadius: 6, border: "none", background: "var(--primary)", color: "var(--on-solid)", fontWeight: 700, cursor: "pointer" }}
                  >
                    {verify.isPending ? "Confirming…" : "Confirm"}
                  </button>
                  <button
                    onClick={() => deny.mutate()}
                    disabled={deny.isPending}
                    style={{ flex: 1, padding: "0.6rem", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--fg-3)", cursor: "pointer" }}
                  >
                    {deny.isPending ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
                <button
                  onClick={() => resend.mutate()}
                  disabled={resend.isPending}
                  style={{ width: "100%", padding: "0.4rem", borderRadius: 6, border: "none", background: "transparent", color: "var(--fg-4)", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}
                >
                  {resend.isPending ? "Resending…" : "Didn't get it? Resend code"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
