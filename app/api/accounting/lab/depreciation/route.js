import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { requireAccounting, requireAccountingClose } from "@/lib/authz";
import ChartOfAccount from "@/models/ChartOfAccount";
import Asset from "@/models/Asset";
import { authorize } from "@/lib/rbac/authorize";
import {
  registerAsset,
  listAssets,
  computeDepreciationAmount,
  runDepreciation,
} from "@/lib/services/AssetService";

// Accounting Lab — depreciation control surface.
//
// The Lab had no way to say "depreciate this, at this rate, every year". This
// route gives the simulator the three answers the user asked for:
//   depreciation yes/no    -> `enabled`
//   if yes, how much       -> `ratePercent` (WDV) or `usefulLifeYears` (SLM)
//   automate by % per year -> method: "WDV" + ratePercent, run per period
//
// It reuses the real Asset Register (Phase 2.11) and posts through the engine
// (Dr Depreciation, Cr Accumulated Depreciation) — no bespoke journal writes.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// GET — current assets plus the depreciation that WOULD be charged, so the UI
// can preview before committing.
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
    const { searchParams } = new URL(request.url);
    const periodMonths = Math.min(Math.max(parseInt(searchParams.get("periodMonths")) || 12, 1), 12);

    const assets = await listAssets(auth.user.societyId, { status: "Active" });
    const preview = assets.map((a) => ({
      id: String(a._id),
      assetCode: a.assetCode,
      name: a.name,
      category: a.category,
      purchaseCost: a.purchaseCost,
      salvageValue: a.salvageValue,
      usefulLifeYears: a.usefulLifeYears,
      depreciationMethod: a.depreciationMethod,
      wdvRatePercent: a.wdvRatePercent,
      accumulatedDepreciation: a.accumulatedDepreciation,
      bookValue: round2(a.purchaseCost - a.accumulatedDepreciation),
      depreciationDue: computeDepreciationAmount(a, periodMonths),
    }));

    return NextResponse.json({
      assets: preview,
      totalDepreciationDue: round2(preview.reduce((s, a) => s + a.depreciationDue, 0)),
      periodMonths,
    });
  } catch (error) {
    console.error("Lab depreciation GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — two actions:
//   { action: "register", assets: [...] }  create fixed assets for the sim
//   { action: "run", enabled, periodMonths }  charge depreciation for the period
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
    const action = body.action || "run";

    // Resolve the accounts every asset needs to post against.
    //
    // FIX: asset registration used to be hard-wired to fund from Cash at Bank
    // (1002). Registering ₹2,31,000 of assets against an opening bank balance of
    // ₹6,000 is what produced the Bank figure of -₹2,25,000 on the reference
    // Balance Sheet — an impossible credit balance on an asset account, and the
    // reason "Total Cash & Bank" printed as -₹2,01,896.63.
    //
    // `fundingCode` now lets the caller say how the assets were paid for:
    //   "1001" Cash in Hand
    //   "1002" Cash at Bank (the old behaviour)
    //   "3001" General Fund — the correct choice when you are seeding assets the
    //          society ALREADY owns rather than buying them this year, because
    //          it puts the corresponding credit in members' funds instead of
    //          overdrawing a bank account.
    const FUNDING_CODES = ["1001", "1002", "3001"];
    const codes = ["1021", "1029", "5020", "1001", "1002", "3001"];
    const accs = await ChartOfAccount.find({ societyId, isDeleted: false, code: { $in: codes } })
      .select("code")
      .lean();
    const byCode = new Map(accs.map((a) => [a.code, String(a._id)]));
    const missing = codes.filter((c) => !byCode.has(c));
    if (missing.length) {
      return NextResponse.json(
        { error: `Chart of Accounts is missing ${missing.join(", ")} — re-run Setup.` },
        { status: 409 },
      );
    }

    // ── Register assets ───────────────────────────────────────────────────
    if (action === "register") {
      const fundingCode = FUNDING_CODES.includes(body.fundingCode) ? body.fundingCode : "3001";
      const fundingAccountId = byCode.get(fundingCode);
      if (!fundingAccountId) {
        return NextResponse.json(
          { error: `Funding account ${fundingCode} is missing — re-run Setup.` },
          { status: 409 },
        );
      }

      const created = [];
      // Named `skippedAssets`, NOT `skipped`. The "run" branch below returns a
      // BOOLEAN `skipped` flag, and the UI rendered "Depreciation skipped for
      // this run" whenever `depResult.skipped` was truthy. An empty array is
      // truthy in JavaScript, so registering assets always returned `skipped: []`
      // and the UI always claimed depreciation had been skipped - regardless of
      // order, and even when nothing was skipped at all.
      const skippedAssets = [];
      const failed = [];
      const existingCodes = new Set(
        (await Asset.find({ societyId, isDeleted: false, assetCode: { $in: (body.assets || []).map((a) => a.assetCode) } })
          .select("assetCode")
          .lean()).map((a) => a.assetCode),
      );
      for (const spec of body.assets || []) {
        // Idempotent, same pattern as quick-setup's Chart of Accounts reuse:
        // re-clicking "Register assets" (e.g. after Reset only cleared
        // vouchers, not the assets themselves) must never re-post a second
        // purchase voucher for an asset that already exists.
        if (existingCodes.has(spec.assetCode)) {
          skippedAssets.push({ name: spec.name, assetCode: spec.assetCode });
          continue;
        }
        try {
          // "Automate by percent every year" => WDV at the given rate.
          // Otherwise straight-line over the useful life.
          const method = spec.ratePercent > 0 ? "WDV" : "StraightLine";
          const asset = await registerAsset(
            societyId,
            {
              assetCode: spec.assetCode,
              name: spec.name,
              category: spec.category || "Other",
              purchaseDate: spec.purchaseDate,
              purchaseCost: round2(spec.purchaseCost),
              salvageValue: round2(spec.salvageValue || 0),
              usefulLifeYears: Number(spec.usefulLifeYears) || 10,
              depreciationMethod: method,
              wdvRatePercent: method === "WDV" ? Number(spec.ratePercent) : undefined,
              linkedAssetAccountId: byCode.get("1021"),
              linkedDepreciationExpenseAccountId: byCode.get("5020"),
              linkedAccumulatedDepreciationAccountId: byCode.get("1029"),
              fundingAccountId,
            },
            auth.user.userId,
          );
          created.push({ id: String(asset._id), name: asset.name, method });
        } catch (err) {
          failed.push({ name: spec.name, error: err.message });
        }
      }
      return NextResponse.json({
        action: "register",
        created,
        skippedAssets,
        failed,
        fundingCode,
      });
    }

    // ── Run depreciation ────────────────────────────────────────────────
    if (body.enabled === false) {
      return NextResponse.json({
        action: "run",
        skipped: true,
        reason: "Depreciation disabled for this run",
        charged: [],
      });
    }

    const periodMonths = Math.min(Math.max(parseInt(body.periodMonths) || 12, 1), 12);
    const assets = await Asset.find({ societyId, isDeleted: false, status: "Active" })
      .select("_id name depreciationRuns").lean();
    // Distinguish "nothing to depreciate" from "depreciation was turned off" and
    // from "it ran and charged nothing". Previously all three looked identical.
    if (!assets.length) {
      return NextResponse.json({
        action: "run",
        skipped: false,
        charged: [],
        failed: [],
        totalDepreciation: 0,
        periodMonths,
        reason: "No active assets found - click Register assets first.",
      });
    }

    const charged = [];
    const failed = [];
    let total = 0;
    for (const a of assets) {
      try {
      const res = await runDepreciation(societyId, String(a._id), { date: body.date, periodMonths }, auth.user.userId);
// runDepreciation returns the ASSET DOCUMENT, not an amount.
const runs = res?.depreciationRuns || [];
const lastRun = runs.length ? runs[runs.length - 1] : null;
const amount = round2(lastRun?.amount ?? 0);
if (amount > 0) {
  charged.push({ asset: a.name, amount, method: lastRun?.method, accumulated: round2(res?.accumulatedDepreciation ?? 0) });
  total = round2(total + amount);
}
      } catch (err) {
        failed.push({ asset: a.name, error: err.message });
      }
    }

    return NextResponse.json({
      action: "run",
      skipped: false,
      charged,
      failed,
      totalDepreciation: total,
      periodMonths,
      reason:
        charged.length === 0 && failed.length === 0
          ? "Assets exist but no depreciation was due for this period - they may already be fully depreciated, or depreciation was already charged for this date."
          : undefined,
    });
  } catch (error) {
    console.error("Lab depreciation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: error.status || 500 },
    );
  }
}