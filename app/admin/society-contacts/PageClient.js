"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import styles from "@/styles/Dashboard.module.css";
import gridStyles from "@/styles/BillingGrid.module.css";
import { produce } from "immer";

const CATEGORIES = [
  "Society Office",
  "Watchman/Security",
  "Plumber",
  "Electrician",
  "Gas Agency",
  "Housekeeping",
  "Pest Control",
  "Lift AMC",
  "Emergency",
  "Helpline",
  "Utility",
  "Other",
];

// These are the numbers the resident app's Essential Contacts screen already
// ships hardcoded (see aaplisociety_app essential_contacts_page.dart) — real,
// nationwide numbers that don't vary per society. "Seed defaults" fills these
// in fully (name + number, nothing left blank) so the admin only has to type
// the numbers that ARE society-specific: the office, watchman, plumber, etc.
const NATIONAL_SEEDS = [
  { category: "Emergency", name: "Police", number: "100" },
  { category: "Emergency", name: "Fire brigade", number: "101" },
  { category: "Emergency", name: "Ambulance", number: "102" },
  { category: "Emergency", name: "Emergency ambulance (108)", number: "108" },
  { category: "Emergency", name: "Disaster management", number: "1078" },
  { category: "Helpline", name: "Women's helpline", number: "1091" },
  { category: "Helpline", name: "Child helpline", number: "1098" },
  { category: "Helpline", name: "Senior citizen helpline", number: "14567" },
  { category: "Helpline", name: "Cyber crime / online fraud", number: "1930" },
  { category: "Utility", name: "Electricity breakdown (MSEDCL)", number: "1912" },
  { category: "Utility", name: "LPG gas leak emergency", number: "1906" },
  { category: "Utility", name: "Water supply complaint", number: "1916" },
];

let nextRowId = 0;
const blankRow = (category, name = "", numbers = [""]) => ({
  _rowId: nextRowId++,
  category,
  name,
  numbers,
});

const contactsToRows = (contacts) =>
  (contacts || []).map((c) => ({
    _rowId: nextRowId++,
    category: c.category,
    name: c.name || "",
    numbers: c.numbers.length > 0 ? c.numbers : [""],
  }));

