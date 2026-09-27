import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccountingClose } from "@/lib/authz";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import { generateBill } from "@/lib/billing/generationService";
import { recordPayment } from "@/lib/services/PaymentService";
import { outstandingForBills, twoDp } from "@/lib/billing/paymentApplication";
import { isCommercialUnit } from "@/lib/commercial/constants";
import { authorize } from "@/lib/rbac/authorize";

// POST /api/accounting/lab/generate-bills — the "run a year of billing" step of
// the Accounting Lab master simulator.
//
// WHAT CHANGED (and why the old numbers were nonsense)
// ----------------------------------------------------
// 1. ALL MEMBERS, not one. `memberId` is now optional; omit it (or pass
//    memberIds: []) and every member in the society is billed for each period,
//    which is what a real monthly billing run does.
//
// 2. NEVER pay `bill.totalBillDue`. That field is the member's CUMULATIVE
//    running balance (opening + current), not the amount outstanding. The old
//    code paid it every month, so once arrears existed it re-paid the whole
//    arrears stack every period — ₹1,395 then ₹2,814 then ₹4,258 ... and
//    ₹40,427.11 of cash collected against ₹10,277.66 of income ever billed.
//    We now resolve the member's ACTUAL outstanding from their open bills.
//
// 3. Realistic payment behaviour. Real members do not pay exact amounts. The
//    `paymentProfile` drives a per-member, per-month mix of full / short /
//    advance / skipped payments in round ₹500-₹1,000 steps, so the simulator
//    exercises arrears, interest, partial allocation AND the advance-liability
//    path instead of the single happy case.
//
// Body: {
//   memberIds?: string[]        // default: all members
//   memberId?: string           // legacy single-member (still honoured)
//   months?: number, startYear?: number, startMonth?: number,
//   paymentProfile?: "none"|"full"|"realistic"|"custom",
//   customPlan?: { [periodIndex]: number },
//   seed?: number               // deterministic randomness for repeatable runs
// }

// Small deterministic PRNG (mulberry32) so a given seed always replays the
// exact same payment pattern — essential for a test simulator you want to
// re-run and compare.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Decides what this member actually pays this month.
 * Returns { amount, behaviour }.
 */
function decidePayment(profile, outstanding, rand, customAmount) {
  const due = twoDp(outstanding);
  if (profile === "none" || due <= 0) return { amount: 0, behaviour: "No payment" };
  if (profile === "custom") {
    const amt = twoDp(customAmount || 0);
    return { amount: amt, behaviour: amt === 0 ? "No payment" : "Custom" };
  }
  if (profile === "full") return { amount: due, behaviour: "Paid in full" };

  // "realistic": a believable spread of member behaviour.
  const roll = rand();
  const step = 500 + Math.floor(rand() * 2) * 500; // ₹500 or ₹1,000
  if (roll < 0.15) {
    return { amount: 0, behaviour: "Skipped (defaulter)" };
  }
  if (roll < 0.4) {
    // Short payment — pays less, leaves arrears that will attract interest.
    const amount = Math.max(0, twoDp(due - step));
    if (amount <= 0) return { amount: 0, behaviour: "Skipped (defaulter)" };
    return { amount, behaviour: `Short by ₹${step.toLocaleString("en-IN")}` };
  }
  if (roll < 0.62) {
    // Advance — pays extra, credits the Advance From Members liability.
    return { amount: twoDp(due + step), behaviour: `Advance +₹${step.toLocaleString("en-IN")}` };
  }
  return { amount: due, behaviour: "Paid in full" };
}

/** Outstanding across a member's open bills, straight from the DB. */
async function currentOutstanding(societyId, memberId) {
  const open = await Bill.find({
    societyId,
    memberId,
    isDeleted: { $ne: true },
    status: { $in: ["Unpaid", "Partial", "Overdue"] },
  })
    .select("closingTotal closingPrincipal closingInterest balanceAmount")
    .lean();
  return outstandingForBills(open);
}

