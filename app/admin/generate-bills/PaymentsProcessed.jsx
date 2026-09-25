"use client";
// app/admin/generate-bills/PaymentsProcessed.jsx
//
// The step after every row passes verification.
//
// Two choices, and they are genuinely different actions:
//
//   PUSH NOW   commit the verified collections to the ledger immediately.
//   SCHEDULE   commit them, and also queue next month's bill generation for a
//              date the admin picks.
//
// The commit itself is idempotent on the server (see commit/route.js). This
// screen can be double-clicked without double-posting.

import PulseLoader from "@/components/brand/PulseLoader";
import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import {
  CheckCircle2,
  Send,
  CalendarClock,
  ArrowLeft,
} from "lucide-react";
import s from "@/styles/CollectionsGrid.module.css";

function nextPeriodOf(periodId) {
  const [y, m] = periodId.split("-").map(Number);
  const d = new Date(y, m, 1); // m is 1-based, so this is already next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function labelOf(periodId) {
  const [y, m] = periodId.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export default function PaymentsProcessed({
  periodId,
  results,
  fingerprint,
  onCommit,
  onBack,
  committing,
  committed,
}) {
  const wrapRef = useRef(null);
  const checkRef = useRef(null);

  const nextPeriod = nextPeriodOf(periodId);
  const [choice, setChoice] = useState(null); // "push" | "schedule"
  const [scheduleDate, setScheduleDate] = useState(() => {
    const [y, m] = nextPeriod.split("-").map(Number);
    // Default to the 1st of the next period.
    return `${y}-${String(m).padStart(2, "0")}-01`;
  });

  const passed = Object.values(results || {}).filter((r) => r.ok);
  const toRecord = passed.filter((r) => r.willRecord);
  const markedUnpaid = passed.filter((r) => !r.willRecord);
  const total = toRecord.reduce((sum, r) => sum + (r.willRecord?.amount || 0), 0);

  // Entrance. transform + opacity only, same rule as everywhere else.
  useEffect(() => {
    if (!wrapRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const tl = gsap.timeline({ defaults: { force3D: true } });

    if (checkRef.current) {
      tl.fromTo(
        checkRef.current,
        { scale: 0.4, opacity: 0, rotate: -12 },
        { scale: 1, opacity: 1, rotate: 0, duration: 0.5, ease: "back.out(2)" },
        0,
      );
    }
    tl.fromTo(
      wrapRef.current.querySelectorAll("[data-pp-stagger]"),
      { opacity: 0, y: 14 },
      {
        opacity: 1,
        y: 0,
        duration: 0.36,
        ease: "power2.out",
        stagger: 0.06,
        clearProps: "transform",
      },
      0.18,
    );
    return () => tl.kill();
  }, []);

  if (committed) {
    return (
      <div className={s.doneWrap} ref={wrapRef}>
        <div className={s.doneBadge} ref={checkRef}>
          <CheckCircle2 size={34} />
        </div>
        <h2 className={s.doneTitle} data-pp-stagger>
          Collections recorded
        </h2>
        <p className={s.doneSub} data-pp-stagger>
          {toRecord.length} payment{toRecord.length === 1 ? "" : "s"} totalling
          {" "}₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2 })} posted to
          the {labelOf(periodId)} ledger.
          {committed.scheduled &&
            ` Next month's bills are scheduled for ${new Date(committed.scheduled).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.`}
        </p>
        {committed.warning && (
          <p className={s.doneWarning} data-pp-stagger>
            {committed.warning}{" "}
            <a href="/admin/receipts">Open receipts</a>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={s.ppWrap} ref={wrapRef}>
      <div className={s.ppHead}>
        <div className={s.doneBadge} ref={checkRef}>
          <CheckCircle2 size={30} />
        </div>
        <h2 className={s.ppTitle}>All rows verified</h2>
        <p className={s.ppSub}>
          Nothing has been written yet. Review the summary, then choose how to
          proceed.
        </p>
      </div>

      {/* ---- Summary ------------------------------------------------- */}
      <div className={s.ppSummary} data-pp-stagger>
        <div className={s.ppStat}>
          <span className={s.ppStatNum}>{toRecord.length}</span>
          <span className={s.ppStatLabel}>payments to record</span>
        </div>
        <div className={s.ppStat}>
          <span className={`${s.ppStatNum} ${s.ppStatAccent}`}>
            ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
          <span className={s.ppStatLabel}>total collected</span>
        </div>
        <div className={s.ppStat}>
          <span className={s.ppStatNum}>{markedUnpaid.length}</span>
          <span className={s.ppStatLabel}>carried forward unpaid</span>
        </div>
      </div>

      {/* ---- Choice cards -------------------------------------------- */}
      <div className={s.ppChoices}>
        <button
          type="button"
          data-pp-stagger
          className={`${s.ppCard} ${choice === "push" ? s.ppCardActive : ""}`}
          onClick={() => setChoice("push")}
        >
          <Send size={20} className={s.ppCardIcon} />
          <span className={s.ppCardTitle}>Push now</span>
          <span className={s.ppCardBody}>
            Post these collections to the ledger straight away. Receipts go out
            to the {toRecord.length} paying flats. Next month&apos;s bills stay
            manual.
          </span>
        </button>

        <button
          type="button"
          data-pp-stagger
          className={`${s.ppCard} ${choice === "schedule" ? s.ppCardActive : ""}`}
          onClick={() => setChoice("schedule")}
        >
          <CalendarClock size={20} className={s.ppCardIcon} />
          <span className={s.ppCardTitle}>
            Push &amp; schedule {labelOf(nextPeriod)}
          </span>
          <span className={s.ppCardBody}>
            Same as above, and queue next month&apos;s generation so it runs on
            its own. You can still cancel it before the run date.
          </span>
        </button>
      </div>

      {choice === "schedule" && (
        <div className={s.ppScheduleRow} data-pp-stagger>
          <label htmlFor="pp-date">Generate {labelOf(nextPeriod)} bills on</label>
          <input
            id="pp-date"
            type="date"
            className={s.ppDate}
            value={scheduleDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setScheduleDate(e.target.value)}
          />
        </div>
      )}

      <div className={s.ppActions}>
        <button className={s.btnGhost} onClick={onBack} disabled={committing}>
          <ArrowLeft size={14} /> Back to grid
        </button>
        <button
          className={s.btnPrimary}
          disabled={!choice || committing}
          onClick={() =>
            onCommit({
              periodId,
              fingerprint,
              mode: choice,
              scheduleFor: choice === "schedule" ? scheduleDate : null,
              nextPeriodId: nextPeriod,
            })
          }
        >
          {committing ? (
            <>
              <PulseLoader size={24} /> Posting…
            </>
          ) : choice === "schedule" ? (
            <>
              <CalendarClock size={15} /> Post &amp; schedule
            </>
          ) : (
            <>
              <Send size={15} /> Post collections
            </>
          )}
        </button>
      </div>
    </div>
  );
}
