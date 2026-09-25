"use client";
import PulseLoader from "@/components/brand/PulseLoader";
import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  FlaskConical,
  Server,
  Database,
  Globe,
  Download,
  ShieldAlert,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Zap,
} from "lucide-react";
import { provisionSociety, manualLane } from "@/lib/loadtest/provisioning";
import {
  runIndividualPhase,
  runConcurrentPhase,
  computeStats,
} from "@/lib/loadtest/runner";
import { makeRunTag } from "@/lib/loadtest/xlsxBuilders";
import styles from "@/styles/LoadTestLab.module.css";

const STAGE_LABELS = {
  import: "Bulk Member Import",
  generate: "Bulk Bill Generation",
  "payments-preview": "Payment Processing \u2014 preview",
  "payments-confirm": "Payment Processing \u2014 confirm",
};
const STAGE_ORDER = ["import", "generate", "payments-preview", "payments-confirm"];
const PHASE_LABELS = { individual: "Individual (baseline)", concurrent: "Concurrent (all 3 at once)" };

function nowMonthYear() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function summarize(events, laneId, stage, phase) {
  const matches = events.filter(
    (e) =>
      e.lane === laneId &&
      e.stage === stage &&
      (!phase || e.phase === phase) &&
      (e.type === "request-success" || e.type === "request-fail"),
  );
  const success = matches.filter((e) => e.type === "request-success").length;
  const fail = matches.filter((e) => e.type === "request-fail").length;
  const skipped = events.some(
    (e) => e.lane === laneId && e.stage === stage && (!phase || e.phase === phase) && e.type === "stage-skipped",
  );
  const latencies = matches.map((e) => e.elapsedMs).filter((n) => typeof n === "number");
  const avg = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;
  const max = latencies.length ? Math.max(...latencies) : null;
  const last = matches[matches.length - 1] || null;
  const pending =
    events.some(
      (e) => e.lane === laneId && e.stage === stage && (!phase || e.phase === phase) && e.type === "request-start",
    ) && matches.length === 0;
  return { success, fail, skipped, avg, max, last, pending, attempted: matches.length };
}

function FlowDiagram({ active, label }) {
  return (
    <div className={styles.flowDiagram}>
      <div className={`${styles.flowNode} ${active ? styles.flowNodeActive : ""}`}>
        <Globe size={16} />
        <span>Browser</span>
      </div>
      <div className={styles.flowTrack}>
        <div className={styles.flowLine} />
        <AnimatePresence>
          {active ? (
            <motion.div
              className={styles.flowPill}
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: ["0%", "48%", "100%"], opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            />
          ) : null}
        </AnimatePresence>
      </div>
      <div className={`${styles.flowNode} ${active ? styles.flowNodeActive : ""}`}>
        <Server size={16} />
        <span>Vercel</span>
      </div>
      <div className={styles.flowTrack}>
        <div className={styles.flowLine} />
        <AnimatePresence>
          {active ? (
            <motion.div
              className={styles.flowPill}
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: ["0%", "48%", "100%"], opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
            />
          ) : null}
        </AnimatePresence>
      </div>
      <div className={`${styles.flowNode} ${active ? styles.flowNodeActive : ""}`}>
        <Database size={16} />
        <span>MongoDB</span>
      </div>
      {active ? <span className={styles.flowActiveLabel}>{label}</span> : null}
    </div>
  );
}

function StatusIcon({ pending, success, fail, skipped }) {
  if (pending) return <PulseLoader size={24} />;
  if (skipped && success === 0 && fail === 0) return <Clock size={14} className={styles.iconIdle} />;
  if (fail > 0 && success === 0) return <XCircle size={14} className={styles.iconFail} />;
  if (success > 0) return <CheckCircle2 size={14} className={styles.iconPass} />;
  return <Clock size={14} className={styles.iconIdle} />;
}

function MetricCard({ stage, m }) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricLabelRow}>
        <StatusIcon pending={m.pending} success={m.success} fail={m.fail} skipped={m.skipped} />
        <span className={styles.metricLabel}>{STAGE_LABELS[stage] || stage}</span>
      </div>
      <div className={styles.metricValue}>
        {m.last
          ? `${m.last.status || "\u2014"}`
          : m.pending
          ? "\u2026"
          : m.skipped
          ? "skipped"
          : "\u2014"}
      </div>
      <div className={styles.metricSub}>
        {m.avg != null ? `${m.avg}ms avg` : m.skipped ? "dependency failed" : "not run yet"}
        {m.max != null ? ` \u00b7 ${m.max}ms max` : ""}
      </div>
    </div>
  );
}

