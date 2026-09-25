/**
 * GET /api/admin/money/insights?view=<view>&fy=<startYear>&memberId=<id>
 *
 * One call per Money screen for the numbers and charts above its list.
 * Every figure is aggregated from the society's own collections; nothing is
 * sample data. Views and the permission each one needs:
 *
 *   overview  any finance view (or dashboard.stats.view)
 *   payments  finance.payments.view | finance.payment.view | finance.paymentsReceived.view
 *   receipts  finance.receipts.view | finance.receipt.view
 *   late      finance.latePayment.view | finance.payment.view
 *   passbook  finance.ledger.view   (memberId narrows it to one flat)
 *   expenses  finance.expenditure.view
 *   guide     accounting.overview.view or any finance view — the "Your year"
 *             guide: where the society stands on each step, plus the Books check
 *
 * Dues follow the rule used by dashboard-stats: every bill opens on the
 * previous bill's closing, so what a unit owes is its NEWEST open bill's
 * balance. Summing every open bill would count older months again.
 */
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import { authorizeAny } from "@/lib/rbac/authorize";
import Bill from "@/models/Bill";
import Transaction from "@/models/Transaction";
import Member from "@/models/Member";
import Expense from "@/models/Expense";
import Receipt from "@/models/Receipt";
import JournalLine from "@/models/JournalLine";
import ChartOfAccount from "@/models/ChartOfAccount";
import Society from "@/models/Society";
import { getCurrentFinancialYear } from "@/lib/services/FinancialYearService";
import BillingHead from "@/models/BillingHead";
import Voucher from "@/models/Voucher";
import { getTrialBalance } from "@/lib/services/TrialBalanceService";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";
import { isCommercialUnit } from "@/lib/commercial/constants";

export const dynamic = "force-dynamic";

const PERMS = {
  payments: ["finance.payments.view", "finance.payment.view", "finance.paymentsReceived.view"],
  receipts: ["finance.receipts.view", "finance.receipt.view"],
  late: ["finance.latePayment.view", "finance.payment.view"],
  passbook: ["finance.ledger.view"],
  expenses: ["finance.expenditure.view"],
};
PERMS.overview = ["dashboard.stats.view", ...new Set(Object.values(PERMS).flat())];
PERMS.guide = ["accounting.overview.view", ...PERMS.overview];

const PAY_MATCH = { type: "Credit", category: { $in: ["Payment", "Adjustment"] }, isReversed: { $ne: true } };
const OPEN = ["Unpaid", "Partial", "Overdue", "Scheduled"];
const DAY = 86400000;
const TZ = "+05:30";
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ymd = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function fyStartYear(date = new Date()) {
  return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}

/** The 12 months of a financial year, Apr to Mar, as { y, m (0-based), key, label }. */
function fyMonths(fy) {
  return Array.from({ length: 12 }, (_, i) => {
    const y = i < 9 ? fy : fy + 1;
    const m = (i + 3) % 12;
    return { y, m, key: `${y}-${m}`, label: new Date(y, m, 1).toLocaleDateString("en-IN", { month: "short" }) };
  });
}

function fyRange(fy) {
  return { from: new Date(fy, 3, 1), to: new Date(fy + 1, 2, 31, 23, 59, 59, 999) };
}

/** Bills in the FY window by billYear/billMonth (billMonth is 0-based). */
function fyBillMatch(fy) {
  return { $or: [{ billYear: fy, billMonth: { $gte: 3 } }, { billYear: fy + 1, billMonth: { $lte: 2 } }] };
}

const monthGroupId = (field) => ({
  y: { $year: { date: field, timezone: TZ } },
  m: { $month: { date: field, timezone: TZ } },
});

