"use client";
// Plan 06 §4.2/§4.4, §12 — docs/motion-system.md is the spec this file
// implements. Two of the eight named transitions, the two the pilot
// surfaces actually use; the rest stay named-not-built until a real screen
// needs them (see the doc for why that's deliberate, not a gap).
//
// Both respect prefers-reduced-motion at the component level, on top of
// (not instead of) the CSS kill-switch in styles/globals.css — a
// framer-motion `transition` prop isn't touched by a CSS animation-duration
// override, so this is the belt to that braces.
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

/**
 * `apertureIris` — modal/sheet open. Focus narrowing: scale + fade in from
 * center, never a slide (a slide implies "from somewhere", a modal isn't
 * from anywhere). Reduced motion: instant show/hide, no scale or fade.
 */
export function ModalIris({ open, children, className, style }) {
  const reduce = useReducedMotion();
  const transition = reduce
    ? { duration: 0 }
    : { duration: 0.18, ease: [0.16, 1, 0.3, 1] };
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={className}
          style={style}
          initial={reduce ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
          transition={transition}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * `cardExpandPortal` (+ its reverse) — drill-in to a record. Originally
 * written as a `layoutId` shared-element transition; rewritten after
 * finding `docs/ANIMATION_GUIDE.md` (adopted 2026-08-17, already governs
 * every other animated surface in this app) — its Pitfall #3 documents
 * `layoutId` breaking hit-testing across a `position` boundary (a static
 * grid card animating into a `position: fixed` detail view/dialog), from a
 * real bug caught in the Shops & Offices dialog rebuild. That guide's own
 * fix, reused here rather than re-deriving it: an independent fade+scale on
 * the destination, plus a static outline ring on the originating card so
 * which record is open stays visible WITHOUT relying on animation
 * continuity (screen readers / a missed frame / a fast double-click never
 * saw the layoutId morph either). `CardExpand` is the destination half;
 * `cardOutlineRingStyle` is a plain style object for the origin card.
 */
export function CardExpand({ children, className, style }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, scale: 0.97, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 8 }}
      transition={{ type: "spring", stiffness: 320, damping: 30 }}
    >
      {children}
    </motion.div>
  );
}

/** Spread onto the originating card while its detail view is open. */
export const cardOutlineRingStyle = { outline: "2px solid var(--r-brand)", outlineOffset: 2 };
