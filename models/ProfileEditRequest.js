import mongoose from "mongoose";
// Mirrors mobile-backend's ProfileEditRequest collection
// (apps/mobile-backend/src/models/index.ts in the AapliSociety_App mobile
// monorepo — see that repo's docs/superpowers/specs/2026-07-19-profile-restructure-design.md).
// Owner-submitted, admin-pending change to Contact / FamilyMember /
// EmergencyContact on the shared Member document — deliberately its own
// collection, not written onto Member directly, until this app's approve
// route below accepts it.
const ProfileEditRequestSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: function () {
        return this.section !== "ShopProfile";
      },
      index: true,
    },
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      default: null,
      required: function () {
        return this.section === "ShopProfile";
      },
      index: true,
    },
    requestedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // SEC-29.
    //
    // `TenantContact` was MISSING here while both the other two layers already
    // supported it: lib/v1/schemas.js:238 accepts it from the mobile client and
    // lib/profile-edit-apply.js:13 knows how to apply it. So a tenant updating
    // their own phone number passed validation, reached the model, and died on
    // `ValidationError: TenantContact is not a valid enum value` — a 500 for a
    // request the product otherwise fully implements.
    //
    // `OwnershipInfo` and `TenantInfo` are Plan 02 §15: the controlled records
    // a member should REQUEST changes to rather than edit directly. They are
    // accepted here and applied in lib/profile-edit-apply.js.
    section: {
      type: String,
      enum: [
        "Contact",
        "TenantContact",
        "FamilyMember",
        "EmergencyContact",
        "Parking",
        "ShopProfile",
        "OwnershipInfo",
        "TenantInfo",
      ],
      required: true,
    },
    action: { type: String, enum: ["Edit", "Add", "Remove"], required: true },
    familyMemberId: mongoose.Schema.Types.ObjectId,
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending", index: true },
    rejectionReason: String,
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: Date,
  },
  { timestamps: true },
);
export default mongoose.models.ProfileEditRequest || mongoose.model("ProfileEditRequest", ProfileEditRequestSchema);