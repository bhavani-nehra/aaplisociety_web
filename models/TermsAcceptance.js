import mongoose from "mongoose";

// One row per Society per document-bundle version. Acceptance covers the
// whole Society — any Admin/Secretary checking sees the same answer.
const TermsAcceptanceSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    bundleVersion: { type: String, required: true },
    acceptedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    acceptedByName: { type: String, required: true },
    acceptedAt: { type: Date, required: true, default: Date.now },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true },
);

TermsAcceptanceSchema.index({ societyId: 1, bundleVersion: 1 }, { unique: true });

export default mongoose.models.TermsAcceptance ||
  mongoose.model("TermsAcceptance", TermsAcceptanceSchema);
