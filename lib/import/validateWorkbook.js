// lib/import/validateWorkbook.js
//
// The validation engine. Runs UNCHANGED in the browser and on the server.
//
// - Browser: called on every cell edit (debounced) so errors appear live and
//   the admin never round-trips to fix a typo.
// - Server:  called once inside POST /api/admin/bulk-import before anything is
//   written. Same input, same rules, same output.
//
// This is why the file has no imports beyond the schema and touches no
// browser or node globals. It must stay isomorphic.
//
// FLAGGED 2026-09-22 (final_audit_fix_plan Run 25): the two bullets above are
// no longer true. `grep -rl "validateWorkbook"` finds only this file — no
// browser upload wizard and no server route imports it. The live server path
// is lib/import/bulkImportValidate.js (a separate, hand-written validator),
// called from app/api/admin/bulk-import/preview/route.js. Its noOverlap and
// uniqueByKey rule handling (below) has been ported there so ownerHistory/
// tenantHistory overlap and shop/vehicle/category uniqueness are actually
// enforced — but this file itself is orphaned. Decide keep (wire it back in,
// e.g. for live client-side cell validation, which nothing currently does)
// or delete (bulkImportValidate.js already duplicates its server-side role).
// Not deleted here — that's a call for whoever owns this workstream, not an
// unasked cleanup.

import { SHEETS, PATTERNS, ENUMS, CROSS_RULES } from "./importSchema";

const rxCache = new Map();
function rx(name) {
  if (!rxCache.has(name)) rxCache.set(name, new RegExp(PATTERNS[name]));
  return rxCache.get(name);
}

const norm = (v) => String(v ?? "").trim();
const lower = (v) => norm(v).toLowerCase();
const isEmpty = (v) => norm(v) === "";

/** True when every cell in the row is blank - such rows are ignored, not flagged. */
export function isBlankRow(row, columns) {
  return columns.every((c) => isEmpty(row?.[c.key]));
}

// ── Single cell ───────────────────────────────────────────────────────────
/**
 * Validate one cell against its column descriptor.
 * @returns {string|null} error message, or null when valid
 */
export function validateCell(col, rawValue, row = {}) {
  const value = norm(rawValue);

  if (isEmpty(value)) {
    return col.required ? `${col.label} is required` : null;
  }

  switch (col.type) {
    case "number":
    case "money":
    case "area": {
      // Accept "1,200" and "₹1,200" - admins paste from other sheets.
      const cleaned = value.replace(/[,\s₹]/g, "");
      const n = Number(cleaned);
      if (!Number.isFinite(n)) return `${col.label} must be a number`;
      if (col.min !== undefined && n < col.min)
        return `${col.label} must be at least ${col.min}`;
      if (col.max !== undefined && n > col.max)
        return `${col.label} must be at most ${col.max}`;
      if ((col.type === "money" || col.type === "area") && n < 0)
        return `${col.label} cannot be negative`;
      break;
    }

    case "date": {
      if (col.pattern && !rx(col.pattern).test(value))
        return `${col.label} must be YYYY-MM-DD`;
      const d = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return `${col.label} is not a real date`;
      // Catch 2026-02-31, which Date silently rolls over to March.
      if (d.toISOString().slice(0, 10) !== value)
        return `${col.label} is not a real calendar date`;
      if (col.afterField && !isEmpty(row[col.afterField])) {
        const start = new Date(`${norm(row[col.afterField])}T00:00:00Z`);
        if (!Number.isNaN(start.getTime()) && d < start)
          return `${col.label} cannot be before ${col.afterField}`;
      }
      break;
    }

    case "select": {
      const allowed = ENUMS[col.options] || [];
      if (!allowed.some((o) => o.toLowerCase() === value.toLowerCase()))
        return `${col.label} must be one of: ${allowed.join(", ")}`;
      break;
    }

    case "email":
      if (!rx("email").test(value)) return `"${value}" is not a valid email`;
      break;

    case "phone": {
  const cleaned = value.replace(/[\s\-()]/g, "");
  const hasPlus = cleaned.startsWith("+");
  const digits = cleaned.replace(/^\+/, "");
  // Only strip a leading 91 as country code when it was written with "+91".
  // A bare "91xxxxxxxxxx" is ambiguous with a real mobile number starting
  // with 91 (e.g. 9152345678), so it is rejected rather than guessed at.
  const local = hasPlus && digits.length === 12 && digits.startsWith("91")
    ? digits.slice(2)
    : digits;
  if (!rx("phoneIN").test(local)) {
    return digits.length === 12 && digits.startsWith("91") && !hasPlus
      ? `${col.label} must include "+" before the country code (use +91${digits.slice(2)}, not ${digits})`
      : `${col.label} must be a 10-digit Indian mobile number`;
  }
  break;
}

    default:
      if (col.pattern && !rx(col.pattern).test(value))
        return `${col.label} format is invalid${col.help ? ` (${col.help})` : ""}`;
  }

  return null;
}