function PhaseBar({ phases }) {
  if (!phases) return <span className={styles.hint}>no browser timing entry matched (older browser or cached response)</span>;
  const segs = [
    // TODO: unmapped color, needs design review (no purple token in canonical palette)
    { key: "dns", label: "DNS", ms: phases.dns, color: "var(--accent)" },
    { key: "tcp", label: "TCP", ms: phases.tcp, color: "var(--accent)" },
    // TODO: unmapped color, needs design review (no cyan token in canonical palette)
    { key: "tls", label: "TLS", ms: phases.tls, color: "#06b6d4" },
    { key: "ttfb", label: "Waiting (TTFB)", ms: phases.ttfb, color: "var(--warning)" },
    { key: "download", label: "Download", ms: phases.download, color: "var(--success)" },
  ];
  const total = Math.max(phases.total, 1);
  return (
    <div className={styles.phaseBarWrap}>
      <div className={styles.phaseBarTrack}>
        {segs.map((s) => (
          <div
            key={s.key}
            className={styles.phaseBarSeg}
            style={{ width: `${Math.max(0, (s.ms / total) * 100)}%`, background: s.color }}
            title={`${s.label}: ${s.ms}ms`}
          />
        ))}
      </div>
      <div className={styles.phaseBarLegend}>
        {segs.map((s) => (
          <span key={s.key} className={styles.phaseLegendItem}>
            <span className={styles.phaseLegendDot} style={{ background: s.color }} />
            {s.label} {s.ms}ms
          </span>
        ))}
        {phases.transferSize ? <span className={styles.phaseLegendItem}>{Math.round(phases.transferSize / 1024)}KB transferred</span> : null}
      </div>
    </div>
  );
}

