// POST /api/admin/fy-runner/backfill-ledger
// body: { financialYearId, apply?: boolean }
// Web port of scripts/fy-cycle.js::backfillLedger. Bills/payments made
// before accounting was turned on for a society exist in the sub-ledger
// (Bill/Transaction) but never reached the double-entry books. Scan/apply
// logic lives in lib/accounting/backfillLedger.js — the fiscalConfig setup
// step calls the same function automatically the moment accounting is
// switched on, so this route is now the manual/on-demand path for older
// gaps rather than the only way to close one.
// apply:false (default) = scan only. apply:true = actually posts.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import FinancialYear from "@/models/FinancialYear";
import { backfillMissingLedgerEntries } from "@/lib/accounting/backfillLedger";

export async function POST(request) {
  const gate = await authorize(request, "finance.accounting.manage");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const societyId = gate.context.societyId;
    const apply = !!body.apply;

    const fy = await FinancialYear.findOne({ _id: body.financialYearId, societyId, isDeleted: false }).lean();
    if (!fy) return NextResponse.json({ error: "Financial Year not found" }, { status: 404 });

    const result = await backfillMissingLedgerEntries({
      societyId,
      financialYear: fy,
      actorUserId: String(gate.context.userId),
      apply,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("fy-runner/backfill-ledger error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
