"use client";
/**
 * Statement layout — the headings the Balance Sheet prints, and what lands
 * under each one.
 *
 * ## Why this page loads the account heads too
 *
 * A schedule on its own is a code and a label: "A — Share Capital". Useless
 * to look at. What a person needs to know is which of their heads print under
 * it, and — the part that actually bites — which heads print under nothing at
 * all, because a head with no schedule code is silently dropped from the
 * Balance Sheet or misplaced on it. There is a seeded check for exactly that
 * (accountsMissingScheduleCode, blocking), and it fails at the moment someone
 * tries to generate a statement, which is the worst possible moment to first
 * hear about it.
 *
 * So the page joins the two and puts the unassigned heads at the top, before
 * anyone has generated anything.
 *
 * ## The headings themselves stay fixed; the real work here is placement
 *
 * The headings are the shared default tier (societyId: null): the statutory
 * layout, not rearranged from a screen — that's accountant's work if a
 * society's registrar wants different naming. What this page DOES let you do
 * directly: assign an unassigned head to the schedule it belongs under, right
 * here, instead of sending the admin to the Account heads page to do it and
 * back again (§7.32 — every page does work, nothing is just a report).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import notify from "@/lib/notify";
import {
  PageHeader, SectionLabel, Card, Pill, Btn, Icon,
  EmptyState, RevampSkeleton, ToggleSwitch, SmallStat,
} from "@/components/revamp";

/** Same five groups, same glosses, as the account-heads page. */
const CATEGORIES = [
  { key: "Asset", label: "Assets", gloss: "What the society owns or is owed." },
  { key: "Liability", label: "Liabilities", gloss: "What the society owes." },
  { key: "Equity", label: "Funds", gloss: "The society's own money — Share Capital, Reserve, Sinking and Repair funds." },
  { key: "Income", label: "Income", gloss: "Money coming in." },
  { key: "Expense", label: "Expenses", gloss: "Money going out." },
];

