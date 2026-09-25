// lib/commercial/shopService.js
//
// NEW 2026-08-07. Create/read/update/delete shops as their OWN records.
//
// This service REPLACES the old "classify a unit as commercial" flow, which
// worked by overwriting Member.flatType and therefore destroyed the flat.
// Nothing in this file ever writes to a Member document. Linking a shop to an
// owner writes `ownerMemberId` on the SHOP; the member is only read.

import mongoose from "mongoose";
import { isDuplicateKeyError } from "@/lib/mongoErrors";
import Shop from "@/models/Shop";
import Member from "@/models/Member";
import { logAudit } from "@/lib/audit-logger";
import { CommercialError, notFound } from "./errors";
import { computeHoursState } from "./shopStorefront";
import { safeRegex } from "@/lib/query-safety";

const toObjectId = (id) =>
  id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));

export const SHOP_AUDIT = {
  CREATED: "COMMERCIAL_SHOP_CREATED",
  UPDATED: "COMMERCIAL_SHOP_UPDATED",
  DELETED: "COMMERCIAL_SHOP_DELETED",
};

// Fields an admin may set. Everything else (societyId, audit, delete flags) is
// server-controlled so a crafted request cannot move a shop between societies.
const WRITABLE = [
  "shopNo",
  "wing",
  "floor",
  "unitKind",
  "ownerMemberId",
  "ownerUserId",
  "ownerName",
  "ownerPhone",
  "ownerEmail",
  "areaSqft",
  "areaBasisNote",
  "occupancyType",
  "tenantName",
  "tenantPhone",
  "leaseStartDate",
  "leaseEndDate",
  "tradeName",
  "categoryId",
  "gstin",
  "shopActNumber",
  "fssaiNumber",
  "electricityMode",
  "electricityMeterNo",
  "lastMeterReading",
  "lastMeterReadingDate",
  "waterConnectionNo",
  "shutterCount",
  "hasSignage",
  "signageSizeSqft",
  "chargeOptIns",
  "emergencyContactName",
  "emergencyContactPhone",
  "openingPrincipal",
  "openingInterest",
  "isBillable",
  "isActive",
];

// Which rate-card charges this shop is billed. Money, so it is normalised
// rather than trusted: unknown keys dropped, quantity coerced and clamped, and
// rows without a head id discarded. A row that is not enabled is kept (with
// quantity 0) so the form can show an explicit "no" instead of an absence the
// admin has to guess at.
function normaliseChargeOptIns(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const row of raw) {
    const headId = row?.headId ? String(row.headId) : null;
    if (!headId || !/^[a-f\d]{24}$/i.test(headId) || seen.has(headId)) continue;
    seen.add(headId);
    const enabled = row?.enabled === true;
    const qty = Math.max(0, Math.min(999, Math.floor(Number(row?.quantity) || 0)));
    out.push({
      headId,
      optInKey: row?.optInKey ? String(row.optInKey).slice(0, 60) : null,
      enabled,
      quantity: enabled ? qty : 0,
      note: row?.note ? String(row.note).slice(0, 200) : null,
    });
  }
  return out;
}

function pickWritable(input) {
  const out = {};
  for (const k of WRITABLE) {
    if (input[k] !== undefined) out[k] = input[k];
  }
  if (out.chargeOptIns !== undefined) out.chargeOptIns = normaliseChargeOptIns(out.chargeOptIns);
  return out;
}

/**
 * Owner linking. The member is READ ONLY. We copy their name/phone onto the
 * shop as a starting point so a bill can be addressed, but the shop then owns
 * its own copy — editing the shop must never edit the flat.
 */
