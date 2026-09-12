"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import styles from "@/styles/Auth.module.css";
import TurnstileWidget from "@/components/TurnstileWidget";
import { SkylineArcMark } from "@/components/brand/SkylineArc";
export default function LoginPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({ username: "", password: "" });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [onboardedMessage, setOnboardedMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  // Avoids useSearchParams (which would require wrapping this page in a
  // Suspense boundary) for a one-off, low-stakes success banner.
  useEffect(() => {
  setHydrated(true);
  const params = new URLSearchParams(window.location.search);
  if (params.get("onboarded") === "1") {
    setOnboardedMessage("Account set up — sign in with your new username and password.");
  }
  if (params.get("expired") === "1") {
    setOnboardedMessage("Your session took too long — please sign in again.");
  }
  // Where to land after signing in, when something sent the user here with a
  // destination in mind — the "collect your records" email being the case
  // that exposed this. Without it, following that link dropped people on the
  // dashboard with no indication of where they were supposed to go.
  //
  // Held in sessionStorage rather than carried through the URL because a
  // multi-profile login detours via /auth/select-society, and the parameter
  // would be lost on the way.
  const next = params.get("next");
  if (isSafeInternalPath(next)) sessionStorage.setItem("postLoginNext", next);
}, []);
  // Only ever a path on this site. Rejects "//evil.com" and "https://…" —
  // an open redirect on a login page is how phishing gets its credibility.
  function isSafeInternalPath(value) {
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
  }

  function consumeNext() {
    try {
      const stored = sessionStorage.getItem("postLoginNext");
      sessionStorage.removeItem("postLoginNext");
      return isSafeInternalPath(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: "" }));
    setApiError("");
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    const newErrors = {};
    if (!formData.username.trim())
      newErrors.username = "Username or email is required";
    if (!formData.password) newErrors.password = "Password is required";
    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      return;
    }
    if (!turnstileToken) {
      setApiError("Please complete the verification check.");
      return;
    }
    setIsLoading(true);
    setApiError("");
    try {
      const resolveRoleRes = await fetch("/api/auth/resolve-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: formData.username,
        }),
      });
      const resolveRoleData = await resolveRoleRes.json().catch(() => ({}));
      console.log(
        "RESOLVE ROLE RESPONSE:",
        resolveRoleRes.status,
        resolveRoleData,
      );
      if (!resolveRoleRes.ok) {
        throw new Error(
          resolveRoleData.error ||
            `Unable to resolve role (${resolveRoleRes.status})`,
        );
      }
      const loginEndpoint = resolveRoleData.isSecurity
        ? "/api/security/auth/login"
        : "/api/auth/login";
      const res = await fetch(loginEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
          turnstileToken,
        }),
      });
      const data = await res.json().catch(() => ({}));
      console.log("LOGIN RESPONSE:", res.status, data);
      if (!res.ok) {
        throw new Error(data.error || `Login failed (${res.status})`);
      }
      if (
        resolveRoleData.isSecurity ||
        data.user?.role === "Security"
      ) {
        router.replace("/security/dashboard");
        return;
      }
      if (data.requiresProfileSelect) {
        sessionStorage.setItem("pendingUserId", data.userId || "");
        sessionStorage.setItem(
          "profileSelectToken",
          data.profileSelectToken || "",
        );
        sessionStorage.setItem(
          "pendingProfiles",
          JSON.stringify(data.profiles || []),
        );
        sessionStorage.setItem("pendingName", data.name || "");
        router.replace("/auth/select-society");
        return;
      }
      const role = data.user?.role;
      const next = consumeNext();
      if (next) {
        router.replace(next);
        return;
      }
      if (role === "SuperAdmin") {
        router.replace("/superadmin/dashboard");
      } else if (
        role === "Secretary" ||
        role === "Admin" ||
        role === "Accountant"
      ) {
        // First Admin/Secretary login for a Society that hasn't accepted
        // the current Terms/Privacy/Refund bundle yet — see
        // app/api/auth/login/route.js and legal/*.md.
        router.replace(data.user?.legalAcceptanceRequired ? "/legal/accept" : "/admin/dashboard");
      } else if (role === "Security") {
        router.replace("/security/dashboard");
      } else if (data.user?.kind === "Staff") {
        // RBAC-only staff role (e.g. Auditor, Treasurer) — role is a display
        // name, not one of the legacy literal strings above, and this
        // account may not hold Dashboard access at all. /my-access always
        // works regardless of which pages this specific role was granted.
        router.replace("/my-access");
      } else {
        router.replace("/member/dashboard");
      }
    } catch (err) {
      console.error("LOGIN ERROR:", err);
      setApiError(err.message || "Something went wrong");
      // Turnstile tokens are single-use — Cloudflare already burned this one
      // on the verify call the failed attempt made, so force a fresh widget
      // (and re-render its DOM node) rather than resubmitting a dead token.
      setTurnstileToken("");
      setTurnstileResetKey((k) => k + 1);
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <div className={styles.authContainer}>
      <div className={styles.authCard}>
        <div className={styles.authHeader}>
          <div className={styles.authLogoMark}>
            <SkylineArcMark color="#ffffff" size={30} />
          </div>
          <h1 className={styles.authTitle}>Welcome Back</h1>
          <p className={styles.authSubtitle}>Sign in to AapliSociety</p>
        </div>
<form onSubmit={handleSubmit} method="post" autoComplete="off">
            {onboardedMessage && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "var(--success-bg)",
                color: "var(--success-fg)",
                borderRadius: "var(--radius-md)",
                marginBottom: "var(--spacing-lg)",
                fontSize: "var(--font-sm)",
                fontWeight: "500",
              }}
            >
              {onboardedMessage}
            </div>
          )}
          {apiError && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "var(--danger-bg)",
                color: "var(--danger-fg)",
                borderRadius: "var(--radius-md)",
                marginBottom: "var(--spacing-lg)",
                fontSize: "var(--font-sm)",
                fontWeight: "500",
              }}
            >
              {apiError}
            </div>
          )}
          <div className={styles.formGroup}>
            <label className="label" htmlFor="username">
              Username / Email
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="off"
              placeholder="e.g. gh_tanvib_1001_27"
              className={`input ${errors.username ? "input-error" : ""}`}
              value={formData.username}
              onChange={handleChange}
              disabled={isLoading}
            />
            {errors.username && <p className="error-text">{errors.username}</p>}
          </div>
          <div className={styles.formGroup}>
            <label className="label" htmlFor="password">
              Password
            </label>
            <div className={styles.passwordWrapper}>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                className={`input ${errors.password ? "input-error" : ""}`}
                value={formData.password}
                onChange={handleChange}
                disabled={isLoading}
              />
              <button
                type="button"
                className={styles.passwordToggle}
                onClick={() => setShowPassword((prev) => !prev)}
                disabled={isLoading}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {errors.password && <p className="error-text">{errors.password}</p>}
          </div>
          <div className={styles.formGroup}>
            <TurnstileWidget
              key={turnstileResetKey}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken("")}
              onError={() => setTurnstileToken("")}
            />
          </div>
          <div className={styles.formActions}>
           <button
  type="submit"
  className="btn btn-primary"
  disabled={isLoading || !hydrated || !turnstileToken}
  style={{ width: "100%", justifyContent: "center" }}
>
              {isLoading ? (
                <>
                  <span className="loading-spinner loading-spinner-sm loading-spinner-white" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
