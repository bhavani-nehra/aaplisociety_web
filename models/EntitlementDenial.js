import mongoose from "mongoose";

/**
 * One row per refused request for a module a society does not own.
 *
 * ## Why this is stored at all
 *
 * The gate returns a bare 404, which is right — a 403 is a product catalogue
 * for anyone mapping the platform. The cost is that support will one day stare
 * at a 404 on a route that plainly exists and have nothing to look at. This is
 * the thing to look at.
 *
 * ## Why it is read as a sales signal, not a security one
 *
 * The overwhelmingly likely explanation for a society repeatedly hitting
 * Amenities routes is that somebody at that society wants Amenities. Treating
 * that as an intrusion attempt reads the signal exactly backwards. The alert
 * this feeds is shaped like a lead, and its primary action is "Grant Amenities".
 *
 * ## Retention
 *
 * 90 days. Long enough to see a pattern across a billing cycle and answer a
 * support question about last month; short enough that we are not accumulating
 * a behavioural record of named individuals indefinitely, which is exactly the
 * open-ended retention the offboarding work exists to close.
 */
const EntitlementDenialSchema = new mongoose.Schema(
  {
    societyId: { type: mongoose.Schema.Types.ObjectId, ref: "Society", required: true, index: true },
    // Captured now — a purge or a rename must not make an old alert unreadable.
    societyName: { type: String },
    module: { type: String, required: true, index: true },

    // Who knocked. Enough to say "Suresh tried this twelve times", not enough
    // to reconstruct anyone's browsing.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    userName: { type: String },
    role: { type: String },

    method: { type: String },
    path: { type: String, required: true },
    ip: { type: String },
    // "web" | "app" — which surface asked, so an alert can say whether this is
    // an admin clicking around or a mobile build that never got updated.
    surface: { type: String },

    // No `index: true` here — the explicit TTL index below already covers
    // {at: 1}; declaring both throws Mongoose's duplicate-schema-index warning.
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// Powers the alert digest: everything for one society since a timestamp.
EntitlementDenialSchema.index({ societyId: 1, at: -1 });
// TTL. Mongo drops the row 90 days after `at` with no cron and nothing to
// forget to run.
EntitlementDenialSchema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.models.EntitlementDenial ||
  mongoose.model("EntitlementDenial", EntitlementDenialSchema);