async function resolveOwner({ societyId, patch }) {
  if (!patch.ownerMemberId) return;

  const member = await Member.findOne({
    _id: patch.ownerMemberId,
    societyId,
    isDeleted: { $ne: true },
  })
    .select("_id ownerName contactNumber emailPrimary wing flatNo")
    .lean();

  if (!member) {
    throw new CommercialError(
      400,
      {
        error: "That member could not be found in this society.",
        code: "OWNER_NOT_FOUND",
        hint: "Pick the owner again from the list, or leave the owner blank for now.",
      },
      "OWNER_NOT_FOUND",
    );
  }

  patch.ownerMemberId = toObjectId(member._id);
  patch.ownerUserId = null; // enforced by the model too, made explicit here
  if (!patch.ownerName) patch.ownerName = member.ownerName;
  if (!patch.ownerPhone) patch.ownerPhone = member.contactNumber ?? null;
  if (!patch.ownerEmail) patch.ownerEmail = member.emailPrimary ?? null;
}

function friendlyDuplicate(err, shopNo, wing) {
  if (isDuplicateKeyError(err)) {
    const label = [wing, shopNo].filter(Boolean).join("-");
    return new CommercialError(
      409,
      {
        error: `Shop ${label} already exists in this society.`,
        code: "DUPLICATE_SHOP",
        hint: "Open the existing shop to edit it, or use a different shop number.",
      },
      "DUPLICATE_SHOP",
    );
  }
  return err;
}

export async function listShops({ societyId, search, includeInactive = false }) {
  const filter = { societyId, isDeleted: { $ne: true } };
  if (!includeInactive) filter.isActive = true;

  if (search && String(search).trim().length >= 1) {
    const rx = safeRegex(String(search).trim().slice(0, 80));
    filter.$or = [{ shopNo: rx }, { wing: rx }, { ownerName: rx }, { tradeName: rx }];
  }

  const rows = await Shop.find(filter).sort({ wing: 1, shopNo: 1 }).limit(1000).lean();

  return rows.map((s) => ({
    id: String(s._id),
    shopNo: s.shopNo,
    wing: s.wing ?? null,
    floor: s.floor ?? 0,
    unitKind: s.unitKind,
    unitLabel: [s.wing, s.shopNo].filter(Boolean).join("-"),
    ownerMemberId: s.ownerMemberId ? String(s.ownerMemberId) : null,
    ownerName: s.ownerName,
    ownerPhone: s.ownerPhone ?? null,
    ownerEmail: s.ownerEmail ?? null,
    ownerAccess: {
      granted: s.ownerAccess?.granted === true,
      path: s.ownerAccess?.path ?? null,
      grantedAt: s.ownerAccess?.grantedAt ?? null,
    },
    areaSqft: s.areaSqft,
    areaBasisNote: s.areaBasisNote,
    occupancyType: s.occupancyType,
    tenantName: s.tenantName ?? null,
    tradeName: s.tradeName ?? null,
    categoryId: s.categoryId ? String(s.categoryId) : null,
    gstin: s.gstin ?? null,
    electricityMode: s.electricityMode,
    chargeOptIns: (s.chargeOptIns || []).map((o) => ({
      headId: String(o.headId),
      optInKey: o.optInKey ?? null,
      enabled: o.enabled === true,
      quantity: Number(o.quantity) || 0,
      note: o.note ?? null,
    })),
    openingPrincipal: s.openingPrincipal ?? 0,
    openingInterest: s.openingInterest ?? 0,
    isBillable: s.isBillable !== false,
    isActive: s.isActive !== false,
    // A shop is billable the moment it has an area. Trade details are only
    // required if the society switched that on in the rate card settings.
    hasTradeDetails: !!(s.tradeName && s.categoryId),
    // Whether residents can see this shop in the app. Only the few fields
    // the admin list actually renders - the full storefront (hours,
    // fulfilment, payment methods) is loaded per shop by its own endpoint,
    // so a 1000-row list does not carry seven days of opening hours each.
    storefront: {
      isPublished: s.storefront?.isPublished === true,
      publishedAt: s.storefront?.publishedAt ?? null,
      manualClosed: s.storefront?.manualClosed === true,
      // Today's hours, computed server-side so the table shows the same
      // "open until 9pm" / "hours not set" language a resident would see,
      // without a per-shop fetch. Ignores publish state on purpose — an
      // admin needs to see the gap (hours never set) BEFORE listing it.
      hoursToday: computeHoursState(s.storefront || {}),
    },
  }));
}

