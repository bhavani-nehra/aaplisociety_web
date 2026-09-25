// Mongoose models for the /v1 (mobile) API. Ported verbatim from the
// mobile-backend's src/models/index.ts.
//
// IMPORTANT: these are registered under DISTINCT model names ("V1User",
// "V1Visitor", ...) but each is explicitly bound to the SAME underlying
// collection the web app owns ("users", "visitors", ...). This means:
//   1. No Mongoose model-name collision with the web app's own models
//      (models/User.js registers "User"; this registers "V1User").
//   2. Reads/writes hit the exact same shared collections, so the mobile
//      endpoints behave identically to the deployed mobile backend.
//   3. strict:false mirror schemas preserve web-authored fields on read and
//      let mobile-only fields (offlineMeta, escalation history, plaintext
//      pass OTP, tenant move-out timestamps, reset codes, ...) persist.
// The web app's own models are untouched.
import mongoose from "mongoose";
// SEC-23: the visitors collection is now owned by ONE schema — see below.
import WebVisitor from "../../models/Visitor.js";
import RealRefreshToken from "../../models/RefreshToken.js";
import RealTenantRequest from "../../models/TenantRequest.js";
import RealRentPayment from "../../models/RentPayment.js";
import RealProfileEditRequest from "../../models/ProfileEditRequest.js";
import RealBlacklist from "../../models/Blacklist.js";
import RealVisitorPass from "../../models/VisitorPass.js";

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// Helper: idempotent model registration bound to an explicit collection name.
function m(name, schema, collection) {
  return mongoose.models[name] || mongoose.model(name, schema, collection);
}

// ROOT CAUSE OF "Profile not found" (404 on /v1/auth/switch-profile).
//
// This mirror schema is what the ENTIRE /v1 (mobile) API reads users through.
// It used to be missing the one field the whole multi-flat feature hangs on:
//
//     profileId
//
// Sub-document schemas are strict even when the PARENT schema is strict:false,
// so every profileId stored by the website was silently DROPPED on hydration.
// p.profileId was therefore always undefined.
//
// It also declared { _id: true }. models/User.js declares { _id: false }, so
// there is no _id persisted for a profile in Mongo - which means Mongoose
// MINTED A BRAND NEW RANDOM ObjectId for each profile on every single load.
//
// Both routes fall back to `String(p.profileId ?? p._id)`:
//
//   POST /v1/auth/login          -> hydration #1 -> ids A1, A2  (sent to app)
//   POST /v1/auth/switch-profile -> hydration #2 -> ids B1, B2  (compared)
//
// A1 !== B1 and A1 !== B2, always, by construction. So the lookup could never
// match and the route could only ever return 404. It was not a stale token,
// not the picker, not the app - the ids were random garbage generated fresh
// per request. The website works because app/api/auth/* uses models/User.js,
// which declares profileId properly.
//
// Fix: declare profileId and turn sub-document _id off, so this schema is
// byte-identical in shape to models/User.js ProfileSchema.
const ProfileSchema = new Schema(
  {
    profileId: { type: ObjectId },
    memberId: {
      type: ObjectId,
      ref: "Member",
      required: function () {
        return this.kind !== "Commercial";
      },
    },
    societyId: { type: ObjectId, ref: "Society", index: true },
    role: { type: String, required: true },
    flatNo: String,
    wing: String,
    societyName: String,
    isPrimary: { type: Boolean, default: false },
    joinedAt: Date,
    status: { type: String, default: "Active" },
    occupancyType: { type: String, enum: ["Owner", "Tenant"], default: "Owner" },
    kind: { type: String, enum: ["Residential", "Commercial"], default: "Residential" },
    shopId: {
      type: ObjectId,
      ref: "Shop",
      default: null,
      required: function () {
        return this.kind === "Commercial";
      },
    },
  },
  // MUST match models/User.js. With _id: true Mongoose invents a new id per
  // read and every profile lookup fails.
  { _id: false },
);