export default function SchedulesPage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  // §7.19 bulk actions: several heads often belong to the same schedule
  // (e.g. every expense head under Schedule J) — select several, assign once.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkCode, setBulkCode] = useState("");
  // Real drag-and-drop: drag any head card onto a Schedule box, drop
  // reassigns it immediately — no "move to which section" dialog. The drop
  // target itself is the choice.
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverCode, setDragOverCode] = useState(null);

  const toggleSelected = useCallback((id) => {
    setSelected((s) => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const assignOne = useCallback(async (accountId, scheduleCode) => {
    const res = await fetch(`/api/accounting/chart-of-accounts/${accountId}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleCode }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not assign that heading.");
  }, []);

  const confirmBulkAssign = useCallback(async () => {
    if (!selected.size || !bulkCode) return;
    setAssigning(true);
    try {
      const ids = [...selected];
      for (const id of ids) await assignOne(id, bulkCode);
      notify.success(`${ids.length} account${ids.length === 1 ? "" : "s"} assigned to Schedule ${bulkCode}.`);
      setSelected(new Set());
      setBulkCode("");
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setAssigning(false);
    }
  }, [selected, bulkCode, assignOne]);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const [schRes, accRes] = await Promise.all([
        fetch("/api/accounting/schedules", { credentials: "include", signal }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include", signal }),
      ]);
      const schJson = await schRes.json().catch(() => ({}));
      if (!schRes.ok) throw new Error(schJson.error || "Could not load the statement layout");
      setSchedules(schJson.schedules || []);
      // The heads are supporting detail, not the page. If they cannot be read
      // the layout is still worth showing, so this failure stays quiet.
      if (accRes.ok) {
        const accJson = await accRes.json().catch(() => ({}));
        setAccounts(accJson.accounts || []);
      }
    } catch (e) {
      if (e?.name !== "AbortError") setError(e.message);
    } finally {
      // A StrictMode double-mount (dev only) aborts the first of two calls to
      // this load() — without this guard its `finally` still clears loading
      // right away, flashing the empty state before the second, real fetch
      // resolves seconds later.
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const dropOnSchedule = useCallback(async (accountId, scheduleCode, accountName) => {
    setDragOverCode(null);
    setDraggedId(null);
    if (!accountId) return;
    try {
      await assignOne(accountId, scheduleCode);
      notify.success(`${accountName || "Account"} moved to Schedule ${scheduleCode}.`);
      await load();
    } catch (e) {
      notify.error(e.message);
    }
  }, [assignOne, load]);

  const install = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/accounting/setup/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "schedules" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "Could not install the layout");
      notify.success(json.message || "Statement layout installed");
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setSeeding(false);
    }
  }, [load]);

  /** Real "hide from statement" — switches the account's own isActive flag
   *  off, the same field Chart of Accounts already uses for this. An
   *  inactive account is excluded from every statement query, so this is a
   *  real hide, not a display-only flag invented for this page. */
  const setVisible = useCallback(async (account, visible) => {
    try {
      const res = await fetch(`/api/accounting/chart-of-accounts/${account._id}/status`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: visible, reason: visible ? "Shown on statement again" : "Hidden from statement" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not change visibility.");
      notify.success(visible ? `${account.name} will show on statements again.` : `${account.name} hidden from statements.`);
      await load();
    } catch (e) {
      notify.error(e.message);
    }
  }, [load]);

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.isActive !== false),
    [accounts],
  );

  /** Schedule code → the heads that print under it. */
  const headsByCode = useMemo(() => {
    const m = new Map();
    for (const a of activeAccounts) {
      if (!a.scheduleCode) continue;
      if (!m.has(a.scheduleCode)) m.set(a.scheduleCode, []);
      m.get(a.scheduleCode).push(a);
    }
    return m;
  }, [activeAccounts]);

  /** The heads that would print under nothing. The reason this page exists. */
  const unassigned = useMemo(
    () => activeAccounts.filter((a) => !a.scheduleCode),
    [activeAccounts],
  );

  const byCategory = useMemo(() => {
    const m = new Map(CATEGORIES.map((c) => [c.key, []]));
    for (const s of schedules) {
      if (!m.has(s.category)) m.set(s.category, []);
      m.get(s.category).push(s);
    }
    for (const list of m.values()) {
      list.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || String(a.code).localeCompare(String(b.code)));
    }
    return m;
  }, [schedules]);

  return (
    <div style={{ maxWidth: 1360, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="layers" size={11} /> Page 5 of 6</>}
        title="Balance Sheet Format"
        sub="The headings your Balance Sheet prints — Schedule A, B, C — which account heads appear under each one, and whether they show at all."
      />
      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={80} /><RevampSkeleton h={220} />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon="alert-triangle" title="Could not load the statement layout" sub={error} />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Btn variant="primary" onClick={() => load()}>Try again</Btn>
          </div>
        </Card>
      ) : schedules.length === 0 ? (
        <Card>
          <div style={{ padding: "36px 24px", textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
            <Icon name="table" size={30} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
            <p style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: "var(--r-fg-1)" }}>
              No statement layout installed
            </p>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.65 }}>
              Without it the figures are all correct and there is nowhere to
              print them — the Balance Sheet has no headings to group anything
              under. The standard statutory layout can be installed for you.
            </p>
            <Btn variant="primary" icon="plus" disabled={seeding} onClick={install} style={{ marginTop: 16 }}>
              {seeding ? "Installing…" : "Install the standard layout"}
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
            <SmallStat icon="layers" label="Headings" value={schedules.length} />
            <SmallStat icon="check-circle" label="Heads placed" value={activeAccounts.length - unassigned.length} />
            <SmallStat icon="alert-triangle" label="Heads with no heading" value={unassigned.length} />
          </div>

          {/* ── the thing that breaks statement generation ────────────── */}
          {unassigned.length ? (
            <Card style={{ marginBottom: 18, borderColor: "var(--r-warning)" }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Icon name="alert-triangle" size={18} color="var(--r-warning)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {unassigned.length} account head{unassigned.length === 1 ? "" : "s"} print under no heading
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 3, lineHeight: 1.6 }}>
                    A head with no heading is left off the Balance Sheet, or put
                    in the wrong place. This is one of the checks that stops a
                    statement being generated — better dealt with now than at
                    the moment you try to print.
                  </div>
                  {unassigned.length > 1 ? (
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--r-fg-4)" }}>
                      Select several below if they share a heading — one assign instead of {unassigned.length}.
                    </div>
                  ) : null}
                  <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--r-fg-4)" }}>
                    Drag a head straight onto a heading below, or use the checkboxes to assign several at once.
                  </div>
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    {unassigned.map((a) => (
                      <div
                        key={a._id}
                        draggable
                        onDragStart={(e) => { setDraggedId(a._id); e.dataTransfer.setData("text/plain", a._id); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => setDraggedId(null)}
                        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", cursor: "grab", opacity: draggedId === a._id ? 0.4 : 1 }}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(a._id)}
                          onChange={() => toggleSelected(a._id)}
                          style={{ flexShrink: 0 }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Icon name="grip-vertical" size={13} color="var(--r-fg-5)" />
                        <span className="revamp-num" style={{ fontSize: 11.5, color: "var(--r-fg-4)", width: 46, flexShrink: 0 }}>{a.code}</span>
                        <span style={{ fontSize: 12.5, color: "var(--r-fg-2)", flex: 1, minWidth: 120 }}>{a.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          ) : null}

          {selected.size ? (
            <Card style={{ marginBottom: 18, border: "1px solid var(--r-brand)" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                Assign {selected.size} selected head{selected.size === 1 ? "" : "s"} to a heading
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[...schedules].sort((a, b) => String(a.code).localeCompare(String(b.code))).map((s) => (
                  <button
                    key={s._id}
                    type="button"
                    onClick={() => setBulkCode(s.code)}
                    style={{
                      padding: "6px 10px", borderRadius: 8, fontSize: 12,
                      border: bulkCode === s.code ? "1px solid var(--r-brand)" : "1px solid var(--r-hairline)",
                      background: bulkCode === s.code ? "var(--r-brand-soft, var(--r-surface-2))" : "var(--r-surface-2)",
                      color: "var(--r-fg-1)", cursor: "pointer",
                    }}
                  >
                    {s.code} — {s.label}
                  </button>
                ))}
              </div>
              {bulkCode ? (
                <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--r-fg-3)" }}>
                  {/* §7.25 config-change impact: real count, not just the new heads — what this actually changes. */}
                  All {selected.size} selected heads will print under <strong>Schedule {bulkCode}</strong>, alongside
                  the {(headsByCode.get(bulkCode) || []).length} head{(headsByCode.get(bulkCode) || []).length === 1 ? "" : "s"} already
                  there — {selected.size + (headsByCode.get(bulkCode) || []).length} total on every statement from now on.
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn size="sm" disabled={assigning} onClick={() => { setSelected(new Set()); setBulkCode(""); }}>Cancel</Btn>
                <Btn size="sm" variant="primary" disabled={assigning || !bulkCode} onClick={confirmBulkAssign}>
                  {assigning ? "…" : "Confirm"}
                </Btn>
              </div>
            </Card>
          ) : null}

          {/* ── real T-format, two columns, the same shape the printed
              Balance Sheet and Income & Expenditure Account use — not a
              single flowing list top to bottom. Liabilities+Funds sit on
              the left the same as the statutory statement's "Liabilities"
              side, Assets on the right as "Assets". ────────────────────── */}
          <SectionLabel icon="scale">Balance Sheet</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
            <FormatSide
              heading="Liabilities"
              categories={CATEGORIES.filter((c) => c.key === "Liability" || c.key === "Equity")}
              byCategory={byCategory} headsByCode={headsByCode}
              setVisible={setVisible}
              draggedId={draggedId} setDraggedId={setDraggedId}
              dragOverCode={dragOverCode} setDragOverCode={setDragOverCode}
              onDrop={dropOnSchedule}
            />
            <FormatSide
              heading="Assets"
              categories={CATEGORIES.filter((c) => c.key === "Asset")}
              byCategory={byCategory} headsByCode={headsByCode}
              setVisible={setVisible}
              draggedId={draggedId} setDraggedId={setDraggedId}
              dragOverCode={dragOverCode} setDragOverCode={setDragOverCode}
              onDrop={dropOnSchedule}
            />
          </div>

          <SectionLabel icon="trending-up">Income & Expenditure</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormatSide
              heading="Expenditure"
              categories={CATEGORIES.filter((c) => c.key === "Expense")}
              byCategory={byCategory} headsByCode={headsByCode}
              setVisible={setVisible}
              draggedId={draggedId} setDraggedId={setDraggedId}
              dragOverCode={dragOverCode} setDragOverCode={setDragOverCode}
              onDrop={dropOnSchedule}
            />
            <FormatSide
              heading="Income"
              categories={CATEGORIES.filter((c) => c.key === "Income")}
              byCategory={byCategory} headsByCode={headsByCode}
              setVisible={setVisible}
              draggedId={draggedId} setDraggedId={setDraggedId}
              dragOverCode={dragOverCode} setDragOverCode={setDragOverCode}
              onDrop={dropOnSchedule}
            />
          </div>

          <p style={{ fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.65, marginTop: 20 }}>
            This is the standard statutory layout, shared by every society on
            the system, and the headings themselves are not rearranged here —
            they&apos;re the ones the registrar expects to see. A heading with
            nothing under it simply does not print. Assign any unassigned head
            above; renaming or removing a head's assignment is still done on
            the Account heads page.
          </p>
        </>
      )}
    </div>
  );
}

/** One side of the T-format — a bordered box headed "Liabilities" / "Assets"
 *  / "Expenditure" / "Income", the schedules under it stacked as compact
 *  mini-tables, mirroring components/accounting/StatutoryStatements.js's
 *  <Side> so this configuration page looks like the statement it configures.
 *
 *  Every head is draggable; every schedule box is a drop target. Dropping
 *  reassigns immediately — the drop target itself is the decision, no
 *  "move to which section" dialog in between. */
function FormatSide({ heading, categories, byCategory, headsByCode, setVisible, draggedId, setDraggedId, dragOverCode, setDragOverCode, onDrop }) {
  const groups = categories.flatMap((c) => byCategory.get(c.key) || []);
  return (
    <div style={{ border: "1px solid var(--r-hairline)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{
        padding: "10px 14px", background: "var(--r-surface-2)", borderBottom: "1px solid var(--r-hairline)",
        fontSize: 12.5, fontWeight: 700, color: "var(--r-fg-2)",
      }}>
        {heading}
      </div>
      {groups.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--r-fg-4)", fontStyle: "italic" }}>Nothing under this side yet.</div>
      ) : (
        groups.map((s, i) => {
          const heads = headsByCode.get(s.code) || [];
          const isDragTarget = dragOverCode === s.code;
          return (
            <div
              key={s._id}
              onDragOver={(e) => { if (draggedId) { e.preventDefault(); setDragOverCode(s.code); } }}
              onDragLeave={() => setDragOverCode((c) => (c === s.code ? null : c))}
              onDrop={(e) => { e.preventDefault(); onDrop(draggedId, s.code); }}
              style={{
                padding: "10px 14px", borderBottom: i === groups.length - 1 ? "none" : "1px solid var(--r-hairline)",
                background: isDragTarget ? "var(--r-brand-soft, var(--r-surface-2))" : "transparent",
                outline: isDragTarget ? "2px dashed var(--r-brand)" : "none", outlineOffset: -2,
                transition: "background 0.1s",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="revamp-num" style={{ fontSize: 11, fontWeight: 700, color: "var(--r-fg-4)" }}>{s.code}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "var(--r-fg-1)" }}>{s.label}</span>
                {s.societyId ? <Pill tone="info" dot={false}>yours</Pill> : null}
                <span style={{ fontSize: 11, color: "var(--r-fg-4)" }}>
                  {heads.length ? `${heads.length} head${heads.length === 1 ? "" : "s"}` : "drop here"}
                </span>
              </div>
              {heads.length ? (
                <div style={{ marginTop: 6, paddingLeft: 8, borderLeft: "2px solid var(--r-hairline)", display: "grid", gap: 4 }}>
                  {heads.map((h) => (
                    <div
                      key={h._id}
                      draggable
                      onDragStart={(e) => { setDraggedId(h._id); e.dataTransfer.setData("text/plain", h._id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDraggedId(null); setDragOverCode(null); }}
                      style={{ display: "flex", alignItems: "center", gap: 8, cursor: "grab", opacity: draggedId === h._id ? 0.4 : 1 }}
                    >
                      <Icon name="grip-vertical" size={12} color="var(--r-fg-5)" />
                      <span style={{ fontSize: 11.5, color: "var(--r-fg-3)", flex: 1, minWidth: 0 }}>{h.name}</span>
                      <ToggleSwitch on={h.isActive !== false} title="Show on statement" onChange={(v) => setVisible(h, v)} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}
