"use client";
/**
 * The books, as written — the journal entries themselves.
 *
 * ## Why this is not the same page as Entries
 *
 * It would be easy to read these two as one list shown twice. They are not,
 * and the page says so out loud, because a reader who thinks they are
 * duplicates will stop trusting both.
 *
 *   Entries (vouchers)  — the slips and their workflow. Drafts, things waiting
 *                         for approval, things cancelled before they counted.
 *                         Most of it never reached the books at all.
 *   The books (here)    — only what was actually written. This is the list an
 *                         auditor asks for, and the one the Trial Balance and
 *                         the Balance Sheet are built from.
 *
 * A Draft voucher appears there and not here. That difference IS the point of
 * having both.
 *
 * ## Read-only, and not for want of an API
 *
 * There is a POST that posts a manual journal, and it is deliberately not
 * wired to a button here. Writing a two-sided entry by hand means choosing
 * accounts and sides and making the totals match — a bookkeeper's job with a
 * bookkeeper's screen, not something to bolt onto a reading page. Corrections
 * to something already written go through Reverse or Auditor Mode, both of
 * which keep the original.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSetupState } from "@/lib/accounting/setupStateClient";
import { useRouter } from "next/navigation";
import { SetupGate } from "@/components/accounting/SetupGate";
import {
  PageHeader, SectionLabel, Card, Pill, Btn, Icon, SearchInput,
  Segmented, EmptyState, RevampSkeleton, SmallStat,
} from "@/components/revamp";

const STATUS = {
  Posted: { label: "In the books", tone: "paid" },
  Reversed: { label: "Reversed", tone: "expired" },
  Cancelled: { label: "Cancelled", tone: "expired" },
  Draft: { label: "Not counted yet", tone: "scheduled" },
};

const SOURCES = {
  Billing: "raised with the bills",
  Payments: "recorded against a payment",
  Interest: "interest run",
  OpeningBalance: "carried in from last year",
  Manual: "entered by hand",
  Assets: "asset register",
  Liabilities: "liability register",
  Funds: "fund transfer",
  Auditor: "auditor correction",
  Migration: "migrated",
  Import: "imported",
};

const money = (n) =>
  typeof n === "number"
    ? n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
    : "—";

const dateText = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";

export default function JournalEntriesPage() {
  return (
    <SetupGate requires="financialYear">
      <JournalEntriesBody />
    </SetupGate>
  );
}

function JournalEntriesBody() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [fy, setFy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState({});

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      // Throws rather than degrading to null on a 5xx: a cold-start 503 used
      // to render this page as an honest-looking empty list.
      const state = await fetchSetupState({ signal });
      const fyId = state?.financialYear?.id;
      setFy(state?.financialYear || null);

      const [eRes, aRes] = await Promise.all([
        fetch(`/api/accounting/journal-entries${fyId ? `?financialYearId=${fyId}` : ""}`, {
          credentials: "include", signal,
        }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include", signal }),
      ]);
      const eJson = await eRes.json().catch(() => ({}));
      if (!eRes.ok) throw new Error(eJson.error || "Could not load the books");
      setRows(eJson.journalEntries || []);
      // Account names are supporting detail — without them the page still
      // works, it just says "an account head" instead of naming one.
      if (aRes.ok) setAccounts((await aRes.json().catch(() => ({}))).accounts || []);
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

  const accountName = useCallback(
    (id) => {
      const a = accounts.find((x) => String(x._id) === String(id));
      return a ? `${a.code} ${a.name}` : "an account head";
    },
    [accounts],
  );

  const toggle = useCallback(
    async (row) => {
      const id = String(row._id);
      if (openId === id) return setOpenId(null);
      setOpenId(id);
      if (detail[id] !== undefined) return;
      try {
        const res = await fetch(`/api/accounting/journal-entries/${id}`, { credentials: "include" });
        const json = await res.json().catch(() => ({}));
        setDetail((d) => ({ ...d, [id]: res.ok ? json.journalEntry : null }));
      } catch {
        setDetail((d) => ({ ...d, [id]: null }));
      }
    },
    [openId, detail],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!needle) return true;
      return [r.narration, r.sourceModule, r.status]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle));
    });
  }, [rows, q, status]);

  const totals = useMemo(() => {
    // Only what counts toward the books. Draft/Cancelled entries were never
    // part of any balance, so folding them into a total here would print a
    // figure that matches nothing on any statement.
    const counted = rows.filter((r) => r.status === "Posted" || r.status === "Reversed");
    return {
      counted: counted.length,
      debit: counted.reduce((s, r) => s + (r.totalDebit || 0), 0),
      credit: counted.reduce((s, r) => s + (r.totalCredit || 0), 0),
      reversed: rows.filter((r) => r.status === "Reversed").length,
    };
  }, [rows]);

  const balanced = Math.abs(totals.debit - totals.credit) < 0.005;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="book-open" size={11} /> Also called journal entries</>}
        title="The books"
        sub={
          fy
            ? `Everything actually written into the books in ${fy.label}. This is the list your auditor asks for.`
            : "Everything actually written into the books. This is the list your auditor asks for."
        }
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn icon="file-text" onClick={() => router.push("/admin/accounting/vouchers")}>Entries</Btn>
            <Btn icon="arrow-left" onClick={() => router.push("/admin/accounting")}>Overview</Btn>
          </div>
        }
      />

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={80} /><RevampSkeleton h={260} />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon="alert-triangle" title="Could not load the books" sub={error} />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Btn variant="primary" onClick={() => load()}>Try again</Btn>
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <div style={{ padding: "36px 24px", textAlign: "center", maxWidth: 540, margin: "0 auto" }}>
            <Icon name="book-open" size={30} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
            <p style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: "var(--r-fg-1)" }}>
              Nothing has been written to the books yet
            </p>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.65 }}>
              Entries appear here once they are recorded and counted. A draft
              slip waiting for approval is not in the books and will not show
              on this page — that is what the Entries page is for.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
              <Btn variant="primary" icon="file-text" onClick={() => router.push("/admin/accounting/vouchers")}>
                See the entries
              </Btn>
              <Btn onClick={() => router.push("/admin/accounting")}>What else is missing?</Btn>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <SmallStat icon="book-open" label="Counted in the books" value={totals.counted} />
              <SmallStat icon="arrow-down" label="Debit total" value={money(totals.debit)} />
              <SmallStat icon="arrow-up" label="Credit total" value={money(totals.credit)} />
              <SmallStat icon="rotate-ccw" label="Reversed" value={totals.reversed} />
            </div>
          </div>

          {/* ── the one number that means something ─────────────────── */}
          <Card style={{ marginBottom: 16, borderColor: balanced ? undefined : "var(--r-danger)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <Icon
                name={balanced ? "check-circle" : "alert-triangle"}
                size={18}
                color={balanced ? "var(--r-success)" : "var(--r-danger)"}
              />
              <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", lineHeight: 1.7 }}>
                {balanced ? (
                  <>
                    <strong>The two sides match.</strong> Every rupee written into
                    the books has been written twice — once on each side — and the
                    two totals above are equal. That is the whole test, and it is
                    passing.
                  </>
                ) : (
                  <>
                    <strong>The two sides do not match.</strong> They differ by{" "}
                    {money(Math.abs(totals.debit - totals.credit))}. Every entry
                    should have been written twice, once on each side. Until this
                    is sorted out the Balance Sheet will not print — and it should
                    not, because it would be wrong. Show this to your accountant.
                  </>
                )}
              </div>
            </div>
          </Card>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search the note or source…" style={{ maxWidth: 260 }} />
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All" },
                { value: "Posted", label: "In the books" },
                { value: "Reversed", label: "Reversed" },
              ]}
            />
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--r-fg-4)" }}>
              {visible.length} shown
            </span>
          </div>

          {visible.length === 0 ? (
            <Card><EmptyState icon="search" title="Nothing matches" sub="Try a different search or filter." /></Card>
          ) : (
            <Card padded={false}>
              {visible.map((r, i) => {
                const id = String(r._id);
                const open = openId === id;
                const st = STATUS[r.status] || { label: r.status, tone: "neutral" };
                const d = detail[id];
                return (
                  <div
                    key={id}
                    style={{ borderBottom: i === visible.length - 1 ? "none" : "1px solid var(--r-hairline)" }}
                  >
                    <div
                      onClick={() => toggle(r)}
                      style={{ display: "flex", gap: 12, padding: "12px 15px", alignItems: "center", cursor: "pointer" }}
                    >
                      <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--r-fg-5)" />
                      <span style={{ fontSize: 12, color: "var(--r-fg-4)", width: 92, flexShrink: 0 }}>
                        {dateText(r.date)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>
                        {r.narration || "No note"}
                        <span style={{ color: "var(--r-fg-4)", fontSize: 11.5 }}>
                          {" · "}{r.lineCount} line{r.lineCount === 1 ? "" : "s"}
                          {SOURCES[r.sourceModule] ? `, ${SOURCES[r.sourceModule]}` : ""}
                        </span>
                      </span>
                      <span className="revamp-num" style={{ fontSize: 12.5, color: "var(--r-fg-2)" }}>
                        {money(r.totalDebit)}
                      </span>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </div>

                    {open ? (
                      <div style={{ padding: "0 15px 14px 41px" }}>
                        {d === undefined ? (
                          <RevampSkeleton h={60} />
                        ) : d === null ? (
                          <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>
                            Could not load the lines of this entry.
                          </div>
                        ) : (
                          <>
                            <SectionLabel icon="columns">The two halves</SectionLabel>
                            <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                              {(d.lines || []).map((l, j) => (
                                <div key={j} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5 }}>
                                  <span style={{
                                    width: 52, flexShrink: 0, fontSize: 11, fontWeight: 700,
                                    color: l.side === "Debit" ? "var(--r-success)" : "var(--r-accent)",
                                  }}>
                                    {l.side}
                                  </span>
                                  <span style={{ flex: 1, minWidth: 0, color: "var(--r-fg-2)" }}>
                                    {accountName(l.accountId)}
                                    {l.narration ? (
                                      <span style={{ color: "var(--r-fg-4)" }}> — {l.narration}</span>
                                    ) : null}
                                  </span>
                                  <span className="revamp-num" style={{ color: "var(--r-fg-1)" }}>
                                    {money(l.amount)}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div style={{ display: "flex", gap: 18, fontSize: 12, color: "var(--r-fg-3)", paddingTop: 6, borderTop: "1px solid var(--r-hairline)" }}>
                              <span>Debit total <strong className="revamp-num">{money(d.totalDebit)}</strong></span>
                              <span>Credit total <strong className="revamp-num">{money(d.totalCredit)}</strong></span>
                            </div>
                          </>
                        )}

                        {r.reversedByJournalEntryId ? (
                          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 8, lineHeight: 1.6 }}>
                            This entry was reversed. It stays here, and an equal and
                            opposite entry sits beside it — the two cancel out, and
                            the books keep both on record.
                          </div>
                        ) : null}
                        {r.reversalOfJournalEntryId ? (
                          <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 8, lineHeight: 1.6 }}>
                            This is the reversal of an earlier entry — it exists to
                            cancel that one out, not to record anything new.
                          </div>
                        ) : null}

                        {r.voucherId ? (
                          <Btn
                            size="sm"
                            style={{ marginTop: 10 }}
                            onClick={() => router.push("/admin/accounting/vouchers")}
                          >
                            See the slip this came from
                          </Btn>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Card>
          )}

          <p style={{ fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.65, marginTop: 12 }}>
            Nothing on this page can be edited, and that is deliberate rather
            than unfinished. Once a figure is in the books, changing it would
            change statements that may already have been printed and signed. A
            mistake is corrected by writing a further entry that cancels it —
            reversal, or an auditor's correction — so both the mistake and the
            fix stay on record. That is what makes these books auditable.
          </p>
        </>
      )}
    </div>
  );
}
