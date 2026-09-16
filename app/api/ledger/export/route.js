import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Transaction from "@/models/Transaction";
// Registers the User schema in this lambda so populate("createdBy") cannot
// throw MissingSchemaError (was returning 500 on ledger/payment fetches).
import User from "@/models/User";
void User;
import Member from "@/models/Member";
import Society from "@/models/Society";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
export async function GET(request) {
  try {
    const gate = await authorize(request, "finance.ledger.export");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "xlsx";
    // Build query
    if (!decoded.societyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const query = { societyId: decoded.societyId };
    const memberId = searchParams.get("memberId");
    const category = searchParams.get("category");
    const txnType = searchParams.get("type");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const billPeriod = searchParams.get("billPeriod");
    const wing = searchParams.get("wing");
    const paymentMode = searchParams.get("paymentMode");
    const financialYear = searchParams.get("financialYear");
    if (memberId && memberId !== "all") query.memberId = memberId;
    if (category && category !== "all") query.category = category;
    if (txnType && txnType !== "all") query.type = txnType;
    const filterMonth = searchParams.get("month");
    const filterYear = searchParams.get("year");
    // If month/year filters are used, they override startDate/endDate
    if (filterMonth && filterYear) {
      // Both selected: specific month of specific year
      const year = parseInt(filterYear);
      const month = parseInt(filterMonth) - 1; // 0-indexed
      const monthStart = new Date(year, month, 1);
      const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);
      query.date = { $gte: monthStart, $lte: monthEnd };
    } else if (filterYear && !filterMonth) {
      // Only year selected: whole year
      const year = parseInt(filterYear);
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
      query.date = { $gte: yearStart, $lte: yearEnd };
    } else if (filterMonth && !filterYear) {
      // Only month selected: that month across ALL years
      // Use $expr to match month from date field
      const month = parseInt(filterMonth);
      query.$expr = {
        $eq: [{ $month: "$date" }, month],
      };
    } else {
      if (startDate) query.date = { ...query.date, $gte: new Date(startDate) };
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.date = { ...query.date, $lte: end };
      }
    }
    if (billPeriod && billPeriod !== "all") query.billPeriodId = billPeriod;
    if (paymentMode && paymentMode !== "all") query.paymentMode = paymentMode;
    if (financialYear && financialYear !== "all")
      query.financialYear = financialYear;
    const transactions = await Transaction.find(query)
      .populate("memberId", "flatNo wing ownerName")
      .populate("createdBy", "name email")
      .sort({ date: -1, createdAt: -1 })
      .lean();
    const society = await Society.findById(decoded.societyId).lean();
    // ===== EXCEL EXPORT =====
    if (format === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Ledger");
      worksheet.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Transaction ID", key: "transactionId", width: 20 },
        { header: "Member", key: "member", width: 25 },
        { header: "Category", key: "category", width: 15 },
        { header: "Type", key: "type", width: 10 },
        { header: "Description", key: "description", width: 40 },
        { header: "Payment Mode", key: "paymentMode", width: 12 },
        { header: "Debit (₹)", key: "debit", width: 12 },
        { header: "Credit (₹)", key: "credit", width: 12 },
        { header: "Balance (₹)", key: "balance", width: 15 },
        { header: "Created By", key: "createdBy", width: 20 },
      ];
      worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      worksheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4F46E5" },
      };
      transactions.forEach((t) => {
        worksheet.addRow({
          date: new Date(t.date).toLocaleDateString("en-IN"),
          transactionId: t.transactionId,
          member: t.memberId
            ? `${t.memberId.wing}-${t.memberId.flatNo} ${t.memberId.ownerName}`
            : "",
          category: t.category,
          type: t.type,
          description: t.description,
          paymentMode: t.paymentMode || "",
          debit: t.type === "Debit" ? t.amount : "",
          credit: t.type === "Credit" ? t.amount : "",
          balance: `${Math.abs(t.balanceAfterTransaction)} ${
            t.balanceAfterTransaction >= 0 ? "DR" : "CR"
          }`,
          createdBy: t.createdBy?.name || "",
        });
      });
      const totalDebit = transactions
        .filter((t) => t.type === "Debit")
        .reduce((sum, t) => sum + t.amount, 0);
      const totalCredit = transactions
        .filter((t) => t.type === "Credit")
        .reduce((sum, t) => sum + t.amount, 0);
      worksheet.addRow({});
      const summaryRow = worksheet.addRow({
        date: "",
        transactionId: "",
        member: "",
        category: "",
        type: "",
        description: "TOTAL",
        paymentMode: "",
        debit: totalDebit,
        credit: totalCredit,
        balance: `${Math.abs(totalDebit - totalCredit)} ${
          totalDebit - totalCredit >= 0 ? "DR" : "CR"
        }`,
        createdBy: "",
      });
      summaryRow.font = { bold: true };
      summaryRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
      };
      const buffer = await workbook.xlsx.writeBuffer();
      return new NextResponse(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="ledger_${Date.now()}.xlsx"`,
        },
      });
    }
    // ===== PDF EXPORT (COMPLETE) =====
    if (format === "pdf") {
      try {
        const jsPDF = require("jspdf").jsPDF;
        const autoTable = require("jspdf-autotable").default;
        const doc = new jsPDF({
          orientation: "portrait",
          unit: "mm",
          format: "a4",
        });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        let yPosition = 15;
        // Header
        doc.setFontSize(16);
        doc.text(society?.name || "Society", pageWidth / 2, yPosition, {
          align: "center",
        });
        yPosition += 6;
        doc.setFontSize(10);
        doc.text(society?.address || "", pageWidth / 2, yPosition, {
          align: "center",
        });
        yPosition += 6;
        doc.setFontSize(12);
        doc.text("Ledger Report", pageWidth / 2, yPosition, {
          align: "center",
        });
        yPosition += 8;
        // Filter info
        let filterInfo = [];
        if (filterMonth && filterYear) {
          const monthNames = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
          ];
          filterInfo.push(
            `Period: ${monthNames[parseInt(filterMonth) - 1]} ${filterYear}`,
          );
        } else if (filterYear) {
          filterInfo.push(`Year: ${filterYear}`);
        }
        if (category && category !== "all")
          filterInfo.push(`Category: ${category}`);
        if (financialYear && financialYear !== "all")
          filterInfo.push(`FY: ${financialYear}`);
        if (filterInfo.length > 0) {
          doc.setFontSize(9);
          doc.text(filterInfo.join(" | "), pageWidth / 2, yPosition, {
            align: "center",
          });
          yPosition += 6;
        }
        // Summary
        const totalDebit = transactions
          .filter((t) => t.type === "Debit")
          .reduce((sum, t) => sum + t.amount, 0);
        const totalCredit = transactions
          .filter((t) => t.type === "Credit")
          .reduce((sum, t) => sum + t.amount, 0);
        const netBalance = totalDebit - totalCredit;
        doc.setFontSize(9);
        doc.text(`Total Transactions: ${transactions.length}`, 15, yPosition);
        yPosition += 5;
        doc.text(
          `Total Debit: ₹${totalDebit.toLocaleString("en-IN")}`,
          15,
          yPosition,
        );
        yPosition += 5;
        doc.text(
          `Total Credit: ₹${totalCredit.toLocaleString("en-IN")}`,
          15,
          yPosition,
        );
        yPosition += 5;
        doc.text(
          `Net Balance: ₹${Math.abs(netBalance).toLocaleString("en-IN")} ${
            netBalance >= 0 ? "DR" : "CR"
          }`,
          15,
          yPosition,
        );
        yPosition += 8;
        // Table
        const tableData = transactions.map((t) => [
          new Date(t.date).toLocaleDateString("en-IN"),
          t.transactionId,
          t.memberId ? `${t.memberId.wing}-${t.memberId.flatNo}` : "",
          t.category || "",
          t.description?.substring(0, 15) || "",
          t.paymentMode || "",
          t.type === "Debit" ? t.amount.toLocaleString("en-IN") : "",
          t.type === "Credit" ? t.amount.toLocaleString("en-IN") : "",
          `${Math.abs(t.balanceAfterTransaction).toLocaleString("en-IN")} ${
            t.balanceAfterTransaction >= 0 ? "DR" : "CR"
          }`,
        ]);
        autoTable(doc, {
          head: [
            [
              "Date",
              "Txn ID",
              "Member",
              "Category",
              "Desc",
              "Mode",
              "Debit",
              "Credit",
              "Balance",
            ],
          ],
          body: tableData,
          startY: yPosition,
          margin: { top: 10, right: 10, bottom: 10, left: 10 },
          styles: {
            fontSize: 8,
            cellPadding: 2,
          },
          headStyles: {
            fillColor: [79, 70, 229],
            textColor: [255, 255, 255],
          },
          bodyStyles: {
            textColor: [0, 0, 0],
          },
          alternateRowStyles: {
            fillColor: [249, 250, 251],
          },
          columnStyles: {
            6: { halign: "right" },
            7: { halign: "right" },
            8: { halign: "right" },
          },
          didDrawPage: (data) => {
            // Footer
            doc.setFontSize(8);
            doc.text(
              `Generated on ${new Date().toLocaleString("en-IN")}`,
              pageWidth / 2,
              pageHeight - 10,
              { align: "center" },
            );
          },
        });
        const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
        return new NextResponse(pdfBuffer, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="ledger_${Date.now()}.pdf"`,
          },
        });
      } catch (error) {
        console.error("PDF generation error:", error);
        return NextResponse.json(
          { error: "PDF generation failed" },
          { status: 500 },
        );
      }
    }
    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Export failed" },
      { status: 500 },
    );
  }
}