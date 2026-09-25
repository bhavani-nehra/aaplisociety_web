"use client";

/**
 * <SetupGate> — the end of dead ends.
 * ----------------------------------------------------------------------------
 * Wrap any accounting page. It asks /api/accounting/setup-state what is
 * missing and, when the page cannot work yet, renders the reason and a button
 * that goes to the exact screen where the missing thing is created — instead
 * of the page body.
 *
 * ## What it replaces
 *
 * Five pages each carried their own version of:
 *
 *     <EmptyState text="No Financial Year found"
 *                 hint="Create a Financial Year under Accounting first." />
 *
 * Three problems with that, in increasing order of seriousness. It is not
 * clickable. It uses a word ("Financial Year") without saying what one is. And
 * it named a place — Accounting — that did not exist in the navigation, so the
 * instruction could not be followed at all.
 *
 * ## Two modes, deliberately different
 *
 * BLOCKING — the prerequisite this page needs is missing. The page body is not
 * rendered. Showing a working-looking screen that will reject every action is
 * worse than showing why it cannot work: the person fills a form, presses
 * save, and gets an error that arrives too late to teach them anything.
 *
 * ADVISORY — the prerequisite is satisfied but something later in the setup is
 * not. A strip appears above the page and the page works normally. This is the
 * "you are on page 3 and page 2 is half done" case: worth saying, never worth
 * blocking on, and dismissible so it does not nag someone who has decided to
 * come back to it.
 *
 * ## Why it fetches rather than being handed props
 *
 * The alternative is every page fetching setup state and passing it down,
 * which is the same duplication in a new place. One component, one request,
 * one vocabulary. Pages that already load their own data are unaffected — this
 * runs alongside.
 *
 * See docs/accounting-guided-ux/00-plan.md §3.
 */

import { useEffect, useState } from "react";
import { fetchSetupState } from "@/lib/accounting/setupStateClient";
import Link from "next/link";

const CARD = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "28px 24px",
  textAlign: "center",
  maxWidth: 560,
  margin: "32px auto",
};

const BTN = {
  display: "inline-block",
  marginTop: 18,
  padding: "10px 20px",
  borderRadius: 8,
  background: "var(--accent)",
  color: "var(--on-solid)",
  fontSize: 13.5,
  fontWeight: 600,
  textDecoration: "none",
};

const STRIP = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  padding: "11px 14px",
  borderRadius: 10,
  border: "1px solid var(--warning-border, #f0c36d)",
  background: "var(--warning-bg, #fff8e6)",
  color: "var(--warning-fg, #7a5b00)",
  fontSize: 13,
  lineHeight: 1.55,
  marginBottom: 16,
};

export function SetupGate({ requires, children }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    // Retries a cold-start 503 once before giving up — see setupStateClient.
    fetchSetupState({ signal: ac.signal })
      .then((d) => setState(d))
      // A failed check must never be what stops someone working. If we cannot
      // tell whether the page is usable, let them find out by using it.
      .catch(() => setState(null))
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, []);

  // Still asking, or not entitled to know, or the call failed: render the page.
  if (loading || !state || state.available === false) return children;

  const step = (state.steps || []).find((s) => s.key === requires);
  const blocking = step && step.status !== "done";

  if (blocking) {
    return (
      <div style={CARD}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--fg-2)" }}>
          {firstThingFirst(step)}
        </p>
        <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.6 }}>
          {step.what}
        </p>
        {step.detail ? (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--fg-4)", lineHeight: 1.6 }}>
            {step.detail}
          </p>
        ) : null}
        {step.href ? (
          <Link href={step.href} style={BTN}>
            {step.fix || `Go to ${step.label}`}
          </Link>
        ) : null}
        <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--fg-5)" }}>
          <Link href="/admin/accounting" style={{ color: "var(--fg-5)" }}>
            See the full accounting checklist
          </Link>
        </p>
      </div>
    );
  }

  // Satisfied. Anything else outstanding is worth mentioning, not enforcing.
  return (
    <>
      <Strip next={state.nextStep} except={requires} dismissed={dismissed} onDismiss={() => setDismissed(true)} />
      {children}
    </>
  );
}

