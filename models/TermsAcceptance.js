import mongoose from "mongoose";

/**
 * One record per Society per bundle version — the Society is the
 * contracting party (it's who the ToS/DPA/Privacy Policy actually binds),
 * so any one of its Admin/Secretary accepting satisfies it for the whole
 * Society, the same way a company's ToS acceptance isn't re-collected from
 * every employee.
 *
 * See lib/legal/documents.js for what BUNDLE_VERSION covers, and
 * legal/*.md for the actual document text this points at.
 */
const TermsAcceptanceSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    bundleVersion: { type: String, required: true },
    acceptedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    acceptedByName: { type: String, required: true },
    acceptedAt: { type: Date, required: true, default: Date.now },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true },
);

// One acceptance per society per version — re-accepting the same version
// (e.g. a duplicate click) just no-ops rather than piling up rows.
TermsAcceptanceSchema.index({ societyId: 1, bundleVersion: 1 }, { unique: true });

export default mongoose.models.TermsAcceptance ||
  mongoose.model("TermsAcceptance", TermsAcceptanceSchema);
