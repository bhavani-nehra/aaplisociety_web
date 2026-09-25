// FILE: app/admin/late-payments/page.js
// CHANGE 15 — NEW PAGE
// Shows all members past billPayFinalDate.
// Admin can record payments manually (admin payments/record has NO date guard).
"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import LateBand from "@/components/money/LateBand";
const MONTH_NAMES = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
function fmt(n) {
  return parseFloat(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
export default function LatePaymentsPage() {
  const qc = useQueryClient();
  // Payment modal state
  const [modal, setModal] = useState(null); // { member, bill }
  const [payAmt, setPayAmt] = useState("");
  const [payMode, setPayMode] = useState("Cash");
  const [payNote, setPayNote] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  // Fetch all members with unpaid bills past billPayFinalDate
  const { data, isLoading } = useQuery({
    queryKey: ["late-payments-list"],
    queryFn: () => apiClient.get("/api/payments/late-list"),
    refetchOnWindowFocus: false,
  });
  const lateMembers = data?.members || [];
  // Record payment mutation (uses admin payments/record — no date block)
  const payMutation = useMutation({
    mutationFn: (payload) => apiClient.post("/api/payments/record", payload),
    onSuccess: (res) => {
      setSuccess(
        `Payment of ₹${payAmt} recorded. Breakdown: Interest ₹${res?.transaction?.breakdown?.interestCleared || 0} + Principal ₹${res?.transaction?.breakdown?.principalCleared || 0}`,
      );
      setModal(null);
      setPayAmt("");
      setPayNote("");
      qc.invalidateQueries({ queryKey: ["late-payments-list"] });
      qc.invalidateQueries({ queryKey: ["money-insights"] });
    },
    onError: (e) => {
      setError(e?.message || "Payment failed");
    },
  });
  function openModal(member) {
    setError(null);
    setSuccess(null);
    setModal(member);
    setPayAmt(String(member.totalOutstanding || ""));
    setPayMode("Cash");
    setPayNote("");
    setChequeNo("");
    setBankName("");
  }
  function handlePay() {
    if (!payAmt || isNaN(parseFloat(payAmt)) || parseFloat(payAmt) <= 0) {
      setError("Enter valid amount");
      return;
    }
    payMutation.mutate({
      memberId: modal.memberId,
      amount: parseFloat(payAmt),
      paymentMode: payMode,
      notes: payNote || `Admin late payment for ${modal.oldestPeriod}`,
      chequeNo: payMode === "Cheque" ? chequeNo : undefined,
      bankName: payMode === "Cheque" ? bankName : undefined,
    });
  }
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 0 }}>
      <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, color: "var(--fg-1)", letterSpacing: "-0.01em" }}>
        Late Payments
      </h1>
      <p style={{ color: "var(--fg-4)", fontSize: 13, marginBottom: "1.25rem" }}>
        Members whose oldest unpaid bill is past the payment deadline. Payment
        window is closed for them — record cash/cheque payments manually here.
        Interest-satisfy-first allocation applied automatically.
      </p>
      <LateBand onRecord={(m) => openModal({ ...m, totalOutstanding: m.balance, principalOutstanding: m.balance - m.interest, interestOutstanding: m.interest })} />
      {success && (
        <div
          style={{
            background: "var(--success-bg)",
            border: "1px solid var(--success)",
            borderRadius: 8,
            padding: "1rem",
            marginBottom: "1rem",
            color: "var(--success-fg)",
            fontWeight: 600,
          }}
        >
          ✅ {success}
        </div>
      )}
      {isLoading ? (
        <div style={{ padding: "3rem", textAlign: "center", color: "var(--fg-4)" }}>
          Loading late payments…
        </div>
      ) : lateMembers.length === 0 ? (
        <div
          style={{
            background: "var(--success-bg)",
            borderRadius: 8,
            padding: "2rem",
            textAlign: "center",
            color: "var(--success-fg)",
            fontWeight: 600,
          }}
        >
          ✅ No members with overdue payment windows. All clear!
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
          >
            <thead>
              <tr style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
                <th style={th}>Wing-Flat</th>
                <th style={th}>Member</th>
                <th style={th}>Oldest Period</th>
                <th style={th}>Deadline</th>
                <th style={th}>Principal Due</th>
                <th style={th}>Interest Due</th>
                <th style={th}>Total Outstanding</th>
                <th style={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {lateMembers.map((m, i) => (
                <tr
                  key={m.memberId}
                  style={{ background: i % 2 === 0 ? "var(--bg-surface)" : "var(--danger-bg)" }}
                >
                  <td style={td}>
                    {m.wing}-{m.flatNo}
                  </td>
                  <td style={td}>{m.ownerName}</td>
                  <td style={td}>{m.oldestPeriod}</td>
                  <td style={{ ...td, color: "var(--danger)", fontWeight: 700 }}>
                    {m.deadline
                      ? new Date(m.deadline).toLocaleDateString("en-IN")
                      : "—"}
                  </td>
                  <td style={td}>₹{fmt(m.principalOutstanding)}</td>
                  <td style={{ ...td, color: "var(--danger)" }}>
                    ₹{fmt(m.interestOutstanding)}
                  </td>
                  <td style={{ ...td, fontWeight: 700, color: "var(--info-fg)" }}>
                    ₹{fmt(m.totalOutstanding)}
                  </td>
                  <td style={td}>
                    <button
                      onClick={() => openModal(m)}
                      style={{
                        background: "var(--primary-hover)",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        padding: "6px 14px",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      Record Payment
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Payment Modal */}
      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 12,
              padding: "2rem",
              width: 480,
              maxWidth: "95vw",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <h2
              style={{
                margin: "0 0 0.5rem",
                fontSize: "1.1rem",
                fontWeight: 700,
              }}
            >
              Record Late Payment
            </h2>
            <p
              style={{ color: "var(--fg-4)", fontSize: 13, marginBottom: "1.5rem" }}
            >
              {modal.wing}-{modal.flatNo} — {modal.ownerName} — Oldest:{" "}
              {modal.oldestPeriod}
            </p>
            {/* Outstanding summary */}
            <div
              style={{
                background: "var(--danger-bg)",
                border: "1px solid var(--danger)",
                borderRadius: 8,
                padding: "1rem",
                marginBottom: "1.25rem",
                fontSize: 13,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <span style={{ color: "var(--fg-4)" }}>Interest Outstanding</span>
                <strong style={{ color: "var(--danger)" }}>
                  ₹{fmt(modal.interestOutstanding)}
                </strong>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <span style={{ color: "var(--fg-4)" }}>Principal Outstanding</span>
                <strong>₹{fmt(modal.principalOutstanding)}</strong>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderTop: "1px solid var(--danger)",
                  paddingTop: 6,
                  marginTop: 6,
                }}
              >
                <span style={{ fontWeight: 700 }}>Total Outstanding</span>
                <strong style={{ color: "var(--info-fg)", fontSize: 15 }}>
                  ₹{fmt(modal.totalOutstanding)}
                </strong>
              </div>
              <p
                style={{
                  margin: "8px 0 0",
                  fontSize: 11,
                  color: "var(--danger-fg)",
                  fontWeight: 600,
                }}
              >
                ⚡ Interest-satisfy-first: payment will clear ₹
                {fmt(modal.interestOutstanding)} interest first, then principal.
              </p>
            </div>
            {error && (
              <div
                style={{
                  background: "var(--danger-bg)",
                  border: "1px solid var(--danger)",
                  borderRadius: 6,
                  padding: "0.75rem",
                  marginBottom: "1rem",
                  color: "var(--danger-fg)",
                  fontSize: 13,
                }}
              >
                ❌ {error}
              </div>
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              <div>
                <label style={label}>Amount (₹)</label>
                <input
                  type="number"
                  value={payAmt}
                  onChange={(e) => setPayAmt(e.target.value)}
                  style={input}
                  min={0}
                  step={0.01}
                />
              </div>
              <div>
                <label style={label}>Payment Mode</label>
                <select
                  value={payMode}
                  onChange={(e) => setPayMode(e.target.value)}
                  style={input}
                >
                  <option value="Cash">Cash</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Online">Online</option>
                  <option value="UPI">UPI</option>
                  <option value="NEFT">NEFT</option>
                  <option value="RTGS">RTGS</option>
                </select>
              </div>
              {payMode === "Cheque" && (
                <>
                  <div>
                    <label style={label}>Cheque No</label>
                    <input
                      value={chequeNo}
                      onChange={(e) => setChequeNo(e.target.value)}
                      style={input}
                    />
                  </div>
                  <div>
                    <label style={label}>Bank Name</label>
                    <input
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      style={input}
                    />
                  </div>
                </>
              )}
              <div>
                <label style={label}>Notes (optional)</label>
                <input
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  style={input}
                  placeholder="e.g. Late cash payment received"
                />
              </div>
            </div>
            <div
              style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}
            >
              <button
                onClick={() => {
                  setModal(null);
                  setError(null);
                }}
                style={{
                  flex: 1,
                  padding: "0.75rem",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "white",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handlePay}
                disabled={payMutation.isPending}
                style={{
                  flex: 2,
                  padding: "0.75rem",
                  border: "none",
                  borderRadius: 8,
                  background: "var(--primary-hover)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                {payMutation.isPending
                  ? "Recording…"
                  : `Record ₹${parseFloat(payAmt || 0).toLocaleString("en-IN")}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
const th = {
  padding: "10px 12px",
  textAlign: "left",
  borderBottom: "2px solid var(--danger)",
  fontWeight: 700,
  fontSize: 12,
  textTransform: "uppercase",
};
const td = { padding: "10px 12px", borderBottom: "1px solid var(--bg-muted)" };
const label = {
  display: "block",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--fg-3)",
  marginBottom: 4,
};
const input = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  border: "1px solid var(--border-strong)",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};