/** The advisory strip itself, so SetupGate and SetupAdvisory cannot drift. */
function Strip({ next, except, dismissed, onDismiss }) {
  if (dismissed || !next || (except && next.key === except)) return null;
  return (
    <div style={STRIP}>
      <span aria-hidden="true"></span>
      <span style={{ flex: 1 }}>
        <strong>Still to do: {next.label}.</strong>{" "}
        {next.detail}{" "}
        {next.href ? (
          <Link href={next.href} style={{ color: "inherit", fontWeight: 600 }}>
            {next.fix || "Open it"} →
          </Link>
        ) : null}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hide this reminder"
        style={{
          border: "none", background: "none", cursor: "pointer",
          color: "inherit", fontSize: 16, lineHeight: 1, padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * <SetupAdvisory> — the strip on its own, for a page that already handles its
 * own missing-prerequisite case.
 *
 * The five statement pages each decide for themselves whether a Financial Year
 * exists and render <NoFinancialYear> when it does not. Wrapping them in a
 * full <SetupGate> would put two different blocking screens on the same page.
 * What they were missing is the OTHER half: a Financial Year exists, the page
 * looks ready, and something further down the checklist is not done — no
 * opening balances, no posting rules — so the statement they are about to
 * print will be quietly wrong.
 *
 * That is exactly the "you are on page 3 and page 2 is half done" case, and it
 * matters more here than anywhere else in the product, because the output of
 * these pages gets signed.
 */
export function SetupAdvisory() {
  const [state, setState] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    // Retries a cold-start 503 once before giving up — see setupStateClient.
    fetchSetupState({ signal: ac.signal })
      .then((d) => setState(d))
      .catch(() => setState(null));
    return () => ac.abort();
  }, []);

  if (!state || state.available === false || state.ready) return null;
  return (
    <Strip next={state.nextStep} dismissed={dismissed} onDismiss={() => setDismissed(true)} />
  );
}

/**
 * The headline. A blocked step is waiting on something earlier, and saying
 * "Add the account heads first" to someone who cannot add them yet is another
 * dead end — so a blocked step reports what it is actually waiting for.
 */
function firstThingFirst(step) {
  if (step.status === "blocked") return `${step.label} is not ready yet`;
  return `${step.label} — not set up yet`;
}

/**
 * <NoFinancialYear> — the specific dead end, killed.
 *
 * The five statement pages already work out for themselves that no Financial
 * Year exists; they just had nothing useful to say about it. This is the
 * replacement for that sentence, not a replacement for their check — which is
 * why it takes no props and does no fetching. Drop-in, one line per page.
 *
 * Kept beside SetupGate because it says the same thing in the same words, and
 * two components that must agree should be readable side by side.
 */
export function NoFinancialYear({ what = "this page" }) {
  // Real years, not a template. "1 April to 31 March" tells a reader trying to
  // work out which year this is exactly nothing.
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyEnd = fyStart + 1;
  return (
    <div style={CARD}>
      <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--fg-2)" }}>
        No Financial Year yet
      </p>
      <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--fg-4)", lineHeight: 1.65 }}>
        A Financial Year is the account book for one year — for the current one
        that is 1 April {fyStart} to 31 March {fyEnd}. On paper you would take a
        new book off the shelf each April; this is the same thing. Everything is
        recorded inside one, so {what} has nothing to work with until the society
        has one.
      </p>
      <Link href="/admin/accounting/financial-years" style={BTN}>
        Create this year&apos;s Financial Year
      </Link>
      <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--fg-5)" }}>
        It takes one click.{" "}
        <Link href="/admin/accounting" style={{ color: "var(--fg-5)" }}>
          See the full accounting checklist
        </Link>
      </p>
    </div>
  );
}

export default SetupGate;