export default function SocietyContactsPage() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [successMessage, setSuccessMessage] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["society-contacts"],
    queryFn: () => apiClient.get("/api/admin/society-contacts"),
  });

  useEffect(() => {
    if (!data?.contacts) return;
    setRows(contactsToRows(data.contacts));
  }, [data]);

  const savedShape = (data?.contacts || []).map((c) => ({
    category: c.category,
    name: c.name || "",
    numbers: c.numbers.length > 0 ? c.numbers : [""],
  }));
  const isDirty =
    JSON.stringify(rows.map(({ _rowId, ...r }) => r)) !== JSON.stringify(savedShape);

  const handleCancel = () => setRows(contactsToRows(data?.contacts));

  const saveMutation = useMutation({
    mutationFn: (contacts) => apiClient.put("/api/admin/society-contacts", { contacts }),
    onSuccess: () => {
      setSuccessMessage("✅ Essential contacts saved");
      setErrors([]);
      queryClient.invalidateQueries(["society-contacts"]);
      setTimeout(() => setSuccessMessage(""), 5000);
    },
    onError: (error) => {
      setErrors([error.message || "Save failed"]);
    },
  });

  const updateRow = (rowId, patch) =>
    setRows((prev) =>
      produce(prev, (draft) => {
        const row = draft.find((r) => r._rowId === rowId);
        if (row) Object.assign(row, patch);
      }),
    );

  const updateNumber = (rowId, idx, value) =>
    setRows((prev) =>
      produce(prev, (draft) => {
        const row = draft.find((r) => r._rowId === rowId);
        if (!row) return;
        row.numbers[idx] = value;
      }),
    );

  // Adds one more empty number box, up to the cap of 3. Admin clicks it
  // explicitly instead of always seeing 3 boxes.
  const addNumberSlot = (rowId) =>
    setRows((prev) =>
      produce(prev, (draft) => {
        const row = draft.find((r) => r._rowId === rowId);
        if (row && row.numbers.length < 3) row.numbers.push("");
      }),
    );

  const removeRow = (rowId) => setRows((prev) => prev.filter((r) => r._rowId !== rowId));

  const addRow = () => setRows((prev) => [...prev, blankRow(CATEGORIES[0])]);

  // Fills in the nationwide numbers (already known — see NATIONAL_SEEDS)
  // fully, and adds a blank row for the remaining, society-specific
  // categories that only the admin can fill in. Existing rows (including
  // ones the admin is mid-editing) are left untouched.
  const seedDefaults = () => {
    const present = new Set(rows.map((r) => `${r.category}::${r.name}`));
    const presentCategories = new Set(rows.map((r) => r.category));
    const manualCategories = [
      "Society Office",
      "Watchman/Security",
      "Plumber",
      "Electrician",
      "Gas Agency",
      "Housekeeping",
      "Pest Control",
      "Lift AMC",
    ];
    const seeded = NATIONAL_SEEDS.filter((s) => !present.has(`${s.category}::${s.name}`)).map(
      (s) => blankRow(s.category, s.name, [s.number]),
    );
    const manual = manualCategories
      .filter((c) => !presentCategories.has(c))
      .map((c) => blankRow(c));
    const additions = [...seeded, ...manual];
    if (additions.length === 0) {
      setSuccessMessage("Every default is already here.");
      setTimeout(() => setSuccessMessage(""), 4000);
      return;
    }
    setRows((prev) => [...prev, ...additions]);
  };

  const handleSave = () => {
    const payload = rows
      .map((r) => ({
        category: r.category,
        name: r.name.trim(),
        numbers: r.numbers.map((n) => n.trim()).filter(Boolean),
      }))
      .filter((r) => r.numbers.length > 0);
    saveMutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "40px" }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "820px", margin: "0 auto" }}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Essential Contacts</h1>
          <p className={styles.pageSubtitle}>
            Numbers a resident actually needs — society office, watchman, plumber, gas agency and
            more. Shown on the &ldquo;Essential contacts&rdquo; screen in the resident app.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" onClick={seedDefaults} className="btn btn-secondary">
            🌱 Seed defaults
          </button>
          {isDirty && (
            <button
              type="button"
              onClick={handleCancel}
              className="btn btn-secondary"
              title="Discard unsaved changes"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="btn btn-success"
            disabled={saveMutation.isPending || !isDirty}
          >
            {saveMutation.isPending ? (
              <>
                <span className="loading-spinner"></span>
                Saving...
              </>
            ) : (
              <>💾 Save</>
            )}
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="toast toast-success" style={{ position: "relative", marginBottom: "var(--spacing-lg)" }}>
          {successMessage}
        </div>
      )}
      {errors.length > 0 && (
        <div className={gridStyles.errorList}>
          <div className={gridStyles.errorListTitle}>❌ Could not save</div>
          {errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className={styles.contentCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Contacts</h2>
          <span style={{ fontSize: "0.75rem", color: "var(--fg-5)" }}>
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        <div style={{ padding: "0 0.25rem 0.25rem" }}>
          <p style={{ margin: "0 0 1rem", color: "var(--fg-3)", fontSize: "0.85rem" }}>
            Up to 3 numbers per contact — e.g. a plumber&rsquo;s own phone plus a WhatsApp or
            alternate number. A row with no number filled in is dropped when you save.
          </p>
          {rows.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "2rem 1rem",
                color: "var(--fg-4)",
                fontSize: "0.85rem",
                border: "1px dashed var(--border-strong)",
                borderRadius: "8px",
              }}
            >
              No contacts yet. Click &ldquo;Seed defaults&rdquo; to start from the standard
              categories, or &ldquo;+ Add contact&rdquo; below.
            </div>
          )}
          <div style={{ display: "grid", gap: "0.5rem" }}>
            {rows.map((row) => (
              <div
                key={row._rowId}
                className={gridStyles.contactRow}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.4rem",
                  alignItems: "center",
                  padding: "0.45rem",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}
              >
                <select
                  value={row.category}
                  onChange={(e) => updateRow(row._rowId, { category: e.target.value })}
                  className="input"
                  style={{ width: "150px", flex: "0 0 auto" }}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => updateRow(row._rowId, { name: e.target.value })}
                  className="input"
                  placeholder={row.category === "Other" ? "Contact name *" : "Name (optional)"}
                  style={{ width: "160px", flex: "0 0 auto" }}
                />
                {row.numbers.map((n, i) => (
                  <input
                    key={i}
                    type="tel"
                    value={n}
                    onChange={(e) => updateNumber(row._rowId, i, e.target.value)}
                    className="input"
                    placeholder={i === 0 ? "Phone number *" : `Number ${i + 1}`}
                    style={{ width: "125px", flex: "0 0 auto" }}
                  />
                ))}
                {row.numbers.length < 3 && (
                  <button
                    type="button"
                    onClick={() => addNumberSlot(row._rowId)}
                    className="btn btn-secondary"
                    title="Add another number"
                    style={{ padding: "0.3rem 0.55rem", flex: "0 0 auto" }}
                  >
                    +
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeRow(row._rowId)}
                  className="btn btn-secondary"
                  title="Remove contact"
                  style={{ padding: "0.3rem 0.55rem", flex: "0 0 auto" }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addRow} className="btn btn-secondary" style={{ marginTop: "0.85rem" }}>
            + Add contact
          </button>
        </div>
      </div>
    </div>
  );
}
