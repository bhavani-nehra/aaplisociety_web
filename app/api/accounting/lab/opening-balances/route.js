import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import { authorizeAny } from "@/lib/rbac/authorize";
import ChartOfAccount from "@/models/ChartOfAccount";
import FinancialYear from "@/models/FinancialYear";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { EVENT_TYPES, createAccountingEvent } from "@/lib/accounting/events.js";
import { process as engineProcess } from "@/lib/accounting/AccountingEngine.js";
import "@/lib/accounting/bootstrap";

// POST /api/accounting/lab/opening-balances
//
// The Accounting Lab previously had NO way to enter the society's own
// financial position — Share Capital, Reserve/Sinking/Repair Funds, Land &
// Building, Fixed Assets, Bank Fixed Deposits, Security Deposits and Current
// Liabilities. That is why the Balance Sheet only ever printed Member
// Receivable, Cash and the surplus: nothing else had ever been posted.
//
// This route accepts the society-side figures and posts them as ONE balanced
// OpeningBalance journal voucher through the normal engine (no direct Journal
// Entry writes — §6.10). The difference between total debits and total
// credits is squared off to General Fund, which is standard practice for an
// opening-balance entry.
//
// Body: { entries: { <accountCode>: <amount> }, asOfDate?: string }

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// GET — lists the accounts the Lab lets the user fill, grouped for the form.
export async function GET(request)  {
  // Lab tooling is dev/staging-only. In production return 404 (not 403) so
  // the route does not even confirm its own existence.
  if (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = requireAccounting(request);
  if (!auth.valid) return auth;
  // Read by the System Tests / Accounting Lab page too, not just Opening
  // Balances — same cross-page-dependency pattern as financial-years.
  const gate = await authorizeAny(request, [
    "statements.openingBalances.view",
    "society.systemTests.view",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const accounts = await ChartOfAccount.find({
      societyId: auth.user.societyId,
      isDeleted: false,
      isActive: true,
    })
      .select("code name type subType scheduleCode")
      .sort({ code: 1 })
      .lean();

    const groups = { Asset: [], Liability: [], Equity: [], Income: [], Expense: [] };
    for (const a of accounts) (groups[a.type] ||= []).push(a);
    return NextResponse.json({ accounts, groups });
  } catch (error) {
    console.error("Lab opening-balances GET error:", error);
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
  const gate = await authorizeAny(request, [
    "statements.openingBalances.update",
    "society.systemTests.update",
  ]);
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const societyId = auth.user.societyId;
    const body = await request.json();
    const entries = body.entries || {};

    const config = await getFiscalConfig(societyId);
    if (!config.enabled) {
      return NextResponse.json(
        { error: "Accounting is not enabled for this society — run Setup first." },
        { status: 409 },
      );
    }

    const codes = Object.keys(entries).filter((c) => round2(entries[c]) !== 0);
    if (!codes.length) {
      return NextResponse.json({ error: "Enter at least one opening figure." }, { status: 400 });
    }

    const accounts = await ChartOfAccount.find({ societyId, isDeleted: false, code: { $in: codes } })
      .select("code name type")
      .lean();
    const byCode = new Map(accounts.map((a) => [a.code, a]));

    const asOf = body.asOfDate ? new Date(body.asOfDate) : new Date();
    const financialYear = await FinancialYear.findOne({
      societyId,
      isDeleted: false,
      startDate: { $lte: asOf },
      endDate: { $gte: asOf },
    });
    if (!financialYear) {
      return NextResponse.json(
        { error: "No Financial Year covers that date — run Setup first." },
        { status: 409 },
      );
    }

    // Assets & Expenses carry a Debit opening; Liabilities, Equity & Income a
    // Credit opening. This follows the account's natural side — the user just
    // types a positive figure into the form.
    const lines = [];
    let debits = 0;
    let credits = 0;
    for (const code of codes) {
      const acc = byCode.get(code);
      if (!acc) {
        return NextResponse.json({ error: `Unknown account code "${code}"` }, { status: 400 });
      }
      const amount = round2(entries[code]);
      if (amount <= 0) continue;
      const side = acc.type === "Asset" || acc.type === "Expense" ? "Debit" : "Credit";
      if (side === "Debit") debits = round2(debits + amount);
      else credits = round2(credits + amount);
      lines.push({ accountId: String(acc._id), side, amount, narration: `Opening balance — ${acc.name}` });
    }

    // Square off to General Fund so the voucher is always balanced.
    const diff = round2(debits - credits);
    if (Math.abs(diff) > 0.005) {
      const generalFund = await ChartOfAccount.findOne({ societyId, isDeleted: false, code: "3001" })
        .select("_id name")
        .lean();
      if (!generalFund) {
        return NextResponse.json(
          { error: "General Fund (3001) is missing — re-run Setup so the balancing account exists." },
          { status: 409 },
        );
      }
      lines.push({
        accountId: String(generalFund._id),
        side: diff > 0 ? "Credit" : "Debit",
        amount: Math.abs(diff),
        narration: "Opening balance difference transferred to General Fund",
      });
    }

    const event = createAccountingEvent({
      type: EVENT_TYPES.OPENING_BALANCE,
      societyId,
      financialYearId: financialYear._id,
      sourceModule: "OpeningBalance",
      sourceRef: financialYear._id,
      actorUserId: auth.user.userId,
      // Idempotent per financial year: re-submitting the form replaces nothing
      // and posts nothing twice.
      idempotencyKey: `lab-opening:${financialYear._id}`,
      payload: {
        lines,
        date: asOf,
        narration: "Opening balances entered via Accounting Lab",
      },
    });

    const result = await engineProcess(event);

    return NextResponse.json({
      posted: true,
      voucher: result?.voucher || null,
      lineCount: lines.length,
      totalDebits: debits,
      totalCredits: credits,
      balancingEntry: Math.abs(diff) > 0.005 ? round2(Math.abs(diff)) : 0,
    });
  } catch (error) {
    console.error("Lab opening-balances error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: error.status || 500 },
    );
  }
}