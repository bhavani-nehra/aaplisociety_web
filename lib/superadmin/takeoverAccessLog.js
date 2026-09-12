import connectDB from "@/lib/mongodb";
import TakeoverAccessLog from "@/models/TakeoverAccessLog";

/**
 * Record one request made under an impersonation token. Called
 * fire-and-forget from lib/authz.js#requireAuth — never awaited by the
 * caller, so a slow or failing write can never affect the real request.
 * Safe to leave unawaited here: this app runs as a long-lived Node process
 * on Coolify/Docker, not short-lived serverless functions, so the promise
 * still completes after the response is sent (unlike on Vercel/edge — see
 * lib/entitlements/denials.js for that constraint elsewhere in this repo).
 */
export async function logTakeoverAccess({ grantId, method, path }) {
  try {
    await connectDB();
    await TakeoverAccessLog.create({ grantId, method, path });
  } catch (err) {
    // Never let a logging failure be visible anywhere — losing one access
    // row is not worth surfacing an error for.
    console.error("takeover access log failed:", err?.message || err);
  }
}
