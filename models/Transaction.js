import mongoose from "mongoose";
const TransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    memberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Member",
      required: true,
      index: true,
    },
    // Mirrors Bill.shopId (models/Bill.js): a commercial transaction's unit.
    // memberId above still gets written (the owner if linked, or the shop id
    // itself when there is no owner — never left unset, since it's required),
    // but a shop's own ledger reads/writes must key on shopId, not memberId.
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shop",
      default: null,
      index: true,
    },
    billSeries: {
      type: String,
      enum: ["RESIDENTIAL", "COMMERCIAL"],
      default: "RESIDENTIAL",
    },
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Society",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["Debit", "Credit"],
      required: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Maintenance",
        "Arrears",
        "Interest",
        "Payment",
        "Adjustment",
        "Refund",
        "Fine",
        "Opening Balance",
      ],
    },
    description: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    // For Payment transactions: how much of amount cleared interest vs principal
    interestCleared: {
      type: Number,
      default: 0,
    },
    principalCleared: {
      type: Number,
      default: 0,
    },
    balanceAfterTransaction: {
      type: Number,
      required: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "referenceModel",
    },
    referenceModel: {
      type: String,
      enum: ["Bill", "Payment", "Member"],
    },
    billPeriodId: {
      type: String,
      index: true,
    },
    notes: { type: String, trim: true },
    // Payment breakdown for transparency (interestCleared, principalCleared, advanceCredit)
    paymentBreakdown: {
      interestCleared: { type: Number, default: 0 },
      principalCleared: { type: Number, default: 0 },
      advanceCredit: { type: Number, default: 0 },
    },
    // How this payment was spread over the member's bills, kept so it can be
    // reversed exactly (lib/services/PaymentReversalService.js). Absent on
    // payments recorded before this existed.
    allocations: {
      type: [
        new mongoose.Schema(
          {
            billId: { type: mongoose.Schema.Types.ObjectId },
            interestCleared: { type: Number, default: 0 },
            principalCleared: { type: Number, default: 0 },
            attributed: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    paymentMode: {
      type: String,
      enum: ["Cash", "Cheque", "Online", "UPI", "NEFT", "RTGS", "System"],
    },
    // Collection-sheet commit key: one sheet submission = one token, so a
    // double-click or retry finds the first run's rows and does not post twice.
    commitToken: { type: String },
    // Top-level payment fields (used by record route)
    chequeNo: { type: String },
    bankName: { type: String },
    upiId: { type: String },
    transactionRef: { type: String },
    // Also keep nested for backwards compat
    paymentDetails: {
      chequeNo: String,
      bankName: String,
      transactionRef: String,
      upiId: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isReversed: {
      type: Boolean,
      default: false,
    },
    reversalTransactionId: {
      type: String,
    },
    financialYear: {
      type: String,
      index: true,
    },
    // Bulk-import provenance — see Society.importRunId
    importRunId: { type: String, default: null, index: true },
  },
  {
    timestamps: true,
  },
);
TransactionSchema.index({ societyId: 1, memberId: 1, date: -1 });
TransactionSchema.index({ societyId: 1, category: 1, date: -1 });
TransactionSchema.index({ societyId: 1, financialYear: 1 });
TransactionSchema.index({ societyId: 1, commitToken: 1 }, { sparse: true });
TransactionSchema.statics.generateTransactionId = function () {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TXN${timestamp}${random}`;
};
export default mongoose.models.Transaction ||
  mongoose.model("Transaction", TransactionSchema);
