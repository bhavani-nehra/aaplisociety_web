import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { validateAdminRequest } from "@/lib/admin-middleware";
import connectDB from "@/lib/mongodb";
import connectStagingDB from "@/lib/mongodb-staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mongo internal collections we never want to list/copy.
const SYSTEM_PREFIX = "system.";
const SOCIETIES_COLLECTION = "societies";

async function listUserCollections(db) {
  const collections = await db.listCollections().toArray();
  return collections
    .map((c) => c.name)
    .filter((name) => !name.startsWith(SYSTEM_PREFIX))
    .sort();
}

// Scope filter for a given collection: the societies collection itself is
// matched by _id, every other collection by its societyId field. Collections
// with no societyId field (PlatformSetting, CronRun, RefreshToken,
// EmailOutbox, stray non-model collections, ...) naturally match zero docs
// here and fall out of the per-society view — no hardcoded exclude list
// needed.
function scopeFilter(collectionName, societyId) {
  return collectionName === SOCIETIES_COLLECTION
    ? { _id: societyId }
    : { societyId };
}

// Per-society diff across every collection, scoped by scopeFilter. Same
// cheap _id-set diff as the old whole-db version, just filtered.
async function diffForSociety(testDb, stagingDb, collectionNames, societyId) {
  const collections = await Promise.all(
    collectionNames.map(async (name) => {
      const filter = scopeFilter(name, societyId);
      const testCount = await testDb.collection(name).countDocuments(filter);
      const stagingCount = await stagingDb.collection(name).countDocuments(filter);

      let missing = Math.max(testCount - stagingCount, 0);
      if (testCount > 0) {
        const [testIds, stagingIds] = await Promise.all([
          testDb.collection(name).find(filter, { projection: { _id: 1 } }).toArray(),
          stagingDb.collection(name).find(filter, { projection: { _id: 1 } }).toArray(),
        ]);
        const stagingIdSet = new Set(stagingIds.map((d) => String(d._id)));
        missing = testIds.filter((d) => !stagingIdSet.has(String(d._id))).length;
      }

      return { name, testCount, stagingCount, missing, inSync: missing === 0 };
    }),
  );

  return collections;
}

// GET — one row per society (present in test and/or staging), each with a
// per-collection breakdown scoped to that society's docs.
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    const [testConn, stagingConn] = await Promise.all([
      connectDB(),
      connectStagingDB(),
    ]);
    const testDb = testConn.connection.db;
    const stagingDb = stagingConn.db;

    const collectionNames = await listUserCollections(testDb);

    const [testSocieties, stagingSocieties] = await Promise.all([
      testDb.collection(SOCIETIES_COLLECTION).find({}).toArray(),
      stagingDb.collection(SOCIETIES_COLLECTION).find({}).toArray(),
    ]);
    const stagingSocietyIds = new Set(stagingSocieties.map((s) => String(s._id)));

    const societies = await Promise.all(
      testSocieties.map(async (soc) => {
        const collections = await diffForSociety(testDb, stagingDb, collectionNames, soc._id);
        const totalTest = collections.reduce((sum, c) => sum + c.testCount, 0);
        const totalStaging = collections.reduce((sum, c) => sum + c.stagingCount, 0);
        const totalMissing = collections.reduce((sum, c) => sum + c.missing, 0);

        return {
          id: String(soc._id),
          name: soc.name || "(unnamed society)",
          inTest: true,
          inStaging: stagingSocietyIds.has(String(soc._id)),
          totalTest,
          totalStaging,
          totalMissing,
          inSync: totalMissing === 0,
          collections,
        };
      }),
    );

    return NextResponse.json({
      societies,
      totalMissing: societies.reduce((sum, s) => sum + s.totalMissing, 0),
    });
  } catch (error) {
    console.error("db-sync status failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — one-click copy for one society. Body: { societyId }. Copies every
// missing doc scoped to that society across every collection. Skips docs
// whose _id already exists in staging; never overwrites, never deletes.
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  let societyId;
  try {
    const body = await request.json();
    societyId = body?.societyId && ObjectId.isValid(body.societyId)
      ? new ObjectId(body.societyId)
      : null;
  } catch {
    // no body
  }
  if (!societyId) {
    return NextResponse.json({ error: "societyId is required" }, { status: 400 });
  }

  try {
    const [testConn, stagingConn] = await Promise.all([
      connectDB(),
      connectStagingDB(),
    ]);
    const testDb = testConn.connection.db;
    const stagingDb = stagingConn.db;

    const societyDoc = await testDb.collection(SOCIETIES_COLLECTION).findOne({ _id: societyId });
    if (!societyDoc) {
      return NextResponse.json({ error: "Society not found in test DB" }, { status: 404 });
    }

    const testNames = await listUserCollections(testDb);

    const results = [];
    for (const name of testNames) {
      const filter = scopeFilter(name, societyId);
      const [scopedDocs, stagingIds] = await Promise.all([
        testDb.collection(name).find(filter).toArray(),
        stagingDb.collection(name).find(filter, { projection: { _id: 1 } }).toArray(),
      ]);
      if (scopedDocs.length === 0) {
        results.push({ name, inserted: 0, skipped: 0 });
        continue;
      }

      const stagingIdSet = new Set(stagingIds.map((d) => String(d._id)));
      const toInsert = scopedDocs.filter((d) => !stagingIdSet.has(String(d._id)));

      let inserted = 0;
      if (toInsert.length > 0) {
        const res = await stagingDb
          .collection(name)
          .insertMany(toInsert, { ordered: false });
        inserted = res.insertedCount;
      }
      results.push({ name, inserted, skipped: scopedDocs.length - toInsert.length });
    }

    return NextResponse.json({
      ok: true,
      societyId: String(societyId),
      results,
      totalInserted: results.reduce((sum, r) => sum + r.inserted, 0),
    });
  } catch (error) {
    console.error("db-sync copy failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
