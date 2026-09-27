import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Member from "@/models/Member";
import BillingHead from "@/models/BillingHead";
import Bill from "@/models/Bill";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { parseFirstSheet } from "@/lib/excelParse";
import { validateBillRows, classifyBillUploadRows } from "../../../../utils/excelValidator";
import { authorize } from "@/lib/rbac/authorize";
// Accepts merged "Wing-FlatNo" (new template) OR separate Wing+FlatNo (legacy)
const REQUIRED_MERGED = ["Wing-FlatNo", "Period"];
const REQUIRED_LEGACY = ["Wing", "FlatNo", "Period"];
export async function POST(request) {
  const gate = await authorize(request, "billing.bill.generate");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    const formData = await request.formData();
    const file = formData.get("file");
    const month = parseInt(formData.get("month"));
    const year = parseInt(formData.get("year"));
    const dueDate = formData.get("dueDate");
    if (!file)
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size > 5 * 1024 * 1024)
      return NextResponse.json(
        { error: "File too large. Max 5MB." },
        { status: 400 },
      );
    if (!file.size)
      return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
    const bytes = await file.arrayBuffer();
    let rawRows;
    try {
      rawRows = await parseFirstSheet(Buffer.from(bytes), { defval: "" });
    } catch {
      return NextResponse.json(
        { error: "That file is not a valid Excel workbook. Upload the .xlsx template." },
        { status: 400 },
      );
    }
    // Skip instruction row (Wing-FlatNo or Wing cell starts with ⚠, or all id columns blank)
    const dataRows = rawRows.filter((r) => {
      const wf = String(r["Wing-FlatNo"] || "").trim();
      const w = String(r.Wing || "").trim();
      if (wf.startsWith("⚠") || w.startsWith("⚠")) return false;
      return wf || w || String(r.FlatNo || "").trim();
    });
    const issues = [];
    // Fetch all valid members + billing heads for this society
    const [members, heads] = await Promise.all([
      Member.find({ societyId: decoded.societyId, isDeleted: { $ne: true } })
        .select(
          "_id flatNo wing ownerName carpetAreaSqft builtUpAreaSqft parkingSlots",
        )
        .lean(),
      BillingHead.find({
        societyId: decoded.societyId,
        isActive: true,
        isDeleted: false,
      })
        .sort({ order: 1 })
        .lean(),
    ]);
    const memberMap = {};
    const wingFlatMap = {};
    members.forEach((m) => {
      memberMap[m._id.toString()] = m;
      const key = `${(m.wing || "").trim().toLowerCase()}-${(m.flatNo || "").trim().toLowerCase()}`;
      wingFlatMap[key] = m;
    });
    // Check required columns — accept merged "Wing-FlatNo" (new) or separate Wing+FlatNo (legacy)
    const excelCols = Object.keys(dataRows[0] || {});
    const hasMergedWingFlat = excelCols.includes("Wing-FlatNo");
    const REQUIRED_COLS = hasMergedWingFlat ? REQUIRED_MERGED : REQUIRED_LEGACY;
    for (const col of REQUIRED_COLS) {
      if (!excelCols.includes(col)) {
        issues.push({
          row: null,
          type: "error",
          message: `Missing required column: "${col}"`,
          fix: `Add a column named exactly "${col}" to your Excel file.`,
        });
      }
    }
    if (issues.filter((i) => i.type === "error").length > 0) {
      return NextResponse.json({
        canProceed: false,
        errorCount: issues.length,
        warningCount: 0,
        duplicateCount: 0,
        issues,
      });
    }
    // Mode is decided PER ROW, not per file — a single upload may legitimately
    // mix a flat that needs a new bill generated with a flat that's already
    // billed and just needs its payment recorded. Collect every distinct
    // period referenced in the file (falling back to the form's month/year
    // for rows that left Period blank) and fetch existing bills across all
    // of them in one query, keyed by memberId+period.
    const defaultPeriodId = `${year}-${String(month).padStart(2, "0")}`;
    const periodsInFile = new Set([defaultPeriodId]);
    for (const row of dataRows) {
      const p = String(row.Period || "").trim();
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) periodsInFile.add(p);
    }
    const existingBills = await Bill.find({
      societyId: decoded.societyId,
      billPeriodId: { $in: [...periodsInFile] },
    })
      .select("memberId billPeriodId")
      .lean();
    const alreadyBilledSet = new Set(
      existingBills.map((b) => `${b.memberId}|${b.billPeriodId}`),
    );
    const { issues: rowIssues, validBills, alreadyBilledRows, comparison } = classifyBillUploadRows(
      dataRows,
      { wingFlatMap, memberMap, heads, alreadyBilledSet, defaultPeriodId },
    );
    issues.push(...rowIssues);
    const errorCount = issues.filter((i) => i.type === "error").length;
    const warningCount = issues.filter((i) => i.type === "warning").length;
    const duplicateCount = issues.filter((i) => i.type === "duplicate").length;
    const diffCount = comparison.filter((r) => r.hasDiff).length;
    const diffIssues = comparison
      .filter((r) => r.hasDiff)
      .map((r) => ({
        type: "diff",
        memberId: r.memberId,
        flat: r.flat,
        name: r.name,
        excelTotal: r.excelTotal,
        autoTotal: r.autoTotal,
        diff: parseFloat((r.excelTotal - r.autoTotal).toFixed(2)),
        why: "Excel subtotal differs from system auto-calculation",
        fix: "Verify charges in your Excel match the billing head rates, or approve if intentional override",
      }));
    const errors = issues.filter((i) => i.type === "error");
    const warnings = issues.filter((i) => i.type === "warning");
    const canProceed = errorCount === 0 && warningCount === 0;
    // Build per-cell grid for ExcelPreviewGrid
    const { gridRows, summary: gridSummary } = validateBillRows(dataRows, {
      wingFlatMap,
      billPeriodId: defaultPeriodId,
      expectedColumns: hasMergedWingFlat ? ["Wing-FlatNo", "Period"] : ["Wing", "FlatNo", "Period"],
    });
    const gridColumns = Object.keys(dataRows[0] || {});
    // Detect if any row has AmountPaid filled — unified template dual-mode detection
    const hasPaymentData = dataRows.some(r => String(r.AmountPaid ?? "").trim() !== "");
    return NextResponse.json({
      success: true,
      hasPaymentData,
      canProceed,
      blockReason: !canProceed
        ? `${errorCount} error(s) and ${warningCount} warning(s) must be resolved before generating.`
        : null,
      validCount: validBills.length,
      alreadyBilledCount: alreadyBilledRows.length,
      alreadyBilledRows,
      errors: errors.map((e) => ({
        row: e.row,
        message: e.message,
        fix: e.fix,
      })),
      errorCount,
      warnings: warnings.map((w) => ({
        row: w.row,
        message: w.message,
        fix: w.fix,
      })),
      warningCount,
      duplicateCount,
      diffCount,
      issues: [...issues, ...diffIssues],
      bills: validBills,
      comparison,
      gridRows,
      gridColumns,
      gridSummary,
    });
  } catch (err) {
    console.error("validate-excel error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