export async function POST(request)  {
  // Lab tooling is dev/staging-only. In production return 404 (not 403) so
  // the route does not even confirm its own existence.
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = requireAccountingClose(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const societyId = auth.user.societyId;
    const body = await request.json();

    // ── Resolve the member set ───────────────────────────────────────────
    let memberIds = Array.isArray(body.memberIds) ? body.memberIds.filter(Boolean) : [];
    if (!memberIds.length && body.memberId) memberIds = [body.memberId];
    if (!memberIds.length) {
      const all = await Member.find({ societyId }).select("_id").lean();
      memberIds = all.map((m) => String(m._id));
    }
    if (!memberIds.length) {
      return NextResponse.json({ error: "This society has no members to bill." }, { status: 400 });
    }

    const members = await Member.find({ _id: { $in: memberIds }, societyId })
      .select("_id ownerName flatNo wing flatType")
      .sort({ wing: 1, flatNo: 1 })
      .lean();
    const memberLabel = new Map(
      members.map((m) => [String(m._id), `${m.wing ? `${m.wing}-` : ""}${m.flatNo} ${m.ownerName}`.trim()]),
    );
    // The Accounting Lab simulates residential billing only — Commercial
    // units are billed exclusively through the dedicated Commercial billing
    // wizard, not this simulator.
    const skippedCommercial = members.filter((m) => isCommercialUnit(m));
    if (skippedCommercial.length) {
      const skippedIds = new Set(skippedCommercial.map((m) => String(m._id)));
      memberIds = memberIds.filter((id) => !skippedIds.has(id));
    }
    if (!memberIds.length) {
      return NextResponse.json({ error: "This society has no residential members to bill (all selected members are Commercial units)." }, { status: 400 });
    }

    const months = Math.min(Math.max(parseInt(body.months) || 12, 1), 36);
    const now = new Date();
    let year = parseInt(body.startYear) || now.getFullYear();
    let month = parseInt(body.startMonth) || now.getMonth() + 1;

    // Back-compat: the old boolean autoPay maps to the "full" profile.
    const profile = body.paymentProfile || (body.autoPay ? "full" : "none");
    const rand = rng(parseInt(body.seed) || 20260731);

    const periods = [];
    const totals = { billed: 0, collected: 0, advance: 0, skipped: 0, failed: 0 };

    for (let i = 0; i < months; i++) {
      const period = {
        year,
        month,
        label: `${year}-${String(month).padStart(2, "0")}`,
        rows: [],
        billedTotal: 0,
        collectedTotal: 0,
      };

      for (const mid of memberIds) {
        const row = { memberId: mid, member: memberLabel.get(mid) || mid };
        try {
          // ── 1. Generate (posts BillGenerated to the ledger) ───────────────
          // publishMode: "now" is required here — the default "config" mode
          // compares the bill's push date against the REAL wall-clock date,
          // so any simulated month not yet reached in real time (which is
          // most of them, since the Lab bills months ahead) gets status
          // "Scheduled" and becomes invisible to currentOutstanding()'s
          // Unpaid/Partial/Overdue filter. That silently zeroed out every
          // "Due" figure and made every payment decision see 0 outstanding —
          // this is a billing simulator, every generated bill must be live
          // immediately.
          const bill = await generateBill({
            societyId,
            memberId: mid,
            year,
            month,
            performedBy: String(auth.user.userId),
            publishMode: "now",
          });
          row.billPeriodId = bill.billPeriodId;
          row.openingBalance = twoDp((bill.openingPrincipal || 0) + (bill.openingInterest || 0));
          row.currentCharges = twoDp(bill.currentCharges);
          row.currentInterest = twoDp(bill.currentInterest);
          row.totalBillDue = twoDp(bill.totalBillDue);
          row.statusAfterBilling = bill.status;
          period.billedTotal = twoDp(period.billedTotal + row.currentCharges + row.currentInterest);

          // ── 2. Pay the REAL outstanding, not the cumulative running total ──
          const outstanding = await currentOutstanding(societyId, mid);
          row.outstandingBeforePayment = outstanding;

          const { amount, behaviour } = decidePayment(
            profile,
            outstanding,
            rand,
            body.customPlan?.[String(i)],
          );
          row.behaviour = behaviour;
          row.paid = 0;

          if (amount > 0) {
            // Pass the bill's own period date, not real "now" — same fix as
            // lib/accounting/billLedgerPosting.js: a simulated payment must
            // land in the Financial Year that actually covers the simulated
            // period, not whichever FY happens to be "current" in real time.
            const payment = await recordPayment({
              memberId: mid,
              societyId,
              amount,
              paymentMode: "Cash",
              paymentDate: bill.dueDate,
              actorUserId: auth.user.userId,
              actorRole: auth.user.role,
            });
            row.paid = twoDp(payment.transaction.amount);
            row.advance = twoDp(Math.max(0, amount - outstanding));
            period.collectedTotal = twoDp(period.collectedTotal + row.paid);
            totals.collected = twoDp(totals.collected + row.paid);
            totals.advance = twoDp(totals.advance + (row.advance || 0));
          } else {
            totals.skipped += 1;
          }

          // ── 3. Closing position AFTER payment — this is the number that now
          //    correctly carries into next month.
          row.closingOutstanding = await currentOutstanding(societyId, mid);
          totals.billed = twoDp(totals.billed + row.currentCharges + row.currentInterest);
        } catch (err) {
          row.error = err.message;
          totals.failed += 1;
        }
        period.rows.push(row);
      }

      period.errorCount = period.rows.filter((r) => r.error).length;
      periods.push(period);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }

    return NextResponse.json({
      periods,
      totals,
      memberCount: memberIds.length,
      monthsRun: months,
      paymentProfile: profile,
      skippedCommercialMembers: skippedCommercial.length
        ? skippedCommercial.map((m) => `${m.wing ? `${m.wing}-` : ""}${m.flatNo} ${m.ownerName}`.trim())
        : undefined,
    });
  } catch (error) {
    console.error("Lab generate-bills error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}