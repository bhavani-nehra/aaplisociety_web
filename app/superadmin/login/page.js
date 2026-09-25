"use client";
import { playScatterIntro } from "@/components/brand/ScatterIntro";
import { useState } from "react";
import { useRouter } from "next/navigation";
import TurnstileWidget from "@/components/TurnstileWidget";
export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const router = useRouter();
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!turnstileToken) {
      setError("Please complete the verification check.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        credentials: "include", // 🔥 IMPORTANT (for cookies)
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, adminKey, turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        setLoading(false);
        // Token was single-use and already burned by the failed verify call.
        setTurnstileToken("");
        setTurnstileResetKey((k) => k + 1);
        return;
      }
      // 🔥 FIXED: redirect based on role
      if (data.user?.role === "SuperAdmin") {
        playScatterIntro();
        router.push("/superadmin/dashboard");
      } else {
        router.push("/superadmin/login");
      }
    } catch (err) {
      setError("Network error");
      setLoading(false);
    }
  };
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: "transparent",
      }}
    >
      <div
        style={{
          background: "var(--bg-surface)",
          padding: "40px",
          borderRadius: "8px",
          maxWidth: "400px",
          width: "100%",
        }}
      >
        <h1
          style={{ color: "var(--fg-1)", marginBottom: "30px", textAlign: "center" }}
        >
          🔐 Admin Access
        </h1>
        {error && (
          <div
            style={{
              background: "#ff000020",
              color: "var(--danger)",
              padding: "12px",
              borderRadius: "4px",
              marginBottom: "20px",
            }}
          >
            {error}
          </div>
        )}
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{ color: "var(--fg-4)", display: "block", marginBottom: "8px" }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "12px",
                background: "var(--bg-muted)",
                border: "1px solid var(--border-strong)",
                borderRadius: "4px",
                color: "var(--fg-1)",
              }}
            />
          </div>
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{ color: "var(--fg-4)", display: "block", marginBottom: "8px" }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "12px",
                background: "var(--bg-muted)",
                border: "1px solid var(--border-strong)",
                borderRadius: "4px",
                color: "var(--fg-1)",
              }}
            />
          </div>
          <div style={{ marginBottom: "20px" }}>
            <label
              style={{ color: "var(--fg-4)", display: "block", marginBottom: "8px" }}
            >
              Admin Key
            </label>
            <input
              type="password"
              value={adminKey}
              onChange={(e) => setAdminKey(e.target.value)}
              required
              placeholder="Enter admin secret key"
              style={{
                width: "100%",
                padding: "12px",
                background: "var(--bg-muted)",
                border: "1px solid var(--border-strong)",
                borderRadius: "4px",
                color: "var(--fg-1)",
              }}
            />
          </div>
          <div style={{ marginBottom: "20px" }}>
            <TurnstileWidget
              key={turnstileResetKey}
              onVerify={setTurnstileToken}
              onExpire={() => setTurnstileToken("")}
              onError={() => setTurnstileToken("")}
            />
          </div>
          <button
            type="submit"
            disabled={loading || !turnstileToken}
            style={{
              width: "100%",
              padding: "14px",
              background: loading ? "var(--border-strong)" : "var(--success)",
              color: "var(--on-solid)",
              border: "none",
              borderRadius: "4px",
              fontSize: "16px",
              fontWeight: "bold",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        </form>
      </div>
    </div>
  );
}
