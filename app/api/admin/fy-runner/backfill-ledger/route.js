// POST /api/admin/fy-runner/backfill-ledger
// body: { financialYearId, apply?: boolean }
// Web port of scripts/fy-cycle.js::backfillLedger. Bills/payments made
// before accounting was turned on for a society exist in the sub-ledger
// (Bill/Transaction) but never reached the double-entry books. Finds any
// bill/payment inside the given Financial Year that has no matching
// Voucher (keyed by "bill:<id>" / "payment:<id>"), and posts it through
// the same functions the app itself uses — idempotent per bill/payment.
// apply:false (default) = scan only. apply:true = actually posts.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Voucher from "@/models/Voucher";
import FinancialYear from "@/models/FinancialYear";
import { postBillToLedger } from "@/lib/accounting/billLedgerPosting";
import { postPaymentToLedger } from "@/lib/accounting/paymentLedgerPosting";
import { twoDp } from "@/lib/billing/paymentApplication";

const isHistoryTxn = (t) => /^history/.test(String(t.notes || ""));

export async function POST(request) {
  const gate = await authorize(request, "finance.accounting.manage");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const societyId = gate.context.societyId;
    const sid = String(societyId);
    const apply = !!body.apply;

    const fy = await FinancialYear.findOne({ _id: body.financialYearId, societyId, isDeleted: false }).lean();
    if (!fy) return NextResponse.json({ error: "Financial Year not found" }, { status: 404 });

    const within = (d) => d && new Date(d) >= new Date(fy.startDate) && new Date(d) <= new Date(fy.endDate);
    const [bills, txns] = await Promise.all([
      Bill.find({ societyId, isDeleted: { $ne: true } }).sort({ billPeriodId: 1 }).lean(),
      Transaction.find({ societyId, type: "Credit", category: "Payment", isReversed: { $ne: true } }).sort({ date: 1 }).lean(),
    ]);

    const inFyBills = bills.filter((b) => !b.isHistoricalArchive && within(b.dueDate || b.generatedAt) && (b.currentCharges || 0) + (b.currentInterest || 0) > 0);
    const inFyTxns = txns.filter((t) => !isHistoryTxn(t) && within(t.date));
    const keys = [...inFyBills.map((b) => `bill:${b._id}`), ...inFyTxns.map((t) => `payment:${t._id}`)];
    const have = new Set((await Voucher.find({ societyId, idempotencyKey: { $in: keys } }).select("idempotencyKey").lean()).map((v) => v.idempotencyKey));
    const missBills = inFyBills.filter((b) => !have.has(`bill:${b._id}`));
    const missTxns = inFyTxns.filter((t) => !have.has(`payment:${t._id}`));

    const summary = {
      billsInFy: inFyBills.length,
      billsMissing: missBills.length,
      paymentsInFy: inFyTxns.length,
      paymentsMissing: missTxns.length,
    };

    if (!apply) {
      return NextResponse.json({ apply: false, summary });
    }

    let nb = 0;
    let np = 0;
    for (const b of missBills) {
      await postBillToLedger(sid, { bill: b, actorUserId: String(gate.context.userId) });
      nb++;
    }
    for (const t of missTxns) {
      const pb = t.paymentBreakdown || {};
      await postPaymentToLedger(sid, {
        transaction: t,
        paymentMode: t.paymentMode,
        paymentDate: t.date,
        notes: t.notes,
        actorUserId: String(gate.context.userId),
        appliedToDues: twoDp((pb.interestCleared || 0) + (pb.principalCleared || 0)),
        advance: twoDp(pb.advanceCredit || 0),
      });
      np++;
    }

    return NextResponse.json({ apply: true, summary, posted: { bills: nb, payments: np } });
  } catch (err) {
    console.error("fy-runner/backfill-ledger error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
