// POST /api/admin/subscriptions/:id — subscription actions, one at a time.
//
// Deliberately NOT done through the generic `PUT /api/admin/societies`, which
// applies whatever `updates` object it is handed straight to findByIdAndUpdate.
// That is fine for editing an address; it is the wrong shape for money. A
// recorded payment has to append to paymentHistory, move lastPaymentDate and
// roll nextPaymentDate forward together — three writes that must agree, and a
// caller passing a hand-built `updates` object gets one of them wrong.
//
// Every action here is audited with the before and after value.

import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import AuditLog from "@/models/AuditLog";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { ensureSettings } from "@/lib/platform/settingsStore";
import { planPrices, PLAN_NAMES } from "@/lib/superadmin/platformMetrics";
import { MODULES } from "@/lib/entitlements/modules";
import { normalizeFeatures, bumpEntitlementVersion } from "@/lib/entitlements/resolve";

export const dynamic = "force-dynamic";

const STATUSES = ["Active", "Suspended", "Trial", "Expired"];
const MAX_TRIAL_EXTENSION_DAYS = 90;

const bad = (message) => NextResponse.json({ error: message }, { status: 400 });

/** One month on from `from`, clamped so the 31st doesn't skip February. */
function addMonth(from) {
  const d = new Date(from);
  const day = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

export async function POST(request, { params }) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;
  const admin = validation.admin;

  try {
    await connectDB();
    await ensureSettings();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");

    const society = await Society.findById(id);
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });

    society.subscription = society.subscription || {};
    const before = JSON.parse(JSON.stringify(society.subscription));
    // Captured before the switch runs, because set-modules mutates
    // society.features in place and the audit entry needs the prior state.
    const before_features = JSON.parse(JSON.stringify(society.features || {}));
    let summary;
    let auditAction;
    let moduleChange = false;
    let modulesBefore = null;

    switch (action) {
      case "change-plan": {
        const planType = String(body.planType || "");
        if (!PLAN_NAMES.includes(planType)) return bad(`Unknown plan "${planType}"`);
        society.subscription.planType = planType;
        summary = `Plan ${before.planType || "Free"} → ${planType}`;
        auditAction = "SUBSCRIPTION_PLAN_CHANGED";
        break;
      }

      case "set-status": {
        const status = String(body.status || "");
        if (!STATUSES.includes(status)) return bad(`Unknown status "${status}"`);
        society.subscription.status = status;
        summary = `Status ${before.status || "Trial"} → ${status}`;
        auditAction = "SUBSCRIPTION_STATUS_CHANGED";
        break;
      }

      case "record-payment": {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0) return bad("Amount must be a positive number");
        const date = body.date ? new Date(body.date) : new Date();
        if (Number.isNaN(date.getTime())) return bad("Invalid payment date");
        if (date.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
          return bad("Payment date cannot be in the future");
        }

        society.subscription.paymentHistory = society.subscription.paymentHistory || [];
        society.subscription.paymentHistory.push({
          date,
          amount,
          transactionId: body.transactionId ? String(body.transactionId).trim() : undefined,
          method: body.method ? String(body.method).trim() : undefined,
        });
        society.subscription.amountPaid = (society.subscription.amountPaid || 0) + amount;
        society.subscription.lastPaymentDate = date;
        // Roll the due date forward from whichever is later, so recording a
        // late payment doesn't leave the society instantly overdue again.
        const base =
          society.subscription.nextPaymentDate &&
          new Date(society.subscription.nextPaymentDate) > date
            ? new Date(society.subscription.nextPaymentDate)
            : date;
        society.subscription.nextPaymentDate = addMonth(base);
        // A payment on a lapsed subscription revives it; one on a suspended
        // society does NOT, because suspension may be for a non-payment reason.
        if (society.subscription.status === "Expired" || society.subscription.status === "Trial") {
          society.subscription.status = "Active";
        }
        summary = `Recorded ₹${amount.toLocaleString("en-IN")}`;
        auditAction = "SUBSCRIPTION_PAYMENT_RECORDED";
        break;
      }

      case "extend-trial": {
        const days = Number(body.days);
        if (!Number.isInteger(days) || days <= 0 || days > MAX_TRIAL_EXTENSION_DAYS) {
          return bad(`Extension must be 1–${MAX_TRIAL_EXTENSION_DAYS} days`);
        }
        const from =
          society.subscription.trialEndsAt && new Date(society.subscription.trialEndsAt) > new Date()
            ? new Date(society.subscription.trialEndsAt)
            : new Date();
        from.setDate(from.getDate() + days);
        society.subscription.trialEndsAt = from;
        society.subscription.status = "Trial";
        summary = `Trial extended ${days} days → ${from.toDateString()}`;
        auditAction = "SUBSCRIPTION_TRIAL_EXTENDED";
        break;
      }

      case "set-next-payment": {
        const date = new Date(body.date);
        if (Number.isNaN(date.getTime())) return bad("Invalid date");
        society.subscription.nextPaymentDate = date;
        summary = `Next payment → ${date.toDateString()}`;
        auditAction = "SUBSCRIPTION_DUE_DATE_CHANGED";
        break;
      }

      // Granting and revoking add-on modules.
      //
      // This lived only in PATCH /api/superadmin/subscriptions, which no UI
      // ever called and which wrote the flags without auditing them. Turning a
      // paid module on or off is a commercial decision with a customer on the
      // other end of it — "who gave them Amenities and when" is exactly the
      // question the audit trail exists to answer, and it is the only
      // subscription action that was not answerable.
      //
      // The keys come from the registry, so a module removed from
      // lib/entitlements/modules.js (rbac, 2026-08-27) cannot be granted here
      // by a stale client still sending it.
      case "set-modules": {
        const requested = body.modules;
        if (!requested || typeof requested !== "object") {
          return bad("modules must be an object of { key: boolean }");
        }
        const unknown = Object.keys(requested).filter(
          (k) => !MODULES.some((m) => m.key === k),
        );
        if (unknown.length) return bad(`Unknown module(s): ${unknown.join(", ")}`);

        society.features = society.features || {};
        const changes = [];
        for (const mod of MODULES) {
          const next = requested[mod.key];
          if (typeof next !== "boolean") continue;
          const current = society.features?.[mod.key]?.enabled === true;
          if (current === next) continue;
          society.features[mod.key] = { ...society.features[mod.key], enabled: next };
          changes.push(`${mod.label} ${next ? "on" : "off"}`);
        }
        if (!changes.length) return bad("Nothing to change");

        modulesBefore = normalizeFeatures(before_features);
        society.markModified("features");
        summary = changes.join(", ");
        auditAction = "SUBSCRIPTION_MODULES_CHANGED";
        moduleChange = true;
        break;
      }

      default:
        return bad(`Unknown action "${action}"`);
    }

    await society.save();

    // Without this the grant would take up to five minutes to reach the
    // resolver, because the entitlement snapshot is cached under this version.
    if (moduleChange) await bumpEntitlementVersion(society._id);

    await AuditLog.create({
      userId: admin.userId,
      societyId: society._id,
      action: auditAction,
      oldData: moduleChange
        ? { subscription: before, modules: modulesBefore }
        : { subscription: before },
      newData: {
        subscription: society.subscription,
        ...(moduleChange ? { modules: normalizeFeatures(society.features) } : {}),
        summary,
        by: admin.email,
      },
      timestamp: new Date(),
    });

    return NextResponse.json({
      success: true,
      summary,
      subscription: society.subscription,
      modules: normalizeFeatures(society.features),
      prices: planPrices(),
    });
  } catch (error) {
    console.error("[admin/subscriptions]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
