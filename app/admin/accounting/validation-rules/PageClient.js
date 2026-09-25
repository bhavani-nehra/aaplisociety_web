"use client";
/**
 * Book checks — what gets verified before any statement is printed.
 *
 * ## The one thing that actually matters on this page
 *
 * Not the list. The word **blocking**. A blocking check that fails stops the
 * Balance Sheet from being generated at all, and an admin who does not know
 * which checks can do that will read "Generate failed" as a broken product
 * rather than as the system refusing to print a statement it knows is wrong.
 *
 * So blocking checks are separated out and named as the ones that can stop a
 * statement, with the reason stated in those words.
 *
 * ## Why navigationTarget is deliberately NOT rendered as a link
 *
 * The seeded rules carry targets like "/accounting/trial-balance" — paths from
 * an earlier layout that have no page today. Rendering them would reproduce
 * exactly the bug this whole feature exists to remove: app/admin/[...catchAll]
 * swallows any unknown /admin/* path and drops the reader on the dashboard
 * with no error. Only targets we can map to a page that demonstrably exists
 * get a link; the rest show their written remedy and nothing clickable.
 *
 * ## Why these checks stay un-switchable, and what the page does instead
 *
 * Same as posting rules: these are the shared default tier (societyId: null)
 * and ValidationRuleService returns 409 on any attempt to patch one — and
 * unlike posting rules, letting a society switch off the very check that
 * would have caught its own mistake genuinely isn't a safe action to offer,
 * so there is no override-off here either.
 *
 * What makes this page do real work instead of just listing definitions:
 * "Run these checks now" actually executes every check against this
 * society's live books (GET /api/accounting/validation/run) and shows
 * pass/fail per rule right here, with the fix target one click away — the
 * same "Fix it for me" pattern as everywhere else, applied to a page that
 * used to only describe what checking would mean (§7.32).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import notify from "@/lib/notify";
import {
  SectionLabel, Card, Pill, Btn, Icon,
  EmptyState, RevampSkeleton, SmallStat,
} from "@/components/revamp";

/**
 * Stored target → a page that exists. Anything absent from this map renders
 * without a link rather than pointing at a path the catch-all would swallow.
 */
const TARGETS = {
  "/accounting/chart-of-accounts": "/admin/accounting/chart-of-accounts",
  "/accounting/fiscal-config": "/admin/accounting/setup",
  "/accounting/trial-balance": "/admin/accounting/statements?tab=trial-balance",
};

/** Severity, in the order someone should read them. */
const SEVERITIES = [
  {
    key: "Error",
    label: "Must be fixed",
    gloss: "Something is wrong with the books themselves. A statement printed in this state would be incorrect.",
    tone: "expired",
  },
  {
    key: "Warning",
    label: "Should be looked at",
    gloss: "Not wrong, but something is incomplete and will show up on a statement as a gap.",
    tone: "warning",
  },
  {
    key: "Info",
    label: "Worth knowing",
    gloss: "Nothing is wrong. These point out work that is sitting unfinished.",
    tone: "info",
  },
];

