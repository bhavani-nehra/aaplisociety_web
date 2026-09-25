// Ported verbatim from @aapli/validation (mobile-backend shared-validation).
// These bounds match the web app's canonical Mongoose schemas exactly, since
// the /v1 layer writes into the same shared collections.
import { z } from "zod";

export const loginSchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(6),
});

export const profileSelectSchema = z.object({
  profileId: z.string().min(1),
});

export const complaintSchema = z.object({
  category: z.enum(["noise", "parking", "water", "security", "cleanliness", "maintenance", "billing", "staff", "pets", "other"]),
  title: z.string().min(10).max(120),
  description: z.string().min(30).max(1000),
  anonymous: z.boolean().optional(),
});

export const VISITOR_PURPOSES = ["Guest", "Delivery", "Domestic Help", "Vendor", "Cab", "Other"];

export const visitorCreateSchema = z.object({
  name: z.string().min(2),
  phone: z.string().regex(/^[0-9]{10}$/),
  purpose: z.enum(VISITOR_PURPOSES),
  purposeNote: z.string().max(300).optional(),
  vehicleNumber: z.string().optional(),
  expectedAt: z.string().datetime().optional(),
});

export const passVerifySchema = z.object({
  code: z.string().min(4),
});

export const sosSchema = z.object({
  note: z.string().max(300).optional(),
});

// Plan 03 §13 — masked calling. Deliberately has NO phone number field: the
// callee is always resolved server-side (see resolveCallee in lib/v1/calls.js).
export const CALL_PURPOSES = ["member_to_security", "guard_to_resident", "visitor_verification"];

export const callInitiateSchema = z.object({
  purpose: z.enum(CALL_PURPOSES),
  visitorId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

export const passCreateSchema = z.object({
  visitorName: z.string().min(2),
  visitorPhone: z.string().regex(/^[0-9]{10}$/).optional(),
  purpose: z.enum(VISITOR_PURPOSES).default("Guest"),
  note: z.string().max(300).optional(),
  passType: z.enum(["OneTime", "Recurring", "Frequent"]).default("OneTime"),
  recurrence: z
    .object({
      days: z.array(z.number().min(0).max(6)).optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    })
    .optional(),
  validFrom: z.string().datetime(),
  expiresAt: z.string().datetime(),
  maxUses: z.number().int().min(0).optional(),
});

export const offlineEntrySchema = z.object({
  name: z.string().min(2),
  phone: z.string().regex(/^[0-9]{10}$/).optional().or(z.literal("")),
  purpose: z.enum(VISITOR_PURPOSES),
  vehicleNumber: z.string().optional(),
  queuedAt: z.string().datetime(),
  clientRef: z.string().min(1),
  note: z.string().max(500).optional(),
});

export const visitorDecisionSchema = z.object({
  decision: z.enum(["approve", "deny"]),
});

export const guardRequestSchema = z.object({
  memberId: z.string().min(1),
  name: z.string().min(2),
  phone: z.string().regex(/^[0-9]{10}$/).optional().or(z.literal("")),
  purpose: z.enum(VISITOR_PURPOSES),
  vehicleNumber: z.string().optional(),
  note: z.string().max(500).optional(),
  queuedAt: z.string().datetime(),
  clientRef: z.string().min(1),
});

export const paymentSchema = z.object({
  billId: z.string().min(1),
  amount: z.number().positive(),
  paymentMode: z.enum(["UPI", "NetBanking", "Card", "Cash", "Cheque"]),
});

export const complaintStatusSchema = z.object({
  status: z.enum(["Open", "In progress", "Resolved", "Rejected"]),
  resolutionNote: z.string().max(2000).optional(),
});

export const noticeSchema = z.object({
  type: z.enum(["maintenance", "meeting", "water", "electricity", "parking", "security", "event", "billing", "custom"]),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  title: z.string().min(10).max(150),
  description: z.string().min(30).max(2000),
  pinned: z.boolean().optional(),
});

export const billCreateSchema = z.object({
  memberId: z.string().min(1),
  period: z.string().min(4),
  title: z.string().max(140).optional(),
  amount: z.number().positive(),
  dueDate: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(6),
});

export const forgotPasswordSchema = z.object({
  identifier: z.string().min(3),
});

export const resetPasswordSchema = z.object({
  identifier: z.string().min(3),
  code: z.string().regex(/^\d{6}$/),
  newPassword: z.string().min(6),
});

export const deviceRegisterSchema = z.object({
  fcmToken: z.string().min(10),
  platform: z.enum(["android", "ios"]),
});

export const tenantRequestCreateSchema = z.object({
  tenantName: z.string().min(2),
  tenantPhone: z.string().regex(/^[0-9]{10}$/),
  tenantEmail: z.string().email(),
  leaseStartDate: z.string().datetime(),
  leaseEndDate: z.string().datetime(),
  rentPerMonth: z.number().positive(),
  depositAmount: z.number().min(0).optional(),
  documents: z.object({
    // The one document with a reason to exist: the society is expected to hold
    // the leave-and-licence agreement, and it is the evidence behind
    // leaseStartDate / rentPerMonth if the tenancy is ever disputed.
    contractKey: z.string().min(1),
    // signatureKey removed — replaced by the acknowledgement below.
    // aadhaarKey removed — no longer collected (D1).
    // Police verification is optional rather than required: a society may
    // still want the proof on file, but requiring it made us a checkpoint in
    // a process that is the owner's and the police's, not ours.
    policeVerificationKey: z.string().min(1).optional(),
  }),
  // Replaces the uploaded signature image. The owner ticks a box; we record
  // who ticked it, when, and from where. That is better evidence than a
  // photograph of a signature — a picture proves only that somebody once had
  // a pen, and cannot be tied to the account that submitted the request.
  acknowledged: z.literal(true, {
    errorMap: () => ({ message: "You must confirm the details are correct before submitting" }),
  }),
});

export const rentPaymentCreateSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().positive(),
  paymentMode: z.enum(["Cash", "UPI", "BankTransfer", "Cheque", "Online"]),
  paidAt: z.string().datetime(),
  notes: z.string().max(500).optional(),
});

