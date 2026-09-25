import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { isDuplicateKeyError } from "@/lib/mongoErrors";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Receipt from "@/models/Receipt";
import Society from "@/models/Society";
import PaymentImport from "@/models/PaymentImport";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import { validatePaymentRows } from "../../../../utils/excelValidator";
import { getFinancialYear } from "@/lib/date-utils";
import { parseXlsxSafely, neutralizeCell, worksheetToJson } from "@/lib/excelParse";
import crypto from "node:crypto";
import cache from "@/lib/cache";
import { recordPayment, PaymentServiceError } from "@/lib/services/PaymentService";
import { notifyPaymentReceived } from "@/lib/v1/notify";
import { mapLimit } from "@/lib/concurrency";
import { ndjsonResponse } from "@/lib/ndjson-stream";
import { authorize } from "@/lib/rbac/authorize";

// Confirm was previously one sequential `for` loop over every payment row —
// for 84 rows at several Mongo round trips each (member/bill lookups,
// transaction + receipt writes, notification) that serialized to minutes.
// Each row targets a different member/bill, so processing rows concurrently
// is safe; only cap concurrency to protect the DB connection pool.
const CONCURRENCY = 8;
function twoDp(n) {
  return parseFloat((Number(n) || 0).toFixed(2));
}
function parseExcelDate(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  // XLSX serial number: days since 1899-12-30
  if (typeof val === "number") {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(val).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s);
  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split("-");
    return new Date(`${yyyy}-${mm}-${dd}`);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
// In-memory staging for preview→confirm flow
// Preview staging lives in redis (lib/cache), NOT module memory: preview and
// confirm routinely land on DIFFERENT lambda instances, and the old
// `const staged = {}` silently lost every cross-instance confirm
// ("Session expired. Re-upload file."). TTL bounds abandoned previews.
const STAGE_TTL_SECONDS = 15 * 60;
const stageKey = (batchKey) => `payimport:${batchKey}`;
export async function POST(request) {
  const gate = await authorize(request, "finance.payment.upload");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    if (decoded.role === "Accountant" || decoded.role === "Member") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 },
      );
    }
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action") || "preview";
    // ── PREVIEW ─────────────────────────────────────────────────────────────
    if (action === "preview") {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file)
        return NextResponse.json(
          { error: "No file uploaded" },
          { status: 400 },
        );
      const bytes = Buffer.from(await file.arrayBuffer());
      const parsed = await parseXlsxSafely(bytes);
      if (parsed.error)
        return NextResponse.json({ error: parsed.error }, { status: parsed.status });
      const rows = worksheetToJson(parsed.worksheet, { defval: "" }).map((r) =>
        Object.fromEntries(Object.entries(r).map(([k, v]) => [k, neutralizeCell(v)])),
      );
      if (!rows.length)
        return NextResponse.json({ error: "Empty file" }, { status: 400 });
      // Validate required columns — accept merged "Wing-FlatNo" or legacy separate Wing+FlatNo
      const headers = Object.keys(rows[0]);
      const hasMergedCol = headers.includes("Wing-FlatNo");
      const hasLegacyCols = headers.includes("Wing") && headers.includes("FlatNo");
      if (!hasMergedCol && !hasLegacyCols) {
        return NextResponse.json(
          { error: "Missing column: Wing-FlatNo (or legacy Wing and FlatNo columns)" },
          { status: 400 },
        );
      }
      const otherRequired = ["AmountPaid", "PaymentDate"];
      const missing = otherRequired.filter((c) => !headers.includes(c));
      if (missing.length) {
        return NextResponse.json(
          { error: `Missing columns: ${missing.join(", ")}` },
          { status: 400 },
        );
      }
      // Normalize Period → Month/Year if needed
      const hasPeriodCol = headers.includes("Period");
      if (hasPeriodCol) {
        rows.forEach((r) => {
          if (r.Period && !r.Month) {
            const [y, m] = String(r.Period).split("-");
            r.Year = parseInt(y);
            r.Month = parseInt(m);
          }
        });
      }
      const [members, society] = await Promise.all([
        Member.find({ societyId: decoded.societyId, isDeleted: { $ne: true } })
          .select(
            "_id flatNo wing ownerName openingPrincipal openingInterest advanceCredit",
          )
          .lean(),
        Society.findById(decoded.societyId).select("config").lean(),
      ]);
      const memberMap = new Map(members.map((m) => [m._id.toString(), m]));
      const wingFlatMap = new Map(
        members.map((m) => [
          `${(m.wing || "").trim().toLowerCase()}-${(m.flatNo || "").trim().toLowerCase()}`,
          m,
        ]),
      );
      const preview = [];
      const errors = [];
      let totalAmount = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        // Support both merged "Wing-FlatNo" and legacy separate Wing/FlatNo columns
        const wingFlatRaw = String(row["Wing-FlatNo"] || "").trim();
        let wing, flatNo;
        if (wingFlatRaw) {
          const dashIdx = wingFlatRaw.indexOf("-");
          wing = dashIdx > 0 ? wingFlatRaw.slice(0, dashIdx).trim() : wingFlatRaw;
          flatNo = dashIdx > 0 ? wingFlatRaw.slice(dashIdx + 1).trim() : "";
        } else {
          wing = String(row.Wing || "").trim();
          flatNo = String(row.FlatNo || "").trim();
        }
        // Skip instruction row
        if (wing.startsWith("⚠") || wingFlatRaw.startsWith("⚠") || (!wing && !flatNo)) continue;
        // Skip rows with no payment
        const _amtRaw = String(row.AmountPaid ?? "").trim();
        if (!_amtRaw) continue;
        const flatKey = `${wing.toLowerCase()}-${flatNo.toLowerCase()}`;
        const member = wingFlatMap.get(flatKey);
        const memberId = member?._id.toString();
        const amountPaid = twoDp(parseFloat(row.AmountPaid) || 0);
        const month = parseInt(row.Month);
        const year = parseInt(row.Year);
        const paymentDate = parseExcelDate(row.PaymentDate) || new Date();
        const paymentMethod = String(row.PaymentMethod || "Cash").trim();
        const remarks = String(row.Remarks || "").trim();
        const rowErrors = [];
        if (!member) rowErrors.push(`Flat "${wing}-${flatNo}" not found`);
        if (amountPaid <= 0) rowErrors.push("AmountPaid must be > 0");
        if (isNaN(month) || month < 1 || month > 12)
          rowErrors.push("Month must be 1–12");
        if (isNaN(year) || year < 2000) rowErrors.push("Invalid Year");
        if (isNaN(paymentDate?.getTime()))
          rowErrors.push("Invalid PaymentDate");
        // Duplicate check
        const dupInBatch = preview.find(
          (p) =>
            p.memberId === memberId &&
            p.month === month &&
            p.year === year &&
            p.status !== "Failed",
        );
        if (dupInBatch) rowErrors.push("Duplicate row for same flat+period");
        if (rowErrors.length) {
          errors.push({ rowNum, errors: rowErrors });
          preview.push({
            rowNum,
            memberId,
            amountPaid,
            month,
            year,
            memberName: member?.ownerName || "?",
            flat: member ? `${member.wing}-${member.flatNo}` : "?",
            paymentDate: paymentDate.toISOString().split("T")[0],
            paymentMethod,
            remarks,
            status: "Failed",
            errors: rowErrors,
          });
          continue;
        }
        totalAmount += amountPaid;
        const billPeriodId = `${year}-${String(month).padStart(2, "0")}`;
        const bill = await Bill.findOne({
          memberId,
          societyId: decoded.societyId,
          billPeriodId,
          isDeleted: { $ne: true },
        })
          .select(
            "totalBillDue totalAmount billPrincipalBalance billInterestBalance principalBalance interestBalance balanceAmount advanceApplied amountPaid status",
          )
          .lean();
        const billDue = twoDp(bill?.totalBillDue || bill?.totalAmount || 0);
        const alreadyPaid = twoDp(bill?.amountPaid || 0);
        // Use live balanceAmount (net of advance) — falls back to gross - paid for new bills
        const remaining = twoDp(
          bill?.balanceAmount != null
            ? Math.max(0, bill.balanceAmount)
            : Math.max(0, billDue - alreadyPaid),
        );
        preview.push({
          rowNum,
          memberId,
          memberName: member.ownerName,
          flat: `${member.wing}-${member.flatNo}`,
          billPeriodId,
          month,
          year,
          amountPaid,
          paymentDate: paymentDate.toISOString().split("T")[0],
          paymentMethod,
          remarks,
          billDue,
          alreadyPaid,
          remaining,
          billFound: !!bill,
          billStatus: bill?.status || "No Bill",
          willOverpay: amountPaid > remaining && remaining > 0,
          status: "Valid",
          errors: [],
        });
      }
      const batchKey = `${decoded.societyId}-${Date.now()}`;
      await cache.set(stageKey(batchKey), { rows: preview, decoded, fileName: file.name }, STAGE_TTL_SECONDS);
      // Build bill map keyed by wing-flatno for grid validation (overpayment + tamper detection)
      const billMap = new Map();
      for (const p of preview) {
        if (p.status === "Valid") {
          // Find the bill we fetched to pass tamper-check fields
          const bill = await Bill.findOne({
            memberId: p.memberId,
            societyId: decoded.societyId,
            billPeriodId: p.billPeriodId,
            isDeleted: { $ne: true },
          })
            .select("totalBillDue openingPrincipal openingInterest balanceAmount")
            .lean();
          billMap.set(p.flat.toLowerCase(), {
            balanceAmount: p.remaining,
            totalBillDue: bill?.totalBillDue ?? p.billDue,
            openingPrincipal: bill?.openingPrincipal ?? null,
            openingInterest: bill?.openingInterest ?? null,
          });
        }
      }
      const { gridRows, summary: gridSummary } = validatePaymentRows(rows, {
        wingFlatMap,
        existingBillMap: billMap,
        today: new Date(),
      });
      const gridColumns = Object.keys(rows[0] || {});
      return NextResponse.json({
        success: true,
        batchKey,
        totalRows: rows.length,
        validRows: preview.filter((r) => r.status === "Valid").length,
        failedRows: errors.length,
        totalAmount,
        preview,
        errors,
        gridRows,
        gridColumns,
        gridSummary,
      });
    }
    // ── CONFIRM ──────────────────────────────────────────────────────────────
    if (action === "confirm") {
      const { batchKey, notes } = await request.json();
      const batch = await cache.get(stageKey(batchKey));
      if (!batch)
        return NextResponse.json(
          { error: "Session expired. Re-upload file." },
          { status: 400 },
        );
      const { rows, decoded: dec, fileName } = batch;
      const validRows = rows.filter((r) => r.status === "Valid");
      if (!validRows.length)
        return NextResponse.json(
          { error: "No valid rows to process" },
          { status: 400 },
        );

      const periodId = validRows[0].billPeriodId;
      const importMonth = validRows[0].month;
      const importYear = validRows[0].year;

      // ── Import-level idempotency ───────────────────────────────────────────
      // A content signature (society + each row's member/period/amount/date) is
      // stored with a unique index. Re-uploading the same file — even in a brand
      // new request — is rejected, so a payment can never be applied twice.
      const contentHash = crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            String(dec.societyId),
            ...validRows.map((r) => [
              String(r.memberId),
              r.billPeriodId,
              twoDp(r.amountPaid),
              r.paymentDate,
            ]),
          ]),
        )
        .digest("hex");

      const importPayload = {
        societyId: dec.societyId,
        importMonth,
        importYear,
        billPeriodId: periodId,
        uploadedFileName: fileName,
        uploadedBy: dec.userId,
        contentHash,
        totalRows: validRows.length,
        status: "Processing",
      };
      let importRecord;
      try {
        importRecord = await PaymentImport.create(importPayload);
      } catch (e) {
        if (!isDuplicateKeyError(e)) throw e;
        // A prior import with the same content signature exists. Only BLOCK the
        // re-upload if that prior attempt actually applied money. If the first
        // attempt failed before applying any payment (successRows=0 AND
        // totalAmountUploaded=0 -- e.g. it errored on "No live bill found"), the
        // stale record is deleted and we retry, so a failed upload is never a
        // permanent dead end.
        const prior = await PaymentImport.findOne({
          societyId: dec.societyId,
          contentHash,
        });
        const priorApplied =
          prior &&
          ((prior.successRows || 0) > 0 || (prior.totalAmountUploaded || 0) > 0);
        if (priorApplied) {
          await cache.del(stageKey(batchKey));
          return NextResponse.json(
            {
              error:
                "This payment file was already imported and payments were recorded. Duplicate uploads are blocked to prevent double payments.",
            },
            { status: 409 },
          );
        }
        if (prior) await PaymentImport.deleteOne({ _id: prior._id });
        importRecord = await PaymentImport.create(importPayload);
      }

      async function processRow(row) {
        const member = await Member.findById(row.memberId).lean();
        if (!member) throw new Error("Member not found");

        // The single canonical bill for this member + period (Ledger V2).
        // Root-cause fix: bulk-onboarded societies' current bills ARE tagged
        // importedFrom:"BulkImport", so the old confirm query (which excluded
        // those + isLocked) found nothing and threw "No live bill found",
        // even though the preview showed the bill as payable. Match the same
        // bill the preview did: the latest non-archived, non-deleted bill.
        const bill = await Bill.findOne({
          memberId: row.memberId,
          societyId: dec.societyId,
          billPeriodId: row.billPeriodId,
          isHistoricalArchive: { $ne: true },
          isDeleted: { $ne: true },
        })
          .sort({ updatedAt: -1 })
          .select("_id balanceAmount status billPeriodId");
        if (!bill) throw new Error(`No live bill found for ${row.billPeriodId}`);

        const balanceBefore = twoDp(bill.balanceAmount);

        // Member-level allocator (lib/services/PaymentService.js#recordPayment):
        // interest-first across every open bill, overpayment to advanceCredit,
        // the ledger Transaction with its running balance and the Journal
        // Entry, all in one Mongo transaction. This route used to allocate
        // against this one bill only, write the Transaction itself and post
        // the ledger afterwards outside any transaction. Re-uploading the same
        // file is still blocked by the PaymentImport content hash above.
        let recorded;
        try {
          recorded = await recordPayment({
            memberId: String(row.memberId),
            societyId: String(dec.societyId),
            amount: twoDp(row.amountPaid),
            paymentMode: row.paymentMethod || "Cash",
            paymentDate: row.paymentDate,
            chequeNo: row.chequeNo,
            bankName: row.bankName,
            upiId: row.upiId,
            notes: `Excel upload for ${row.billPeriodId}${row.remarks ? ` - ${row.remarks}` : ""}`,
            actorUserId: dec.userId,
            actorRole: dec.role,
          });
        } catch (err) {
          if (err instanceof PaymentServiceError) {
            return {
              kind: "skipped",
              entry: {
                memberId: row.memberId,
                flat: row.flat,
                memberName: row.memberName,
                amountPaid: row.amountPaid,
                status: "Skipped",
                errorMessage: err.message,
              },
            };
          }
          throw err;
        }

        const txnId = recorded.transaction.transactionId;
        await Transaction.updateOne(
          { societyId: dec.societyId, transactionId: txnId },
          { $set: { billPeriodId: row.billPeriodId, financialYear: getFinancialYear(new Date(row.paymentDate)) } },
        );
        const paymentTxn = await Transaction.findOne({ societyId: dec.societyId, transactionId: txnId }).select("_id paymentBreakdown").lean();

        // The Excel confirmation is the finalization step: allocation just
        // happened, so clear any prior "Payment Done" acknowledgement marker.
        await Bill.updateOne({ _id: bill._id }, { $set: { pendingPayment: null } });
        const bd = paymentTxn?.paymentBreakdown || {};
        const intClr = twoDp(bd.interestCleared);
        const prinClr = twoDp(bd.principalCleared);
        const advanceCredit = twoDp(bd.advanceCredit);
        const amountApplied = twoDp(twoDp(row.amountPaid) - advanceCredit);
        const ledgerFailed = false;
        const after = await Bill.findById(bill._id).select("balanceAmount").lean();
        const result = { balanceAmount: twoDp(after?.balanceAmount) };

        // Receipt for the bill touched.
        const receiptNos = [];
        if (amountApplied > 0) {
          const nameParts = (member.ownerName || "member").trim().split(/\s+/);
          const nameSlug =
            nameParts.length > 1
              ? `${nameParts[0]}_${nameParts[nameParts.length - 1]}`
              : nameParts[0];
          const flatSlug = `${member.wing || ""}-${member.flatNo || ""}`;
          const filename = `${nameSlug}_${flatSlug}_${bill.billPeriodId}_receipt`.replace(
            /[^a-zA-Z0-9_\-]/g,
            "_",
          );
          const receiptNo = `RCP-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
          await Receipt.create({
            receiptNo,
            filename,
            billId: bill._id,
            billPeriodId: bill.billPeriodId,
            memberId: row.memberId,
            societyId: dec.societyId,
            amount: twoDp(row.amountPaid),
            amountReceived: twoDp(row.amountPaid),
            amountApplied,
            interestApplied: intClr,
            principalApplied: prinClr,
            advanceCreditCreated: advanceCredit,
            remainingBalance: twoDp(result.balanceAmount),
            settlementStatus: result.balanceAmount > 0 ? "Partial" : "Paid",
            previousBalanceSnapshot: balanceBefore,
            paymentMode: row.paymentMethod || "Cash",
            paidAt: new Date(row.paymentDate),
            transactionId: txnId,
            notes: row.remarks,
            status: "Generated",
          });
          receiptNos.push(receiptNo);
        }
        await notifyPaymentReceived({ transactionId: paymentTxn._id, societyId: dec.societyId, memberId: row.memberId, amount: twoDp(row.amountPaid), appliedAmount: amountApplied, advanceCredit, remainingBalance: twoDp(result.balanceAmount), period: row.billPeriodId });

        return {
          kind: "success",
          intClr,
          prinClr,
          advanceCredit,
          amountPaid: row.amountPaid,
          ledgerFailed,
          entry: {
            memberId: row.memberId,
            flat: row.flat,
            memberName: row.memberName,
            amountPaid: row.amountPaid,
            interestCleared: intClr,
            principalCleared: prinClr,
            advanceCredit,
            billId: bill._id,
            receiptNos,
            status: "Success",
          },
        };
      }

      return ndjsonResponse(async (emit) => {
        const importResults = [];
        let totalInterestCleared = 0;
        let totalPrincipalCleared = 0;
        let totalAdvanceCredit = 0;
        let totalAmountProcessed = 0;
        let successCount = 0;
        let failCount = 0;
        let skippedCount = 0;
        let ledgerFailCount = 0;

        await mapLimit(validRows, CONCURRENCY, processRow, (settled, row, done, total) => {
          if (settled.status === "fulfilled") {
            const r = settled.value;
            importResults.push(r.entry);
            if (r.kind === "skipped") {
              skippedCount++;
            } else {
              totalInterestCleared += r.intClr;
              totalPrincipalCleared += r.prinClr;
              totalAdvanceCredit += r.advanceCredit;
              totalAmountProcessed += r.amountPaid;
              successCount++;
              if (r.ledgerFailed) ledgerFailCount++;
            }
            emit({ type: "progress", done, total, flat: row.flat, memberName: row.memberName, ok: r.kind !== "failed", status: r.entry.status });
          } else {
            failCount++;
            importResults.push({
              memberId: row.memberId,
              flat: row.flat,
              memberName: row.memberName,
              amountPaid: row.amountPaid,
              status: "Failed",
              errorMessage: settled.reason.message,
            });
            emit({ type: "progress", done, total, flat: row.flat, memberName: row.memberName, ok: false, error: settled.reason.message });
          }
        });

        await PaymentImport.updateOne(
          { _id: importRecord._id },
          {
            $set: {
              successRows: successCount,
              failedRows: failCount,
              skippedRows: skippedCount,
              totalAmountUploaded: twoDp(totalAmountProcessed),
              totalInterestCleared: twoDp(totalInterestCleared),
              totalPrincipalCleared: twoDp(totalPrincipalCleared),
              totalAdvanceCredit: twoDp(totalAdvanceCredit),
              rows: importResults.map((r) => ({
                memberId: r.memberId,
                flatNo: r.flat?.split("-")[1],
                wing: r.flat?.split("-")[0],
                ownerName: r.memberName,
                amountPaid: r.amountPaid,
                interestCleared: r.interestCleared || 0,
                principalCleared: r.principalCleared || 0,
                advanceCredit: r.advanceCredit || 0,
                billId: r.billId,
                status: r.status,
                errorMessage: r.errorMessage,
              })),
              notes,
              status: "Completed",
            },
          },
        );

        // NOTE (behaviour change): the previous silent `Bill.updateMany(...)` that
        // zeroed historical BulkImport bills has been REMOVED (§17(2) forbids
        // silent recompute-overwrites). History corrections now go exclusively
        // through the audited /superadmin/fix-history-bills workflow.

        await cache.delPattern(`billing:list:${dec.societyId}:*`);
        await cache.del(`payments:outstanding:${dec.societyId}`);
        if (successCount > 0) {
          await cache.delPattern(`v1:bills:${dec.societyId}:member:*`);
          await cache.delPattern(`v1:ledger:${dec.societyId}:member:*`);
          await cache.delPattern(`v1:receipts:${dec.societyId}:member:*`);
        }

        await cache.del(stageKey(batchKey));
        return {
          success: true,
          importId: importRecord._id,
          billPeriodId: periodId,
          totalRows: validRows.length,
          successRows: successCount,
          failedRows: failCount,
          skippedRows: skippedCount,
          totalAmountProcessed: twoDp(totalAmountProcessed),
          totalInterestCleared: twoDp(totalInterestCleared),
          totalPrincipalCleared: twoDp(totalPrincipalCleared),
          totalAdvanceCredit: twoDp(totalAdvanceCredit),
          results: importResults,
          ...(ledgerFailCount > 0
            ? {
                warning: `${ledgerFailCount} payment(s) posted but could not be recorded in Accounting. Fix this on the Vouchers page.`,
                ledgerFailCount,
              }
            : {}),
        };
      });
    }
    return NextResponse.json(
      { error: "Invalid action. Use ?action=preview or ?action=confirm" },
      { status: 400 },
    );
  } catch (err) {
    console.error("upload-payments error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}