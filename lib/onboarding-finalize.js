// Shared "make this onboarding real" step — extracted out of
// app/api/admin/bulk-import/route.js so it can fire from two places:
//   1. Immediately after bulk-import, for a society with NO bill history to
//      import (nothing to wait for).
//   2. After the Bill History step (Confirm or Skip), for a society that DID
//      have history — this is what final_audit_fix_plan/bill-history-upgrade.md
//      §40 means by "nothing is emailed until the whole onboarding, including
//      the bill-history decision, is actually finished."
// Marks the Society "active" and sends every queued onboarding email. Call
// this ONLY once everything the society needs (members, billing heads,
// current-month bill) already exists for real — there is no rollback past
// this point (SEC-19/SEC-20 pointOfNoReturn convention).
import Society from "@/models/Society";
import EmailOutbox from "@/models/EmailOutbox";
import { sendEmail, onboardingEmailHtml } from "@/lib/brevo-email";
import { signToken } from "@/lib/jwt";

export async function finalizeBulkImportOnboarding({
  importRunId,
  societyId,
  societyPayload, // { societyName, address, email, fullName }
  memberCredentials, // mutated in place — setCredentialsUrl filled in per cred
  societyAdminUser, // the admin User doc, or null if a reused account
  multiSocietyAdminUser, // truthy if the admin email already had a login elsewhere
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  let adminSetCredentialsUrl = null;

  const outboxDocs = memberCredentials
    .filter((c) => c.isNewUser && c.email)
    .map((cred) => {
      const onboardingToken = signToken({ userId: cred.userId, purpose: "onboarding" }, { expiresIn: "7d" });
      const setCredentialsUrl = `${appUrl}/onboarding/set-credentials?token=${onboardingToken}`;
      cred.setCredentialsUrl = setCredentialsUrl;
      return {
        importRunId,
        userId: cred.userId,
        type: "onboarding",
        to: cred.email,
        subject: `Set up your account — ${societyPayload.societyName}`,
        html: onboardingEmailHtml({
          memberName: cred.ownerName,
          societyName: societyPayload.societyName,
          societyAddress: societyPayload.address || "",
          unitKind: cred.accountType === "Tenant" ? "Flat (as tenant of)" : "Flat",
          unitLabel: cred.wing ? `${cred.wing}-${cred.flatNo}` : cred.flatNo,
          setCredentialsUrl,
        }),
      };
    });

  const notifyDocs = [];
  for (const cred of memberCredentials) {
    if (cred.isNewUser || !cred.email || !cred.userId) continue;
    notifyDocs.push({
      importRunId,
      userId: cred.userId,
      type: "profile-added",
      to: cred.email,
      subject: `${societyPayload.societyName} added to your account`,
      html: `<p>Hi ${cred.ownerName || ""},</p><p><strong>${cred.wing ? `${cred.wing}-${cred.flatNo}` : cred.flatNo}</strong> at <strong>${societyPayload.societyName}</strong> has been added to your existing account. Sign in as usual and pick it from your profile list.</p><p><a href="${appUrl}/auth/login">${appUrl}/auth/login</a></p>`,
    });
  }
  if (multiSocietyAdminUser && societyPayload.email) {
    notifyDocs.push({
      importRunId,
      userId: societyAdminUser?._id,
      type: "profile-added",
      to: societyPayload.email,
      subject: `${societyPayload.societyName} added to your account`,
      html: `<p>Hi ${societyPayload.fullName || ""},</p><p>You've been made Admin of <strong>${societyPayload.societyName}</strong> using your existing login. Sign in as usual and pick it from your profile list.</p><p><a href="${appUrl}/auth/login">${appUrl}/auth/login</a></p>`,
    });
  }

  if (!multiSocietyAdminUser && societyPayload.email && societyAdminUser?._id) {
    const adminToken = signToken({ userId: String(societyAdminUser._id), purpose: "onboarding" }, { expiresIn: "7d" });
    adminSetCredentialsUrl = `${appUrl}/onboarding/set-credentials?token=${adminToken}`;
    outboxDocs.push({
      importRunId,
      userId: societyAdminUser._id,
      type: "onboarding",
      to: societyPayload.email,
      subject: `Set up your admin account — ${societyPayload.societyName}`,
      html: onboardingEmailHtml({
        memberName: societyPayload.fullName || "Admin",
        societyName: societyPayload.societyName,
        societyAddress: societyPayload.address || "",
        unitKind: "",
        unitLabel: "",
        setCredentialsUrl: adminSetCredentialsUrl,
      }),
    });
  }
  outboxDocs.push(...notifyDocs);

  if (outboxDocs.length > 0) {
    try {
      await EmailOutbox.insertMany(outboxDocs, { ordered: false });
    } catch (err) {
      if (err.code !== 11000) {
        console.error("[onboarding-finalize] outbox insert error:", err.message);
      }
    }
  }

  const onboardingEmailErrors = [];
  const pending = await EmailOutbox.find({ importRunId, status: "pending" });
  for (const row of pending) {
    try {
      await sendEmail({ to: row.to, subject: row.subject, html: row.html });
      row.status = "sent";
      row.sentAt = new Date();
      await row.save();
    } catch (err) {
      row.attempts += 1;
      row.lastError = err.message;
      row.status = "failed";
      await row.save();
      console.error(`[onboarding-finalize] email failed for ${row.to}:`, err.message);
      onboardingEmailErrors.push(row.to);
    }
  }

  // Society is now real and visible to normal queries — past this point,
  // nothing about this run may be rolled back (SEC-19/SEC-20 convention).
  await Society.updateOne({ _id: societyId }, { $set: { importStatus: "active" } });

  return { adminSetCredentialsUrl, onboardingEmailErrors };
}