function Waterfall({ events, runStartAt }) {
  if (!runStartAt) return <div className={styles.emptyNote}>Run the lab to see a live waterfall here.</div>;
  const rows = events.filter((e) => e.type === "request-success" || e.type === "request-fail");
  if (!rows.length) return <div className={styles.emptyNote}>Waiting for the first response\u2026</div>;
  const ends = rows.map((e) => e.at - runStartAt);
  const span = Math.max(Math.max(...ends), 500);
  return (
    <div className={styles.waterfallWrap}>
      {rows.map((e, i) => {
        const end = e.at - runStartAt;
        const start = Math.max(0, end - (e.elapsedMs || 0));
        const leftPct = (start / span) * 100;
        const widthPct = Math.max(0.6, ((e.elapsedMs || 1) / span) * 100);
        return (
          <div className={styles.waterfallRow} key={i}>
            <div className={styles.waterfallLabel}>
              {e.lane} \u00b7 {PHASE_LABELS[e.phase] ? (e.phase === "concurrent" ? "C" : "I") : ""} \u00b7 {STAGE_LABELS[e.stage] || e.stage}
            </div>
            <div className={styles.waterfallTrack}>
              <div
                className={`${styles.waterfallBar} ${e.type === "request-fail" ? styles.barFail : styles.barPass}`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                title={`${e.elapsedMs}ms \u2014 status ${e.status}`}
              />
            </div>
            <div className={styles.waterfallMs}>{e.elapsedMs}ms</div>
          </div>
        );
      })}
    </div>
  );
}

function StatsCards({ stats, title }) {
  return (
    <div className={styles.statsBlock}>
      <h4>{title}</h4>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.count}</div>
          <div className={styles.statLabel}>requests</div>
        </div>
        <div className={`${styles.statCard} ${styles.statPass}`}>
          <div className={styles.statValue}>{stats.successCount}</div>
          <div className={styles.statLabel}>succeeded</div>
        </div>
        <div className={`${styles.statCard} ${styles.statFail}`}>
          <div className={styles.statValue}>{stats.failCount}</div>
          <div className={styles.statLabel}>failed</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.p50}ms</div>
          <div className={styles.statLabel}>p50 latency</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.p90}ms</div>
          <div className={styles.statLabel}>p90 latency</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.p99}ms</div>
          <div className={styles.statLabel}>p99 latency</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statValue}>{stats.rps}</div>
          <div className={styles.statLabel}>req/sec</div>
        </div>
      </div>
      {Object.keys(stats.byStage).length ? (
        <div className={styles.byStageTable}>
          {Object.entries(stats.byStage).map(([stage, s]) => (
            <div className={styles.byStageRow} key={stage}>
              <span className={styles.byStageName}>{STAGE_LABELS[stage] || stage}</span>
              <span>{s.count} reqs</span>
              <span className={styles.statPassText}>{s.successCount} ok</span>
              <span className={styles.statFailText}>{s.failCount} fail</span>
              <span>{s.avgMs}ms avg</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EventLog({ events, expanded, onToggle }) {
  return (
    <div className={styles.eventLog}>
      {events.length === 0 ? (
        <div className={styles.emptyNote}>Events will appear here as the run progresses.</div>
      ) : null}
      {events
        .map((e, i) => ({ e, i }))
        .slice()
        .reverse()
        .map(({ e, i }) => {
          const canExpand = e.type === "request-success" || e.type === "request-fail";
          const isOpen = expanded.has(i);
          return (
            <div key={i} className={styles.eventLogItem}>
              <div
                className={styles.eventLogRow}
                onClick={canExpand ? () => onToggle(i) : undefined}
                style={canExpand ? { cursor: "pointer" } : undefined}
              >
                {canExpand ? (
                  isOpen ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )
                ) : (
                  <span style={{ width: 12, display: "inline-block" }} />
                )}
                <span className={styles.eventLogTime}>{new Date(e.at).toLocaleTimeString()}</span>
                <span
                  className={`${styles.eventLogBadge} ${
                    e.type === "request-fail"
                      ? styles.badgeFail
                      : e.type === "request-success"
                      ? styles.badgePass
                      : e.type === "stage-skipped"
                      ? styles.badgeSkip
                      : styles.badgeInfo
                  }`}
                >
                  {e.type}
                </span>
                <span className={styles.eventLogLane}>{e.lane || "-"}</span>
                {e.phase ? <span className={styles.eventLogPhase}>{e.phase}</span> : null}
                <span className={styles.eventLogStage}>{STAGE_LABELS[e.stage] || e.stage || ""}</span>
                {typeof e.elapsedMs === "number" ? (
                  <span className={styles.eventLogMs}>{e.elapsedMs}ms</span>
                ) : null}
                {typeof e.status !== "undefined" ? (
                  <span className={styles.eventLogStatus}>HTTP {e.status}</span>
                ) : null}
                {e.error ? <span className={styles.eventLogError}>{e.error}</span> : null}
                {e.reason ? <span className={styles.eventLogError}>{e.reason}</span> : null}
              </div>
              {isOpen ? (
                <div className={styles.eventLogDetail}>
                  {e.phases ? <PhaseBar phases={e.phases} /> : null}
                  <div className={styles.rawBodyLabel}>Raw response body (exactly what the server sent back):</div>
                  <pre className={styles.rawBody}>{JSON.stringify(e.body ?? e.error ?? null, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}

function LaneCard({ lane, active, phaseLabel }) {
  return (
    <div className={styles.laneCard} key={lane.id}>
      <div className={styles.laneHeader}>
        <span>{lane.label}</span>
        {lane.ok ? (
          <span className={styles.laneOkBadge}>ready</span>
        ) : (
          <span className={styles.laneErrBadge}>not provisioned</span>
        )}
      </div>
      {lane.ok ? (
        <div className={styles.laneMeta}>
          <div>{lane.societyName}</div>
          {lane.adminEmail ? <div className={styles.hint}>{lane.adminEmail}</div> : null}
        </div>
      ) : lane.error ? (
        <div className={styles.laneError}>
          {lane.error}
          {lane.blockedByFlag ? (
            <div className={styles.hint}>
              Set <code>ALLOW_PUBLIC_SIGNUP=true</code> in your Vercel project&apos;s environment
              variables (Production) and redeploy, or switch this lane to &quot;paste existing
              token&quot; mode below.
            </div>
          ) : null}
        </div>
      ) : null}
      <FlowDiagram active={active} label={phaseLabel} />
    </div>
  );
}

export default function LoadTestLabPage() {
  const { year: defaultYear, month: defaultMonth } = nowMonthYear();
  const [laneCount, setLaneCount] = useState(3);
  const [mode, setMode] = useState("auto"); // "auto" | "manual"
  const [manualTokens, setManualTokens] = useState({});
  const [memberCount, setMemberCount] = useState(50);
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [paymentAmount, setPaymentAmount] = useState(500);
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);

  const [lanes, setLanes] = useState([]);
  const [provisioning, setProvisioning] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | baseline | concurrent | done
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState([]);
  const [activeStage, setActiveStage] = useState({});
  const [runStartAt, setRunStartAt] = useState(null);
  const [baselineResults, setBaselineResults] = useState({});
  const [expanded, setExpanded] = useState(() => new Set());

  const emit = useCallback((event) => {
    setEvents((prev) => [...prev, event]);
    if (event.type === "request-start") {
      setActiveStage((prev) => ({ ...prev, [event.lane]: `${event.phase || ""} \u00b7 ${STAGE_LABELS[event.stage] || event.stage}` }));
    } else if (event.type === "request-success" || event.type === "request-fail" || event.type === "stage-skipped") {
      setActiveStage((prev) => ({ ...prev, [event.lane]: null }));
    }
  }, []);

  const config = useMemo(
    () => ({
      memberCount: Number(memberCount),
      year: Number(year),
      month: Number(month),
      paymentAmount: Number(paymentAmount),
    }),
    [memberCount, year, month, paymentAmount],
  );

  const readyLanes = lanes.filter((l) => l.ok);
  const canRunBaseline = safetyConfirmed && !running && readyLanes.length > 0;
  const canRunConcurrent =
    safetyConfirmed && !running && readyLanes.some((l) => baselineResults[l.id]?.importResult?.ok);

  async function handleProvision() {
    setProvisioning(true);
    const sessionTag = makeRunTag();
    const results = await Promise.all(
      Array.from({ length: Number(laneCount) }).map(async (_, i) => {
        const id = `L${i + 1}`;
        if (mode === "manual") {
          const token = (manualTokens[id] || "").trim();
          if (!token) {
            return { id, label: `Lane ${i + 1} (manual)`, ok: false, error: "Paste a token for this lane, or switch to auto-provision." };
          }
          const l = manualLane({ token, label: `Lane ${i + 1} (manual society)` });
          return { id, label: `Lane ${i + 1} (manual)`, ...l };
        }
        const result = await provisionSociety({ runTag: sessionTag, laneIndex: i + 1 });
        return { id, label: `Lane ${i + 1} (auto-provisioned)`, ...result };
      }),
    );
    setLanes(results);
    setProvisioning(false);
  }

  async function handleRunBaseline() {
    setRunning(true);
    setPhase("baseline");
    setRunStartAt((prev) => prev || Date.now());
    try {
      const pairs = await Promise.all(
        readyLanes.map(async (lane) => [lane.id, await runIndividualPhase({ lane, config, emit })]),
      );
      setBaselineResults((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    } finally {
      setRunning(false);
    }
  }

  async function handleRunConcurrent() {
    setRunning(true);
    setPhase("concurrent");
    try {
      await Promise.all(
        readyLanes.map((lane) =>
          runConcurrentPhase({ lane, config, baseline: baselineResults[lane.id], emit }),
        ),
      );
    } finally {
      setRunning(false);
      setPhase("done");
    }
  }

  async function handleRunBoth() {
    setRunning(true);
    setPhase("baseline");
    setRunStartAt(Date.now());
    try {
      const pairs = await Promise.all(
        readyLanes.map(async (lane) => [lane.id, await runIndividualPhase({ lane, config, emit })]),
      );
      const results = Object.fromEntries(pairs);
      setBaselineResults((prev) => ({ ...prev, ...results }));
      setPhase("concurrent");
      await Promise.all(
        readyLanes.map((lane) => runConcurrentPhase({ lane, config, baseline: results[lane.id], emit })),
      );
    } finally {
      setRunning(false);
      setPhase("done");
    }
  }

  function handleReset() {
    setEvents([]);
    setActiveStage({});
    setRunStartAt(null);
    setBaselineResults({});
    setPhase("idle");
    setExpanded(new Set());
  }

  function toggleExpanded(i) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  const individualStats = useMemo(
    () => computeStats(events.filter((e) => e.phase === "individual")),
    [events],
  );
  const concurrentStats = useMemo(
    () => computeStats(events.filter((e) => e.phase === "concurrent")),
    [events],
  );
  const overallStats = useMemo(() => computeStats(events), [events]);

  function handleExportReport() {
    const lines = [];
    lines.push("# Load Test Lab report (v2)");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("## Config");
    lines.push(`- Lanes: ${lanes.map((l) => `${l.label} (${l.societyName || l.error || "n/a"})`).join("; ")}`);
    lines.push(`- Members per batch: ${config.memberCount}`);
    lines.push(`- Baseline bill period: ${config.month}/${config.year}`);
    lines.push(`- Payment amount per row: \u20b9${config.paymentAmount}`);
    lines.push("");
    lines.push("## Overall stats");
    lines.push(`- Requests: ${overallStats.count}, success: ${overallStats.successCount}, fail: ${overallStats.failCount}`);
    lines.push(`- Latency p50/p90/p99: ${overallStats.p50}ms / ${overallStats.p90}ms / ${overallStats.p99}ms`);
    lines.push(`- Throughput: ${overallStats.rps} req/sec`);
    lines.push("");
    lines.push("## Individual (baseline) phase stats");
    lines.push(`- Requests: ${individualStats.count}, success: ${individualStats.successCount}, fail: ${individualStats.failCount}, p50 ${individualStats.p50}ms, p90 ${individualStats.p90}ms, p99 ${individualStats.p99}ms, ${individualStats.rps} req/sec`);
    lines.push("");
    lines.push("## Concurrent phase stats");
    lines.push(`- Requests: ${concurrentStats.count}, success: ${concurrentStats.successCount}, fail: ${concurrentStats.failCount}, p50 ${concurrentStats.p50}ms, p90 ${concurrentStats.p90}ms, p99 ${concurrentStats.p99}ms, ${concurrentStats.rps} req/sec`);
    lines.push("");
    readyLanes.forEach((lane) => {
      lines.push(`## ${lane.label} \u2014 ${lane.societyName}`);
      ["individual", "concurrent"].forEach((ph) => {
        lines.push(`### ${PHASE_LABELS[ph]}`);
        STAGE_ORDER.forEach((stage) => {
          const m = summarize(events, lane.id, stage, ph);
          lines.push(
            `- **${STAGE_LABELS[stage]}**: ${m.success} success / ${m.fail} fail${m.skipped ? " (skipped)" : ""} \u2014 avg ${m.avg ?? "\u2014"}ms, max ${m.max ?? "\u2014"}ms`,
          );
        });
      });
      lines.push("");
    });
    lines.push("## Full event log (raw request/response bodies included)");
    events.forEach((e) => {
      lines.push(
        `- \`${new Date(e.at).toISOString()}\` [${e.lane || "-"}] ${e.phase || ""} ${e.type} ${e.stage || ""} ${
          typeof e.status !== "undefined" ? `HTTP ${e.status}` : ""
        } ${typeof e.elapsedMs === "number" ? `${e.elapsedMs}ms` : ""} ${e.error || e.reason || ""}`,
      );
      if (e.type === "request-success" || e.type === "request-fail") {
        lines.push("  ```json");
        lines.push("  " + JSON.stringify(e.body ?? null).slice(0, 4000));
        lines.push("  ```");
      }
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `loadtest-lab-report-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <FlaskConical size={22} />
          <h1>Load Test Lab</h1>
        </div>
        <p className={styles.subtitle}>
          Drives your REAL bulk member import, bulk bill generation, and bulk payment processing
          routes directly from this page \u2014 no new backend process. Every lane below is its own
          freshly auto-provisioned, empty test society (via the real signup route), so there is
          nowhere else you need to go add members \u2014 the lab creates its own place to write to.
        </p>
      </div>

      <div className={styles.safetyBanner}>
        <ShieldAlert size={18} />
        <div>
          <strong>What changed from the last version, based on your two failed runs:</strong> every
          lane now gets its own brand-new, empty society (bulk-generate targeting \u201cevery
          member in the society\u201d is now safe by construction, not by a checkbox); every
          request&apos;s full raw response body is captured and shown (the hidden HTTP 500 on
          import and the cascading 400 on payments-confirm are now fully visible below instead of
          swallowed); a failed stage now skips only the stages that depend on it instead of
          continuing to bill against unrelated data; network timing bars below are real
          browser-measured DNS/TCP/TLS/wait/download phases, not a decorative animation.
        </div>
      </div>

      <div className={styles.configGrid}>
        <div className={styles.configField}>
          <label>Number of lanes (societies) running at once</label>
          <input
            type="number"
            min={1}
            max={8}
            value={laneCount}
            onChange={(e) => setLaneCount(e.target.value)}
          />
          <span className={styles.hint}>Each lane is a separate, isolated society \u2014 kept small on purpose; raise it once the first round looks right.</span>
        </div>
        <div className={styles.configField}>
          <label>Lane society source</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="auto">Auto-provision a fresh society per lane (recommended)</option>
            <option value="manual">Paste an existing admin token per lane</option>
          </select>
        </div>
        <div className={styles.configField}>
          <label>Members per batch, per lane</label>
          <input
            type="number"
            min={1}
            max={2000}
            value={memberCount}
            onChange={(e) => setMemberCount(e.target.value)}
          />
        </div>
        <div className={styles.configField}>
          <label>Baseline bill month</label>
          <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div className={styles.configField}>
          <label>Baseline bill year</label>
          <input type="number" min={2020} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className={styles.configField}>
          <label>Payment amount / row (\u20b9)</label>
          <input
            type="number"
            min={1}
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
          />
        </div>
      </div>

      {mode === "manual" ? (
        <div className={styles.configGrid}>
          {Array.from({ length: Number(laneCount) }).map((_, i) => {
            const id = `L${i + 1}`;
            return (
              <div className={styles.configField} key={id}>
                <label>Lane {i + 1} token</label>
                <input
                  type="password"
                  placeholder="Paste an Admin/Secretary bearer token for a DISPOSABLE test society"
                  value={manualTokens[id] || ""}
                  onChange={(e) => setManualTokens((prev) => ({ ...prev, [id]: e.target.value }))}
                />
              </div>
            );
          })}
          <span className={styles.hint}>
            Login does not return a usable token in this app (it only sets an httpOnly cookie), so
            paste a token you already have some other way, or use auto-provisioning instead.
          </span>
        </div>
      ) : null}

      <label className={styles.safetyCheckbox}>
        <input
          type="checkbox"
          checked={safetyConfirmed}
          onChange={(e) => setSafetyConfirmed(e.target.checked)}
        />
        I understand every lane below writes real database records (in its own fresh test
        society when auto-provisioned, or in whatever society a pasted manual token belongs to).
      </label>

      <div className={styles.runControls}>
        <button className={styles.btnSecondary} disabled={provisioning || running} onClick={handleProvision}>
          {provisioning ? <PulseLoader size={24} /> : <Zap size={14} />}
          Provision {laneCount} lane{Number(laneCount) === 1 ? "" : "s"}
        </button>
        <button className={styles.btnSecondary} disabled={!canRunBaseline} onClick={handleRunBaseline}>
          <Play size={14} /> Run individually (baseline)
        </button>
        <button className={styles.btnSecondary} disabled={!canRunConcurrent} onClick={handleRunConcurrent}>
          <Play size={14} /> Then run all 3 concurrently
        </button>
        <button className={styles.btnPrimary} disabled={!canRunBaseline} onClick={handleRunBoth}>
          {running ? <PulseLoader size={24} /> : <Play size={14} />}
          Run full round (individual \u2192 concurrent)
        </button>
        <button className={styles.btnSecondary} disabled={running} onClick={handleReset}>
          <RotateCcw size={14} /> Reset run data
        </button>
        <button className={styles.btnSecondary} disabled={events.length === 0} onClick={handleExportReport}>
          <Download size={14} /> Export report (.md)
        </button>
      </div>

      <div className={styles.laneGrid}>
        {lanes.length === 0 ? (
          <div className={styles.emptyNote}>Click &quot;Provision lanes&quot; to create test societies first.</div>
        ) : null}
        {lanes.map((lane) => (
          <LaneCard key={lane.id} lane={lane} active={!!activeStage[lane.id]} phaseLabel={activeStage[lane.id]} />
        ))}
      </div>

      {lanes.some((l) => l.ok) ? (
        <div className={styles.laneGrid}>
          {readyLanes.map((lane) => (
            <div className={styles.panel} key={lane.id}>
              <h3>{lane.label} stage detail</h3>
              {["individual", "concurrent"].map((ph) => (
                <div key={ph} className={styles.phaseSection}>
                  <div className={styles.phaseSectionTitle}>{PHASE_LABELS[ph]}</div>
                  <div className={styles.metricsGrid}>
                    {STAGE_ORDER.map((stage) => (
                      <MetricCard key={stage} stage={stage} m={summarize(events, lane.id, stage, ph)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.panelsGrid}>
        <StatsCards stats={individualStats} title="Individual (baseline) phase \u2014 real percentiles" />
        <StatsCards stats={concurrentStats} title="Concurrent phase \u2014 real percentiles" />
      </div>

      <div className={styles.panel}>
        <h3>Request waterfall</h3>
        <Waterfall events={events} runStartAt={runStartAt} />
      </div>

      <div className={styles.panel}>
        <h3>Live event log \u2014 click a row for the full raw request/response body and real network phase timing</h3>
        <EventLog events={events} expanded={expanded} onToggle={toggleExpanded} />
      </div>
    </div>
  );
}
