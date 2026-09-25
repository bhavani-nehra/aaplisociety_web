"use client";

// CHANGED 2026-08-07: added optional expandable rows.
//
// Purely additive — a row without an `expanded` value renders exactly as before,
// so every existing caller (categories, businesses, moderation) is untouched.
// The Units screen uses it to open a unit's setup panel inline, instead of
// sending the admin to a second screen to re-type details the flat already has.

export default function Table({ cols, rows, onRowClick, emptyText = "Nothing here yet." }) {
  if (!rows.length) {
    return <div style={{ padding: "36px 12px", textAlign: "center", color: "var(--cx-fg-4)", fontSize: 13 }}>{emptyText}</div>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
      <thead>
        <tr>
          {cols.map((c, i) => (
            <th key={i} style={{
              textAlign: c.align || "left", padding: "8px 12px", fontSize: 10, fontWeight: 600,
              color: "var(--cx-fg-4)", 
              borderBottom: "1px solid var(--cx-border)", background: "var(--cx-surface-2)",
            }}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <FragmentRow key={i} r={r} i={i} cols={cols} onRowClick={onRowClick} />
        ))}
      </tbody>
    </table>
  );
}

function FragmentRow({ r, i, cols, onRowClick }) {
  return (
    <>
      <tr
        onClick={() => onRowClick && onRowClick(r, i)}
        style={{ cursor: onRowClick ? "pointer" : "default" }}
      >
        {r.cells.map((cell, j) => (
          <td key={j} style={{
            padding: "10px 12px",
            // The divider is dropped when a panel is open directly beneath, so
            // the row and its panel read as one block.
            borderBottom: r.expanded ? "none" : "1px solid var(--cx-border)",
            textAlign: cols[j].align || "left", color: "var(--cx-fg-2)",
            fontVariantNumeric: cols[j].num ? "tabular-nums" : "normal",
            verticalAlign: "top",
          }}>{cell}</td>
        ))}
      </tr>
      {r.expanded ? (
        <tr>
          <td colSpan={cols.length} style={{ padding: 0, borderBottom: "1px solid var(--cx-border)" }}>
            {r.expanded}
          </td>
        </tr>
      ) : null}
    </>
  );
}
