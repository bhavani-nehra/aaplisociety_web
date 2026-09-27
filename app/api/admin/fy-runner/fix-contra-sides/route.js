// POST /api/admin/fy-runner/fix-contra-sides
// body: { financialYearId, apply?: boolean, accountIds?: string[] }
// Web port of scripts/fy-cycle.js::fixContraSides. A contra-asset account
// (e.g. Accumulated Depreciation) belongs on the credit side; if an opening
// balance was typed in as a debit, this finds it and posts a correction:
// Cr the contra account / Dr whichever account took the opening balancing
// figure — but ONLY when the debit is provably just that opening entry
// (same amount, nothing else touched it since). Anything else is reported,
// never auto-corrected.
// apply:false (default) = scan only, nothing written. apply:true = post the
// corrections for the given accountIds (or all correctable ones if omitted).
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import ChartOfAccount from "@/models/ChartOfAccount";
import Voucher from "@/models/Voucher";
import JournalLine from "@/models/JournalLine";
import FinancialYear from "@/models/FinancialYear";
import { getTrialBalance } from "@/lib/services/TrialBalanceService";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine";
import { createAccountingEvent, EVENT_TYPES } from "@/lib/accounting/events";
import { STANDARD_ACCOUNTS } from "@/lib/accounting/standardAccounts";

const twoDp = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CONTRA_CODES = new Set(STANDARD_ACCOUNTS.filter((a) => a.key === "accumDep").map((a) => a.code));

export async function POST(request) {
  const gate = await authorize(request, "finance.accounting.manage");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const societyId = gate.context.societyId;
    const fy = await FinancialYear.findOne({ _id: body.financialYearId, societyId, isDeleted: false }).lean();
    if (!fy) return NextResponse.json({ error: "Financial Year not found" }, { status: 404 });

    const tb = await getTrialBalance(String(societyId), String(fy._id));
    const wrong = tb.rows.filter((r) => CONTRA_CODES.has(r.code) && r.debit > 0.005);
    if (!wrong.length) return NextResponse.json({ findings: [], corrected: [], uncorrectable: [] });

    const ov = await Voucher.findOne({ societyId, financialYearId: fy._id, sourceModule: "OpeningBalance", isDeleted: false, status: { $ne: "Cancelled" } }).select("_id").lean();
    const lines = ov ? await JournalLine.find({ societyId, voucherId: ov._id, status: "Posted" }).lean() : [];
    const fundIds = new Set((await ChartOfAccount.find({ societyId, subType: { $in: ["RetainedSurplus", "GeneralFund"] } }).select("_id").lean()).map((a) => String(a._id)));
    const bal = lines.filter((l) => fundIds.has(String(l.accountId))).sort((a, b) => b.amount - a.amount)[0] || null;

    const apply = !!body.apply;
    const wantIds = Array.isArray(body.accountIds) ? new Set(body.accountIds.map(String)) : null;

    const correctable = [];
    const uncorrectable = [];
    for (const r of wrong) {
      const open = lines.find((l) => String(l.accountId) === String(r.accountId) && l.side === "Debit") || null;
      if (!open || !bal || Math.abs(open.amount - r.debit) > 0.005) {
        uncorrectable.push({ code: r.code, name: r.name, debit: r.debit, reason: "Its debit is not just the opening entry — correct it with a manual journal entry instead." });
        continue;
      }
      correctable.push({ accountId: String(r.accountId), code: r.code, name: r.name, debit: r.debit, correctionAmount: twoDp(r.debit * 2), balancingAccountId: String(bal.accountId) });
    }

    if (!apply) {
      return NextResponse.json({ findings: wrong.map((r) => ({ code: r.code, name: r.name, debit: r.debit })), correctable, uncorrectable });
    }

    const corrected = [];
    for (const c of correctable) {
      if (wantIds && !wantIds.has(c.accountId)) continue;
      await engineProcess(
        createAccountingEvent({
          type: EVENT_TYPES.MANUAL_ADJUSTMENT,
          societyId: String(societyId),
          financialYearId: String(fy._id),
          sourceModule: "Manual",
          actorUserId: String(gate.context.userId),
          idempotencyKey: `fix:contra:${c.accountId}:${fy._id}`,
          payload: {
            date: fy.startDate,
            narration: `Correction: ${c.name} opened on the debit side — moved to credit`,
            lines: [
              { accountId: c.accountId, side: "Credit", amount: c.correctionAmount, narration: `${c.name} — belongs on the credit side` },
              { accountId: c.balancingAccountId, side: "Debit", amount: c.correctionAmount, narration: "Opening balancing figure was overstated by the same amount" },
            ],
          },
        }),
      );
      corrected.push(c);
    }

    return NextResponse.json({ corrected, uncorrectable, skipped: correctable.filter((c) => wantIds && !wantIds.has(c.accountId)) });
  } catch (err) {
    console.error("fy-runner/fix-contra-sides error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
