// Single source of truth for "what does a Society Admin have to accept, and
// which version are we on". Bump BUNDLE_VERSION any time any file listed
// here changes in a way that needs a fresh acceptance — every society's
// existing TermsAcceptance stops satisfying the new version automatically,
// and app/legal/accept re-prompts on next dashboard load.
//
// The three documents are accepted as ONE bundle, not three separate
// checkboxes — a Society either agrees to how the platform works or it
// doesn't; splitting it into three acceptances would just be three clicks
// nobody reads differently.
export const BUNDLE_VERSION = "2026-09-11";

export const LEGAL_DOCUMENTS = [
  { id: "tos", title: "Terms of Service" },
  { id: "privacy", title: "Privacy Policy" },
  { id: "refund", title: "Refund & Cancellation Policy" },
];

export function findDocument(id) {
  return LEGAL_DOCUMENTS.find((d) => d.id === id) || null;
}
