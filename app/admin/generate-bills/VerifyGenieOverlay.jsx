"use client";
// app/admin/generate-bills/VerifyGenieOverlay.jsx
//
// The dock-style overlay that grows out of the "Verify & Submit" button.
//
// Behaviour that matters more than the animation:
//
//  - Rows are verified in batches, and results stream in so the admin watches
//    green and red land one after another instead of staring at a spinner.
//  - Rows that already passed are NOT re-sent on a retry. The pass cache is
//    keyed on (billId + the exact values that were verified), so editing a row
//    invalidates only that row.
//  - Passing rows are removed from the queue as they land, so a second run
//    only ever carries the failures.

import PulseLoader from "@/components/brand/PulseLoader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { gsap } from "gsap";
import {
  CheckCircle2,
  XCircle,
  ShieldCheck,
  X,
  RotateCcw,
} from "lucide-react";
import { useGenieMorph } from "./useGenieMorph";
import s from "@/styles/CollectionsGrid.module.css";

const BATCH_SIZE = 12;

/** Identity of a row's *content*, so we know when a cached pass is invalid. */
export function rowSignatureOf(billId, st) {
  return [
    billId,
    String(st?.amountPaid ?? ""),
    String(st?.mode ?? ""),
    String(st?.remarks ?? ""),
    String(st?.overpayAsAdvance ?? ""),
    String(st?.confirmedBlank ?? ""),
  ].join("|");
}

