import mongoose from "mongoose";

// final_audit_fix_plan/bill-history-upgrade.md §16 STAGING ARCHITECTURE,
// §38 SAFE SAVE RULES. Nothing here is a real Bill — this is the draft
// record. No route writes to this model yet (backend-only phase).
const BillHistoryImportBatchSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, default: Date.now },
    fileName: { type: String, required: true },
    fileHash: { type: String, required: true, index: true }, // sha256, §18 idempotency
    sourceFormat: { type: String, enum: ["single-month", "multi-sheet", "long-format", "v2-template"], required: true },
    detectedPeriods: [String], // "YYYY-MM"
    columnMapping: { type: mongoose.Schema.Types.Mixed },
    reconciliationSummary: { type: mongoose.Schema.Types.Mixed },
    warningSummary: { type: mongoose.Schema.Types.Mixed },
    errorSummary: { type: mongoose.Schema.Types.Mixed },
    resolutionCount: { type: Number, default: 0 },
    overrideCount: { type: Number, default: 0 },
    processorVersion: { type: String, required: true },
    status: {
      type: String,
      enum: ["STAGED", "REVIEW", "READY", "COMMITTED", "FAILED", "EXPIRED"],
      default: "STAGED",
      index: true,
    },
    // §38-A draft lifecycle
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    snapshotVersion: { type: mongoose.Schema.Types.Mixed }, // versions of members/config/bills it depended on, checked again at Confirm
    // §38-D race-condition lock (one import lock per society)
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lockedAt: { type: Date, default: null },
    committedAt: { type: Date, default: null },
    committedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    failureReason: { type: String, default: null },
  },
  { timestamps: true },
);

BillHistoryImportBatchSchema.index({ societyId: 1, status: 1 });
BillHistoryImportBatchSchema.index({ societyId: 1, fileHash: 1 });

export default mongoose.models.BillHistoryImportBatch ||
  mongoose.model("BillHistoryImportBatch", BillHistoryImportBatchSchema);
