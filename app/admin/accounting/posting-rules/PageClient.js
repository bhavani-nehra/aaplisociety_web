"use client";
/**
 * Automatic entry rules — what the system writes into the books, and when.
 *
 * ## What this page is translating
 *
 * A PostingRule is a trigger and a set of lines: "when a PaymentRecorded
 * event arrives with paymentMode Cash, debit `cash` for `amount` and credit
 * `memberReceivable` for `appliedToDues`". Every noun in that sentence is a
 * resolver key, not a name anybody would recognise.
 *
 * So the page does three substitutions and nothing else:
 *   eventType  → the moment it describes   "A member pays"
 *   accountKey → the head it resolves to   "Dues from Members"
 *   amountKey  → the figure it takes       "the part settling old dues"
 *
 * ## Why Debit and Credit are NOT translated away
 *
 * The tempting move is to print "money in" for Debit and "money out" for
 * Credit. That is true for cash and bank and false for income, funds and
 * everything a society owes — a maintenance bill CREDITS income while money
 * is coming in. A wrong translation of the one word the auditor will use is
 * worse than the word. So both words stay, glossed once at the top, and the
 * two sides are shown as two halves of one slip.
 *
 * ## Why standard rules can't be hand-edited, and what you CAN do instead
 *
 * These are the shared default tier (societyId: null). PostingRuleService
 * refuses to patch them directly — editing the postings themselves (resolver
 * keys, amount paths) is a bookkeeper's job. What every rule DOES get here:
 * a real action. A standard rule can be switched off for just this society
 * (copies its exact postings into a society-owned rule, deactivated — see
 * "Switch off for us"). A society's own rule can be switched on/off or
 * removed outright. Every action shows what it will do and asks to confirm
 * before it touches anything (§7.32 — no silent process, no read-only page).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import notify from "@/lib/notify";
import {
  SectionLabel, Card, Pill, Btn, Icon,
  EmptyState, RevampSkeleton, ToggleSwitch, SmallStat,
} from "@/components/revamp";

/** The moment each rule fires, said the way it would be said out loud. */
const EVENTS = {
  PaymentRecorded: { label: "A member pays", order: 1 },
  BillGenerated: { label: "A maintenance bill is raised", order: 2 },
  InterestAccrued: { label: "Interest is charged on overdue dues", order: 3 },
  OpeningBalance: { label: "Last year's closing figures are carried in", order: 4 },
  ManualAdjustment: { label: "Someone records an entry by hand", order: 5 },
  AssetPurchased: { label: "The society buys something lasting", order: 6 },
  DepreciationPosted: { label: "Wear and tear is charged for the year", order: 7 },
  AssetDisposed: { label: "Something the society owns is sold or scrapped", order: 8 },
  LiabilityIncurred: { label: "The society takes on a due — a vendor bill, loan or deposit", order: 9 },
  LiabilityPaymentMade: { label: "The society pays off one of those dues", order: 10 },
  ReserveTransfer: { label: "Money moves into or out of a fund", order: 11 },
};

/** Resolver key → the head it lands on, by the name printed on the statement. */
const ACCOUNT_KEYS = {
  cash: "Cash in Hand",
  defaultBank: "the society's bank account",
  memberReceivable: "Dues from Members",
  memberAdvance: "Advance Received from Members",
  maintenanceIncome: "Maintenance Income",
  interestIncome: "Interest Income",
  roundOff: "Round Off",
};

/** Amount path → the figure it picks up. */
const AMOUNT_KEYS = {
  amount: "the full amount",
  appliedToDues: "the part settling old dues",
  advance: "anything paid over and above the dues",
  receivableIncrease: "this month's new charges",
  currentCharges: "this month's maintenance charges",
  currentInterest: "this month's interest, if any",
  interestAmount: "the interest charged",
};

function accountText(key = "") {
  if (ACCOUNT_KEYS[key]) return ACCOUNT_KEYS[key];
  if (key.startsWith("billingHead:")) return "the head this charge belongs to";
  if (key.startsWith("payload:")) return "the head chosen on the entry itself";
  return key;
}

const amountText = (key = "") => AMOUNT_KEYS[key] || key;