async function monthlyCollections(societyId, from, to, extra = {}) {
  const rows = await Transaction.aggregate([
    { $match: { societyId, ...PAY_MATCH, date: { $gte: from, $lte: to }, ...extra } },
    { $group: { _id: monthGroupId("$date"), total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const map = {};
  rows.forEach((r) => { map[`${r._id.y}-${r._id.m - 1}`] = { total: r2(r.total), count: r.count }; });
  return map;
}

async function monthlyBilled(societyId, fy) {
  const rows = await Bill.aggregate([
    { $match: { societyId, isDeleted: { $ne: true }, ...fyBillMatch(fy) } },
    {
      $group: {
        _id: { y: "$billYear", m: "$billMonth" },
        billed: { $sum: { $add: [{ $ifNull: ["$currentCharges", 0] }, { $ifNull: ["$currentInterest", 0] }] } },
        count: { $sum: 1 },
        paid: { $sum: { $cond: [{ $eq: ["$status", "Paid"] }, 1, 0] } },
        partial: { $sum: { $cond: [{ $eq: ["$status", "Partial"] }, 1, 0] } },
      },
    },
  ]);
  const map = {};
  rows.forEach((r) => { map[`${r._id.y}-${r._id.m}`] = { billed: r2(r.billed), count: r.count, paid: r.paid, partial: r.partial }; });
  return map;
}

async function monthlyExpenses(societyId, from, to) {
  const rows = await Expense.aggregate([
    { $match: { societyId, isDeleted: { $ne: true }, date: { $gte: from, $lte: to } } },
    { $group: { _id: monthGroupId("$date"), total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const map = {};
  rows.forEach((r) => { map[`${r._id.y}-${r._id.m - 1}`] = { total: r2(r.total), count: r.count }; });
  return map;
}

/** Newest open bill per unit: the amount each unit really owes today. */
async function openDuesByUnit(societyId) {
  return Bill.aggregate([
    { $match: { societyId, status: { $in: OPEN }, isDeleted: { $ne: true }, isHistoricalArchive: { $ne: true } } },
    { $sort: { billYear: -1, billMonth: -1 } },
    {
      $group: {
        _id: { $ifNull: ["$shopId", "$memberId"] },
        memberId: { $first: "$memberId" },
        balance: { $first: "$balanceAmount" },
        principal: { $first: "$principalBalance" },
        interest: { $first: "$interestBalance" },
        oldestDue: { $min: "$dueDate" },
        oldestPeriod: { $last: "$billPeriodId" },
        openBills: { $sum: 1 },
      },
    },
    { $match: { balance: { $gt: 0.009 } } },
  ]);
}

async function advanceHeld(societyId) {
  const [row] = await Member.aggregate([
    { $match: { societyId, isDeleted: { $ne: true }, advanceCredit: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: "$advanceCredit" }, members: { $sum: 1 } } },
  ]);
  return { total: r2(row?.total), members: row?.members || 0 };
}

/** Closing balance of every Bank / Cash account in the current FY's books. */
async function bankAndCash(societyId) {
  const fyDoc = await getCurrentFinancialYear(societyId).catch(() => null);
  if (!fyDoc) return { available: false, accounts: [] };
  const accounts = await ChartOfAccount.find({ societyId, subType: { $in: ["Bank", "Cash"] }, isDeleted: { $ne: true } })
    .select("_id name code subType").lean();
  if (!accounts.length) return { available: true, fyLabel: fyDoc.label, accounts: [] };
  const sums = await JournalLine.aggregate([
    { $match: { societyId, financialYearId: fyDoc._id, status: "Posted", accountId: { $in: accounts.map((a) => a._id) } } },
    {
      $group: {
        _id: "$accountId",
        dr: { $sum: { $cond: [{ $eq: ["$side", "Debit"] }, "$amount", 0] } },
        cr: { $sum: { $cond: [{ $eq: ["$side", "Credit"] }, "$amount", 0] } },
        lines: { $sum: 1 },
        last: { $max: "$date" },
      },
    },
  ]);
  const byId = Object.fromEntries(sums.map((s) => [String(s._id), s]));
  return {
    available: true,
    fyLabel: fyDoc.label,
    accounts: accounts.map((a) => {
      const s = byId[String(a._id)] || { dr: 0, cr: 0, lines: 0, last: null };
      return { id: String(a._id), name: a.name, code: a.code, kind: a.subType, balance: r2(s.dr - s.cr), lines: s.lines, lastEntry: s.last };
    }).filter((a) => a.lines > 0 || a.balance !== 0),
  };
}

function agingOf(units, today) {
  const buckets = [
    { key: "0-30", label: "0–30 days", min: 0, max: 30 },
    { key: "31-60", label: "31–60 days", min: 31, max: 60 },
    { key: "61-90", label: "61–90 days", min: 61, max: 90 },
    { key: "90+", label: "Over 90 days", min: 91, max: Infinity },
  ].map((b) => ({ ...b, units: 0, amount: 0 }));
  const notDue = { units: 0, amount: 0 };
  for (const u of units) {
    const days = u.oldestDue ? Math.floor((today - new Date(u.oldestDue)) / DAY) : -1;
    u.daysOverdue = Math.max(days, 0);
    u.isOverdue = days >= 0;
    if (days < 0) { notDue.units += 1; notDue.amount += u.balance; continue; }
    const b = buckets.find((x) => days >= x.min && days <= x.max);
    b.units += 1;
    b.amount += u.balance;
  }
  return {
    buckets: buckets.map(({ max, min, ...b }) => ({ ...b, amount: r2(b.amount) })),
    notDue: { units: notDue.units, amount: r2(notDue.amount) },
  };
}

async function attachMembers(units) {
  const ids = units.map((u) => u.memberId).filter(Boolean);
  const members = await Member.find({ _id: { $in: ids } }).select("_id wing flatNo ownerName contactNumber").lean();
  const map = Object.fromEntries(members.map((m) => [String(m._id), m]));
  return units.map((u) => {
    const m = map[String(u.memberId)] || {};
    return { ...u, memberId: String(u.memberId), wing: m.wing || "", flatNo: m.flatNo || "", ownerName: m.ownerName || "", contactNumber: m.contactNumber || "" };
  });
}

function payRow(p) {
  return {
    _id: String(p._id),
    transactionId: p.transactionId,
    date: p.date,
    amount: r2(p.amount),
    paymentMode: p.paymentMode || null,
    ref: p.transactionRef || p.chequeNo || p.upiId || null,
    bankName: p.bankName || null,
    description: p.description || "",
    interest: r2(p.paymentBreakdown?.interestCleared ?? p.interestCleared),
    principal: r2(p.paymentBreakdown?.principalCleared ?? p.principalCleared),
    advance: r2(p.paymentBreakdown?.advanceCredit),
    billPeriodId: p.billPeriodId || null,
    member: p.memberId && typeof p.memberId === "object"
      ? { _id: String(p.memberId._id), flatNo: p.memberId.flatNo, wing: p.memberId.wing, ownerName: p.memberId.ownerName }
      : null,
  };
}

// ── views ────────────────────────────────────────────────────────────────────

async function paymentsView(societyId, fy, today) {
  const months = fyMonths(fy);
  const { from: fyFrom, to: fyTo } = fyRange(fy);
  const heatFrom = new Date(today.getTime() - 83 * DAY); // 12 weeks
  heatFrom.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const weekStart = new Date(today.getTime() - 6 * DAY);
  weekStart.setHours(0, 0, 0, 0);
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);
  const inWin = (start, v) => ({ $cond: [{ $gte: ["$date", start] }, v, 0] });

  const [byMonth, daily, modes, windows, reversed, recent] = await Promise.all([
    monthlyCollections(societyId, fyFrom, fyTo),
    Transaction.aggregate([
      { $match: { societyId, ...PAY_MATCH, date: { $gte: new Date(Math.min(heatFrom, prevStart)), $lte: today } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: TZ } }, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      { $match: { societyId, ...PAY_MATCH, date: { $gte: fyFrom, $lte: fyTo } } },
      { $group: { _id: "$paymentMode", total: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    Transaction.aggregate([
      { $match: { societyId, ...PAY_MATCH, date: { $gte: prevStart, $lte: today } } },
      {
        $group: {
          _id: null,
          today: { $sum: inWin(dayStart, "$amount") },
          todayCount: { $sum: inWin(dayStart, 1) },
          week: { $sum: inWin(weekStart, "$amount") },
          weekCount: { $sum: inWin(weekStart, 1) },
          month: { $sum: inWin(monthStart, "$amount") },
          monthCount: { $sum: inWin(monthStart, 1) },
          prevMonth: { $sum: { $cond: [{ $lt: ["$date", monthStart] }, "$amount", 0] } },
          interest: { $sum: inWin(monthStart, { $ifNull: ["$paymentBreakdown.interestCleared", 0] }) },
          advance: { $sum: inWin(monthStart, { $ifNull: ["$paymentBreakdown.advanceCredit", 0] }) },
          largest: { $max: inWin(monthStart, "$amount") },
        },
      },
    ]),
    Transaction.countDocuments({ societyId, type: "Credit", category: { $in: ["Payment", "Adjustment"] }, isReversed: true, date: { $gte: fyFrom, $lte: fyTo } }),
    Transaction.find({ societyId, ...PAY_MATCH }).populate("memberId", "flatNo wing ownerName").sort({ date: -1, createdAt: -1 }).limit(8).lean(),
  ]);

  const dayMap = Object.fromEntries(daily.map((d) => [d._id, { total: r2(d.total), count: d.count }]));
  const heat = [];
  for (let t = heatFrom.getTime(); t <= today.getTime(); t += DAY) {
    const d = new Date(t);
    const key = ymd(d);
    heat.push({ date: key, dow: d.getDay(), ...(dayMap[key] || { total: 0, count: 0 }) });
  }
  const w = windows[0] || {};
  const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthDaily = Array.from({ length: days }, (_, i) => {
    const key = ymd(new Date(today.getFullYear(), today.getMonth(), i + 1, 12));
    return { day: i + 1, ...(dayMap[key] || { total: 0, count: 0 }), future: i + 1 > today.getDate() };
  });
  return {
    fy,
    months: months.map((mo) => ({ label: mo.label, key: mo.key, ...(byMonth[mo.key] || { total: 0, count: 0 }) })),
    heat,
    monthDaily,
    monthLabel: today.toLocaleDateString("en-IN", { month: "long" }),
    modes: modes.map((m) => ({ mode: m._id || "Unknown", total: r2(m.total), count: m.count })),
    windows: {
      today: r2(w.today), todayCount: w.todayCount || 0,
      week: r2(w.week), weekCount: w.weekCount || 0,
      month: r2(w.month), monthCount: w.monthCount || 0,
      prevMonth: r2(w.prevMonth),
      interest: r2(w.interest), advance: r2(w.advance), largest: r2(w.largest),
    },
    reversedCount: reversed,
    recent: recent.map(payRow),
  };
}

async function receiptsView(societyId, fy) {
  const months = fyMonths(fy);
  const { from: fyFrom, to: fyTo } = fyRange(fy);
  const match = { societyId, paidAt: { $gte: fyFrom, $lte: fyTo } };
  const [byMonth, byStatus, byMode, latest, paymentsFy] = await Promise.all([
    Receipt.aggregate([{ $match: match }, { $group: { _id: monthGroupId("$paidAt"), count: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
    Receipt.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
    Receipt.aggregate([{ $match: match }, { $group: { _id: "$paymentMode", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Receipt.find({ societyId }).populate("memberId", "flatNo wing ownerName").sort({ paidAt: -1, createdAt: -1 }).limit(3).lean(),
    Transaction.countDocuments({ societyId, ...PAY_MATCH, memberId: { $ne: null }, date: { $gte: fyFrom, $lte: fyTo } }),
  ]);
  const mm = Object.fromEntries(byMonth.map((r) => [`${r._id.y}-${r._id.m - 1}`, { count: r.count, amount: r2(r.amount) }]));
  const st = Object.fromEntries(byStatus.map((s) => [s._id, s]));
  return {
    fy,
    issued: byStatus.reduce((s, x) => s + x.count, 0),
    amount: r2(byStatus.reduce((s, x) => s + x.amount, 0)),
    printed: st.Downloaded?.count || 0,
    notPrinted: st.Generated?.count || 0,
    paymentsInFy: paymentsFy,
    months: months.map((mo) => ({ label: mo.label, ...(mm[mo.key] || { count: 0, amount: 0 }) })),
    modes: byMode.map((m) => ({ mode: m._id || "Unknown", count: m.count })),
    latest: latest.map((r) => ({
      _id: String(r._id),
      receiptNo: r.receiptNo,
      amount: r2(r.amount),
      paidAt: r.paidAt,
      paymentMode: r.paymentMode,
      billPeriodId: r.billPeriodId,
      interest: r2(r.interestApplied),
      principal: r2(r.principalApplied),
      advance: r2(r.advanceCreditCreated),
      remaining: r2(r.remainingBalance),
      settlementStatus: r.settlementStatus,
      status: r.status,
      member: r.memberId ? { flatNo: r.memberId.flatNo, wing: r.memberId.wing, ownerName: r.memberId.ownerName } : null,
    })),
  };
}

async function lateView(societyId, today) {
  const [society, raw] = await Promise.all([
    Society.findById(societyId).select("config").lean(),
    openDuesByUnit(societyId),
  ]);
  const units = await attachMembers(raw);
  const { buckets, notDue } = agingOf(units, today);
  const overdue = units.filter((u) => u.isOverdue);
  const wings = {};
  for (const u of overdue) {
    const k = u.wing || "—";
    wings[k] = wings[k] || { wing: k, units: 0, amount: 0 };
    wings[k].units += 1;
    wings[k].amount += u.balance;
  }
  const total = overdue.reduce((s, u) => s + u.balance, 0);
  const interest = overdue.reduce((s, u) => s + (u.interest || 0), 0);
  return {
    billPayFinalDay: society?.config?.billPayFinalDay || 0,
    totalOverdue: r2(total),
    interestOverdue: r2(interest),
    principalOverdue: r2(total - interest),
    overdueUnits: overdue.length,
    openUnits: units.length,
    openAmount: r2(units.reduce((s, u) => s + u.balance, 0)),
    buckets,
    notDue,
    wings: Object.values(wings).map((w) => ({ ...w, amount: r2(w.amount) })).sort((a, b) => String(a.wing).localeCompare(String(b.wing))),
    top: overdue.sort((a, b) => b.balance - a.balance).slice(0, 6).map((u) => ({
      memberId: u.memberId, wing: u.wing, flatNo: u.flatNo, ownerName: u.ownerName, contactNumber: u.contactNumber,
      balance: r2(u.balance), interest: r2(u.interest), daysOverdue: u.daysOverdue, openBills: u.openBills, oldestPeriod: u.oldestPeriod,
    })),
  };
}

async function passbookView(societyId, fy, memberIdStr) {
  const months = fyMonths(fy);
  const { from: fyFrom, to: fyTo } = fyRange(fy);
  if (memberIdStr && mongoose.Types.ObjectId.isValid(memberIdStr)) {
    const memberId = new mongoose.Types.ObjectId(memberIdStr);
    const [member, bills, paid, lastPay, openNow] = await Promise.all([
      Member.findOne({ _id: memberId, societyId }).select("wing flatNo ownerName advanceCredit").lean(),
      Bill.find({ societyId, memberId, isDeleted: { $ne: true }, ...fyBillMatch(fy) })
        .select("billYear billMonth billPeriodId currentCharges currentInterest balanceAmount status").lean(),
      monthlyCollections(societyId, fyFrom, fyTo, { memberId }),
      Transaction.findOne({ societyId, memberId, ...PAY_MATCH }).sort({ date: -1 }).select("date amount paymentMode").lean(),
      Bill.findOne({ societyId, memberId, status: { $in: OPEN }, isDeleted: { $ne: true }, isHistoricalArchive: { $ne: true } })
        .sort({ billYear: -1, billMonth: -1 }).select("balanceAmount billPeriodId").lean(),
    ]);
    if (!member) return { scope: "member", notFound: true };
    const bm = Object.fromEntries(bills.map((b) => [`${b.billYear}-${b.billMonth}`, b]));
    const tiles = months.map((mo) => {
      const b = bm[mo.key];
      return {
        label: mo.label,
        year: mo.y,
        billed: b ? r2((b.currentCharges || 0) + (b.currentInterest || 0)) : null,
        paid: paid[mo.key]?.total || 0,
        status: b ? b.status : null,
        balance: b ? r2(b.balanceAmount) : null,
        period: b?.billPeriodId || null,
      };
    });
    return {
      scope: "member",
      fy,
      member: { _id: memberIdStr, wing: member.wing, flatNo: member.flatNo, ownerName: member.ownerName, advance: r2(member.advanceCredit) },
      owes: r2(openNow?.balanceAmount),
      owesPeriod: openNow?.billPeriodId || null,
      billedFy: r2(tiles.reduce((s, t) => s + (t.billed || 0), 0)),
      paidFy: r2(tiles.reduce((s, t) => s + t.paid, 0)),
      paidMonths: tiles.filter((t) => t.status === "Paid").length,
      billedMonths: tiles.filter((t) => t.status).length,
      lastPayment: lastPay ? { date: lastPay.date, amount: r2(lastPay.amount), mode: lastPay.paymentMode } : null,
      tiles,
    };
  }
  const [billed, paid, units, adv, memberCount] = await Promise.all([
    monthlyBilled(societyId, fy),
    monthlyCollections(societyId, fyFrom, fyTo),
    openDuesByUnit(societyId),
    advanceHeld(societyId),
    Member.countDocuments({ societyId, isDeleted: { $ne: true } }),
  ]);
  return {
    scope: "society",
    fy,
    months: months.map((mo) => ({ label: mo.label, billed: billed[mo.key]?.billed || 0, paid: paid[mo.key]?.total || 0 })),
    members: memberCount,
    owing: units.length,
    inAdvance: adv.members,
    settled: Math.max(memberCount - units.length - adv.members, 0),
    dues: r2(units.reduce((s, u) => s + u.balance, 0)),
    advance: adv.total,
  };
}

async function expensesView(societyId, fy) {
  const months = fyMonths(fy);
  const { from: fyFrom, to: fyTo } = fyRange(fy);
  const match = { societyId, isDeleted: { $ne: true }, date: { $gte: fyFrom, $lte: fyTo } };
  const [byMonth, byCat, byVendor, repeats, notPosted, income, prevYear] = await Promise.all([
    monthlyExpenses(societyId, fyFrom, fyTo),
    Expense.aggregate([{ $match: match }, { $group: { _id: "$category", total: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
    Expense.aggregate([{ $match: { ...match, vendor: { $nin: [null, ""] } } }, { $group: { _id: "$vendor", total: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 5 }]),
    Expense.aggregate([
      { $match: match },
      { $sort: { date: 1 } },
      { $group: { _id: { category: "$category", vendor: { $ifNull: ["$vendor", ""] } }, months: { $addToSet: "$periodId" }, total: { $sum: "$amount" }, last: { $max: "$date" }, lastAmount: { $last: "$amount" } } },
      { $match: { "months.2": { $exists: true } } },
      { $sort: { total: -1 } },
      { $limit: 6 },
    ]),
    Expense.countDocuments({ ...match, voucherId: null }),
    monthlyCollections(societyId, fyFrom, fyTo),
    Expense.aggregate([
      { $match: { societyId, isDeleted: { $ne: true }, ...(() => { const p = fyRange(fy - 1); return { date: { $gte: p.from, $lte: p.to } }; })() } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);
  const spent = r2(byCat.reduce((s, c) => s + c.total, 0));
  const collected = r2(Object.values(income).reduce((s, m) => s + m.total, 0));
  return {
    fy,
    spent,
    collected,
    lastYear: r2(prevYear[0]?.total),
    count: byCat.reduce((s, c) => s + c.count, 0),
    notPosted,
    months: months.map((mo) => ({ label: mo.label, key: mo.key, spent: byMonth[mo.key]?.total || 0, collected: income[mo.key]?.total || 0 })),
    categories: byCat.map((c) => ({ category: c._id, total: r2(c.total), count: c.count })),
    vendors: byVendor.map((v) => ({ vendor: v._id, total: r2(v.total), count: v.count })),
    recurring: repeats.map((r) => ({ category: r._id.category, vendor: r._id.vendor || null, months: r.months.length, total: r2(r.total), last: r.last, lastAmount: r2(r.lastAmount) })),
  };
}

async function overviewView(societyId, fy, today) {
  const months = fyMonths(fy);
  const [payments, late, expenses, billed, adv, bank, heads, recentExpenses, recentReceipts, memberCount, society] = await Promise.all([
    paymentsView(societyId, fy, today),
    lateView(societyId, today),
    expensesView(societyId, fy),
    monthlyBilled(societyId, fy),
    advanceHeld(societyId),
    bankAndCash(societyId),
    Bill.aggregate([
      { $match: { societyId, isDeleted: { $ne: true }, ...fyBillMatch(fy) } },
      { $project: { c: { $objectToArray: { $ifNull: ["$charges", {}] } } } },
      { $unwind: "$c" },
      { $group: { _id: "$c.k", total: { $sum: "$c.v" } } },
      { $sort: { total: -1 } },
    ]),
    Expense.find({ societyId, isDeleted: { $ne: true } }).sort({ date: -1, createdAt: -1 }).limit(4).select("category vendor amount date paymentMethod").lean(),
    Receipt.find({ societyId }).populate("memberId", "flatNo wing").sort({ createdAt: -1 }).limit(3).select("receiptNo amount createdAt status memberId").lean(),
    Member.countDocuments({ societyId, isDeleted: { $ne: true } }),
    Society.findById(societyId).select("name").lean(),
  ]);
  const monthKey = `${today.getFullYear()}-${today.getMonth()}`;
  const thisMonthBill = billed[monthKey] || { billed: 0, count: 0, paid: 0, partial: 0 };
  const series = months.map((mo, i) => ({
    label: mo.label,
    key: mo.key,
    billed: billed[mo.key]?.billed || 0,
    collected: payments.months[i].total || 0,
    spent: expenses.months[i].spent || 0,
  }));
  const flat = (m) => (m ? `${m.wing ? `${m.wing}-` : ""}${m.flatNo}` : "");
  const activity = [
    ...payments.recent.slice(0, 5).map((p) => ({ kind: "payment", at: p.date, amount: p.amount, text: `${p.member?.ownerName || "Payment"} paid`, sub: [flat(p.member), p.paymentMode].filter(Boolean).join(" · ") })),
    ...recentExpenses.map((e) => ({ kind: "expense", at: e.date, amount: r2(e.amount), text: `Expense · ${e.category}`, sub: [e.vendor, e.paymentMethod].filter(Boolean).join(" · ") })),
    ...recentReceipts.map((r) => ({ kind: "receipt", at: r.createdAt, amount: r2(r.amount), text: `Receipt ${r.receiptNo} ${r.status === "Downloaded" ? "printed" : "issued"}`, sub: flat(r.memberId) })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6);
  const fyCollected = r2(series.reduce((s, m) => s + m.collected, 0));
  const fyBilled = r2(series.reduce((s, m) => s + m.billed, 0));
  const monthIdx = months.findIndex((m) => m.key === monthKey);
  return {
    fy,
    fyLabel: `FY ${fy}-${String(fy + 1).slice(-2)}`,
    society: society?.name || "",
    members: memberCount,
    thisMonth: {
      label: today.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      collected: payments.windows.month,
      count: payments.windows.monthCount,
      prevMonth: payments.windows.prevMonth,
      billed: thisMonthBill.billed,
      bills: thisMonthBill.count,
      paidBills: thisMonthBill.paid,
      partialBills: thisMonthBill.partial,
      expenses: monthIdx >= 0 ? expenses.months[monthIdx].spent : 0,
    },
    fyTotals: { billed: fyBilled, collected: fyCollected, spent: expenses.spent, surplus: r2(fyCollected - expenses.spent), lastYearSpent: expenses.lastYear },
    series,
    dues: { total: late.openAmount, units: late.openUnits, overdue: late.totalOverdue, overdueUnits: late.overdueUnits },
    advance: adv,
    aging: late.buckets,
    notDue: late.notDue,
    top: late.top,
    modes: payments.modes,
    heat: payments.heat,
    heads: heads.map((h) => ({ head: h._id, total: r2(h.total) })).filter((h) => h.total > 0),
    categories: expenses.categories.slice(0, 5),
    bank,
    recent: payments.recent,
    receipts: recentReceipts.length,
    activity,
  };
}

/**
 * "Your year" guide: one figure per step, and the four Books checks in plain
 * words — the same comparisons scripts/fy-cycle.js runs after every month.
 */
async function guideView(societyId, fy, today) {
  const { from, to } = fyRange(fy);
  const curY = today.getFullYear();
  const curM = today.getMonth();
  const monthStart = new Date(curY, curM, 1);
  const monthEnd = new Date(curY, curM + 1, 1);
  const [members, heads, historyBills, monthBills, lastLive, payMonth, expFy, expMonth, notPosted] = await Promise.all([
    Member.find({ societyId, isDeleted: { $ne: true } }).lean(),
    BillingHead.countDocuments({ societyId, isDeleted: { $ne: true } }),
    Bill.countDocuments({ societyId, isDeleted: { $ne: true }, isHistoricalArchive: true }),
    Bill.countDocuments({ societyId, isDeleted: { $ne: true }, isHistoricalArchive: { $ne: true }, billYear: curY, billMonth: curM }),
    Bill.aggregate([
      { $match: { societyId, isDeleted: { $ne: true }, isHistoricalArchive: { $ne: true }, $or: [{ billSeries: { $exists: false } }, { billSeries: null }, { billSeries: "RESIDENTIAL" }] } },
      { $sort: { billYear: -1, billMonth: -1 } },
      { $group: { _id: "$memberId", owes: { $first: { $ifNull: ["$closingTotal", "$balanceAmount"] } } } },
    ]),
    Transaction.aggregate([
      { $match: { societyId, ...PAY_MATCH, date: { $gte: monthStart, $lt: monthEnd } } },
      { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
    Expense.aggregate([
      { $match: { societyId, isDeleted: { $ne: true }, date: { $gte: from, $lt: to } } },
      { $group: { _id: { y: { $year: { date: "$date", timezone: TZ } }, m: { $month: { date: "$date", timezone: TZ } } }, n: { $sum: 1 } } },
    ]),
    Expense.countDocuments({ societyId, isDeleted: { $ne: true }, date: { $gte: monthStart, $lt: monthEnd } }),
    Expense.countDocuments({ societyId, isDeleted: { $ne: true }, date: { $gte: from, $lt: to }, voucherId: null }),
  ]);
  const residential = members.filter((m) => !isCommercialUnit(m));
  const monthsElapsed = fyMonths(fy).filter((m) => new Date(m.y, m.m, 1) <= today).length;

  const checks = await booksChecks(societyId, residential, lastLive)
    .catch((e) => [{ key: "error", ok: false, label: "Books check could not run", detail: e.message }]);

  return {
    fy,
    fyLabel: `${fy}-${String(fy + 1).slice(-2)}`,
    society: { members: residential.length, heads },
    history: { bills: historyBills },
    thisMonth: {
      label: monthStart.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
      bills: monthBills,
      payments: payMonth[0]?.n || 0,
      collected: r2(payMonth[0]?.amount),
    },
    expenses: { monthsWithEntries: expFy.length, monthsElapsed, thisMonth: expMonth, notPosted, total: expFy.reduce((s, x) => s + x.n, 0) },
    yearEnds: to,
    daysToYearEnd: Math.max(0, Math.ceil((to - today) / DAY)),
    checks,
  };
}

async function booksChecks(societyId, residential, lastLive) {
  const fyDoc = await getCurrentFinancialYear(societyId).catch(() => null);
  if (!fyDoc) {
    return [{ key: "year", ok: false, label: "No year in the books yet", detail: "Create the year first — Set up your books, step 1.", href: "/admin/accounting/setup-books?section=year" }];
  }
  const [tb, cfg] = await Promise.all([
    getTrialBalance(societyId, fyDoc._id),
    getFiscalConfig(societyId).catch(() => null),
  ]);
  const m = cfg?.defaultAccountMappings || {};
  const drOf = (id) => {
    const r = tb.rows.find((x) => String(x.accountId) === String(id));
    return r2((r?.debit || 0) - (r?.credit || 0));
  };
  const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const out = [];
  const cmp = (key, label, ledger, expected, href, what) => {
    const diff = r2(ledger - expected);
    const ok = Math.abs(diff) <= 0.02;
    out.push({
      key,
      ok,
      label,
      detail: ok ? `${what} ${money(expected)}, and so do the books` : `Books say ${money(ledger)}; ${what.toLowerCase()} ${money(expected)} — off by ${money(Math.abs(diff))}`,
      href,
    });
  };

  out.push({
    key: "balanced",
    ok: tb.isBalanced,
    label: "Both sides of the books agree",
    detail: tb.isBalanced ? `Debits = credits = ${money(tb.totalDebit)}` : `Debits ${money(tb.totalDebit)}, credits ${money(tb.totalCredit)}`,
    href: "/admin/accounting/statements?tab=trial-balance",
  });

  const resIds = new Set(residential.map((x) => String(x._id)));
  const owesBy = new Map(lastLive.filter((x) => resIds.has(String(x._id))).map((x) => [String(x._id), r2(x.owes)]));
  if (m.memberReceivableAccountId) {
    cmp("dues", "Dues match the bills", drOf(m.memberReceivableAccountId), r2([...owesBy.values()].reduce((a, b) => a + b, 0)), "/admin/late-payment", "Members' latest bills carry");
  }
  if (m.memberAdvanceAccountId) {
    cmp("advance", "Advance matches", r2(-drOf(m.memberAdvanceAccountId)), r2(residential.reduce((a, x) => a + (x.advanceCredit || 0), 0)), "/admin/ledger", "Members hold in advance");
  }

  // Bank and cash: what moved this year (the opening entry taken out) must be
  // what was collected less what was spent through the books.
  const cashIds = [m.cashAccountId, m.defaultBankAccountId].filter(Boolean).map(String);
  if (cashIds.length) {
    const opening = await Voucher.find({ societyId, financialYearId: fyDoc._id, sourceModule: "OpeningBalance", isDeleted: { $ne: true } }).select("_id").lean();
    const start = new Date(fyDoc.startDate);
    const end = new Date(new Date(fyDoc.endDate).getTime() + DAY);
    const [[mv], [pin], [pout]] = await Promise.all([
      JournalLine.aggregate([
        { $match: { societyId, financialYearId: fyDoc._id, status: "Posted", accountId: { $in: cashIds.map((id) => new mongoose.Types.ObjectId(id)) }, voucherId: { $nin: opening.map((v) => v._id) } } },
        { $group: { _id: null, dr: { $sum: { $cond: [{ $eq: ["$side", "Debit"] }, "$amount", 0] } }, cr: { $sum: { $cond: [{ $eq: ["$side", "Credit"] }, "$amount", 0] } } } },
      ]),
      Transaction.aggregate([
        { $match: { societyId, type: "Credit", category: "Payment", isReversed: { $ne: true }, date: { $gte: start, $lt: end } } },
        { $group: { _id: null, t: { $sum: "$amount" } } },
      ]),
      Expense.aggregate([
        { $match: { societyId, isDeleted: { $ne: true }, voucherId: { $ne: null }, date: { $gte: start, $lt: end } } },
        { $group: { _id: null, t: { $sum: "$amount" } } },
      ]),
    ]);
    cmp("bank", "Bank matches", r2((mv?.dr || 0) - (mv?.cr || 0)), r2((pin?.t || 0) - (pout?.t || 0)), "/admin/accounting/registers?tab=bank-accounts", "Collected less spent this year comes to");
  }

  // Every member's passbook: its last running balance = dues − advance.
  // "Last" is the last one written: each entry's running balance is worked
  // out from the entries before it when it is saved, and a payment dated
  // earlier in the day than the bill it pays is still written after it.
  const last = await Transaction.aggregate([
    { $match: { societyId, isReversed: { $ne: true }, memberId: { $in: residential.map((x) => x._id) } } },
    { $sort: { createdAt: 1, _id: 1 } },
    { $group: { _id: "$memberId", bal: { $last: "$balanceAfterTransaction" } } },
  ]);
  const advBy = new Map(residential.map((x) => [String(x._id), x.advanceCredit || 0]));
  const flats = new Map(residential.map((x) => [String(x._id), `${x.wing ? `${x.wing}-` : ""}${x.flatNo}`]));
  const wrong = last.filter((t) => Math.abs(r2(t.bal) - r2((owesBy.get(String(t._id)) || 0) - (advBy.get(String(t._id)) || 0))) > 0.02);
  out.push({
    key: "passbook",
    ok: !wrong.length,
    label: "Every member's passbook adds up",
    detail: wrong.length
      ? `${wrong.length} passbook(s) do not match what the flat owes: ${wrong.slice(0, 4).map((w) => flats.get(String(w._id))).join(", ")}`
      : `${last.length} passbooks match what each flat owes`,
    href: "/admin/ledger",
  });
  return out;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") || "overview";
  if (!PERMS[view]) return NextResponse.json({ error: "Unknown view" }, { status: 400 });
  const gate = await authorizeAny(request, PERMS[view]);
  if (!gate.ok) return gate.response;
  const sid = gate.context.societyId;
  if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) {
    return NextResponse.json({ error: "Invalid society context" }, { status: 400 });
  }
  try {
    await connectDB();
    const societyId = new mongoose.Types.ObjectId(String(sid));
    const today = new Date();
    const fyParam = parseInt(searchParams.get("fy") || "", 10);
    const fy = Number.isFinite(fyParam) && fyParam > 2000 ? fyParam : fyStartYear(today);
    let data;
    if (view === "payments") data = await paymentsView(societyId, fy, today);
    else if (view === "receipts") data = await receiptsView(societyId, fy);
    else if (view === "late") data = await lateView(societyId, today);
    else if (view === "passbook") data = await passbookView(societyId, fy, searchParams.get("memberId"));
    else if (view === "expenses") data = await expensesView(societyId, fy);
    else if (view === "guide") data = await guideView(societyId, fy, today);
    else data = await overviewView(societyId, fy, today);
    return NextResponse.json({ success: true, view, generatedAt: today.toISOString(), ...data });
  } catch (err) {
    console.error("[money/insights]", view, err);
    return NextResponse.json({ error: "Could not load these figures" }, { status: 500 });
  }
}
