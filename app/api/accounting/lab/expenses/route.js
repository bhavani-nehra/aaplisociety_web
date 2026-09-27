import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import ChartOfAccount from "@/models/ChartOfAccount";
import FinancialYear from "@/models/FinancialYear";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap";
import { authorize } from "@/lib/rbac/authorize";

// POST /api/accounting/lab/expenses
//
// The Lab could only ever put money IN (billing/receipts) - there was no way
// to record what the society actually SPENT, so the Income & Expenditure
// Account only ever showed Maintenance/Interest Income with nothing on the
// Expenditure side.
//
// ---------------------------------------------------------------------------
// CHANGES IN THIS REVISION
// ---------------------------------------------------------------------------
// 1. EXPENSE_CODES widened from 9 heads (5001-5009) to the full ~20 the
//    statutory reference Expenditure side prints (5001-5023, excluding 5020
//    Depreciation which is posted by the Asset Register, never by hand - it
//    would double-count against per-asset depreciation).
//
// 2. NEW `incomeEntries`: non-member income (Bank Interest, Misc. Income,
//    Parking, Non-occupancy, Scrap Sale ...) can now be posted too, so the
//    Income side shows the same spread as the reference instead of only
//    Maintenance + Interest on Arrears. Dr Cash/Bank, Cr income head.
//
// 3. NEW `fundingCode`: choose whether spend leaves Cash in Hand (1001) or
//    Cash at Bank (1002). Previously hard-wired to 1001, which is what made
//    Cash look untouched while Bank went to -2,25,000 in the reference run.
//
// 4. Idempotency key now includes a stable fingerprint of the actual entries,
//    not just the total. Two different expense mixes that happen to sum to the
//    same rupee value used to collide and the second one silently no-op'd,
//    returning the FIRST voucher, which looked exactly like "my expenses never
//    posted".
//
// One MANUAL_ADJUSTMENT voucher per call, always internally balanced.
//   expenses: Dr each expense head, Cr funding account (total)
//   income:   Dr funding account (total), Cr each income head

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 5020 (Depreciation) is deliberately EXCLUDED - it is charged by the Asset
// Register via runDepreciation() and broken out per asset on the I&E. Allowing
// a manual entry here would double-count it.
const EXPENSE_CODES = [
  "5001", "5002", "5003", "5004", "5005", "5006", "5007", "5008", "5009",
  "5010", "5011", "5012", "5013", "5014", "5015", "5016", "5017", "5018",
  "5019", "5021", "5022", "5023",
];

// Non-member income heads. 4001 (Members Contribution - Rep.& Maint.) and 4002
// (Interest on Arrears) are excluded: those are posted by the billing engine
// from real bills, so a manual entry would inflate income the members were
// never actually charged.
const INCOME_CODES = ["4003", "4004", "4005", "4006", "4007", "4008", "4009", "4010", "4011", "4012", "4013"];

const FUNDING_CODES = ["1001", "1002"];

/** Stable fingerprint of a code->amount map, so distinct mixes get distinct idempotency keys. */
function fingerprint(map) {
  return Object.keys(map)
    .sort()
    .map((k) => `${k}=${round2(map[k])}`)
    .join(",");
}

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

