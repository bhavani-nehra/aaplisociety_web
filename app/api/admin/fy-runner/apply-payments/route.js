import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import { recordPayment, PaymentServiceError } from "@/lib/services/PaymentService";
import { outstandingForBills, twoDp } from "@/lib/billing/paymentApplication";
import { mapLimit } from "@/lib/concurrency";
import Bill from "@/models/Bill";
import cache from "@/lib/cache";

// Applies a payment tier against each member's REAL current outstanding (the
// latest open bill's closingTotal — see outstandingForBills for why not a sum).
// Every write goes through recordPayment(), the same single source of truth
// /api/payments/record uses; no allocation math lives here.
//
//   less    -> outstanding * lessPercent/100     (default 80)
//   full    -> outstanding
//   advance -> outstanding * advancePercent/100  (default 120)
//   custom  -> outstanding * percent/100
//   skip    -> nothing recorded

// Same cap generate-final uses: members never share Bill/Member/Transaction
// docs, so they are safe in parallel; the cap protects the connection pool.
const CONCURRENCY = 8;

function endOfMonth(year, month0) {
  return new Date(year, month0 + 1, 0, 12);
}

async function memberPosition(societyId, memberId, billSeries) {
  const open = await Bill.find({
    societyId,
    memberId,
    billSeries,
    isDeleted: { $ne: true },
    status: { $in: ["Unpaid", "Partial", "Overdue"] },
  })
    .select("closingTotal closingPrincipal closingInterest balanceAmount billYear billMonth dueDate")
    .lean();
  const outstanding = outstandingForBills(open);
  const latest = open.reduce(
    (best, b) => (!best || b.billYear > best.billYear || (b.billYear === best.billYear && b.billMonth > best.billMonth) ? b : best),
    null,
  );
  // Pay on the bill's own due date so the receipt lands in the period (and
  // Financial Year) being run, not today's real date. A due date that spills
  // into the next month is pulled back to the bill month's last day.
  let paymentDate = null;
  if (latest) {
    const monthEnd = endOfMonth(latest.billYear, latest.billMonth);
    const due = latest.dueDate ? new Date(latest.dueDate) : monthEnd;
    paymentDate = due > monthEnd ? monthEnd : due;
  }
  return { outstanding, paymentDate };
}

export async function POST(request) {
  try {
    const gate = await authorize(request, "finance.payment.record");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const {
      payments,
      billSeries = "RESIDENTIAL",
      paymentMode = "Cash",
      lessPercent = 80,
      advancePercent = 120,
      periodLabel = "",
    } = await request.json();

    if (!Array.isArray(payments) || !payments.length) {
      return NextResponse.json({ error: "payments[] is required" }, { status: 400 });
    }
    const less = Number(lessPercent);
    const adv = Number(advancePercent);
    if (!(less > 0 && less < 100)) return NextResponse.json({ error: "lessPercent must be between 0 and 100" }, { status: 400 });
    if (!(adv > 100 && adv <= 500)) return NextResponse.json({ error: "advancePercent must be between 100 and 500" }, { status: 400 });

    const societyId = decoded.societyId;

    async function payOne({ memberId, tier, percent }) {
      const row = { memberId, tier };
      const { outstanding, paymentDate } = await memberPosition(societyId, memberId, billSeries);
      row.outstanding = outstanding;

      let pct = 0;
      if (tier === "less") pct = less;
      else if (tier === "full") pct = 100;
      else if (tier === "advance") pct = adv;
      else if (tier === "custom") pct = Number(percent) || 0;
      row.percent = pct;
      row.amount = twoDp(outstanding * (pct / 100));

      if (outstanding <= 0 || row.amount <= 0) {
        row.status = outstanding <= 0 ? "Nothing due" : "Skipped";
        row.paid = 0;
        return row;
      }

      const payment = await recordPayment({
        memberId,
        societyId,
        amount: row.amount,
        paymentMode,
        paymentDate,
        actorUserId: decoded.userId,
        actorRole: decoded.role,
        notes: `FY Runner — ${tier} ${pct}%${periodLabel ? ` (${periodLabel})` : ""}`,
      });
      row.paid = twoDp(payment.transaction.amount);
      row.status = "Paid";
      return row;
    }

    const settled = await mapLimit(payments, CONCURRENCY, payOne);
    const results = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : {
            memberId: payments[i]?.memberId,
            tier: payments[i]?.tier,
            status: "Error",
            error: s.reason instanceof PaymentServiceError ? s.reason.message : s.reason?.message || "Payment failed",
          },
    );

    const totals = results.reduce(
      (t, r) => ({
        outstanding: twoDp(t.outstanding + (r.outstanding || 0)),
        paid: twoDp(t.paid + (r.paid || 0)),
        skipped: t.skipped + (r.status === "Skipped" || r.status === "Nothing due" ? 1 : 0),
        failed: t.failed + (r.status === "Error" ? 1 : 0),
      }),
      { outstanding: 0, paid: 0, skipped: 0, failed: 0 },
    );

    await cache.delPattern(`v1:bills:${societyId}:member:*`);
    await cache.delPattern(`v1:ledger:${societyId}:member:*`);
    await cache.delPattern(`v1:receipts:${societyId}:member:*`);
    await cache.del(`payments:outstanding:${societyId}`);

    return NextResponse.json({ success: true, results, totals });
  } catch (error) {
    console.error("fy-runner/apply-payments error:", error);
    return NextResponse.json({ error: "Internal server error", details: error.message }, { status: 500 });
  }
}