export const tenantHistoryCreateSchema = z.object({
  tenantName: z.string().min(2),
  tenantPhone: z.string().regex(/^[0-9]{10}$/),
  tenantEmail: z.string().email().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  rentPerMonth: z.number().positive(),
  depositAmount: z.number().min(0).optional(),
  moveOutReason: z.string().max(300).optional(),
});

const phoneField = z.string().regex(/^[0-9]{10}$/);
const contactEditPayloadSchema = z
  .object({
    contactNumber: phoneField.optional(),
    whatsappNumber: phoneField.optional(),
    alternateContact: phoneField.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

const emergencyContactEditPayloadSchema = z.object({
  name: z.string().min(2),
  phoneNumber: phoneField,
  relation: z.string().min(1),
  address: z.string().max(200).optional(),
});

const familyMemberPayloadSchema = z.object({
  name: z.string().min(2),
  relation: z.string().min(1),
  age: z.number().int().positive().optional(),
  contactNumber: phoneField.optional(),
  occupation: z.string().optional(),
});

const parkingAddPayloadSchema = z.object({
  slotNumber: z.string().min(1),
  type: z.enum(["Stilt", "Open", "Covered"]),
  vehicleType: z.enum(["Two-Wheeler", "Four-Wheeler"]),
});
const parkingEditPayloadSchema = z.object({
  slotId: z.string().min(1).optional(),
  slotNumber: z.string().min(1).optional(),
  newSlotNumber: z.string().min(1).optional(),
  type: z.enum(["Stilt", "Open", "Covered"]).optional(),
  vehicleType: z.enum(["Two-Wheeler", "Four-Wheeler"]).optional(),
}).refine((d) => d.slotId || d.slotNumber, { message: "slotId or slotNumber is required to identify the slot" });
const parkingRemovePayloadSchema = z.object({
  slotId: z.string().min(1).optional(),
  slotNumber: z.string().min(1).optional(),
}).refine((d) => d.slotId || d.slotNumber, { message: "slotId or slotNumber is required to identify the slot" });
const tenantContactEditPayloadSchema = z
  .object({
    contactNumber: phoneField.optional(),
    email: z.string().email().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

// ── Plan 02 §15 ─────────────────────────────────────────────────────────────
//
// `.strict()` on both: the payload is applied field-by-field from an allowlist
// in lib/profile-edit-apply.js, so an unknown key would be silently dropped
// rather than rejected. Failing at the edge tells the member their change was
// not understood instead of approving a request that quietly does less than it
// appears to.
const ownershipInfoEditPayloadSchema = z
  .object({
    ownerName: z.string().trim().min(2).max(100).optional(),
    contactNumber: phoneField.optional(),
    alternateContact: phoneField.optional(),
    whatsappNumber: phoneField.optional(),
    emailPrimary: z.string().trim().email().max(160).optional(),
    emailSecondary: z.string().trim().email().max(160).optional(),
    panCard: z.string().trim().length(10).optional(),
    aadhaar: z.string().trim().min(12).max(12).optional(),
    permanentAddress: z
      .object({
        line1: z.string().trim().max(200).optional(),
        line2: z.string().trim().max(200).optional(),
        city: z.string().trim().max(80).optional(),
        state: z.string().trim().max(80).optional(),
        pincode: z.string().trim().max(10).optional(),
        country: z.string().trim().max(80).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "Provide at least one field to change" });

const tenantInfoEditPayloadSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    panCard: z.string().trim().length(10).optional(),
    aadhaar: z.string().trim().length(12).optional(),
    // Money. Non-negative rather than positive: a zero-rent arrangement (a
    // relative living in the flat) is a real thing an owner records.
    rentPerMonth: z.number().nonnegative().optional(),
    depositAmount: z.number().nonnegative().optional(),
    emergencyContact: z
      .object({
        name: z.string().trim().max(100).optional(),
        relation: z.string().trim().max(60).optional(),
        phone: phoneField.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: "Provide at least one field to change" });

export const shopProfileEditPayloadSchema = z.object({
  tradeName: z.string().trim().min(2).max(120).optional(),
  categoryId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid category").optional(),
  gstin: z.string().trim().length(15).optional(),
  ownerPhone: z.string().trim().min(6).max(20).optional(),
  ownerEmail: z.string().trim().email().max(160).optional(),
  tenantName: z.string().trim().max(160).optional(),
  tenantPhone: z.string().trim().min(6).max(20).optional(),
}).refine((p) => Object.keys(p).length > 0, { message: "Provide at least one field to change" });

export const profileEditRequestCreateSchema = z.union([
  z.object({ section: z.literal("Contact"), action: z.literal("Edit"), payload: contactEditPayloadSchema }),
  z.object({ section: z.literal("TenantContact"), action: z.literal("Edit"), payload: tenantContactEditPayloadSchema }),
  z.object({ section: z.literal("EmergencyContact"), action: z.literal("Edit"), payload: emergencyContactEditPayloadSchema }),
  z.object({ section: z.literal("FamilyMember"), action: z.literal("Add"), payload: familyMemberPayloadSchema }),
  z.object({ section: z.literal("FamilyMember"), action: z.literal("Edit"), familyMemberId: z.string().min(1), payload: familyMemberPayloadSchema }),
  z.object({ section: z.literal("FamilyMember"), action: z.literal("Remove"), familyMemberId: z.string().min(1), payload: z.object({}).strict().optional() }),
  z.object({ section: z.literal("Parking"), action: z.literal("Add"), payload: parkingAddPayloadSchema }),
  z.object({ section: z.literal("Parking"), action: z.literal("Edit"), payload: parkingEditPayloadSchema }),
  z.object({ section: z.literal("Parking"), action: z.literal("Remove"), payload: parkingRemovePayloadSchema }),
  z.object({ section: z.literal("ShopProfile"), action: z.literal("Edit"), payload: shopProfileEditPayloadSchema }),
  z.object({ section: z.literal("OwnershipInfo"), action: z.literal("Edit"), payload: ownershipInfoEditPayloadSchema }),
  z.object({ section: z.literal("TenantInfo"), action: z.literal("Edit"), payload: tenantInfoEditPayloadSchema }),
]);