// ── Whole workbook ──────────────────────────────────────────────────────
/**
 * @param {Record<string, Array<Object>>} data  sheetId -> rows
 * @returns {{
 *   ok: boolean,
 *   cellErrors: Record<string, Record<number, Record<string, string>>>,
 *   sheetErrors: Record<string, string[]>,
 *   counts: Record<string, {rows:number, errors:number}>,
 *   totalErrors: number
 * }}
 */
export function validateWorkbook(data) {
  const cellErrors = {};
  const sheetErrors = {};
  const counts = {};

  const err = (sheetId, rowIdx, colKey, message) => {
    cellErrors[sheetId] ??= {};
    cellErrors[sheetId][rowIdx] ??= {};
    // Keep the first error per cell - showing five at once is noise.
    cellErrors[sheetId][rowIdx][colKey] ??= message;
  };

  // Pass 1: per-cell + per-sheet uniqueness
  for (const sheet of SHEETS) {
    const rows = (data[sheet.id] || []).filter(
      (r) => !isBlankRow(r, sheet.columns),
    );
    counts[sheet.id] = { rows: rows.length, errors: 0 };
    sheetErrors[sheet.id] = [];

    if (sheet.required && rows.length < (sheet.minRows ?? 1)) {
      sheetErrors[sheet.id].push(
        `${sheet.title} needs at least ${sheet.minRows ?? 1} row.`,
      );
    }
    if (sheet.maxRows && rows.length > sheet.maxRows) {
      sheetErrors[sheet.id].push(
        `${sheet.title} has ${rows.length} rows; the limit is ${sheet.maxRows}.`,
      );
    }

    const seenSimple = new Map(); // colKey -> Map(value -> firstRowIdx)
    const seenComposite = new Map(); // "wing|flat" -> firstRowIdx

    rows.forEach((row, i) => {
      for (const col of sheet.columns) {
        const message = validateCell(col, row[col.key], row);
        if (message) err(sheet.id, i, col.key, message);

        // Per-sheet single-column uniqueness
        if (col.unique === "sheet" && !isEmpty(row[col.key])) {
          const map = seenSimple.get(col.key) || new Map();
          const v = lower(row[col.key]);
          if (map.has(v)) {
            err(
              sheet.id,
              i,
              col.key,
              `Duplicate ${col.label} "${norm(row[col.key])}" (also row ${map.get(v) + 1})`,
            );
          } else {
            map.set(v, i);
          }
          seenSimple.set(col.key, map);
        }
      }

      // Composite wing+flatNo uniqueness on the Members sheet
      if (sheet.columns.some((c) => c.unique === "wing+flatNo")) {
        const key = `${lower(row.wing)}|${lower(row["flatNo*"])}`;
        if (!isEmpty(row["flatNo*"])) {
          if (seenComposite.has(key)) {
            err(
              sheet.id,
              i,
              "flatNo*",
              `Flat ${norm(row.wing)}-${norm(row["flatNo*"])} is already on row ${seenComposite.get(key) + 1}`,
            );
          } else {
            seenComposite.set(key, i);
          }
        }
      }
    });
  }

  // Pass 2: cross-sheet rules
  const basicRows = (data.basicInfo || []).filter(
    (r) => !isBlankRow(r, SHEETS[1].columns),
  );
  const knownFlats = new Set(
    basicRows.map((r) => lower(r["flatNo*"])).filter(Boolean),
  );

  for (const rule of CROSS_RULES) {
    switch (rule.kind) {
      case "fk": {
        for (const sheetId of rule.appliesTo) {
          const sheet = SHEETS.find((s) => s.id === sheetId);
          const rows = (data[sheetId] || []).filter(
            (r) => !isBlankRow(r, sheet.columns),
          );
          rows.forEach((row, i) => {
            const v = lower(row["flatNo*"]);
            if (v && !knownFlats.has(v)) {
              err(
                sheetId,
                i,
                "flatNo*",
                rule.message.replace("{value}", norm(row["flatNo*"])),
              );
            }
          });
        }
        break;
      }

      case "ownerScopedEmail": {
        // THE multi-flat rule. Same email + same owner = one person with
        // several flats, which is legitimate and becomes one account with
        // several profiles. Same email + different owner = a copy-paste
        // mistake.
        const seen = new Map(); // email -> { owner, rowIdx }
        basicRows.forEach((row, i) => {
          const email = lower(row[rule.emailColumn]);
          if (!email) return;
          const owner = lower(row[rule.ownerColumn]);
          const prior = seen.get(email);
          if (prior && prior.owner !== owner) {
            err(
              rule.sheet,
              i,
              rule.emailColumn,
              rule.message
                .replace("{value}", norm(row[rule.emailColumn]))
                .replace("{other}", norm(basicRows[prior.rowIdx][rule.ownerColumn])),
            );
          } else if (!prior) {
            seen.set(email, { owner, rowIdx: i });
          }
        });
        break;
      }

      case "atMostOne": {
        const sheet = SHEETS.find((s) => s.id === rule.sheet);
        const rows = (data[rule.sheet] || []).filter(
          (r) => !isBlankRow(r, sheet.columns),
        );
        const groups = new Map();
        rows.forEach((row, i) => {
          if (lower(row[rule.whenColumn]) !== lower(rule.whenValue)) return;
          const g = lower(row[rule.groupBy]);
          if (!g) return;
          if (groups.has(g)) {
            err(
              rule.sheet,
              i,
              rule.whenColumn,
              rule.message.replace("{group}", norm(row[rule.groupBy])),
            );
          } else {
            groups.set(g, i);
          }
        });
        break;
      }

      // Plan 02 §21 — two rows for the same flat whose periods overlap.
      //
      // Per-row validation already rejects "end before start". This is the
      // thing it cannot see: a contradiction BETWEEN rows, where the flat's
      // history claims two owners (or two tenants) on the same date.
      case "noOverlap": {
        const sheet = SHEETS.find((s) => s.id === rule.sheet);
        const rows = (data[rule.sheet] || []).filter(
          (r) => !isBlankRow(r, sheet.columns),
        );

        // Group by flat, carrying each row's original index so the error can be
        // reported on the row the admin is actually looking at.
        const byGroup = new Map();
        rows.forEach((row, i) => {
          const g = lower(row[rule.groupBy]);
          if (!g) return;
          const startRaw = norm(row[rule.startColumn]);
          if (!startRaw) return; // a missing start is already a required-field error
          const start = Date.parse(startRaw);
          if (Number.isNaN(start)) return; // already a date-format error
          const endRaw = norm(row[rule.endColumn]);
          // An OPEN period runs to the present. This is what catches the common
          // real mistake: the previous owner was never closed off, so the next
          // owner starts while the old one is still recorded as current.
          const parsedEnd = endRaw ? Date.parse(endRaw) : NaN;
          const end = Number.isNaN(parsedEnd) ? Date.now() : parsedEnd;
          if (!byGroup.has(g)) byGroup.set(g, []);
          byGroup.get(g).push({ i, start, end, open: !endRaw, label: norm(row[rule.groupBy]) });
        });

        for (const [, periods] of byGroup) {
          if (periods.length < 2) continue;
          // Sorted, so only adjacent pairs need comparing rather than every
          // pair — and so the error lands on the LATER row, which is the one
          // the admin most likely added.
          periods.sort((a, b) => a.start - b.start);
          for (let k = 1; k < periods.length; k += 1) {
            const prev = periods[k - 1];
            const cur = periods[k];
            // Touching is fine: one period ending the same day another begins
            // is how a handover is normally recorded. Strict `<` so only real
            // overlap is flagged.
            if (cur.start < prev.end) {
              err(
                rule.sheet,
                cur.i,
                rule.startColumn,
                rule.message
                  .replace("{group}", cur.label)
                  .replace("{other}", `row ${prev.i + 1}`),
              );
            }
          }
        }
        break;
      }

      case "uniqueByKey": {
        const sheet = SHEETS.find((s) => s.id === rule.sheet);
        const rows = (data[rule.sheet] || []).filter(
          (r) => !isBlankRow(r, sheet.columns),
        );
        const seen = new Map();
        rows.forEach((row, i) => {
          const v = lower(row[rule.column]);
          if (!v) return;
          if (seen.has(v)) {
            err(
              rule.sheet,
              i,
              rule.column,
              rule.message.replace("{value}", norm(row[rule.column])),
            );
          } else {
            seen.set(v, i);
          }
        });
        break;
      }

      // §17 - ordering for values compareColumns cannot handle.
      //
      // compareColumns coerces both sides with Number() and returns early on
      // NaN, so it silently passes every date and every "HH:mm" time. Both of
      // those formats are zero-padded and fixed-width, so a plain string
      // comparison orders them correctly and needs no parsing.
      // §17 - referential checks driven by the column descriptors themselves.
      //
      // The "fk" rule above is hardcoded to the column `flatNo*` and to an
      // explicit appliesTo list, so it cannot express "this shop's category
      // must exist on the Commercial Categories sheet" or "this shop's owner
      // flat must exist". Meanwhile every column already carries an
      // `fk: { sheet, column }` descriptor that nothing read.
      //
      // This walks those descriptors, so a new sheet declaring an fk is
      // checked the day it is added with no rule to remember to write.
      case "columnFk": {
        for (const sheet of SHEETS) {
          const fkCols = sheet.columns.filter((c) => c.fk);
          if (fkCols.length === 0) continue;
          const rows = (data[sheet.id] || []).filter(
            (r) => !isBlankRow(r, sheet.columns),
          );
          if (rows.length === 0) continue;

          for (const col of fkCols) {
            const target = SHEETS.find((s) => s.id === col.fk.sheet);
            if (!target) continue;
            const targetRows = (data[col.fk.sheet] || []).filter(
              (r) => !isBlankRow(r, target.columns),
            );
            const known = new Set(
              targetRows.map((r) => lower(r[col.fk.column])).filter(Boolean),
            );
            rows.forEach((row, i) => {
              const raw = norm(row[col.key]);
              // Blank is fine: an fk column is only required if it also
              // carries `required`, which the per-cell pass enforces.
              if (!raw) return;
              if (known.has(lower(raw))) return;
              err(
                sheet.id,
                i,
                col.key,
                `${col.label} "${raw}" is not listed in "${target.title}"`,
              );
            });
          }
        }
        break;
      }

      // One column becomes mandatory because of what another column says.
      // The per-cell pass only knows unconditional `required`.
      case "requiredWhen": {
        const sheet = SHEETS.find((s) => s.id === rule.sheet);
        const rows = (data[rule.sheet] || []).filter(
          (r) => !isBlankRow(r, sheet.columns),
        );
        rows.forEach((row, i) => {
          if (lower(row[rule.whenColumn]) !== lower(rule.whenValue)) return;
          if (norm(row[rule.requiredColumn])) return;
          err(rule.sheet, i, rule.requiredColumn, rule.message);
        });
        break;
      }

      case "beforeAfter": {
        const sheet = SHEETS.find((s) => s.id === rule.sheet);
        const rows = (data[rule.sheet] || []).filter(
          (r) => !isBlankRow(r, sheet.columns),
        );
        rows.forEach((row, i) => {
          const l = norm(row[rule.left]);
          const r = norm(row[rule.right]);
          // An absent end date means "still running", not an error.
          if (!l || !r) return;
          if (r < l) err(rule.sheet, i, rule.right, rule.message);
        });
        break;
      }

      case "compareColumns": {
        const sheet = SHEETS.find((s) => s.id === rule.sheet);
        const rows = (data[rule.sheet] || []).filter(
          (r) => !isBlankRow(r, sheet.columns),
        );
        rows.forEach((row, i) => {
          const l = norm(row[rule.left]);
          const r = norm(row[rule.right]);
          if (rule.skipWhenEmpty && (isEmpty(l) || isEmpty(r))) return;
          const ln = Number(l.replace(/[,\s₹]/g, ""));
          const rn = Number(r.replace(/[,\s₹]/g, ""));
          if (!Number.isFinite(ln) || !Number.isFinite(rn)) return;
          const pass = rule.op === ">=" ? ln >= rn : ln <= rn;
          if (!pass) err(rule.sheet, i, rule.left, rule.message);
        });
        break;
      }
    }
  }

  // Tally
  let totalErrors = 0;
  for (const sheetId of Object.keys(counts)) {
    const perRow = cellErrors[sheetId] || {};
    const n = Object.values(perRow).reduce(
      (acc, cols) => acc + Object.keys(cols).length,
      0,
    );
    counts[sheetId].errors = n + (sheetErrors[sheetId]?.length || 0);
    totalErrors += counts[sheetId].errors;
  }

  return {
    ok: totalErrors === 0,
    cellErrors,
    sheetErrors,
    counts,
    totalErrors,
  };
}

