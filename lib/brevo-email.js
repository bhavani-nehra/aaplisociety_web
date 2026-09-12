/**
 * lib/brevo-email.js
 *
 * Same pattern as apps/mobile-backend/src/lib/brevo.ts - plain fetch against
 * Brevo's transactional email API, no SDK dependency. Brevo env vars have
 * been sitting in .env.local unused until now (see the mobile-backend
 * forgot-password feature, which uses the same account).
 */
export async function sendEmail({ to, subject, html }) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: process.env.BREVO_SENDER_EMAIL,
        name: process.env.BREVO_SENDER_NAME || "AapliSocietyy",
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo send failed (${res.status}): ${body}`);
  }
}
// Ticket title/description/etc. are free text an Admin typed — escape
// before interpolating into HTML so a ticket titled `<img src=x onerror=...>`
// can't inject markup into a SuperAdmin's inbox.
export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// unitLabel/unitKind are optional so this stays backward-compatible with any
// caller that only has memberName/societyName (e.g. a staff account with no
// unit at all) — but every real invite (flat or shop) should pass them: an
// email that only says "your account has been created" with no mention of
// WHICH flat or shop gives the recipient nothing to verify the invite
// against, and reads as generic/untrustworthy.
// Sent to every active SuperAdmin the moment an admin submits a ticket.
// Deliberately excludes screenshots/error logs — this is a "go look at it"
// notification, not the ticket itself; the recipient reads the actual
// content on the superadmin tickets page, where it's rendered inline and
// nothing is attached or downloadable.
export function ticketNotificationEmailHtml({
  societyName,
  adminName,
  category,
  title,
  description,
  ticketUrl,
}) {
  const desc = escapeHtml(description).slice(0, 400);
  const truncated = description.length > 400 ? "…" : "";
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
      <p>A new support ticket was submitted.</p>
      <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding:6px 0; color:#6b7280; width:120px;">Society</td><td style="padding:6px 0;"><strong>${escapeHtml(societyName)}</strong></td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Submitted by</td><td style="padding:6px 0;">${escapeHtml(adminName)}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Category</td><td style="padding:6px 0;">${escapeHtml(category)}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Title</td><td style="padding:6px 0;"><strong>${escapeHtml(title)}</strong></td></tr>
      </table>
      <p style="color:#374151; white-space: pre-wrap;">${desc}${truncated}</p>
      <p style="margin: 24px 0;">
        <a href="${ticketUrl}" style="background:#1e40af;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          View ticket
        </a>
      </p>
    </div>
  `;
}

export function onboardingEmailHtml({
  memberName,
  societyName,
  societyAddress,
  unitKind,
  unitLabel,
  setCredentialsUrl,
}) {
  const unitLine = unitLabel
    ? `<p>You've been added as the owner of <strong>${unitKind || "unit"} ${unitLabel}</strong> at <strong>${societyName}</strong>${societyAddress ? `, ${societyAddress}` : ""}.</p>`
    : `<p>Your account for <strong>${societyName}</strong> on AapliSocietyy has been created.</p>`;
  return `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <p>Hi ${memberName},</p>
      ${unitLine}
      <p>Before you can log in, set up your own username and password:</p>
      <p style="margin: 24px 0;">
        <a href="${setCredentialsUrl}" style="background:#1e40af;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
          Set up my account
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;">This link expires in 7 days. If it stops working, contact your society admin for a new one.</p>
    </div>
  `;
}
