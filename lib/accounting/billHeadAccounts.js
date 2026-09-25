import BillingHead from "@/models/BillingHead";
import ChartOfAccount from "@/models/ChartOfAccount";
import { STANDARD_ACCOUNTS } from "@/lib/accounting/standardAccounts.js";
import { getFiscalConfig } from "@/lib/services/FiscalConfigService";

// Where each BILLING HEAD's money is credited when a bill is posted.
//
// A bill used to post its whole charge to one account (Members Contribution –
// Rep. & Maint.), so the statutory Income & Expenditure printed one lump line
// while the bill itself carried Water, Electricity, Parking, Sinking Fund…
// The chart already seeds the income heads a society's statement prints
// (4005–4011) and BillingHead already has an optional `linkedAccountId` for
// exactly this — nothing connected them. This does:
//
//   1. the head's own linked account, when the admin set one;
//   2. otherwise the standard account its NAME points at;
//   3. otherwise the maintenance-income account (today's behaviour).
//
// Sinking Fund and Repair Fund charges are contributions to a fund, not
// income, so they credit that fund's own account — a society's fund balances
// grow by what members pay in, which is how its printed Balance Sheet shows
// them.
const HEAD_TARGETS = [
  [/sinking/i, { subType: "SinkingFund" }],
  [/repair fund|bldg.*(rep|dev)|building repair|rep.*dev/i, { subType: "RepairFund" }],
  [/non.?occupancy/i, { key: "nonOccupancyIncome" }],
  [/parking/i, { key: "parkingIncome" }],
  [/insurance/i, { key: "insuranceIncome" }],
  [/property tax/i, { key: "propertyTaxIncome" }],
  [/water/i, { key: "waterIncome" }],
  [/electric/i, { key: "electricityIncome" }],
  [/security|service|housekeeping|lift/i, { key: "serviceChargesIncome" }],
];

const codeOf = (key) => STANDARD_ACCOUNTS.find((a) => a.key === key)?.code;

/** The account a head named `headName` posts to, from a society's chart. */
export function targetAccountForHead(headName, chart, fallback, linkedAccountId = null) {
  if (linkedAccountId) {
    const linked = chart.find((a) => String(a._id) === String(linkedAccountId) && a.isActive !== false);
    if (linked) return linked;
  }
  for (const [rx, t] of HEAD_TARGETS) {
    if (!rx.test(headName)) continue;
    const acc = t.key
      ? chart.find((a) => a.code === codeOf(t.key) && a.isActive !== false)
      : chart.find((a) => a.subType === t.subType && a.isActive !== false);
    if (acc) return acc;
  }
  return fallback;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Debit/credit lines for one bill (or a month of bills) split by billing head.
 * `charges` is { headName: amount }. Returns null when the society's accounts
 * are not mapped, so the caller falls back to the single-line posting.
 */
export async function buildBillByHeadLines({ societyId, charges, currentCharges, currentInterest, session = null }) {
  const config = await getFiscalConfig(societyId, session);
  const m = config.defaultAccountMappings || {};
  if (!m.memberReceivableAccountId || !m.maintenanceIncomeAccountId) return null;

  const q = ChartOfAccount.find({ societyId, isDeleted: { $ne: true } });
  if (session) q.session(session);
  const chart = await q.lean();
  const receivable = chart.find((a) => String(a._id) === String(m.memberReceivableAccountId));
  const fallback = chart.find((a) => String(a._id) === String(m.maintenanceIncomeAccountId));
  const interestAcc = chart.find((a) => String(a._id) === String(m.interestIncomeAccountId));
  if (!receivable || !fallback) return null;

  const names = Object.keys(charges || {});
  const hq = BillingHead.find({ societyId, headName: { $in: names }, isDeleted: { $ne: true } }).select("headName linkedAccountId");
  if (session) hq.session(session);
  const linked = new Map((await hq.lean()).map((h) => [h.headName, h.linkedAccountId]));

  const byAccount = new Map();
  const mapping = [];
  let charged = 0;
  for (const [name, raw] of Object.entries(charges || {})) {
    const amount = round2(raw);
    if (!(amount > 0)) continue;
    const acc = targetAccountForHead(name, chart, fallback, linked.get(name));
    byAccount.set(String(acc._id), round2((byAccount.get(String(acc._id)) || 0) + amount));
    mapping.push({ head: name, account: acc, amount });
    charged = round2(charged + amount);
  }
  // Bill totals are the source of truth; put any rounding difference on the
  // fallback so the voucher always balances against the receivable.
  const residual = round2((currentCharges ?? charged) - charged);
  if (Math.abs(residual) >= 0.005) byAccount.set(String(fallback._id), round2((byAccount.get(String(fallback._id)) || 0) + residual));

  const interest = round2(currentInterest);
  const totalCharges = round2([...byAccount.values()].reduce((s, v) => s + v, 0));
  const receivableIncrease = round2(totalCharges + interest);
  if (!(receivableIncrease > 0) || (interest > 0 && !interestAcc)) return null;

  const lines = [{ accountId: String(receivable._id), side: "Debit", amount: receivableIncrease, narration: "Bill raised" }];
  for (const [id, amount] of byAccount) {
    if (amount > 0) lines.push({ accountId: id, side: "Credit", amount, narration: "Member charges" });
  }
  if (interest > 0) lines.push({ accountId: String(interestAcc._id), side: "Credit", amount: interest, narration: "Interest on arrears" });
  return { lines, receivableIncrease, mapping };
}
