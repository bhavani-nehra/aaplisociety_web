"use client";

// Opening Balances — the real, production page to set a Financial Year's
// starting position (not a simulator). One-time setup per Financial Year:
// how much cash/bank the society had, what it owned, what it owed, and its
// accumulated Funds, on day one of the year.
//
// Plain-language note for non-technical society admins: everywhere else in
// this app calls one recorded transaction a "voucher" — think of it as one
// receipt/payment slip in a paper cash book. This page creates exactly one
// such slip: the "opening" slip that carries last year's closing figures
// into this year's books.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "../../../components/accounting/generate/Icon";
import { PageHeader, FySelect, Btn, EmptyState } from "../../../components/accounting/generate/PageHeader";
import { NoFinancialYear, SetupAdvisory } from "@/components/accounting/SetupGate";
import Assistant from "@/components/accounting/Assistant";
import { useFinancialYears } from "../../../components/accounting/generate/useFinancialYears";
import { fmtINR, Banner } from "../../../components/accounting/generate/Primitives";

async function fetchJSON(url, opts) {
  const res = await fetch(url, { credentials: "include", ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const GROUP_LABEL = {
  Asset: "What the society owns (Assets) — cash, bank, fixed deposits, property, dues from members",
  Liability: "What the society owes (Liabilities) — bills payable, deposits held for others",
  Equity: "Society Funds — Share Capital, Reserve Fund, Sinking Fund, General Fund etc.",
};

export default function OpeningBalancesScreen() {
  const router = useRouter();
  const { years, financialYearId, setFinancialYearId, loading: fyLoading } = useFinancialYears();
  const [status, setStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [amounts, setAmounts] = useState({}); // accountId -> string
  const [fundAccountId, setFundAccountId] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState(null);
  const [posted, setPosted] = useState(false);
  // Once other entries already exist, the plain opening-balance form can no
  // longer be posted as the opening slip. This tracks the two doors offered
  // instead: "yes, something's missing — enter it as a correction" or
  // "no, this year genuinely started from zero".
  const [correctionChoice, setCorrectionChoice] = useState(null); // null | "enter" | "zero"
  const [confirmingZero, setConfirmingZero] = useState(false);
  const [priorSurplus, setPriorSurplus] = useState(null); // { label, amount } | null

  useEffect(() => {
    if (!financialYearId) return;
    let cancelled = false;
    setFetching(true);
    setError(null);
    setPosted(false);
    Promise.all([
      fetchJSON(`/api/accounting/opening-balance?financialYearId=${financialYearId}`),
      fetchJSON(`/api/accounting/chart-of-accounts`),
    ])
      .then(([{ status }, { accounts }]) => {
        if (cancelled) return;
        setStatus(status);
        const relevant = accounts.filter((a) => ["Asset", "Liability", "Equity"].includes(a.type));
        setAccounts(relevant);
        setAmounts({});
        // "Income & Expenditure A/c" is the account real society books
        // actually carry accumulated surplus in — last year's audited
        // closing figure becomes this year's opening balancing figure here,
        // the same way Reserve/Sinking Fund already do. Falls back to
        // General Fund only for a society that adopted this template before
        // that account existed and hasn't added it yet.
        const firstEquity =
          relevant.find((a) => a.type === "Equity" && a.code === "3005") ||
          relevant.find((a) => a.type === "Equity" && /income\s*&?\s*expenditure/i.test(a.name)) ||
          relevant.find((a) => a.type === "Equity" && /general fund/i.test(a.name)) ||
          relevant.find((a) => a.type === "Equity");
        setFundAccountId(firstEquity ? String(firstEquity._id) : "");
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setFetching(false));
    return () => { cancelled = true; };
  }, [financialYearId]);

  // Last year's surplus — a sanity-check hint next to the Fund-account
  // picker, not a value forced into anything. The balancing figure below is
  // still computed live from whatever gets entered for every other account;
  // this just tells the admin what number it should land near, the same way
  // a bookkeeper checks new opening balances against last year's audited
  // closing before signing off. `years` sorts newest-first (see
  // useFinancialYears), so the previous FY is the very next entry.
  useEffect(() => {
    if (!financialYearId || !years.length) { setPriorSurplus(null); return; }
    const idx = years.findIndex((y) => String(y._id) === String(financialYearId));
    const prior = idx >= 0 ? years[idx + 1] : null;
    if (!prior) { setPriorSurplus(null); return; }
    let cancelled = false;
    fetchJSON(`/api/accounting/financial-statements/income-expenditure?financialYearId=${prior._id}`)
      .then((data) => {
        if (cancelled) return;
        const amount = data?.statement?.surplusOrDeficitCurrent;
        if (typeof amount === "number") setPriorSurplus({ label: prior.label, amount });
        else setPriorSurplus(null);
      })
      .catch(() => !cancelled && setPriorSurplus(null));
    return () => { cancelled = true; };
  }, [financialYearId, years]);

  const grouped = useMemo(() => {
    const g = { Asset: [], Liability: [], Equity: [] };
    accounts.forEach((a) => { if (g[a.type]) g[a.type].push(a); });
    return g;
  }, [accounts]);

  const entries = useMemo(
    () =>
      Object.entries(amounts)
        .filter(([, v]) => Number(v) > 0)
        .map(([accountId, v]) => ({ accountId, amount: Number(v) })),
    [amounts],
  );

  const totals = useMemo(() => {
    let debit = 0, credit = 0;
    entries.forEach(({ accountId, amount }) => {
      const acc = accounts.find((a) => String(a._id) === accountId);
      if (!acc) return;
      if (acc.normalBalance === "Debit") debit += amount; else credit += amount;
    });
    return { debit, credit };
  }, [entries, accounts]);

  const balancingAmount = round2(Math.abs(totals.debit - totals.credit));
  function round2(n) { return Math.round(n * 100) / 100; }

  const canPost = (status?.canEnterOpening || correctionChoice === "enter") && entries.length > 0 && fundAccountId;

  const submit = async () => {
    setPosting(true);
    setPostError(null);
    try {
      const url = correctionChoice === "enter"
        ? "/api/accounting/opening-balance/correction"
        : "/api/accounting/opening-balance";
      await fetchJSON(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financialYearId, entries, openingFundAccountId: fundAccountId }),
      });
      setPosted(true);
      setCorrectionChoice(null);
      const { status: fresh } = await fetchJSON(`/api/accounting/opening-balance?financialYearId=${financialYearId}`);
      setStatus(fresh);
    } catch (e) {
      setPostError(e.message);
    } finally {
      setPosting(false);
    }
  };

  const confirmZero = async () => {
    setConfirmingZero(true);
    setPostError(null);
    try {
      await fetchJSON("/api/accounting/opening-balance/confirm-zero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financialYearId }),
      });
      setPosted(true);
      setCorrectionChoice(null);
      const { status: fresh } = await fetchJSON(`/api/accounting/opening-balance?financialYearId=${financialYearId}`);
      setStatus(fresh);
    } catch (e) {
      setPostError(e.message);
    } finally {
      setConfirmingZero(false);
    }
  };

  return (
    <div>
      <Assistant />
      <PageHeader
        title="Opening Balances"
        subtitle="One-time setup per Financial Year — carry last year's closing figures into this year's books"
        right={<FySelect years={years} value={financialYearId} onChange={setFinancialYearId} />}
      />

      {/* Financial Year exists, but something further down the checklist
          does not — and the output of this page gets signed. */}
      <SetupAdvisory />

      <div style={{ background: "var(--info-bg)", border: "1px solid var(--info)", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "var(--info-fg)", display: "flex", gap: 10 }}>
        <Icon name="database" size={17} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          <strong>In plain words:</strong> this page is where you tell the system how much cash, bank balance, property, dues and funds the society had on the first day of this Financial Year.
          Everywhere else the app calls one recorded entry a "voucher" — it just means one receipt/payment slip, same as a paper cash book. This page creates exactly one such slip: the opening slip.
        </span>
      </div>

      {fyLoading || fetching ? (
        <EmptyState text="Loading…" />
      ) : error ? (
        <Banner tone="danger" icon="alert-triangle">{error}</Banner>
      ) : !status ? (
        <NoFinancialYear what="entering opening balances" />
      ) : status.openingBalancesConfirmed ? (
        <Banner tone="success" icon="check-circle">
          Opening balances are already posted and confirmed for this Financial Year. To change them, ask your accountant to post a correcting Journal Entry — the opening slip itself is locked once posted, the same way a paper cash book's first page isn't rewritten.
        </Banner>
      ) : !status.canEnterOpening && correctionChoice !== "enter" ? (
        <>
          <Banner tone="danger" icon="alert-triangle">
            {status.voucherCount} transaction(s) are already recorded in this Financial Year, so the opening-balance step can no longer be entered as the first slip.
          </Banner>
          {posted && <Banner tone="success" icon="check-circle">Done. This Financial Year's opening-balance step is now confirmed.</Banner>}
          {postError && <Banner tone="danger" icon="alert-triangle">{postError}</Banner>}
          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginTop: 16, fontSize: 13.5, color: "var(--fg-3)", lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}><strong>One question decides what to do next:</strong> did this society have any cash, bank balance, dues, or funds on the first day of this Financial Year — carried over from last year's closing statement?</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              <Btn variant="primary" onClick={() => setCorrectionChoice("enter")}>
                <Icon name="plus-circle" size={14} /> Yes — enter it now
              </Btn>
              <Btn variant="secondary" onClick={confirmZero} disabled={confirmingZero}>
                <Icon name="check-circle" size={14} /> {confirmingZero ? "Saving…" : "No — this year started from zero"}
              </Btn>
            </div>
            <p style={{ marginTop: 14, marginBottom: 0, fontSize: 12.5, color: "var(--fg-5)" }}>
              Choosing "Yes" posts one dated correcting entry — the same amounts form as normal, it just doesn't need to be the very first entry any more. Choosing "No" just marks this step done; nothing is posted because there is nothing to post.
            </p>
          </div>
        </>
      ) : (
        <>
          {correctionChoice === "enter" && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 12.5, color: "var(--fg-5)" }}>
                Entering this as a correction — {status.voucherCount} other transaction(s) already exist in this Financial Year, so this posts a dated correcting entry, not the opening slip itself.
              </div>
              <Btn variant="secondary" onClick={() => setCorrectionChoice(null)}>
                <Icon name="arrow-left" size={14} /> Back
              </Btn>
            </div>
          )}
          {posted && (
            <Banner tone="success" icon="check-circle">
              {correctionChoice === "enter"
                ? "Correcting entry posted. This Financial Year's opening-balance step is now confirmed."
                : "Opening balances posted. This Financial Year now has a confirmed starting position."}
            </Banner>
          )}
          {postError && <Banner tone="danger" icon="alert-triangle">{postError}</Banner>}

          {["Asset", "Liability", "Equity"].map((type) => (
            <div key={type} style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 16, overflow: "hidden" }}>
              <div style={{ padding: "12px 18px", background: "var(--bg-sunken)", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 700, color: "var(--fg-2)" }}>{GROUP_LABEL[type]}</div>
              <div style={{ padding: "6px 18px" }}>
                {grouped[type].length === 0 && <div style={{ padding: "12px 0", fontSize: 13, color: "var(--fg-5)" }}>No accounts of this kind set up yet.</div>}
                {grouped[type].map((a) => (
                  <div key={a._id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--bg-muted)" }}>
                    <span style={{ flex: 1, fontSize: 13.5, color: "var(--fg-3)" }}>{a.name} <span style={{ color: "var(--fg-5)", fontSize: 12 }}>({a.code})</span></span>
                    <span style={{ fontSize: 12, color: "var(--fg-5)" }}>₹</span>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={amounts[a._id] ?? ""}
                      onChange={(e) => setAmounts((s) => ({ ...s, [a._id]: e.target.value }))}
                      style={{ width: 140, padding: "6px 10px", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 13, textAlign: "right", fontFamily: "inherit" }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--fg-3)", marginBottom: 8 }}>
              Balancing Fund account (absorbs the difference between what's owned and what's owed — this is last year's accumulated surplus, so &quot;Income &amp; Expenditure A/c&quot; is normally the right choice, not General Fund)
            </label>
            {priorSurplus ? (
              <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--fg-4)" }}>
                {priorSurplus.label}&apos;s books closed with a {priorSurplus.amount >= 0 ? "surplus" : "deficit"} of{" "}
                <strong style={{ color: "var(--fg-2)" }}>{fmtINR(Math.abs(priorSurplus.amount))}</strong> — the balancing
                figure below should land near that plus whatever this account already carried in, once every other
                opening balance is entered.
              </p>
            ) : null}
            <select
              value={fundAccountId}
              onChange={(e) => setFundAccountId(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border-strong)", fontSize: 13, fontFamily: "inherit", width: "100%", maxWidth: 360 }}
            >
              <option value="">Select a Fund account…</option>
              {grouped.Equity.map((a) => <option key={a._id} value={a._id}>{a.name}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "var(--fg-4)" }}>
              Entered so far: <strong style={{ color: "var(--fg-1)" }}>{entries.length}</strong> account(s) · Debits {fmtINR(totals.debit)} · Credits {fmtINR(totals.credit)}
              {balancingAmount > 0.005 && <> · balancing figure {fmtINR(balancingAmount)} will post to the Fund account above</>}
            </div>
            <Btn variant="primary" onClick={submit} disabled={!canPost || posting}>
              <Icon name="check-circle" size={14} /> {posting ? "Posting…" : correctionChoice === "enter" ? "Post correcting entry" : "Post opening balances"}
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}