const UserSchema = new Schema(
  {
    username: { type: String, required: true, index: true },
    email: { type: String, index: true },
    passwordHash: { type: String },
    password: { type: String },
    role: { type: String, required: true },
    societyId: { type: ObjectId, ref: "Society", index: true },
    memberId: { type: ObjectId, ref: "Member" },
    profiles: [ProfileSchema],
    activeProfileId: ObjectId,
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    resetCodeHash: { type: String },
    resetCodeExpiresAt: { type: Date },
    resetCodeAttempts: { type: Number, default: 0 },
  },
  { timestamps: true, strict: false },
);

const EscalationStepSchema = new Schema(
  {
    level: { type: Number, required: true },
    channel: { type: String, enum: ["in_app", "push", "sms", "whatsapp", "email", "guard_call", "admin_alert"], required: true },
    target: { type: String, default: "" },
    recipientRole: { type: String, default: "" },
    ok: { type: Boolean, default: false },
    error: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// SEC-23: the VisitorSchema that used to live here has been REMOVED.
//
// It was a `strict: false` mirror bound to the same `visitors` collection as
// models/Visitor.js. Two schemas over one collection drifted and produced real
// failures — see the note on `export const Visitor` below. models/Visitor.js is
// now the single schema, and it already carries the identical
// { societyId, "offlineMeta.clientRef" } unique partial index this block
// declared, so the offline de-dupe guarantee is unchanged.

// 90 days. Raise it if a society ever asks for a longer in-app history, but
// remember you are paying for storage, index size and backup size to keep a
// feed nobody scrolls.
export const NOTIFICATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const NotificationSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    createdBy: ObjectId,
    createdByName: { type: String, default: "System" },
    type: { type: String, required: true },
    title: String,
    message: String,
    priority: { type: String, enum: ["normal", "high", "critical"], default: "normal" },
    recipientType: { type: String, default: "user" },
    recipientIds: [{ type: String }],
    metadata: Schema.Types.Mixed,
    actionUrl: String,
    readBy: [{ userId: { type: ObjectId, ref: "User" }, readAt: { type: Date, default: Date.now } }],
    // Every notification now carries its own expiry, defaulted to 90 days out.
    // The TTL index below is what actually deletes it; without a default this
    // field was declared but never populated, so nothing ever expired.
    expiresAt: { type: Date, default: () => new Date(Date.now() + NOTIFICATION_TTL_MS) },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false },
);

// --- Notification retention -------------------------------------------------
// This collection was the fastest-growing thing in the database: roughly 1.3
// rows per visitor event, forever. Nobody has ever opened a notification from
// four months ago, but every one of them was stored, indexed and included in
// backups every month, which is what pushed the Atlas tier up.
//
// The durable audit trail lives on the Visitor / Bill / Payment documents. These
// rows are a feed, so they get a 90-day life. MongoDB's TTL monitor deletes
// expired documents in the background roughly once a minute, at zero cost to us.
//
// expireAfterSeconds: 0 means "delete when the date in this field has passed",
// which is why the default above is a future date rather than `Date.now`.
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "notif_ttl" });

// The poller's query is the single most frequent query in the entire system:
//   { societyId, isDeleted: { $ne: true }, createdAt: { $gt: since } } sort createdAt desc
// Without this compound index that becomes a collection scan per poll - the most
// expensive possible shape for the most repeated possible call. With it, an
// empty result is an index-only lookup that touches no documents at all.
NotificationSchema.index({ societyId: 1, createdAt: -1 }, { name: "notif_feed" });

// Members filter the same feed by recipient, so support that too.
NotificationSchema.index({ societyId: 1, recipientType: 1, recipientIds: 1, createdAt: -1 }, { name: "notif_recipient" });

const DeviceTokenSchema = new Schema({
  userId: { type: ObjectId, ref: "User", required: true, index: true },
  societyId: { type: ObjectId, ref: "Society", index: true },
  fcmToken: { type: String, required: true, unique: true },
  platform: { type: String, enum: ["android", "ios"], required: true },
  lastSeenAt: { type: Date, default: Date.now },
});



const BillSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", required: true, index: true },
    period: String,
    title: String,
    principal: { type: Number, default: 0 },
    interest: { type: Number, default: 0 },
    amount: { type: Number, required: true },
    amountPaid: { type: Number, default: 0 },
    status: { type: String, default: "Unpaid", index: true },
    dueDate: Date,
  },
  { timestamps: true, strict: false },
);

const PaymentSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    billId: { type: ObjectId, ref: "Bill", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", index: true },
    amount: { type: Number, required: true },
    paymentMode: String,
    reference: String,
  },
  { timestamps: true },
);

const ComplaintSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    memberId: { type: ObjectId, ref: "Member", required: true, index: true },
    anonymousName: { type: String, required: true },
    category: { type: String, required: true },
    title: { type: String, required: true },
    description: String,
    status: { type: String, default: "PENDING", index: true },
    anonymous: { type: Boolean, default: false },
    resolutionNote: String,
  },
  { timestamps: true, strict: false },
);

const NoticeSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    createdBy: { type: ObjectId, ref: "User", required: true },
    createdByName: { type: String, required: true },
    type: { type: String, required: true },
    priority: { type: String, default: "medium" },
    title: { type: String, required: true },
    description: String,
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true, strict: false },
);

const TenantRequestDocumentsSchema = new Schema(
  { contractKey: String, signatureKey: String, aadhaarKey: String, policeVerificationKey: String },
  { _id: false },
);











const ParkingSlotSchema = new Schema(
  { slotNumber: String, type: String, vehicleType: String, monthlyBilling: Boolean },
  { _id: false },
);
const FamilyMemberSchema = new Schema({
  name: String,
  relation: String,
  age: Number,
  contactNumber: String,
  occupation: String,
});
const MemberSchema = new Schema(
  {
    societyId: { type: ObjectId, ref: "Society", index: true },
    userId: { type: ObjectId, ref: "User", index: true },
    flatNo: String,
    wing: String,
    floor: Number,
    carpetAreaSqft: Number,
    builtUpAreaSqft: Number,
    flatType: String,
    parkingSlots: [ParkingSlotSchema],
    isActive: { type: Boolean, default: true },
    ownershipType: String,
    possessionDate: Date,
    ownerName: String,
    contactNumber: String,
    alternateContact: String,
    whatsappNumber: String,
    emailPrimary: String,
    emailSecondary: String,
    familyMembers: [FamilyMemberSchema],
    emergencyContact: { name: String, relation: String, phoneNumber: String, address: String },
    membershipStatus: String,
    membershipNumber: String,
    hasVotingRights: Boolean,
    advanceCredit: { type: Number, default: 0 },
    currentTenant: Schema.Types.Mixed,
    tenantHistory: [Schema.Types.Mixed],
  },
  { timestamps: true, strict: false },
);

const SocietySchema = new Schema(
  { name: String, address: String, gstNo: String, fyStartMonth: Number },
  { timestamps: true, strict: false },
);

const TransactionSchema = new Schema(
  {
    transactionId: String,
    date: Date,
    memberId: { type: ObjectId, ref: "Member", index: true },
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    createdBy: ObjectId,
    type: { type: String, required: true },
    category: String,
    description: String,
    amount: { type: Number, required: true },
    balanceAfterTransaction: Number,
    referenceId: ObjectId,
    referenceModel: String,
    billPeriodId: String,
    paymentMode: String,
    interestCleared: Number,
    principalCleared: Number,
    paymentBreakdown: Schema.Types.Mixed,
  },
  { timestamps: true, strict: false },
);

const ReceiptSchema = new Schema(
  {
    receiptNo: String,
    filename: String,
    billId: { type: ObjectId, ref: "Bill" },
    billPeriodId: String,
    memberId: { type: ObjectId, ref: "Member", index: true },
    societyId: { type: ObjectId, ref: "Society", required: true, index: true },
    amount: { type: Number, required: true },
    paymentMode: String,
    paidAt: Date,
    transactionId: String,
    notes: String,
    status: { type: String, default: "Generated" },
  },
  { timestamps: true, strict: false },
);

