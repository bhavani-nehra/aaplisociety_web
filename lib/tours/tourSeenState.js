// Pure helpers for the guided-tour "seen" flag (docs/ux-overhaul/
// 2026-09-01-guided-tours-design.md: `localStorage["tour.<area>.<id>.seen"]
// = "1"`). Deliberately free of any `localStorage` access — that keeps the
// actual decision logic unit-testable under this repo's Jest config
// (testEnvironment: "node", no jsdom/localStorage available). Callers
// (TourRunner.jsx, HelpPanel.jsx) do the actual `localStorage.getItem`/
// `setItem` and pass the raw value through `isTourSeenValue`.

export function getTourSeenKey(area, tourId) {
  if (!area || !tourId) {
    throw new Error("getTourSeenKey requires both a non-empty area and tourId");
  }
  return `tour.${area}.${tourId}.seen`;
}

export function isTourSeenValue(rawValue) {
  return rawValue === "1";
}
