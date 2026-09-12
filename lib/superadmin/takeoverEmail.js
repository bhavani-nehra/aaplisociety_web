import { escapeHtml } from "@/lib/brevo-email";

// Shared by app/api/v1/takeover/[id]/approve and .../resend-otp — same
// email, same reasoning either way ("here's your code, expires in 5 min").
export function otpEmailHtml({ otp, ticketTitle, scope, minutes, superadminName }) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2>Support access code</h2>
      <p><strong>${escapeHtml(superadminName)}</strong> requested ${scope === "write" ? "edit" : "view-only"}
      access to your dashboard for ${minutes} minutes, for ticket
      "<strong>${escapeHtml(ticketTitle)}</strong>".</p>
      <p>If you approved this, enter this code to confirm:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${otp}</p>
      <p style="color:#666;font-size:13px;">Expires in 5 minutes. If you did not expect this request, ignore this
      email and deny the request in your dashboard.</p>
    </div>
  `;
}
