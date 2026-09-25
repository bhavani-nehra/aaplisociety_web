"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { apiClient } from "@/lib/api-client";
import { produce } from "immer";
import {
  PageHeader, Card, Btn, Icon, Select, EmptyState, RevampSkeleton, Toast,
} from "@/components/revamp";

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

const CATEGORY_ICON = {
  "Society Office": "building-2",
  "Watchman/Security": "shield",
  Plumber: "wrench",
  Electrician: "zap",
  "Gas Agency": "flame",
  Housekeeping: "sparkles",
  "Pest Control": "bug",
  "Lift AMC": "move-vertical",
  Emergency: "siren",
  Helpline: "phone-call",
  Utility: "plug",
  Other: "more-horizontal",
};

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

// Reduced-motion read, same local pattern already used in
// app/admin/dashboard/PageClient.js and app/admin/ledger/PageClient.js — see
// docs/motion-system.md's rule of thumb: a third use stays local, a fourth
// is the signal to extract a shared primitive.
function useReduceMotionPref() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

export default function SocietyContactsPage() {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState([]);
  const [toast, setToast] = useState(null);
  const reduceMotion = useReduceMotionPref();

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

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
      showToast("Essential contacts saved");
      queryClient.invalidateQueries(["society-contacts"]);
    },
    onError: (error) => {
      showToast(error.message || "Save failed", "err");
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
      showToast("Every default is already here.");
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
      <div style={{ maxWidth: "820px", margin: "40px auto" }}>
        <RevampSkeleton h={420} />
      </div>
    );
  }

  const rowMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: -6 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -6 },
        transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
      };

  return (
    <div style={{ maxWidth: "820px", margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="phone-call" size={11} /> People · Essential Contacts</>}
        title="Essential Contacts"
        sub={
          <>
            Numbers a resident actually needs — society office, watchman, plumber, gas agency and
            more. Shown on the &ldquo;Essential contacts&rdquo; screen in the resident app.
          </>
        }
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="secondary" icon="sparkles" onClick={seedDefaults}>
              Seed defaults
            </Btn>
            {isDirty && (
              <Btn variant="ghost" onClick={handleCancel} title="Discard unsaved changes">
                Cancel
              </Btn>
            )}
            <Btn
              variant="primary"
              icon={saveMutation.isPending ? undefined : "save"}
              onClick={handleSave}
              disabled={saveMutation.isPending || !isDirty}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Btn>
          </div>
        }
      />

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)" }}>Contacts</div>
          <span style={{ fontSize: 11.5, color: "var(--r-fg-4)" }}>
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </span>
        </div>
        <p style={{ margin: "6px 0 16px", color: "var(--r-fg-4)", fontSize: 12.5 }}>
          Up to 3 numbers per contact — e.g. a plumber&rsquo;s own phone plus a WhatsApp or
          alternate number. A row with no number filled in is dropped when you save.
        </p>

        {rows.length === 0 ? (
          <EmptyState
            icon="phone-off"
            title="No contacts yet"
            sub={'Click "Seed defaults" to start from the standard categories, or "+ Add contact" below.'}
          />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <AnimatePresence initial={false}>
              {rows.map((row) => (
                <motion.div key={row._rowId} {...rowMotion}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "center",
                      padding: "8px 10px",
                      border: "1px solid var(--r-border)",
                      borderRadius: 10,
                      background: "var(--r-surface)",
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: "var(--r-brand-soft)",
                        color: "var(--r-brand)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon name={CATEGORY_ICON[row.category] || "phone"} size={15} />
                    </div>
                    <Select
                      value={row.category}
                      onChange={(v) => updateRow(row._rowId, { category: v })}
                      size="sm"
                      style={{ width: 150, flex: "0 0 auto" }}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </Select>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateRow(row._rowId, { name: e.target.value })}
                      className="input"
                      placeholder={row.category === "Other" ? "Contact name *" : "Name (optional)"}
                      style={{ width: 160, height: 30, fontSize: 12.5, flex: "0 0 auto" }}
                    />
                    {row.numbers.map((n, i) => (
                      <input
                        key={i}
                        type="tel"
                        value={n}
                        onChange={(e) => updateNumber(row._rowId, i, e.target.value)}
                        className="input"
                        placeholder={i === 0 ? "Phone number *" : `Number ${i + 1}`}
                        style={{ width: 120, height: 30, fontSize: 12.5, flex: "0 0 auto" }}
                      />
                    ))}
                    {row.numbers.length < 3 && (
                      <Btn
                        size="sm"
                        variant="ghost"
                        icon="plus"
                        title="Add another number"
                        onClick={() => addNumberSlot(row._rowId)}
                      />
                    )}
                    <Btn
                      size="sm"
                      variant="ghost"
                      icon="trash-2"
                      title="Remove contact"
                      onClick={() => removeRow(row._rowId)}
                      style={{ marginLeft: "auto", color: "var(--r-danger)" }}
                    />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        <Btn variant="secondary" icon="plus" onClick={addRow} style={{ marginTop: 14 }}>
          Add contact
        </Btn>
      </Card>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
