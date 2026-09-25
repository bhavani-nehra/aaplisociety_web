import mongoose from "mongoose";

// The validated-but-not-yet-written result of a bulk-import preview pass —
// see lib/import/bulkImportValidate.js runPreviewChecks() and
// app/api/admin/bulk-import/preview/route.js. Committing (POST
// /api/admin/bulk-import with a previewId) reads this back instead of
// re-parsing the file and re-running every DB uniqueness check, so a retry
// after a mid-import failure never repeats work already confirmed.
//
// TTL'd short — this is a few-minutes-long "I just checked, go ahead and
// write it" handoff between two requests in the same admin session, not a
// durable record of anything.
const BulkImportPreviewSchema = new mongoose.Schema(
  {
    previewId: { type: String, required: true, unique: true },
    societyPayload: { type: mongoose.Schema.Types.Mixed, required: true },
    validMembers: { type: mongoose.Schema.Types.Mixed, required: true },
    // Plan 02 §17 - the optional commercial and amenity sheets, already
    // normalised. Stored alongside validMembers so the commit inserts exactly
    // what the preview validated, rather than re-parsing the workbook.
    optional: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    // [[email, {_id, username}], ...] — a Map isn't BSON-storable directly.
    existingMemberEmailMap: { type: mongoose.Schema.Types.Mixed, default: [] },
    multiSocietyAdminUserId: { type: String, default: null },
    warnings: [{ type: String }],
    // SEC-26: the validator's own verdict, persisted.
    //
    // `runPreviewChecks()` computes `ok` (no society errors, no blocking row
    // errors, at least one valid member) and the route only mints a previewId
    // when it is true — so a failing workbook has no token to commit with and
    // the strict "one bad row = nothing imported" rule already holds.
    //
    // It held *implicitly*, though: the rule lived in a `if (result.ok)` in the
    // preview route, and the commit route never re-checked. A previewId stays
    // valid for 30 minutes, and nothing in the stored document said whether the
    // data behind it had passed. Storing the verdict lets the layer that
    // performs the WRITE assert it, rather than trusting a decision made in a
    // different request.
    ok: { type: Boolean, default: null },
    // Per-row status/messages from the same pass. Kept so a commit refusal can
    // say WHICH rows were bad instead of only that some were.
    rowResults: { type: mongoose.Schema.Types.Mixed, default: null },
    used: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now, expires: 1800 }, // 30 min TTL
  },
  { timestamps: false },
);

export default mongoose.models.BulkImportPreview ||
  mongoose.model("BulkImportPreview", BulkImportPreviewSchema);
