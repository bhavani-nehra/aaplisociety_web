"use client";
/**
 * Guided setup — opening the books where you can watch it happen.
 *
 * ## What this is instead of
 *
 * One button that called /api/accounting/quick-setup, did six things, and
 * returned `{ ready: true }`. Two seconds of spinner, one green tick, and no
 * way to know which of the six subsystems actually landed.
 *
 * Here each step says where it stands, says what it is about to do BEFORE it
 * does it, runs on its own, and reports what it created and what was already
 * there. "Run all" walks the same steps in order, one request each, so the
 * list fills in as it goes rather than resolving all at once — the work is
 * the same, the difference is that it is visible.
 *
 * ## Why a step collapses once it succeeds
 *
 * It opens itself the moment a run starts, so the log is visible while it
 * matters — mid-stream, or right at the "57 created" instant. Once that
 * settles into a one-line Receipt, staying open just holds six similar-looking
 * blocks of text open on the screen at once. The Receipt line still says what
 * happened; the full created/skipped list is one click away, not gone.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader, SectionLabel, Card, Pill, Btn, Icon, Progress, RevampSkeleton,
  DiffPreview, RunLog, Receipt,
} from "@/components/revamp";

export default function AccountingSetupPage() {
  const router = useRouter();
  const [steps, setSteps] = useState([]);
  const [states, setStates] = useState({});
  const [receipts, setReceipts] = useState({}); // key -> {status,at,actorName,counts,error} | null — persisted, survives refresh
  const [results, setResults] = useState({}); // key -> {status,message,created,skipped,error}
  const [running, setRunning] = useState(null); // key currently in flight
  const [runAll, setRunAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);
  const [open, setOpen] = useState({});

  // Plan -> Stream phases (design doc §6). Kept separate from `results`
  // (the settled outcome) and `receipts` (the persisted past) — these two
  // are transient, in-flight UI state for the step currently being previewed
  // or watched live.
  const [plans, setPlans] = useState({}); // key -> {willCreate,willSkip,willUpdate} | null
  const [planBusy, setPlanBusy] = useState(null); // key currently fetching a plan
  const [planExpanded, setPlanExpanded] = useState({});
  const [streamEvents, setStreamEvents] = useState({}); // key -> SetupEvent[]
  const [streaming, setStreaming] = useState(null); // key currently streaming

  const load = useCallback(async (signal) => {
    setLoading(true);
    setLoadErr(null);
    try {
      const res = await fetch("/api/accounting/setup/run", { credentials: "include", signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not load the setup steps");
      setSteps(json.steps || []);
      setStates(json.states || {});
      setReceipts(json.receipts || {});
    } catch (e) {
      if (e?.name !== "AbortError") setLoadErr(e.message);
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

  /**
   * Re-reads the step states without flipping the page back to its skeleton.
   * Running one step used to leave its "Right now — ..." line reading the old
   * count directly above a green "Created 57 account head(s)." message, which
   * reads as a contradiction. Only "Run all six" refreshed, because only it
   * called load().
   */
  const refreshStates = useCallback(async () => {
    try {
      const res = await fetch("/api/accounting/setup/run", { credentials: "include" });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setSteps(json.steps || []);
        setStates(json.states || {});
        setReceipts(json.receipts || {});
      }
    } catch {
      // The result message still stands on its own; only the state lines go
      // stale, and the next load() corrects them.
    }
  }, []);

  const runOne = useCallback(async (key, { refresh = true } = {}) => {
    setRunning(key);
    setResults((r) => ({ ...r, [key]: { status: "running" } }));
    setOpen((o) => ({ ...o, [key]: true }));
    try {
      const res = await fetch("/api/accounting/setup/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: key }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setResults((r) => ({
          ...r,
          [key]: { status: "failed", error: json.error || "That step could not be completed." },
        }));
        return false;
      }
      setResults((r) => ({
        ...r,
        [key]: {
          status: "done",
          message: json.message,
          created: json.created || [],
          skipped: json.skipped || [],
        },
      }));
      // Fold the fresh receipt in immediately — no need to wait on
      // refreshStates()/load() for "last run" to show the right actor/time.
      if (json.receipt) {
        setReceipts((r) => ({ ...r, [key]: { status: "ok", at: json.receipt.at, actorName: json.receipt.actorName } }));
      }
      // Collapse on success — the step opened itself to show the run in
      // progress; once it's done the one-line Receipt says enough, and
      // whoever wants the created/skipped list re-opens it themselves.
      setOpen((o) => ({ ...o, [key]: false }));
      if (refresh) await refreshStates();
      return true;
    } catch (e) {
      setResults((r) => ({ ...r, [key]: { status: "failed", error: e.message } }));
      return false;
    } finally {
      setRunning(null);
    }
  }, [refreshStates]);

  /** PLAN — fetch the dry-run diff, no write. Cancel is just clearing state. */
  const previewStep = useCallback(async (key) => {
    setPlanBusy(key);
    setOpen((o) => ({ ...o, [key]: true }));
    try {
      const res = await fetch("/api/accounting/setup/run?dryRun=1", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: key }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        setResults((r) => ({ ...r, [key]: { status: "failed", error: json.error || "Could not build a preview." } }));
        return;
      }
      setPlans((p) => ({ ...p, [key]: { willCreate: json.willCreate || [], willSkip: json.willSkip || [], willUpdate: json.willUpdate || [] } }));
    } catch (e) {
      setResults((r) => ({ ...r, [key]: { status: "failed", error: e.message } }));
    } finally {
      setPlanBusy(null);
    }
  }, []);

  const cancelPreview = useCallback((key) => {
    setPlans((p) => ({ ...p, [key]: null }));
  }, []);

  /**
   * STREAM — read the NDJSON body as it arrives so the log fills in live
   * instead of appearing all at once when the fetch resolves. The server has
   * already written the receipt by the time this loop ends (see
   * setup/run/route.js's `?stream=1` branch), so a final refreshStates()
   * picks up both the new `done` state and the persisted receipt.
   */
  const runStreaming = useCallback(async (key) => {
    const startedAt = Date.now();
    setPlans((p) => ({ ...p, [key]: null }));
    setStreaming(key);
    // Show something the instant the button is pressed, rather than a blank
    // panel for however long the request takes to reach the server — the
    // real "start" event (with its own timestamp) still lands right after.
    setStreamEvents((s) => ({ ...s, [key]: [{ t: "start", at: new Date().toISOString() }] }));
    setOpen((o) => ({ ...o, [key]: true }));
    const created = [];
    const skipped = [];
    let failed = null;
    try {
      const res = await fetch("/api/accounting/setup/run?stream=1", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: key }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "That step could not be completed.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          setStreamEvents((s) => ({ ...s, [key]: [...(s[key] || []), evt] }));
          if (evt.t === "item") (evt.action === "skipped" ? skipped : created).push(evt.label);
          if (evt.t === "error") failed = evt.message;
        }
      }
    } catch (e) {
      failed = e.message;
    }
    setResults((r) => ({
      ...r,
      [key]: failed
        ? { status: "failed", error: failed }
        : { status: "done", message: `${created.length} created · ${skipped.length} already there.`, created, skipped },
    }));
    // Collapse on success (a failure stays open — the log is the thing that
    // explains what went wrong, so there's nothing to hide there). A step
    // that finishes in well under a second used to open and collapse fast
    // enough to read as a glitch rather than a result — hold it open at
    // least 900ms so the log is actually legible before it folds away.
    if (!failed) {
      const elapsed = Date.now() - startedAt;
      const holdMs = Math.max(0, 900 - elapsed);
      setTimeout(() => setOpen((o) => ({ ...o, [key]: false })), holdMs);
    }
    setStreaming(null);
    await refreshStates();
  }, [refreshStates]);

  // "Run all six" batch preview — §7.32/§7.21: even the batch button must
  // show a combined diff before touching anything. Fetches a dry-run for
  // every not-yet-done step and holds them for one confirm, instead of
  // running straight through.
  const [batchPlan, setBatchPlan] = useState(null); // { items: [{key,title,willCreate,willSkip,willUpdate}] } | null
  const [batchPlanning, setBatchPlanning] = useState(false);

  // Which steps in the current batch plan the admin has kept ticked — every
  // step starts included, and unticking one is how "deny" actually works
  // here: the plan can't rewrite what a single step does internally (each
  // step is one atomic unit of work server-side), but the admin can refuse
  // to run specific steps in this pass and come back to them separately.
  const [batchIncluded, setBatchIncluded] = useState({});

  const prepareRunAll = useCallback(async () => {
    setBatchPlanning(true);
    try {
      const pending = steps.filter((s) => !(states[s.key]?.done === true || results[s.key]?.status === "done"));
      // Fetched together, not one-at-a-time — a six-step dry run used to be
      // six sequential round trips before the confirm screen even appeared.
      const items = await Promise.all(pending.map(async (s) => {
        const res = await fetch("/api/accounting/setup/run?dryRun=1", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: s.key }),
        });
        const json = await res.json().catch(() => ({}));
        return {
          key: s.key, title: s.title,
          willCreate: json.willCreate || [], willSkip: json.willSkip || [], willUpdate: json.willUpdate || [],
          error: !res.ok || json.ok === false ? (json.error || "Could not preview this step.") : null,
        };
      }));
      setBatchIncluded(Object.fromEntries(items.map((i) => [i.key, true])));
      setBatchPlan({ items });
    } finally {
      setBatchPlanning(false);
    }
  }, [steps, states, results]);

  const cancelRunAll = useCallback(() => setBatchPlan(null), []);
  const toggleBatchItem = useCallback((key) => {
    setBatchIncluded((b) => ({ ...b, [key]: !b[key] }));
  }, []);

  const confirmRunAll = useCallback(async () => {
    const keys = (batchPlan?.items || [])
      .filter((i) => batchIncluded[i.key])
      .map((i) => i.key);
    setBatchPlan(null);
    setRunAll(true);
    for (const key of keys) {
      // Stop on the first failure. Carrying on would pile a second error on
      // top of the first and bury the one that actually needs reading.
      const ok = await runOne(key, { refresh: false });
      if (!ok) break;
    }
    setRunAll(false);
    await load();
  }, [batchPlan, batchIncluded, runOne, load]);

  const doneCount = steps.filter(
    (s) => results[s.key]?.status === "done" || states[s.key]?.done === true,
  ).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  const busy = !!running || runAll || !!streaming;
  const anyFailed = Object.values(results).some((r) => r?.status === "failed");

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="wand-2" size={11} /> One-time setup</>}
        title="Open the books"
        sub="Six steps. Each one shows what it will do before it does it, and what it changed afterwards."
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn variant="primary" icon="play" disabled={busy || loading || batchPlanning || !!batchPlan} onClick={prepareRunAll}>
              {runAll ? "Running…" : batchPlanning ? "Building preview…" : `Preview & run all ${steps.length || ""}`}
            </Btn>
          </div>
        }
      />

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          <RevampSkeleton h={90} /><RevampSkeleton h={90} /><RevampSkeleton h={90} />
        </div>
      ) : loadErr ? (
        <Card>
          <div style={{ padding: 20, textAlign: "center" }}>
            <Icon name="alert-triangle" size={28} color="var(--r-danger)" style={{ margin: "0 auto" }} />
            <p style={{ marginTop: 10, fontSize: 13.5, color: "var(--r-fg-2)" }}>{loadErr}</p>
            <Btn variant="primary" onClick={() => load()} style={{ marginTop: 12 }}>Try again</Btn>
          </div>
        </Card>
      ) : (
        <>
          {batchPlan ? (
            <Card style={{ marginBottom: 18, border: "1px solid var(--r-brand)" }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                About to run {batchPlan.items.filter((i) => batchIncluded[i.key]).length} of {batchPlan.items.length} step{batchPlan.items.length === 1 ? "" : "s"}
              </div>
              <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginBottom: 8 }}>
                Untick anything you don&apos;t want run in this pass — it stays undone and you can come back to it on its own.
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {batchPlan.items.map((it) => {
                  const included = !!batchIncluded[it.key];
                  return (
                    <label key={it.key} style={{
                      display: "flex", gap: 10, alignItems: "flex-start",
                      padding: "8px 11px", borderRadius: 8, cursor: "pointer",
                      background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)",
                      opacity: included ? 1 : 0.55,
                    }}>
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => toggleBatchItem(it.key)}
                        style={{ marginTop: 3, width: 15, height: 15, flexShrink: 0, accentColor: "var(--r-brand)" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{it.title}</div>
                        {it.error ? (
                          <div style={{ fontSize: 12, color: "var(--r-danger)", marginTop: 4 }}>{it.error}</div>
                        ) : (
                          <div style={{ fontSize: 12, color: "var(--r-fg-3)", marginTop: 4 }}>
                            {it.willCreate.length} to create · {it.willUpdate.length} to update · {it.willSkip.length} already there
                          </div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <Btn onClick={cancelRunAll}>Cancel</Btn>
                <Btn
                  variant="primary"
                  disabled={!batchPlan.items.some((i) => batchIncluded[i.key])}
                  onClick={confirmRunAll}
                >
                  Confirm &amp; run {batchPlan.items.filter((i) => batchIncluded[i.key]).length || ""}
                </Btn>
              </div>
            </Card>
          ) : null}

          <Card style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <div style={{ fontSize: 13, color: "var(--r-fg-3)" }}>
                <strong style={{ color: "var(--r-fg-1)", fontSize: 15 }}>{doneCount}</strong> of {steps.length} steps done
              </div>
              <Pill tone={pct === 100 ? "paid" : "partial"}>{pct}%</Pill>
            </div>
            <Progress value={pct} total={100} color={pct === 100 ? "var(--r-success)" : "var(--r-warning)"} height={8} />
            {anyFailed ? (
              <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--r-danger)" }}>
                A step did not complete. Read its message below, fix what it names, then press that step again.
              </div>
            ) : null}
          </Card>

          <SectionLabel icon="list-checks">The six steps</SectionLabel>
          <div style={{ display: "grid", gap: 12 }}>
            {steps.map((s, i) => (
              <StepCard
                key={s.key}
                index={i + 1}
                step={s}
                state={states[s.key]}
                result={results[s.key]}
                receipt={receipts[s.key]}
                plan={plans[s.key]}
                planBusy={planBusy === s.key}
                planExpanded={!!planExpanded[s.key]}
                onTogglePlan={() => setPlanExpanded((o) => ({ ...o, [s.key]: !o[s.key] }))}
                streamEvents={streamEvents[s.key]}
                isStreaming={streaming === s.key}
                blockedBy={s.needs && !(results[s.needs]?.status === "done" || states[s.needs]?.done) ? s.needs : null}
                stepsByKey={Object.fromEntries(steps.map((x) => [x.key, x]))}
                busy={busy || !!planBusy || !!streaming}
                isOpen={!!open[s.key]}
                onToggle={() => setOpen((o) => ({ ...o, [s.key]: !o[s.key] }))}
                onPreview={() => previewStep(s.key)}
                onCancelPreview={() => cancelPreview(s.key)}
                onRun={() => runStreaming(s.key)}
              />
            ))}
          </div>

          {pct === 100 ? (
            <Card style={{ marginTop: 18 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <Icon name="check-circle" size={22} color="var(--r-success)" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>The books are open.</div>
                  <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 2 }}>
                    Next: enter last year&apos;s closing figures, then raise this month&apos;s bills.
                  </div>
                </div>
                <Btn variant="primary" onClick={() => router.push("/admin/opening-balances")}>
                  Opening figures
                </Btn>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function StepCard({
  index, step, state, result, receipt, plan, planBusy, planExpanded, onTogglePlan,
  streamEvents, isStreaming, blockedBy, stepsByKey, busy, isOpen, onToggle, onRun, onPreview, onCancelPreview,
}) {
  const status = result?.status || (state?.done === true ? "already" : "todo");
  const running = isStreaming || status === "running";
  const done = status === "done" || status === "already";
  const failed = status === "failed";

  const tone = failed
    ? { fg: "var(--r-danger)", icon: "alert-triangle" }
    : done
      ? { fg: "var(--r-success)", icon: "check-circle" }
      : running
        ? { fg: "var(--r-brand)", icon: "loader" }
        : { fg: "var(--r-fg-4)", icon: "circle" };

  return (
    <Card padded={false}>
      <div style={{ display: "flex", gap: 13, padding: "15px 17px", alignItems: "flex-start" }}>
        <div style={{
          width: 26, height: 26, borderRadius: 999, flexShrink: 0,
          background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 700, color: "var(--r-fg-3)",
        }}>{index}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Icon name={tone.icon} size={16} color={tone.fg} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--r-fg-1)" }}>{step.title}</span>
            {status === "already" ? <Pill tone="paid">already done</Pill> : null}
            {status === "done" ? <Pill tone="paid">done</Pill> : null}
            {failed ? <Pill tone="overdue">did not run</Pill> : null}
            {blockedBy ? <Pill tone="neutral">needs step above</Pill> : null}
          </div>

          <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 5, lineHeight: 1.6 }}>
            {step.what}
          </div>

          {/* PLAN phase — the real diff, fetched with zero writes, cancellable. */}
          {plan && !done && !running ? (
            <div style={{ marginTop: 8 }}>
              <DiffPreview
                willCreate={plan.willCreate}
                willSkip={plan.willSkip}
                willUpdate={plan.willUpdate}
                expanded={planExpanded}
                onToggle={onTogglePlan}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Btn size="sm" onClick={onCancelPreview}>Cancel</Btn>
                <Btn size="sm" variant="primary" onClick={onRun}>Run this</Btn>
              </div>
            </div>
          ) : !done && !running ? (
            <div style={{
              marginTop: 8, padding: "8px 11px", borderRadius: 8,
              background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)",
              fontSize: 12, color: "var(--r-fg-2)", lineHeight: 1.55,
            }}>
              <strong>When you press this:</strong> {step.willDo}
            </div>
          ) : null}

          {state?.detail ? (
            <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 6 }}>
              Right now — {state.detail}
            </div>
          ) : null}

          {/* Persisted receipt — the only trace of a run once the page has
              been reloaded and `result` (in-memory) is gone. Only shown when
              there's no live result already saying the same thing louder. */}
          {!result && receipt ? (
            <div style={{ marginTop: 6 }}>
              <Receipt status={receipt.status} at={receipt.at} actorName={receipt.actorName} />
            </div>
          ) : null}

          {blockedBy ? (
            <div style={{ fontSize: 11.5, color: "var(--r-warning)", marginTop: 6 }}>
              Do &ldquo;{stepsByKey[blockedBy]?.title || blockedBy}&rdquo; first.
            </div>
          ) : null}

          {isStreaming ? (
            <div style={{ marginTop: 8 }}>
              <RunLog events={streamEvents || []} height={140} />
            </div>
          ) : running ? (
            <div style={{ fontSize: 12.5, color: "var(--r-brand)", marginTop: 8 }}>Working…</div>
          ) : null}

          {failed ? (
            <div style={{
              marginTop: 8, padding: "9px 11px", borderRadius: 8,
              background: "var(--r-danger-soft)", color: "var(--r-danger)",
              fontSize: 12.5, lineHeight: 1.6,
            }}>{result.error}</div>
          ) : null}

          {/* The receipt — collapses to one line, re-openable to what changed. */}
          {status === "done" ? (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12.5, color: "var(--r-success)", fontWeight: 600, marginBottom: 4 }}>
                {result.message}
              </div>
              <Receipt
                status="ok"
                at={receipt?.at || new Date()}
                actorName={receipt?.actorName}
                created={result.created || []}
                skipped={result.skipped || []}
                expanded={isOpen}
                onToggle={onToggle}
              />
            </div>
          ) : null}

          {state?.missing?.length && !done ? (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 11.5, color: "var(--r-fg-4)", cursor: "pointer" }}>
                See the {state.missing.length} missing
              </summary>
              <div style={{ fontSize: 11.5, color: "var(--r-fg-4)", marginTop: 5, lineHeight: 1.6 }}>
                {state.missing.join(", ")}
              </div>
            </details>
          ) : null}
        </div>

        {plan && !done && !running ? null : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
            {/* Run is never a direct click target — every run (first time or
                "again") must pass through Preview first, per §7.32 of
                docs/accounting-module-audit-and-consolidation-plan.md: no
                silent process. Preview loads the diff; the Run button that
                actually posts only appears inside that diff panel above. */}
            {!running ? (
              <Btn size="sm" variant="primary" disabled={busy || !!blockedBy || planBusy} onClick={onPreview}>
                {planBusy ? "…" : done ? "Preview to run again" : "Preview"}
              </Btn>
            ) : (
              <Btn size="sm" variant="secondary" disabled>…</Btn>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
