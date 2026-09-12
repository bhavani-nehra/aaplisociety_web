"use client";
/**
 * TourRunner — thin wrapper around driver.js. Given a tour object and an
 * `active` flag, drives the spotlight sequence; marks the tour "seen" in
 * localStorage when it's dismissed or finished (Esc, backdrop click, Skip,
 * and reaching the last step's Done button all funnel through driver.js's
 * own onDestroyed callback, so all four are covered by this one hook).
 *
 * See docs/ux-overhaul/2026-09-01-guided-tours-design.md ("Architecture",
 * "Structure & flow") and docs/superpowers/plans/
 * 2026-09-12-guided-tours-phase1.md Task 3.
 */
import { useEffect } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./tour-theme.css";
import { getTourSeenKey } from "@/lib/tours/tourSeenState";

export default function TourRunner({ tour, active, onDone }) {
  useEffect(() => {
    if (!active || !tour) return undefined;

    const steps = tour.steps.map((step) => {
      const popover = { title: step.title, description: step.body };
      if (step.advanceAction === "click") {
        // Generic engine behavior, not specific to this tour: click the
        // step's own target element (e.g. a button that opens a modal)
        // before moving on, instead of just advancing past it. Combined
        // with the `waitForElement` config below, this gives the next
        // step's element time to actually mount (e.g. after a React state
        // update opens a modal) before driver.js tries to highlight it.
        popover.onNextClick = (element, _step, opts) => {
          if (element) element.click();
          opts.driver.moveNext();
        };
      }
      return { element: step.selector, popover };
    });

    const driverObj = driver({
      showProgress: true,
      allowClose: true, // Esc/backdrop-click must always be able to dismiss — never set false.
      waitForElement: 500, // ms to retry finding a step's element — covers the modal-open case above.
      steps,
      onDestroyed: () => {
        try {
          window.localStorage.setItem(getTourSeenKey(tour.area, tour.id), "1");
        } catch (_) {
          // localStorage unavailable (private-mode Safari, disabled storage,
          // etc.) — non-fatal, the tour itself still ran to completion.
        }
        if (onDone) onDone();
      },
    });

    driverObj.drive();

    return () => driverObj.destroy();
  }, [active, tour, onDone]);

  return null;
}