export default function VerifyGenieOverlay({
  open,
  originRef,
  periodId,
  billSeries = "RESIDENTIAL",
  fingerprint,
  rows,
  rowState,
  passCache,
  setPassCache,
  onResults,
  onAllPassed,
  onClose,
  onStaleFingerprint,
}) {
  const panelRef = useRef(null);
  const listRef = useRef(null);
  const { openFrom, closeTo, flashRow } = useGenieMorph();

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]); // [{ billId, flat, ok, message, note }]
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const abortRef = useRef(false);

  // ---- The queue: everything not already cached as passing ---------------
  const queue = useMemo(() => {
    return rows.filter((r) => {
      if (r.systemStatus === "PAID") return false; // nothing collectible
      const sig = rowSignatureOf(r.billId, rowState[r.billId]);
      return passCache[r.billId] !== sig;
    });
  }, [rows, rowState, passCache]);

  const skipped = rows.length - queue.length;

  // ---- Genie in ----------------------------------------------------------
  useEffect(() => {
    if (!open || !panelRef.current || !originRef?.current) return;
    openFrom(originRef.current, panelRef.current, {
      contentSelector: "[data-genie-content]",
      staggerSelector: "[data-genie-stagger]",
    });
  }, [open, openFrom, originRef]);

  const handleClose = useCallback(async () => {
    abortRef.current = true;
    if (panelRef.current && originRef?.current) {
      await closeTo(originRef.current, panelRef.current);
    }
    onClose?.();
  }, [closeTo, onClose, originRef]);

  // ---- Verification run --------------------------------------------------
  const run = useCallback(async () => {
    if (running || queue.length === 0) return;
    abortRef.current = false;
    setRunning(true);
    setLog([]);
    setProgress({ done: 0, total: queue.length });

    const collected = {};
    const nextCache = { ...passCache };

    for (let i = 0; i < queue.length; i += BATCH_SIZE) {
      if (abortRef.current) break;
      const slice = queue.slice(i, i + BATCH_SIZE);

      // Only the three editable fields plus the signature leave the browser.
      // No ledger numbers are sent, so there is nothing to tamper with.
      const payload = slice.map((r) => ({
        billId: r.billId,
        flat: r.flat,
        sig: r.sig,
        amountPaid: rowState[r.billId]?.amountPaid ?? null,
        mode: rowState[r.billId]?.mode ?? "",
        remarks: rowState[r.billId]?.remarks ?? "",
        overpayAsAdvance: !!rowState[r.billId]?.overpayAsAdvance,
      }));

      let res;
      try {
        res = await apiClient.post("/api/bills/collection-sheet/verify", {
          periodId,
          billSeries,
          fingerprint,
          rows: payload,
        });
      } catch (err) {
        if (err?.status === 409 || err?.data?.code === "STALE_FINGERPRINT") {
          setRunning(false);
          onStaleFingerprint?.();
          return;
        }
        setLog((l) => [
          ...l,
          {
            billId: `batch-${i}`,
            flat: "—",
            ok: false,
            message: err?.message || "Network error. Retry this batch.",
          },
        ]);
        continue;
      }

      for (const r of res.results) {
        collected[r.billId] = r;
        if (r.ok) {
          nextCache[r.billId] = rowSignatureOf(r.billId, rowState[r.billId]);
        } else {
          delete nextCache[r.billId];
        }

        setLog((l) => [...l, r]);
        setProgress((p) => ({ ...p, done: p.done + 1 }));

        // Flash the corresponding row in the grid underneath the overlay.
        const el = document.querySelector(`[data-bill-id="${r.billId}"]`);
        if (el) flashRow(el, r.ok ? "pass" : "fail");

        // A short, deliberate gap. Without it 31 results arrive in one frame
        // and the whole point of live feedback is lost.
        await new Promise((rs) => setTimeout(rs, 55));
        if (abortRef.current) break;
      }
    }

    setPassCache(nextCache);
    onResults?.(collected);
    setRunning(false);

    const allOk =
      Object.values(collected).length > 0 &&
      Object.values(collected).every((r) => r.ok);
    if (allOk) {
      // Small confirmation pulse on the panel itself. scale only.
      if (panelRef.current) {
        gsap.fromTo(
          panelRef.current,
          { scale: 1 },
          { scale: 1.012, duration: 0.16, yoyo: true, repeat: 1, ease: "power2.out" },
        );
      }
      setTimeout(() => onAllPassed?.(collected), 700);
    }
  }, [
    running,
    queue,
    rowState,
    periodId,
    fingerprint,
    passCache,
    setPassCache,
    onResults,
    onAllPassed,
    onStaleFingerprint,
    flashRow,
  ]);

  // Auto-start once the genie finishes opening.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => run(), 620);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the newest log line visible.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [log.length]);

  if (!open) return null;

  const passed = log.filter((l) => l.ok).length;
  const failed = log.filter((l) => !l.ok).length;
  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <div className={s.genieScrim} onClick={running ? undefined : handleClose}>
      <div
        ref={panelRef}
        className={s.geniePanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Verify collections"
      >
        <div data-genie-content>
          <div className={s.genieHead}>
            <div className={s.genieTitleWrap}>
              <ShieldCheck size={18} className={s.genieIcon} />
              <div>
                <h3 className={s.genieTitle}>Verifying collections</h3>
                <p className={s.genieSub}>
                  {skipped > 0 && `${skipped} already verified or settled · `}
                  {progress.total} row{progress.total === 1 ? "" : "s"} in queue
                </p>
              </div>
            </div>
            <button
              className={s.genieClose}
              onClick={handleClose}
              disabled={running}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          <div className={s.progressTrack}>
            {/* scaleX, not width. width would reflow the bar's parent. */}
            <div
              className={s.progressFill}
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>

          <div className={s.genieCounts}>
            <span className={s.countPass}>
              <CheckCircle2 size={13} /> {passed} passed
            </span>
            <span className={s.countFail}>
              <XCircle size={13} /> {failed} failed
            </span>
            {running && (
              <span className={s.countRunning}>
                <PulseLoader size={24} /> checking…
              </span>
            )}
          </div>

          <div className={s.genieList} ref={listRef}>
            {log.length === 0 && (
              <div className={s.genieEmpty}>
                {queue.length === 0
                  ? "Every row is already verified. Nothing to re-check."
                  : "Starting…"}
              </div>
            )}
            {log.map((l, i) => (
              <div
                key={`${l.billId}-${i}`}
                data-genie-stagger
                className={`${s.genieLine} ${l.ok ? s.genieLinePass : s.genieLineFail}`}
              >
                <span className={s.genieLineIcon}>
                  {l.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                </span>
                <span className={s.genieLineFlat}>{l.flat}</span>
                <span className={s.genieLineMsg}>{l.ok ? l.note : l.message}</span>
              </div>
            ))}
          </div>

          <div className={s.genieFoot}>
            {failed > 0 && !running && (
              <button className={s.btnSecondary} onClick={run}>
                <RotateCcw size={14} /> Re-check {failed} failed row
                {failed === 1 ? "" : "s"}
              </button>
            )}
            <button
              className={s.btnGhost}
              onClick={handleClose}
              disabled={running}
            >
              {failed > 0 ? "Back to grid" : "Close"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