export default function ValidationRulesPage() {
  const router = useRouter();
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState(null); // ruleId -> outcome, or null if never run
  const [ranAt, setRanAt] = useState(null);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/accounting/validation/run", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not run the checks");
      const byId = {};
      for (const r of json.results || json.checks || []) byId[r.ruleId] = r;
      setRunResults(byId);
      setRanAt(new Date());
      const failed = Object.values(byId).filter((r) => !r.passed).length;
      if (failed) notify.error(`${failed} check${failed === 1 ? "" : "s"} failed — see below.`);
      else notify.success("All checks passed.");
    } catch (e) {
      notify.error(e.message);
    } finally {
      setRunning(false);
    }
  }, []);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounting/validation-rules", { credentials: "include", signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the checks");
      setRules(json.validationRules || []);
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

  const install = useCallback(async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/accounting/setup/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "validationRules" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "Could not install the checks");
      notify.success(json.message || "Checks installed");
      await load();
    } catch (e) {
      notify.error(e.message);
    } finally {
      setSeeding(false);
    }
  }, [load]);

  const bySeverity = useMemo(() => {
    const m = new Map(SEVERITIES.map((s) => [s.key, []]));
    for (const r of rules) {
      const k = m.has(r.severity) ? r.severity : "Info";
      m.get(k).push(r);
    }
    return m;
  }, [rules]);

  const blockingCount = rules.filter((r) => r.blocking).length;
  const activeCount = rules.filter((r) => r.isActive !== false).length;

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      {/* No own header — this renders inside the Configuration accordion
          (page 1 of 6), which already titles this section "Book Checks". */}
      {rules.length ? (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <Btn variant="primary" icon="play" disabled={running} onClick={runNow}>
            {running ? "Running…" : "Run these checks now"}
          </Btn>
        </div>
      ) : null}

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={80} /><RevampSkeleton h={220} />
        </div>
      ) : error ? (
        <Card>
          <EmptyState icon="alert-triangle" title="Could not load the checks" sub={error} />
          <div style={{ textAlign: "center", paddingBottom: 20 }}>
            <Btn variant="primary" onClick={() => load()}>Try again</Btn>
          </div>
        </Card>
      ) : rules.length === 0 ? (
        <Card>
          <div style={{ padding: "36px 24px", textAlign: "center", maxWidth: 520, margin: "0 auto" }}>
            <Icon name="shield-check" size={30} color="var(--r-fg-5)" style={{ margin: "0 auto" }} />
            <p style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: "var(--r-fg-1)" }}>
              No checks configured
            </p>
            <p style={{ marginTop: 8, fontSize: 13, color: "var(--r-fg-3)", lineHeight: 1.65 }}>
              With no checks, a mistake in the books would print onto the
              statement and only be found by the auditor — months later, when
              correcting it is a great deal more work.
            </p>
            <Btn variant="primary" icon="plus" disabled={seeding} onClick={install} style={{ marginTop: 16 }}>
              {seeding ? "Installing…" : "Install the standard checks"}
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              <SmallStat icon="shield-check" label="Checks active" value={activeCount} />
              <SmallStat icon="alert-triangle" label="Can stop a statement" value={blockingCount} />
              <SmallStat icon="list-ordered" label="Checks in total" value={rules.length} />
            </div>
          </div>

          {runResults ? (
            <Card style={{ marginBottom: 18, border: `1px solid ${Object.values(runResults).some((r) => !r.passed) ? "var(--r-danger)" : "var(--r-success)"}` }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {Object.values(runResults).some((r) => !r.passed)
                  ? `${Object.values(runResults).filter((r) => !r.passed).length} check(s) failed`
                  : "All checks passed"} — run {ranAt ? ranAt.toLocaleTimeString() : "just now"}
              </div>
            </Card>
          ) : null}

          {blockingCount ? (
            <Card style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <Icon name="info" size={17} color="var(--r-accent)" />
                <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", lineHeight: 1.7 }}>
                  {blockingCount} of these can <strong>stop a statement being
                  printed</strong>. That is deliberate — a Balance Sheet that
                  does not balance is worse than no Balance Sheet, because it
                  gets signed. If generating a statement is refused, the reason
                  will be one of the checks marked below.
                </div>
              </div>
            </Card>
          ) : null}

          {SEVERITIES.filter((s) => (bySeverity.get(s.key) || []).length).map((s) => (
            <div key={s.key} style={{ marginBottom: 20 }}>
              <SectionLabel icon="circle">{s.label}</SectionLabel>
              <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.55 }}>
                {s.gloss}
              </p>
              <Card padded={false}>
                {(bySeverity.get(s.key) || []).map((r, i, arr) => {
                  const target = TARGETS[r.navigationTarget];
                  const outcome = runResults?.[r._id];
                  return (
                    <div
                      key={r._id}
                      style={{
                        padding: "13px 15px",
                        borderBottom: i === arr.length - 1 ? "none" : "1px solid var(--r-hairline)",
                        opacity: r.isActive === false ? 0.55 : 1,
                        background: outcome && !outcome.passed ? "var(--r-danger-soft)" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--r-fg-1)" }}>
                          {r.description || r.rule}
                        </span>
                        {r.blocking ? <Pill tone="overdue">stops a statement</Pill> : null}
                        {r.societyId ? <Pill tone="info" dot={false}>yours</Pill> : null}
                        {r.isActive === false ? <Pill tone="expired">switched off</Pill> : null}
                        {outcome ? (
                          outcome.passed
                            ? <Pill tone="paid">passed</Pill>
                            : <Pill tone="overdue">failed{outcome.count ? ` — ${outcome.count}` : ""}</Pill>
                        ) : null}
                      </div>
                      {r.helpText ? (
                        <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 5, lineHeight: 1.6 }}>
                          {r.helpText}
                        </div>
                      ) : null}
                      {outcome && !outcome.passed && outcome.message ? (
                        <div style={{ fontSize: 12.5, color: "var(--r-danger)", marginTop: 5, lineHeight: 1.6 }}>
                          {outcome.message}
                        </div>
                      ) : null}
                      {r.suggestedResolution ? (
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>
                            If it fails: {r.suggestedResolution}
                          </span>
                          {target ? (
                            <Btn size="sm" variant={outcome && !outcome.passed ? "primary" : "secondary"} onClick={() => router.push(target)}>
                              {outcome && !outcome.passed ? "Fix it" : "Go there"}
                            </Btn>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </Card>
            </div>
          ))}

          <p style={{ fontSize: 12, color: "var(--r-fg-4)", lineHeight: 1.65 }}>
            These are the standard checks, shared by every society on the
            system, and they are not switched off here — a check that can be
            turned off by the person it would have caught is not a check. They
            run automatically whenever a statement is generated, and you can
            run them on demand any time with the button above to see exactly
            where the books stand right now.
          </p>
        </>
      )}
    </div>
  );
}
