// Plan 01 §19 — a redacting logger. A spot-check across every `console.*`
// call whose argument mentions token/password/secret/authorization/body/
// claims/decoded (2026-09-22) found none logging a raw secret value today —
// the risk this file closes is a FUTURE regression, not a live leak: someone
// adding `console.log(req.body)` on an auth route later, without meaning to
// print a password alongside it.
//
// Not built into lib/appserverlogs.js — that file's own header says
// "TEMP DEV TOOL — DELETE," so it is the wrong permanent home for this.

const SENSITIVE_KEYS = /^(password|newPassword|oldPassword|plainPassword|tempPassword|token|accessToken|refreshToken|secret|authorization|otp|pin|apiKey)$/i;

/**
 * Deep-clones `value`, replacing any object key matching a known-sensitive
 * name with `"[REDACTED]"`. Arrays and nested objects are walked; anything
 * that isn't a plain object/array (a string, a Mongoose document, a Buffer)
 * is returned as-is at that position — this is for logging shallow request
 * bodies and JWT payloads, not for serializing arbitrary class instances.
 *
 * @param {unknown} value
 * @param {number} [depth] internal recursion guard
 * @returns {unknown}
 */
export function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redact(val, depth + 1);
  }
  return out;
}

/**
 * `console.error`/`console.log` replacement for call sites that need to log
 * a request body, decoded JWT claims, or similar — redacts sensitive keys
 * before they reach the log, rather than trusting every future caller to
 * remember to.
 *
 * @param {"log"|"warn"|"error"} level
 * @param {string} message
 * @param {unknown} [data]
 */
export function safeLog(level, message, data) {
  if (data === undefined) {
    console[level](message);
  } else {
    console[level](message, redact(data));
  }
}