/** "paymentMode is Cash" — the condition that decides which rule wins. */
function conditionText(c) {
  const field = String(c.field || "").replace(/([A-Z])/g, " $1").toLowerCase().trim();
  const ops = { eq: "is", ne: "is not", gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most", in: "is one of", exists: "is present" };
  const op = ops[c.op] || c.op;
  if (c.op === "exists") return `${field} ${op}`;
  return `${field} ${op} ${Array.isArray(c.value) ? c.value.join(", ") : c.value}`;
}

export default function PostingRulesPage() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  // Preview → Confirm → Run for every row action (§7.32: no silent process).
  // pending holds what's about to happen; nothing is sent until confirmed.
  const [pending, setPending] = useState(null); // { kind: 'toggle'|'delete'|'override', rule } | null
  const [acting, setActing] = useState(false);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/posting-rules", { credentials: "include", signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the entry rules");
      setRules(json.postingRules || []);
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

  /** Install the standard set, through the same runner the guided setup uses. */
  const install = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/accounting/setup/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "postingRules" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "Could not install the rules");
      notify.success(json.message || "Rules installed");
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setSeeding(false);
    }
  }, [load]);

  /** Grouped by the moment they fire, because that is how someone looks for one. */
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of rules) {
      if (!m.has(r.eventType)) m.set(r.eventType, []);
      m.get(r.eventType).push(r);
    }
    for (const list of m.values()) list.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return [...m.entries()].sort(
      (a, b) => (EVENTS[a[0]]?.order ?? 99) - (EVENTS[b[0]]?.order ?? 99),
    );
  }, [rules]);

  const ownCount = rules.filter((r) => r.societyId).length;

  const confirmPending = useCallback(async () => {
    if (!pending) return;
    setActing(true);
    try {
      const { kind, rule } = pending;
      let res;
      if (kind === "toggle") {
        res = await fetch(`/api/accounting/posting-rules/${rule._id}`, {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !rule.isActive }),
        });
      } else if (kind === "delete") {
        res = await fetch(`/api/accounting/posting-rules/${rule._id}`, {
          method: "DELETE", credentials: "include",
        });
      } else if (kind === "override-off") {
        // Copies the standard rule's exact postings into a society-owned
        // rule at higher priority, switched off — the one safe, real action
        // available on a shared default: stop it firing here, without
        // touching the postings every other society relies on.
        res = await fetch("/api/accounting/posting-rules", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: rule.eventType,
            voucherType: rule.voucherType,
            description: `${rule.description || rule.systemKey} — switched off for this society`,
            conditions: rule.conditions || [],
            priority: (rule.priority || 0) + 1,
            lineSpecs: rule.lineSpecs || [],
            linesFromPayload: !!rule.linesFromPayload,
            isActive: false,
          }),
        });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "That did not go through.");
      notify.success(
        kind === "toggle" ? `Rule ${!rule.isActive ? "switched on" : "switched off"}.`
          : kind === "delete" ? "Rule removed."
          : "Standard rule switched off for this society.",
      );
      setPending(null);
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setActing(false);
    }
  }, [pending, load]);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      {/* No "Overview" back-button — this now renders inside the
          Configuration accordion (page 1 of 6), which IS /admin/accounting;
          that button used to point at its own page. */}
      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={80} /><RevampSkeleton h={220} />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon="alert-triangle" title="Could not load the entry rules" sub={error} />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Btn variant="primary" onClick={() => load()}>Try again</Btn>
          </div>
        </Card>
      ) : rules.length === 0 ? (
        <Card>
          <div style={{ padding: "36px 24px", textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
            <Icon name="repeat" size={30} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
            <p style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: "var(--r-fg-1)" }}>
              No entry rules installed
            </p>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.65 }}>
              Without these, raising a bill or recording a payment updates the
              member's account but never reaches the books — so the statements
              at the end of the year would come out empty.
            </p>
            <Btn variant="primary" icon="plus" disabled={seeding} onClick={install} style={{ marginTop: 16 }}>
              {seeding ? "Installing…" : "Install the standard rules"}
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          {/* ── the one bit of vocabulary this page cannot avoid ──────── */}
          <Card style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <Icon name="info" size={17} color="var(--r-accent)" />
              <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", lineHeight: 1.7 }}>
                Every entry has <strong>two halves that must match</strong> — the
                same rule as the paper cash book. One half is marked{" "}
                <strong>Debit</strong>, the other <strong>Credit</strong>. Your
                auditor will use those two words, so they are kept here rather
                than renamed. Each rule below is one slip: what triggers it, and
                the two halves it writes.
              </div>
            </div>
          </Card>

          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <SmallStat icon="repeat" label="Rules active" value={rules.length} />
              <SmallStat icon="layers" label="Moments covered" value={groups.length} />
              <SmallStat icon="edit" label="Added by this society" value={ownCount} />
            </div>
          </div>

          {groups.map(([eventType, list]) => (
            <div key={eventType} style={{ marginBottom: 20 }}>
              <SectionLabel icon="zap">
                {EVENTS[eventType]?.label || eventType}
              </SectionLabel>
              <Card padded={false}>
                {list.map((r, i) => (
                  <div
                    key={r._id}
                    style={{
                      padding: "13px 15px",
                      borderBottom: i === list.length - 1 ? "none" : "1px solid var(--r-hairline)",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--r-fg-1)" }}>
                        {r.description || r.systemKey}
                      </span>
                      {r.societyId ? <Pill tone="info" dot={false}>yours</Pill> : <Pill tone="info" dot={false}>standard</Pill>}
                      {r.isActive === false ? <Pill tone="expired">switched off</Pill> : null}
                      <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
                        {r.societyId ? (
                          <>
                            {/* A switch, not a button — this is a binary on/off
                                state, and the mockup's ToggleSwitch reads that
                                correctly where a text button didn't. The click
                                still only opens the pending-confirm panel below
                                (§7.32 — no toggle fires on its own click). */}
                            <ToggleSwitch
                              on={r.isActive !== false}
                              disabled={acting || !!pending}
                              title={r.isActive === false ? "Switch on" : "Switch off"}
                              onChange={() => setPending({ kind: "toggle", rule: r })}
                            />
                            <Btn size="sm" variant="danger" disabled={acting || !!pending} onClick={() => setPending({ kind: "delete", rule: r })}>
                              Remove
                            </Btn>
                          </>
                        ) : (
                          <Btn size="sm" disabled={acting || !!pending} onClick={() => setPending({ kind: "override-off", rule: r })}>
                            Switch off for us
                          </Btn>
                        )}
                      </div>
                    </div>

                    {pending?.rule?._id === r._id ? (
                      <div style={{
                        marginTop: 8, padding: "10px 12px", borderRadius: 8,
                        background: "var(--r-surface-2)", border: "1px solid var(--r-brand)",
                        fontSize: 12.5, color: "var(--r-fg-2)", lineHeight: 1.6,
                      }}>
                        {pending.kind === "toggle" && (
                          <>This rule will be <strong>{r.isActive === false ? "switched on" : "switched off"}</strong> — {r.isActive === false ? "it will start writing entries again." : "it will stop writing entries until switched on again."}</>
                        )}
                        {pending.kind === "delete" && (
                          <>This will <strong>remove</strong> your society&apos;s override. The standard rule underneath takes over again.</>
                        )}
                        {pending.kind === "override-off" && (
                          <>This creates a rule <strong>owned by your society</strong>, copying this one&apos;s postings exactly, set to <strong>switched off</strong> — so it stops firing for you without changing it for anyone else.</>
                        )}
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <Btn size="sm" disabled={acting} onClick={() => setPending(null)}>Cancel</Btn>
                          <Btn size="sm" variant="primary" disabled={acting} onClick={confirmPending}>
                            {acting ? "…" : "Confirm"}
                          </Btn>
                        </div>
                      </div>
                    ) : null}

                    {r.conditions?.length ? (
                      <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 4 }}>
                        Only when {r.conditions.map(conditionText).join(" and ")}.
                      </div>
                    ) : null}

                    {r.linesFromPayload ? (
                      <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 7, lineHeight: 1.6 }}>
                        The two halves are chosen at the time — by whoever records
                        the entry, or by the register that raised it. There is no
                        fixed pair to show here.
                      </div>
                    ) : (
                      <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                        {(r.lineSpecs || []).map((l, j) => (
                          <div key={j} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5 }}>
                            <span style={{
                              width: 52, flexShrink: 0, fontSize: 11, fontWeight: 700,
                              color: l.side === "Debit" ? "var(--r-success)" : "var(--r-accent)",
                            }}>
                              {l.side}
                            </span>
                            <span style={{ color: "var(--r-fg-2)" }}>
                              {accountText(l.accountKey)}
                              <span style={{ color: "var(--r-fg-4)" }}>
                                {" — "}{amountText(l.amountKey)}
                                {l.optional ? ", if there is any" : ""}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </Card>
            </div>
          ))}

          <p style={{ fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.65 }}>
            Standard rules are shared by every society on the system, so their
            postings aren&apos;t changed here — changing one would change how every
            past and future entry is written, for everyone. What you can do:
            switch a standard rule off just for your society, or switch off /
            remove one your society already added. Nothing posts until the
            account heads exist and the mappings are set, so a half-configured
            society gets a clear refusal rather than a half-written book.
          </p>
        </>
      )}
    </div>
  );
}