export async function getShop({ societyId, id }) {
  const doc = await Shop.findOne({ _id: id, societyId, isDeleted: { $ne: true } }).lean();
  if (!doc) throw notFound();
  return { ...doc, id: String(doc._id) };
}

export async function createShop({ societyId, userId, input }) {
  const patch = pickWritable(input);
  await resolveOwner({ societyId, patch });

  const doc = new Shop({
    ...patch,
    societyId: toObjectId(societyId),
    createdBy: userId ?? null,
    updatedBy: userId ?? null,
  });

  try {
    await doc.save();
  } catch (err) {
    // Mongoose validation messages are already written for humans in the
    // model (e.g. the rented-out-without-tenant rule).
    if (err?.name === "ValidationError") {
      throw new CommercialError(
        400,
        {
          error: Object.values(err.errors)[0]?.message || "Some shop details are not valid.",
          code: "VALIDATION_ERROR",
          issues: Object.entries(err.errors).map(([field, e]) => ({
            field,
            message: e.message,
          })),
        },
        "VALIDATION_ERROR",
      );
    }
    throw friendlyDuplicate(err, patch.shopNo, patch.wing);
  }

  await logAudit(userId, societyId, SHOP_AUDIT.CREATED, null, {
    shopId: String(doc._id),
    unitLabel: [doc.wing, doc.shopNo].filter(Boolean).join("-"),
    areaSqft: doc.areaSqft,
    ownerMemberId: doc.ownerMemberId ? String(doc.ownerMemberId) : null,
  });

  return { id: String(doc._id), shop: doc.toObject() };
}

export async function updateShop({ societyId, userId, id, input }) {
  const doc = await Shop.findOne({ _id: id, societyId, isDeleted: { $ne: true } });
  if (!doc) throw notFound();

  const before = {
    areaSqft: doc.areaSqft,
    unitKind: doc.unitKind,
    ownerMemberId: doc.ownerMemberId ? String(doc.ownerMemberId) : null,
    occupancyType: doc.occupancyType,
  };

  const patch = pickWritable(input);
  await resolveOwner({ societyId, patch });
  Object.assign(doc, patch, { updatedBy: userId ?? null });

  try {
    await doc.save();
  } catch (err) {
    if (err?.name === "ValidationError") {
      throw new CommercialError(
        400,
        {
          error: Object.values(err.errors)[0]?.message || "Some shop details are not valid.",
          code: "VALIDATION_ERROR",
          issues: Object.entries(err.errors).map(([field, e]) => ({
            field,
            message: e.message,
          })),
        },
        "VALIDATION_ERROR",
      );
    }
    throw friendlyDuplicate(err, doc.shopNo, doc.wing);
  }

  await logAudit(userId, societyId, SHOP_AUDIT.UPDATED, before, {
    shopId: String(doc._id),
    areaSqft: doc.areaSqft,
    unitKind: doc.unitKind,
    ownerMemberId: doc.ownerMemberId ? String(doc.ownerMemberId) : null,
    occupancyType: doc.occupancyType,
  });

  return { id: String(doc._id), shop: doc.toObject() };
}

/**
 * Soft delete. Deleting a shop must never touch the flat it was linked to —
 * that link was only ever a reference.
 */
export async function deleteShop({ societyId, userId, id }) {
  const doc = await Shop.findOne({ _id: id, societyId, isDeleted: { $ne: true } });
  if (!doc) throw notFound();

  doc.isDeleted = true;
  doc.deletedAt = new Date();
  doc.isActive = false;
  doc.updatedBy = userId ?? null;
  await doc.save();

  await logAudit(
    userId,
    societyId,
    SHOP_AUDIT.DELETED,
    { shopId: String(doc._id), unitLabel: [doc.wing, doc.shopNo].filter(Boolean).join("-") },
    null,
  );

  return { id: String(doc._id), deleted: true };
}

/** Shops that a billing run should pick up. */
export async function listBillableShops({ societyId }) {
  return Shop.find({
    societyId,
    isDeleted: { $ne: true },
    isActive: true,
    isBillable: true,
  })
    .sort({ wing: 1, shopNo: 1 })
    .lean();
}