/**
 * Warnings never block submission. They are the "are you sure" layer:
 * things that are legal but usually a mistake.
 */
export function collectWarnings(data) {
  const warnings = [];
  const basic = (data.basicInfo || []).filter(
    (r) => !isBlankRow(r, SHEETS[1].columns),
  );

  const noEmail = basic.filter((r) => isEmpty(r["emailPrimary*"]));
  if (noEmail.length) {
    warnings.push(
      `${noEmail.length} flat(s) have no email. They get a member record but NO login account and NO onboarding email: ${noEmail
        .slice(0, 8)
        .map((r) => `${norm(r.wing)}-${norm(r["flatNo*"])}`)
        .join(", ")}${noEmail.length > 8 ? ", …" : ""}`,
    );
  }

  // Multi-flat owners - surfaced as information, since it drives account merging.
  const byEmail = new Map();
  for (const r of basic) {
    const e = lower(r["emailPrimary*"]);
    if (!e) continue;
    byEmail.set(e, [...(byEmail.get(e) || []), `${norm(r.wing)}-${norm(r["flatNo*"])}`]);
  }
  const multi = [...byEmail.entries()].filter(([, flats]) => flats.length > 1);
  if (multi.length) {
    warnings.push(
      `${multi.length} owner(s) hold several flats and will get ONE login with a profile per flat: ${multi
        .slice(0, 5)
        .map(([e, flats]) => `${e} (${flats.join(", ")})`)
        .join("; ")}${multi.length > 5 ? "; …" : ""}`,
    );
  }

  const society = (data.society || [])[0] || {};
  // Keys must match SOCIETY_COLUMNS in importSchema.js and rowToSocietyPayload()
// in the import route. Stale names here make society[k] undefined, which
// silently fires the "all rates are 0" warning on every import.
const rates = [
  "Maintenance Rate (Per Sq Ft)",
  "Sinking Fund Rate (Per Sq Ft)",
  "Repair Fund Rate (Per Sq Ft)",
  "Water Charges (Fixed)",
  "Security Charges (Fixed)",
  "Electricity Charges (Fixed)",
];
  if (rates.every((k) => !Number(norm(society[k]).replace(/[,\s₹]/g, "")))) {
    warnings.push(
      "Every billing rate is 0. The import will succeed but generated bills will be ₹0 until you set rates in Society Config.",
    );
  }

  return warnings;
}