export async function GET(request)  {
  // Lab tooling is dev/staging-only. In production return 404 (not 403) so
  // the route does not even confirm its own existence.
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  const gate = await authorize(request, "society.systemTests.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const accounts = await ChartOfAccount.find({
      societyId: auth.user.societyId,
      isDeleted: false,
      code: { $in: [...EXPENSE_CODES, ...INCOME_CODES, ...FUNDING_CODES] },
    })
      .select("code name type")
      .sort({ code: 1 })
      .lean();

    return NextResponse.json({
      accounts: accounts.filter((a) => EXPENSE_CODES.includes(a.code)),
      incomeAccounts: accounts.filter((a) => INCOME_CODES.includes(a.code)),
      fundingAccounts: accounts.filter((a) => FUNDING_CODES.includes(a.code)),
    });
  } catch (error) {
    console.error("Lab expenses GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
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

    const entries = body.entries || {};
    const incomeEntries = body.incomeEntries || {};

    const config = await getFiscalConfig(societyId);
    if (!config.enabled) {
      return NextResponse.json(
        { error: "Accounting is not enabled for this society - run Setup first." },
        { status: 409 },
      );
    }

    const expenseCodes = Object.keys(entries).filter((c) => round2(entries[c]) > 0);
    const incomeCodes = Object.keys(incomeEntries).filter((c) => round2(incomeEntries[c]) > 0);

    if (!expenseCodes.length && !incomeCodes.length) {
      return NextResponse.json({ error: "Enter at least one expense or income amount." }, { status: 400 });
    }

    const badExpense = expenseCodes.filter((c) => !EXPENSE_CODES.includes(c));
    if (badExpense.length) {
      return NextResponse.json(
        { error: `Not a postable expense head: ${badExpense.join(", ")}. Depreciation (5020) is charged from Step 3, not here.` },
        { status: 400 },
      );
    }
    const badIncome = incomeCodes.filter((c) => !INCOME_CODES.includes(c));
    if (badIncome.length) {
      return NextResponse.json(
        { error: `Not a postable income head: ${badIncome.join(", ")}. Member billing income comes from Step 5.` },
        { status: 400 },
      );
    }

    const fundingCode = FUNDING_CODES.includes(body.fundingCode) ? body.fundingCode : "1001";

    const fundingAccount = await ChartOfAccount.findOne({ societyId, isDeleted: false, code: fundingCode })
      .select("_id name")
      .lean();
    if (!fundingAccount) {
      return NextResponse.json(
        { error: `Funding account (${fundingCode}) is missing - re-run Setup.` },
        { status: 409 },
      );
    }

    const allCodes = [...expenseCodes, ...incomeCodes];
    const accounts = await ChartOfAccount.find({ societyId, isDeleted: false, code: { $in: allCodes } })
      .select("code name")
      .lean();
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const missing = allCodes.filter((c) => !byCode.has(c));
    if (missing.length) {
      return NextResponse.json(
        { error: `Unknown account code(s): ${missing.join(", ")} - re-run Setup to seed the full Chart of Accounts.` },
        { status: 400 },
      );
    }

    const date = body.date ? new Date(body.date) : new Date();
    const financialYear = await FinancialYear.findOne({
      societyId,
      isDeleted: false,
      startDate: { $lte: date },
      endDate: { $gte: date },
    });
    if (!financialYear) {
      return NextResponse.json({ error: "No Financial Year covers that date." }, { status: 409 });
    }

    const lines = [];
    let expenseTotal = 0;
    let incomeTotal = 0;

    for (const code of expenseCodes) {
      const acc = byCode.get(code);
      const amount = round2(entries[code]);
      expenseTotal = round2(expenseTotal + amount);
      lines.push({
        accountId: String(acc._id),
        side: "Debit",
        amount,
        narration: `Expense - ${acc.name}`,
      });
    }

    for (const code of incomeCodes) {
      const acc = byCode.get(code);
      const amount = round2(incomeEntries[code]);
      incomeTotal = round2(incomeTotal + amount);
      lines.push({
        accountId: String(acc._id),
        side: "Credit",
        amount,
        narration: `Income - ${acc.name}`,
      });
    }

    // Net the two sides against the single funding account so the voucher is
    // balanced whichever way round it falls.
    const net = round2(expenseTotal - incomeTotal);
    if (net > 0) {
      lines.push({
        accountId: String(fundingAccount._id),
        side: "Credit",
        amount: net,
        narration: `Net paid from ${fundingAccount.name}`,
      });
    } else if (net < 0) {
      lines.push({
        accountId: String(fundingAccount._id),
        side: "Debit",
        amount: Math.abs(net),
        narration: `Net received into ${fundingAccount.name}`,
      });
    }
    // net === 0: expenses exactly offset income, no cash movement, still balanced.

    const fp = hash(`${fingerprint(entries)}|${fingerprint(incomeEntries)}|${fundingCode}`);

    const event = createAccountingEvent({
      type: EVENT_TYPES.MANUAL_ADJUSTMENT,
      societyId,
      financialYearId: financialYear._id,
      sourceModule: "Manual",
      sourceRef: financialYear._id,
      actorUserId: auth.user.userId,
      idempotencyKey: `lab-expense:${financialYear._id}:${date.toISOString().slice(0, 10)}:${fp}`,
      payload: {
        lines,
        date,
        narration: "Operating expenses / other income entered via Accounting Lab",
      },
    });

    const result = await engineProcess(event);

    return NextResponse.json({
      posted: true,
      voucher: result?.voucher || null,
      // idempotentHit tells the UI "this exact mix was already posted" instead of
      // silently implying a fresh voucher was written.
      idempotentHit: !!result?.idempotentHit,
      lineCount: lines.length,
      total: expenseTotal,
      expenseTotal,
      incomeTotal,
      netCashMovement: net,
      fundingAccount: fundingAccount.name,
    });
  } catch (error) {
    console.error("Lab expenses error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: error.status || 500 },
    );
  }
}