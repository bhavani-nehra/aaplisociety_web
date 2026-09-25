// Applies an approved ProfileEditRequest's payload onto a live (non-lean)
// Member document. Kept separate from the approve route so the mutation
// logic is unit-testable against a plain mongoose document without a DB
// connection. Mutates `member` in place; caller is responsible for save().
export function applyProfileEditPayload(member, editRequest) {
  const { section, action, familyMemberId, payload = {} } = editRequest;
  if (section === "Contact") {
    if (payload.contactNumber) member.contactNumber = payload.contactNumber;
    if (payload.whatsappNumber) member.whatsappNumber = payload.whatsappNumber;
    if (payload.alternateContact) member.alternateContact = payload.alternateContact;
    return;
  }
  if (section === "TenantContact") {
    if (!member.currentTenant) {
      const err = new Error("Flat has no current tenant to update");
      err.code = "TENANT_NOT_FOUND";
      throw err;
    }
    if (payload.contactNumber) member.currentTenant.contactNumber = payload.contactNumber;
    if (payload.email) member.currentTenant.email = payload.email;
    return;
  }
  if (section === "EmergencyContact") {
    member.emergencyContact = {
      name: payload.name,
      relation: payload.relation,
      phoneNumber: payload.phoneNumber,
      address: payload.address,
    };
    return;
  }
  if (section === "Parking") {
    if (!Array.isArray(member.parkingSlots)) member.parkingSlots = [];
    if (action === "Add") {
      member.parkingSlots.push({
        slotNumber: payload.slotNumber,
        type: payload.type,
        vehicleType: payload.vehicleType,
        // Business rule (see Member schema): Stilt slots aren't billed monthly.
        monthlyBilling: payload.type !== "Stilt",
      });
      return;
    }
    const slot = payload.slotId
      ? member.parkingSlots.id(payload.slotId)
      : member.parkingSlots.find((s) => s.slotNumber === payload.slotNumber);
    if (!slot) {
      const err = new Error("Parking slot not found on Member document");
      err.code = "PARKING_SLOT_NOT_FOUND";
      throw err;
    }
    if (action === "Remove") {
      slot.deleteOne();
      return;
    }
    // Edit — when identified by slotId, `slotNumber` carries the new value;
    // when identified by slotNumber, `newSlotNumber` carries the rename.
    if (payload.newSlotNumber !== undefined) {
      slot.slotNumber = payload.newSlotNumber;
    } else if (payload.slotId && payload.slotNumber !== undefined) {
      slot.slotNumber = payload.slotNumber;
    }
    if (payload.type !== undefined) {
      slot.type = payload.type;
      slot.monthlyBilling = payload.type !== "Stilt";
    }
    if (payload.vehicleType !== undefined) slot.vehicleType = payload.vehicleType;
    return;
  }
  // ── Plan 02 §15: controlled records a member requests rather than edits ──
  //
  // OwnershipInfo covers the owner's own identity and contact details on the
  // flat. Deliberately a REQUEST, not a direct edit: these fields name who owns
  // the property, they appear on bills and receipts, and a member changing them
  // unilaterally is indistinguishable from a member quietly rewriting the
  // owner of record.
  //
  // What it does NOT do is change WHO the owner is — that is an ownership
  // transfer (models/OwnershipTransfer.js), which needs a buyer, an approval
  // and an audit trail. This is the current owner correcting their own details.
  if (section === "OwnershipInfo") {
    const ALLOWED = [
      "ownerName",
      "contactNumber",
      "alternateContact",
      "whatsappNumber",
      "emailPrimary",
      "emailSecondary",
      "panCard",
      "aadhaar",
    ];
    // Allowlist, not a spread: the payload arrives from a member's device, and
    // a blind assign would let it reach `openingBalance`, `societyId` or
    // `membershipStatus` on the same document.
    for (const field of ALLOWED) {
      if (payload[field] !== undefined) member[field] = payload[field];
    }
    if (payload.permanentAddress && typeof payload.permanentAddress === "object") {
      member.permanentAddress = {
        ...(member.permanentAddress?.toObject?.() || member.permanentAddress || {}),
        ...payload.permanentAddress,
      };
    }
    return;
  }

  // TenantInfo — the commercial terms of a sitting tenancy, as recorded on the
  // flat. Distinct from TenantContact above (phone/email) because rent and
  // deposit are money, and from the tenant-request workflow, which is how a
  // tenancy is CREATED or ENDED. This edits the terms of one already running.
  if (section === "TenantInfo") {
    if (!member.currentTenant) {
      const err = new Error("Flat has no current tenant to update");
      err.code = "TENANT_NOT_FOUND";
      throw err;
    }
    const ALLOWED = ["name", "panCard", "aadhaar", "rentPerMonth", "depositAmount"];
    for (const field of ALLOWED) {
      if (payload[field] !== undefined) member.currentTenant[field] = payload[field];
    }
    if (payload.emergencyContact && typeof payload.emergencyContact === "object") {
      member.currentTenant.emergencyContact = {
        ...(member.currentTenant.emergencyContact?.toObject?.() ||
          member.currentTenant.emergencyContact ||
          {}),
        ...payload.emergencyContact,
      };
    }
    return;
  }

  // ── FamilyMember ────────────────────────────────────────────────────────
  //
  // SEC-29: this used to be the implicit fallthrough — anything that was not
  // one of the sections above landed here and was treated as a family-member
  // edit. That is how an unrecognised section silently mutated the wrong part
  // of the document instead of failing. Now it is explicit, and anything
  // unknown throws below.
  if (section !== "FamilyMember") {
    const err = new Error(`Unsupported profile-edit section: ${section}`);
    err.code = "UNSUPPORTED_SECTION";
    throw err;
  }
  if (action === "Add") {
    member.familyMembers.push({
      name: payload.name,
      relation: payload.relation,
      age: payload.age,
      contactNumber: payload.contactNumber,
      occupation: payload.occupation,
    });
    return;
  }
  const target = member.familyMembers.id(familyMemberId);
  if (!target) {
    const err = new Error("Family member not found on Member document");
    err.code = "FAMILY_MEMBER_NOT_FOUND";
    throw err;
  }
  if (action === "Remove") {
    target.deleteOne();
    return;
  }
  // Edit
  if (payload.name !== undefined) target.name = payload.name;
  if (payload.relation !== undefined) target.relation = payload.relation;
  if (payload.age !== undefined) target.age = payload.age;
  if (payload.contactNumber !== undefined) target.contactNumber = payload.contactNumber;
  if (payload.occupation !== undefined) target.occupation = payload.occupation;
}