export const User = m("V1User", UserSchema, "users");
export const Member = m("V1Member", MemberSchema, "members");
export const Society = m("V1Society", SocietySchema, "societies");
export const Transaction = m("V1Transaction", TransactionSchema, "transactions");
export const Receipt = m("V1Receipt", ReceiptSchema, "receipts");
// SEC-23 — the `visitors` collection has exactly one schema now.
//
// This used to be `m("V1Visitor", VisitorSchema, "visitors")`: a second,
// `strict: false` schema mapped onto the same collection as models/Visitor.js.
// Two schemas over one collection drifted apart and produced real failures:
//
//   * `enteredBy` was `required` on the web side only, so a visitor created
//     from the app 500'd every one of the nine web routes that call `.save()`.
//   * `entryMethod: "GuardRequest"` was allowed here and missing from the web
//     enum — 10 of the 14 visitor documents in the database failed web-schema
//     validation because of it.
//   * `photoKey` was silently discarded once before for the same reason (see
//     the comment on that field in models/Visitor.js).
//
// models/Visitor.js now declares everything both surfaces persist, including
// `assignedGuardId` and `sosAck`, which only the mobile routes write. Exporting
// the web model directly means there is no second schema left to drift.
//
// NOTE this is deliberately `strict: true` (the web model's default). The
// mirror's `strict: false` was what let an undeclared field persist silently;
// with one schema that is a liability rather than a safety net, and the
// visitors collection records who was admitted through a physical gate.
export const Visitor = WebVisitor;
export const Notification = m("V1Notification", NotificationSchema, "notifications");
export const DeviceToken = m("V1DeviceToken", DeviceTokenSchema, "devicetokens");
// SEC-24: the `refreshtokens` collection has ONE schema. The `strict: false`
// mirror that used to be declared here is deleted; models/RefreshToken.js is the
// single owner. Verified before removal: zero required-field divergence and
// every live document validates against the real model.
export const RefreshToken = RealRefreshToken;
export const Bill = m("V1Bill", BillSchema, "bills");
export const Payment = m("V1Payment", PaymentSchema, "payments");
export const Complaint = m("V1Complaint", ComplaintSchema, "complaints");
export const Notice = m("V1Notice", NoticeSchema, "notices");
// SEC-24: the `tenantrequests` collection has ONE schema. The `strict: false`
// mirror that used to be declared here is deleted; models/TenantRequest.js is the
// single owner. Verified before removal: zero required-field divergence and
// every live document validates against the real model.
export const TenantRequest = RealTenantRequest;
// SEC-24: the `rentpayments` collection has ONE schema. The `strict: false`
// mirror that used to be declared here is deleted; models/RentPayment.js is the
// single owner. Verified before removal: zero required-field divergence and
// every live document validates against the real model.
export const RentPayment = RealRentPayment;
// SEC-24: the `profileeditrequests` collection has ONE schema. The `strict: false`
// mirror that used to be declared here is deleted; models/ProfileEditRequest.js is the
// single owner. Verified before removal: zero required-field divergence and
// every live document validates against the real model.
export const ProfileEditRequest = RealProfileEditRequest;
// SEC-24: the `visitorpasses` collection has ONE schema. The `strict: false`
// mirror that used to be declared here is deleted; models/VisitorPass.js is the
// single owner. Verified before removal: zero required-field divergence and
// every live document validates against the real model. The mirror also declared a PLAINTEXT `otp` alongside `otpHash`. Nothing
// ever read it back — both verify paths hash the supplied value and match on
// `otpHash` — so it was a credential sitting at rest for no reason, against
// the real model's own stated design ("Credentials (hashed). Raw values are
// returned ONCE on creation."). Dropping it is the point, not a casualty.
export const VisitorPass = RealVisitorPass;
// SEC-24: the `blacklists` collection has ONE schema. The `strict: false`
// mirror that used to be declared here is deleted; models/Blacklist.js is the
// single owner. Verified before removal: zero required-field divergence and
// every live document validates against the real model.
export const Blacklist = RealBlacklist;

export { mongoose };