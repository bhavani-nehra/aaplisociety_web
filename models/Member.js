import mongoose from "mongoose";
// Owner History Schema (embedded subdocument)
const OwnerHistorySchema = new mongoose.Schema(
  {
    ownerName: { type: String, required: true, trim: true },
    panCard: { type: String, trim: true, uppercase: true },
    aadhaar: { type: String, trim: true },
    contactNumber: { type: String, required: true },
    emailPrimary: { type: String, trim: true, lowercase: true },
    // Ownership period
    ownershipStartDate: { type: Date, required: true },
    ownershipEndDate: { type: Date }, // null if current owner
    durationMonths: { type: Number }, // auto-calculated
    // Purchase/Sale details
    purchaseAmount: { type: Number },
    saleAmount: { type: Number },
    // Transfer details
    transferType: {
      type: String,
      enum: ["Purchase", "Inheritance", "Gift", "Court Order", "Other"],
      default: "Purchase",
    },
    transferDate: { type: Date },
    registrationNumber: { type: String }, // Sale deed registration number
    // Why ownership ended
    exitReason: {
      type: String,
      enum: ["Sold", "Transferred", "Deceased", "Other"],
    },
    isCurrent: { type: Boolean, default: false },
    // Notes
    notes: { type: String, trim: true },
  },
  { _id: true, timestamps: true },
);
// Tenant/Occupant History Schema (embedded subdocument)
const TenantHistorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    panCard: { type: String, trim: true },
    aadhaar: { type: String, trim: true },
    contactNumber: { type: String, required: true },
    email: { type: String, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date }, // null if current tenant
    duration: { type: Number }, // in months, auto-calculated
    depositAmount: { type: Number, default: 0 },
    rentPerMonth: { type: Number, default: 0 },
    isCurrent: { type: Boolean, default: false },
    moveOutReason: { type: String, trim: true },
    emergencyContact: {
      name: { type: String },
      relation: { type: String },
      phone: { type: String },
    },
  },
  { _id: true, timestamps: true },
);
// Main Member Schema
const MemberSchema = new mongoose.Schema(
  {
    // === FLAT MASTER DATA (Highest Level) ===
    // Flat Identification (VERY UNIQUE)
    flatNo: {
      type: String,
      required: true,
      trim: true,
       set: function (v) {
    if (v == null) return v;
    let s = String(v).trim();
    const w = String(this.wing || "").trim();
    if (w && s.toUpperCase().startsWith(w.toUpperCase())) {
      s = s.slice(w.length).replace(/^[-\s]+/, "") || s;
    }
    return s;
  },
      uppercase: true,
    },
    wing: {
      type: String,
      trim: true,
      default: "",
      uppercase: true,
    },
    floor: {
      type: Number,
      min: -3, // Basement levels
      max: 150,
    },
    // Flat Physical Details
    carpetAreaSqft: {
      type: Number,
      required: true,
      min: 0,
    },
    builtUpAreaSqft: { type: Number, min: 0 },
    superBuiltUpAreaSqft: { type: Number, min: 0 },
    flatType: {
      type: String,
      enum: [
        "1BHK",
        "2BHK",
        "3BHK",
        "4BHK",
        "5BHK+",
        "Studio",
        "Penthouse",
        "Shop",
        "Office",
      ],
      default: "2BHK",
    },
    parkingSlots: [
      {
        slotNumber: String,
        type: { type: String, enum: ["Stilt", "Open", "Covered"] },
        vehicleType: { type: String, enum: ["Two-Wheeler", "Four-Wheeler"] },
        monthlyBilling: { type: Boolean, default: true }, // auto-set: false for Stilt, true for Open/Covered
      },
    ],
    isActive: { type: Boolean, default: true },
    // Ownership Status
    ownershipType: {
      type: String,
      enum: ["Owner-Occupied", "Rented", "Vacant", "Under-Dispute"],
      default: "Owner-Occupied",
    },
    possessionDate: { type: Date },
    // === CURRENT OWNER ===
    //
    // SEC-27: these fields ARE the current owner. They are not derived from
    // `ownerHistory`, despite what this comment used to claim ("from
    // ownerHistory array - most recent").
    //
    // Measured against the database: of 86 members, 78 have no `ownerHistory`
    // at all and the remaining 8 carry only PAST owners — every entry has
    // `isCurrent: false`, and the person named at this level is a different
    // person from the one in the history. `currentTenant`/`tenantHistory`
    // follow the same split (9 members have a current tenant; zero have tenant
    // history).
    //
    // So the split is: these fields = who owns it now; `ownerHistory` = who
    // owned it before. The `isCurrent` flag on those entries is currently
    // vestigial — nothing sets it true.
    //
    // This matters because `MemberSchema.methods.transferOwnership` below DOES
    // set `isCurrent: true` when it pushes a new entry. Nothing calls it today,
    // but the moment an ownership-transfer workflow ships, these two places
    // start describing the same fact and the invariant has to be enforced
    // somewhere. Build that with the transfer, not before it — there is no
    // drift to fix while `ownerHistory` holds only history.
    ownerName: {
      type: String,
      required: true,
      trim: true,
    },
    // Primary Contact Information
    contactNumber: {
      type: String,
      trim: true,
      required: true,
    },
    alternateContact: { type: String, trim: true },
    whatsappNumber: { type: String, trim: true },
    emailPrimary: { type: String, trim: true, lowercase: true },
    emailSecondary: { type: String, trim: true, lowercase: true },
    // Identity Documents
    panCard: { type: String, trim: true, uppercase: true },
    aadhaar: { type: String, trim: true },
    // Permanent Address (if different from flat address)
    permanentAddress: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
      country: { type: String, default: "India" },
    },
    // Emergency Contact
    //
    // Kept as the single "primary" contact because every existing read in the
    // app expects an object here, not a list. The repeatable list below is
    // additive; this field mirrors whichever entry is marked primary.
    emergencyContact: {
      name: { type: String },
      relation: { type: String },
      phoneNumber: { type: String },
      address: { type: String },
    },
    // Plan 02 §17 - emergency contacts as a repeatable list.
    //
    // One number is not enough in practice: the flat owner is away, the
    // number rings out, and the guard has nobody else to try. The importer
    // fills this from the Emergency Contacts sheet.
    emergencyContacts: [
      {
        name: { type: String, required: true },
        relation: { type: String },
        contactNumber: { type: String },
        alternateContact: { type: String },
        email: { type: String, lowercase: true, trim: true },
        address: { type: String },
        // At most one per flat, enforced at import by the atMostOne rule on
        // the sheet. This is who is called first.
        isPrimary: { type: Boolean, default: false },
      },
    ],
    // Plan 02 §17 - vehicles as first-class records.
    //
    // parkingSlots above records the SLOT (and is what monthly parking is
    // billed from); this records the VEHICLE. They are different things: a
    // flat can own a car with no slot, or hold a slot standing empty, and the
    // society gate needs the registration number either way.
    vehicles: [
      {
        registrationNumber: { type: String, required: true, uppercase: true, trim: true },
        vehicleType: { type: String, enum: ["Two-Wheeler", "Four-Wheeler"] },
        make: { type: String },
        model: { type: String },
        colour: { type: String },
        fuelType: { type: String, enum: ["Petrol", "Diesel", "CNG", "Electric", "Hybrid"] },
        // Free text, matched against parkingSlots[].slotNumber when present.
        parkingSlot: { type: String },
        // Only when the registered owner differs from the flat owner.
        ownerName: { type: String },
        contactNumber: { type: String },
      },
    ],
    // Family Members (residing in the flat)
    familyMembers: [
      {
        name: { type: String, required: true },
        relation: { type: String }, // Spouse, Son, Daughter, Parent, etc.
        age: { type: Number },
        contactNumber: { type: String },
        occupation: { type: String },
      },
    ],
    // === OWNER HISTORY (Array of all owners - COMPLETE TIMELINE) ===
    ownerHistory: [OwnerHistorySchema],
    // === TENANT/OCCUPANT DATA (Array of Historical Records) ===
    currentTenant: TenantHistorySchema, // Current tenant if rented
    tenantHistory: [TenantHistorySchema], // All previous tenants
    // === FINANCIAL DATA ===
    // Total legacy opening outstanding (principal + interest together)
    openingBalance: {
      type: Number,
      default: 0,
    },
    // Optional split of opening balance for new logic (used going forward)
    openingPrincipal: {
      type: Number,
      default: 0,
    },
    openingInterest: {
      type: Number,
      default: 0,
    },
    // Advance credit (prepaid amount). Used only after all interest/principal cleared.
    advanceCredit: {
      type: Number,
      default: 0,
    },
    securityDeposit: {
      amount: { type: Number, default: 0 },
      depositDate: { type: Date },
      refundDate: { type: Date },
      status: {
        type: String,
        enum: ["Pending", "Deposited", "Refunded", "Adjusted"],
        default: "Pending",
      },
    },
    // Special Charges/Discounts
    specialDiscount: {
      percentage: { type: Number, min: 0, max: 100, default: 0 },
      reason: { type: String },
      validUntil: { type: Date },
    },
    // === MEMBERSHIP STATUS ===
    membershipStatus: {
      type: String,
      enum: ["Active", "Inactive", "Suspended", "Blocked", "Exited"],
      default: "Active",
    },
    membershipNumber: {
      type: String,
      sparse: true,
    },
    // Voting Rights
    hasVotingRights: { type: Boolean, default: true },
    // === BILLING PREFERENCES ===
    billingPreferences: {
      emailBill: { type: Boolean, default: true },
      whatsappBill: { type: Boolean, default: false },
      printedBill: { type: Boolean, default: false },
      billDeliveryDay: { type: Number, min: 1, max: 31 },
    },
    // === MAINTENANCE DUES CONFIG ===
    customMaintenanceConfig: {
      isCustom: { type: Boolean, default: false },
      customRatePerSqft: { type: Number },
      reason: { type: String },
    },
    // === NOTES & REMARKS ===
    internalNotes: { type: String, trim: true }, // Admin-only notes
    publicRemarks: { type: String, trim: true }, // Visible to member
    // === SYSTEM FIELDS ===
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // false during migration; set true after backfill complete
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    isDeleted: { type: Boolean, default: false },
    // === CONTACTABILITY (Visitor module — zero-dead-end escalation) ===
    // Set when a visitor-approval notification could not reach this flat
    // (e.g. phone disconnected / permanently off). Surfaces a "please update
    // your number" banner to the resident and a HIGH ALERT to admins.
    contactInvalid: { type: Boolean, default: false },
    contactInvalidReason: { type: String, trim: true, default: "" },
    contactInvalidAt: { type: Date, default: null },
    // Bulk-import provenance — see Society.importRunId
    importRunId: { type: String, default: null, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);
// Indexes for performance
// 🔐 1. Unique membership number per society
MemberSchema.index({ societyId: 1, membershipNumber: 1 }, { unique: true });
// 🏠 2. Unique flat per society
MemberSchema.index({ societyId: 1, flatNo: 1, wing: 1 }, { unique: true });
// 📊 3. Query optimization indexes
MemberSchema.index({ societyId: 1, membershipStatus: 1 });
MemberSchema.index({ societyId: 1, ownershipType: 1 });
// 🪪 4. Optional identity indexes
MemberSchema.index({ panCard: 1 }, { sparse: true });
// 📞 5. Contact (can be non-unique unless required)
MemberSchema.index(
  { societyId: 1, contactNumber: 1 },
  { unique: false }, // or true if needed
);
// 📧 6. Email — non-unique: same person can own multiple flats in same society
MemberSchema.index({ societyId: 1, emailPrimary: 1 }, { sparse: true });
// 🗑️ 7. Soft delete
MemberSchema.index({ isDeleted: 1 });
// Virtual for full flat identifier
MemberSchema.virtual("fullFlatId").get(function () {
  return this.wing ? `${this.wing}-${this.flatNo}` : this.flatNo;
});
// Virtual for current occupant name
MemberSchema.virtual("currentOccupantName").get(function () {
  if (this.ownershipType === "Rented" && this.currentTenant) {
    return this.currentTenant.name;
  }
  return this.ownerName;
});
// Virtual to get current owner from history
MemberSchema.virtual("currentOwnerFromHistory").get(function () {
  const currentOwner = this.ownerHistory.find((owner) => owner.isCurrent);
  return currentOwner || null;
});
// Pre-save middleware to auto-generate membership number
MemberSchema.pre("save", async function (next) {
  if (this.isNew && !this.membershipNumber) {
    try {
      // Bind to this document's own session (if any). A bulk import creates
      // every member inside ONE transaction — a read that isn't scoped to
      // that session can't see the transaction's own uncommitted inserts, so
      // every member in the batch would see "zero prior members" and all
      // generate the same MEM-0001, colliding on the unique
      // {societyId,membershipNumber} index at insert time.
      const session = this.$session();
      // Get count of existing members in this society
      const lastMember = await this.constructor
        .findOne({ societyId: this.societyId })
        .sort({ createdAt: -1 })
        .session(session);
      let nextNumber = 1;
      if (lastMember && lastMember.membershipNumber) {
        const lastNum = parseInt(lastMember.membershipNumber.split("-")[1]);
        nextNumber = lastNum + 1;
      }
      this.membershipNumber = `MEM-${String(nextNumber).padStart(4, "0")}`;
      let attempts = 0;
      const maxAttempts = 10;
      while (attempts < maxAttempts) {
        this.membershipNumber = `MEM-${String(nextNumber).padStart(4, "0")}`;
        // Check if this number already exists
        const existing = await this.constructor
          .findOne({
            societyId: this.societyId,
            membershipNumber: this.membershipNumber,
          })
          .session(session);
        if (!existing) {
          break; // Found unique number
        }
        nextNumber++;
        attempts++;
      }
      if (attempts >= maxAttempts) {
        throw new Error("Failed to generate unique membership number");
      }
    } catch (error) {
      return next(error);
    }
  }
  // Calculate tenant duration if endDate is set
  if (
    this.currentTenant &&
    this.currentTenant.endDate &&
    this.currentTenant.startDate
  ) {
    const months = Math.floor(
      (this.currentTenant.endDate - this.currentTenant.startDate) /
        (1000 * 60 * 60 * 24 * 30),
    );
    this.currentTenant.duration = months;
  }
  // Calculate owner duration for history entries
  this.ownerHistory.forEach((owner) => {
    if (owner.ownershipEndDate && owner.ownershipStartDate) {
      const months = Math.floor(
        (owner.ownershipEndDate - owner.ownershipStartDate) /
          (1000 * 60 * 60 * 24 * 30),
      );
      owner.durationMonths = months;
    }
  });
  next();
});
// ========== METHODS ==========
// Method to transfer ownership to new owner
MemberSchema.methods.transferOwnership = function (
  newOwnerData,
  transferDetails,
) {
  // Move current owner to history
  if (this.ownerName) {
    const currentOwnerHistory = {
      ownerName: this.ownerName,
      panCard: this.panCard,
      aadhaar: this.aadhaar,
      contactNumber: this.contactNumber,
      emailPrimary: this.emailPrimary,
      ownershipStartDate:
        this.ownerHistory.length > 0
          ? this.ownerHistory[this.ownerHistory.length - 1].ownershipEndDate ||
            this.possessionDate
          : this.possessionDate,
      ownershipEndDate: transferDetails.transferDate || new Date(),
      isCurrent: false,
      ...transferDetails, // includes purchaseAmount, saleAmount, exitReason, etc.
    };
    this.ownerHistory.push(currentOwnerHistory);
  }
  // Set new owner as current
  this.ownerName = newOwnerData.ownerName;
  this.panCard = newOwnerData.panCard;
  this.aadhaar = newOwnerData.aadhaar;
  this.contactNumber = newOwnerData.contactNumber;
  this.emailPrimary = newOwnerData.emailPrimary;
  // Add new owner to history as current
  this.ownerHistory.push({
    ...newOwnerData,
    ownershipStartDate: transferDetails.transferDate || new Date(),
    isCurrent: true,
  });
};
// Method to move current tenant to history
MemberSchema.methods.moveCurrentTenantToHistory = function (moveOutReason) {
  if (this.currentTenant) {
    this.currentTenant.endDate = new Date();
    this.currentTenant.isCurrent = false;
    this.currentTenant.moveOutReason = moveOutReason;
    // Calculate duration
    const months = Math.floor(
      (this.currentTenant.endDate - this.currentTenant.startDate) /
        (1000 * 60 * 60 * 24 * 30),
    );
    this.currentTenant.duration = months;
    this.tenantHistory.push(this.currentTenant.toObject());
    this.currentTenant = null;
    this.ownershipType = "Owner-Occupied";
  }
};
// Method to add new tenant
MemberSchema.methods.addNewTenant = function (tenantData) {
  // Move current tenant to history if exists
  if (this.currentTenant) {
    this.moveCurrentTenantToHistory("New tenant moved in");
  }
  this.currentTenant = {
    ...tenantData,
    isCurrent: true,
    startDate: tenantData.startDate || new Date(),
  };
  this.ownershipType = "Rented";
};
export default mongoose.models.Member || mongoose.model("Member", MemberSchema);
