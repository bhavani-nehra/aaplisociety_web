// POST /api/admin/fy-runner/import-expenses
// body: { rows: [{ date, category, amount, paymentMethod, vendor, referenceNo, description }], financialYearId }
//
// Bulk version of POST /api/expenses (same validation, same postExpenseToBooks
// call) for the FY Runner's year-close flow — the CLI equivalent
// (scripts/fy-cycle.js::importExpenses) reads a CSV file on disk; this reads
// rows pasted/typed in the UI instead. Every row is independent: one bad row
// never blocks the rest, same as the script's per-row problem list.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Expense from "@/models/Expense";
import FinancialYear from "@/models/FinancialYear";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";
import { postExpenseToBooks } from "@/lib/accounting/expenseBridge";

const VALID_CATEGORIES = new Set([
  "Salary", "Security", "Housekeeping", "Repairs & Maintenance", "Electricity",
  "Water", "Lift/Elevator", "Garden", "Legal & Professional", "Audit",
  "Insurance", "Property Tax", "Bank Charges", "Festival & Events", "Miscellaneous",
]);
const VALID_METHODS = new Set(["Cash", "Cheque", "Online", "NEFT", "UPI", "Card", "Other"]);

export async function POST(request) {
  const gate = await authorize(request, "finance.expenditure.create");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const body = await request.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      return NextResponse.json({ error: "rows[] is required" }, { status: 400 });
    }
    if (rows.length > 500) {
      return NextResponse.json({ error: "Max 500 rows per import" }, { status: 400 });
    }

    let fy = null;
    if (body.financialYearId) {
      fy = await FinancialYear.findOne({ _id: body.financialYearId, societyId: gate.context.societyId, isDeleted: false }).lean();
      if (!fy) return NextResponse.json({ error: "Financial Year not found" }, { status: 404 });
    }

    const posted = [];
    const problems = [];
    let totalAmount = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const rowNum = i + 1;

      if (!VALID_CATEGORIES.has(String(r.category))) {
        problems.push({ row: rowNum, error: `Invalid category "${r.category}"` });
        continue;
      }
      const amount = Number(r.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        problems.push({ row: rowNum, error: `Amount "${r.amount}" must be a positive number` });
        continue;
      }
      const date = r.date ? new Date(r.date) : null;
      if (!date || isNaN(date.getTime())) {
        problems.push({ row: rowNum, error: `"${r.date}" is not a valid date` });
        continue;
      }
      if (fy && (date < new Date(fy.startDate) || date > new Date(fy.endDate))) {
        problems.push({ row: rowNum, error: `${r.date} is outside ${fy.label}` });
        continue;
      }
      const paymentMethod = VALID_METHODS.has(r.paymentMethod) ? r.paymentMethod : "Online";
      const periodId = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
      const referenceNo = String(r.referenceNo || "").trim();

      // Same dedupe convention as scripts/fy-cycle.js::importExpenses — a
      // referenceNo that already exists means this row was already imported.
      if (referenceNo) {
        const dup = await Expense.findOne({ societyId: gate.context.societyId, referenceNo, isDeleted: { $ne: true } }).select("_id").lean();
        if (dup) {
          problems.push({ row: rowNum, error: `referenceNo "${referenceNo}" already imported — skipped` });
          continue;
        }
      }

      const expense = await Expense.create({
        societyId: gate.context.societyId,
        category: r.category,
        amount: +amount.toFixed(2),
        date,
        periodId,
        paymentMethod,
        vendor: String(r.vendor || "").trim(),
        referenceNo: referenceNo || undefined,
        description: String(r.description || "").trim(),
        createdBy: gate.context.userId,
        createdByName: gate.context.name || gate.context.email || "",
      });

      const accounting = await postExpenseToBooks({
        societyId: gate.context.societyId,
        expense,
        actorUserId: gate.context.userId,
      });
      if (accounting.posted) {
        expense.voucherId = accounting.voucherId || null;
        expense.postedToBooksAt = new Date();
        expense.notPostedReason = null;
      } else {
        expense.notPostedReason = accounting.reason;
      }
      await expense.save().catch((e) => console.error("fy-runner import-expenses post-state save failed", e));

      posted.push({ row: rowNum, expenseId: String(expense._id), amount: expense.amount, category: expense.category, postedToBooks: accounting.posted, notPostedReason: accounting.posted ? null : accounting.reason });
      totalAmount += expense.amount;
    }

    if (posted.length) {
      await logAudit(gate.context.userId, gate.context.societyId, "EXPENSE_BULK_IMPORTED", null, {
        count: posted.length,
        totalAmount: +totalAmount.toFixed(2),
        problemCount: problems.length,
      });
    }

    return NextResponse.json({
      success: true,
      posted: posted.length,
      totalAmount: +totalAmount.toFixed(2),
      results: posted,
      problems,
    });
  } catch (err) {
    console.error("fy-runner/import-expenses error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
