// Plan 01 §16 — shared helpers for the three ways user input reaches a Mongo
// query unsafely: as a regex, as a sort field, as a projection field.
//
// `app/api/amenities/route.js:35` already escaped its search regex before
// this file existed; everywhere else in the app that built a `$regex` filter
// used the raw, unescaped search string. A malicious or merely careless
// input (an unbalanced group, a pathological `(a+)+$`) reaches MongoDB's
// regex engine as-is — at best a 500 from an invalid pattern, at worst a
// slow query an attacker can repeat. Escaping regex metacharacters removes
// both: the string only ever matches itself, literally.

/**
 * Escape every regex metacharacter in `input` so it can be embedded in a
 * larger pattern (e.g. anchored with `^`/`$` for an exact-match search) and
 * still only ever match itself, literally. Exported separately from
 * `safeRegex` because anchoring has to wrap the ALREADY-escaped string —
 * escaping `^input$` as a whole would turn the anchors themselves into
 * literal characters instead of anchors.
 *
 * @param {string} input
 * @returns {string}
 */
export function escapeRegex(input) {
  return String(input ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a case-insensitive RegExp that matches `input` LITERALLY — every
 * regex metacharacter is escaped first, so a search box can never become a
 * regex-injection or ReDoS vector.
 *
 * @param {string} input
 * @param {string} [flags="i"]
 * @returns {RegExp}
 */
export function safeRegex(input, flags = "i") {
  return new RegExp(escapeRegex(input), flags);
}

/**
 * Turn a client-supplied sort field into a Mongoose `.sort()` argument, or
 * `null` if the field isn't one the route allows sorting by. Never passes
 * the client's string straight into `.sort()` — that would let a request
 * name any field, including ones that leak existence/cardinality of data
 * the response otherwise hides (e.g. sorting members by a field the caller
 * cannot read), or a `$`-prefixed key that changes `.sort()`'s meaning.
 *
 * @param {string} input - client-supplied field name, optionally prefixed with "-" for descending
 * @param {string[]} allowed - field names this route permits sorting by
 * @returns {Record<string, 1|-1>|null}
 */
export function safeSort(input, allowed) {
  if (!input || typeof input !== "string") return null;
  const desc = input.startsWith("-");
  const field = desc ? input.slice(1) : input;
  if (!allowed.includes(field)) return null;
  return { [field]: desc ? -1 : 1 };
}

/**
 * Turn a client-supplied field list into a Mongoose `.select()` projection
 * containing only fields the route allows projecting. A projection built
 * from an unchecked client list can be used to pull fields the response
 * shape was deliberately built to omit (a password hash, another member's
 * private field) — this keeps the caller's list within an allowlist instead
 * of trusting it.
 *
 * @param {string[]|string} input - field names, or a comma-separated string of them
 * @param {string[]} allowed - field names this route permits projecting
 * @returns {string} space-joined field list safe to pass to `.select()`; empty string means "no restriction requested, or nothing valid was asked for"
 */
export function safeProjection(input, allowed) {
  const requested = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",").map((s) => s.trim())
      : [];
  const allowedSet = new Set(allowed);
  return requested.filter((f) => allowedSet.has(f)).join(" ");
}

/**
 * True if any key in a (shallow) object begins with `$` or contains `.` —
 * the two shapes that change a Mongo query's meaning when they reach a
 * filter (`$where`, `$gt`, dotted paths that reach into a nested field the
 * caller shouldn't be able to name directly). Call before merging any
 * client-supplied object into a filter or update; a validated zod shape
 * upstream should already rule this out, but this is the backstop for the
 * dynamic/partial-update routes that build a filter from a loop over
 * `Object.keys(body)` rather than a fixed schema.
 *
 * @param {Record<string, unknown>} obj
 * @returns {boolean}
 */
export function hasDangerousKeys(obj) {
  if (!obj || typeof obj !== "object") return false;
  return Object.keys(obj).some((k) => k.startsWith("$") || k.includes("."));
}
