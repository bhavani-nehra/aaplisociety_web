"use client";
/**
 * Corrections — what was changed after it was already in the books, and why.
 *
 * ## Why an empty page here is the good outcome
 *
 * Every other accounting page treats "nothing here yet" as work outstanding.
 * This one is the opposite: an empty corrections list means nothing has needed
 * fixing after the fact. So the empty state says that plainly instead of
 * offering a button, because there is nothing here to go and do.
 *
 * ## What a row actually is
 *
 * Not an edit. A correcting entry cannot change what was written — it writes
 * something new that offsets it. The original stays in the books untouched.
 * Each row therefore names three things: the entry that was wrong, the entry
 * written to fix it, and the reason, which the service refuses to record
 * without.
 *
 * The before/after lines are stored on the record, so the page can show what
 * the entry looked like and what it was replaced with side by side. That is
 * the only place in the product where those two can be compared, and it is
 * the first thing an auditor asks for.
 *
 * ## Not the same as the activity log
 *
 * Society-wide "who changed which document" lives in AuditLog and its own
 * page. This is narrower and heavier: accounting corrections to posted
 * figures, which is why the model is separate and append-only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchSetupState } from "@/lib/accounting/setupStateClient";
import { useRouter } from "next/navigation";
import { SetupGate } from "@/components/accounting/SetupGate";
import {
  PageHeader, SectionLabel, Card, Pill, Btn, Icon, SearchInput,
  EmptyState, RevampSkeleton, SmallStat,
} from "@/components/revamp";

const ACTIONS = {
  Adjustment: { label: "Correction posted", tone: "warning" },
  Reversal: { label: "Reversed", tone: "expired" },
  Correction: { label: "Correction posted", tone: "warning" },
};

const money = (n) =>
  typeof n === "number"
    ? n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 })
    : "—";

const dateText = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : "";

/** One side of the before/after comparison. */
function Lines({ title, lines, accountName, muted }) {
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--r-fg-4)", marginBottom: 5, letterSpacing: 0.3 }}>
        {title}
      </div>
      {!lines?.length ? (
        <div style={{ fontSize: 12, color: "var(--r-fg-5)" }}>No lines recorded.</div>
      ) : (
        <div style={{ display: "grid", gap: 3, opacity: muted ? 0.7 : 1 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12 }}>
              <span style={{
                width: 46, flexShrink: 0, fontSize: 10.5, fontWeight: 700,
                color: l.side === "Debit" ? "var(--r-success)" : "var(--r-accent)",
              }}>
                {l.side}
              </span>
              <span style={{ flex: 1, minWidth: 0, color: "var(--r-fg-2)" }}>
                {accountName(l.accountId)}
              </span>
              <span className="revamp-num" style={{ color: "var(--r-fg-1)" }}>{money(l.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AuditTrailPage() {
  return (
    <SetupGate requires="financialYear">
      <AuditTrailBody />
    </SetupGate>
  );
}

function AuditTrailBody() {
  const router = useRouter();
  const [trail, setTrail] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [fy, setFy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      // Throws rather than degrading to null on a 5xx: a cold-start 503 used
      // to render this page as an honest-looking empty list.
      const state = await fetchSetupState({ signal });
      const fyId = state?.financialYear?.id;
      setFy(state?.financialYear || null);

      const [tRes, aRes] = await Promise.all([
        fetch(`/api/accounting/audit-trail${fyId ? `?financialYearId=${fyId}` : ""}`, {
          credentials: "include", signal,
        }),
        fetch("/api/accounting/chart-of-accounts", { credentials: "include", signal }),
      ]);
      const tJson = await tRes.json().catch(() => ({}));
      if (!tRes.ok) throw new Error(tJson.error || "Could not load the corrections");
      setTrail(tJson.trail || []);
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

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return trail;
    return trail.filter((r) =>
      [r.reason, r.action].filter(Boolean).some((s) => String(s).toLowerCase().includes(needle)),
    );
  }, [trail, q]);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="history" size={11} /> Also called the audit trail</>}
        title="Corrections"
        sub={
          fy
            ? `Every change made to a figure that was already in the books in ${fy.label} — what it was, what replaced it, and why.`
            : "Every change made to a figure that was already in the books — what it was, what replaced it, and why."
        }
        right={
          <div style={{ display: "flex", gap: 8 }}>
            <Btn icon="book-open" onClick={() => router.push("/admin/accounting/journal-entries")}>The books</Btn>
            <Btn icon="arrow-left" onClick={() => router.push("/admin/accounting")}>Overview</Btn>
          </div>
        }
      />

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={80} /><RevampSkeleton h={220} />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon="alert-triangle" title="Could not load the corrections" sub={error} />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Btn variant="primary" onClick={() => load()}>Try again</Btn>
          </div>
        </Card>
      ) : trail.length === 0 ? (
        <Card>
          <div style={{ padding: "36px 24px", textAlign: "center", maxWidth: 540, margin: "0 auto" }}>
            <Icon name="check-circle" size={30} color="var(--r-success)" style={{ margin: "0 auto" }} />
            <p style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: "var(--r-fg-1)" }}>
              Nothing has needed correcting
            </p>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.65 }}>
              This page fills up only when a figure already in the books has had
              to be put right afterwards. An empty list is the result you want —
              there is nothing here for you to do.
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
            <SmallStat icon="history" label="Corrections on record" value={trail.length} />
            <SmallStat icon="clock" label="Most recent" value={trail[0]?.adjustedAt ? dateText(trail[0].adjustedAt).split(",")[0] : "—"} />
          </div>

          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <Icon name="info" size={17} color="var(--r-accent)" />
              <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", lineHeight: 1.7 }}>
                None of these erased anything. A figure already in the books is
                never rewritten — a further entry is added that offsets it, so
                the original and the correction both stay on record. That is why
                a correction always carries a reason, and why this list cannot be
                edited or cleared.
              </div>
            </div>
          </Card>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Search the reason…" style={{ maxWidth: 300 }} />
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--r-fg-4)" }}>
              {visible.length} shown
            </span>
          </div>

          {visible.length === 0 ? (
            <Card><EmptyState icon="search" title="Nothing matches" sub="Try a different search." /></Card>
          ) : (
            <Card padded={false}>
              {visible.map((r, i) => {
                const id = String(r._id);
                const open = openId === id;
                const act = ACTIONS[r.action] || { label: r.action, tone: "neutral" };
                return (
                  <div key={id} style={{ borderBottom: i === visible.length - 1 ? "none" : "1px solid var(--r-hairline)" }}>
                    <div
                      onClick={() => setOpenId(open ? null : id)}
                      style={{ display: "flex", gap: 12, padding: "12px 15px", alignItems: "center", cursor: "pointer" }}
                    >
                      <Icon name={open ? "chevron-down" : "chevron-right"} size={14} color="var(--r-fg-5)" />
                      <span style={{ fontSize: 12, color: "var(--r-fg-4)", width: 140, flexShrink: 0 }}>
                        {dateText(r.adjustedAt)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--r-fg-1)" }}>{r.reason}</span>
                      <Pill tone={act.tone}>{act.label}</Pill>
                    </div>

                    {open ? (
                      <div style={{ padding: "0 15px 14px 41px" }}>
                        <SectionLabel icon="columns">What changed</SectionLabel>
                        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 4 }}>
                          <Lines title="AS IT WAS" lines={r.beforeLines} accountName={accountName} muted />
                          <Lines title="WHAT WAS WRITTEN TO PUT IT RIGHT" lines={r.afterLines} accountName={accountName} />
                        </div>
                        <p style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 10, lineHeight: 1.65 }}>
                          The left-hand entry is still in the books exactly as it
                          was. The right-hand one was added beside it. Both count,
                          and together they give the corrected figure.
                        </p>
                        <Btn size="sm" style={{ marginTop: 8 }} onClick={() => router.push("/admin/accounting/journal-entries")}>
                          Open the books
                        </Btn>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
