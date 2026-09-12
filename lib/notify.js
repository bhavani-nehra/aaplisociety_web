"use client";
import { toast } from "sonner";
import { confirmDialog, promptDialog } from "@/components/ui/ConfirmDialogHost";

// Drop-in replacement for window.alert() / window.confirm() / window.prompt(),
// themed to match the app (see ToastProvider.js + ConfirmDialogHost.js).
//   alert("x")            -> notify.info("x")            (or .success/.error/.warning)
//   confirm("x")           -> await notify.confirm("x")   (same true/false return)
//   prompt("x", "default") -> await notify.prompt("x", "default") (same string/null return)
//
// notify.undo("x", { onUndo, onCommit }) -> optimistic-delete pattern: the
// caller has already applied the change to local state before calling this;
// the toast gives the user a window to reverse it (onUndo) before the real
// mutation commits (onCommit). See
// docs/superpowers/plans/2026-09-12-feedback-state-patterns-phase1-undo-toasts.md.

/**
 * Settle-once controller behind notify.undo(). Exactly one of onUndo /
 * onCommit ever runs, no matter which of sonner's events (the action
 * button's onClick, onAutoClose, onDismiss) fires first, or fires more than
 * once for the same toast. Exported as a named export (separate from the
 * default `notify` object) so it is unit-testable with no sonner/DOM
 * dependency — see tests/unit/notify-undo.unit.test.js.
 */
export function createUndoSettler({ onUndo, onCommit }) {
  let settled = false;
  return {
    undo() {
      if (settled) return false;
      settled = true;
      onUndo();
      return true;
    },
    commit() {
      if (settled) return false;
      settled = true;
      onCommit();
      return true;
    },
    get isSettled() {
      return settled;
    },
  };
}

const notify = {
  success: (message, opts) => toast.success(message, opts),
  error: (message, opts) => toast.error(message, opts),
  warning: (message, opts) => toast.warning(message, opts),
  info: (message, opts) => toast.message(message, opts),

  confirm: (message, opts = {}) =>
    confirmDialog({
      title: opts.title ?? "Are you sure?",
      message: typeof message === "string" ? message : "",
      tone: opts.tone ?? "danger",
      confirmLabel: opts.confirmLabel ?? "Confirm",
      cancelLabel: opts.cancelLabel ?? "Cancel",
    }),

  prompt: (message, defaultValue = "", opts = {}) =>
    promptDialog({
      title: opts.title ?? (typeof message === "string" ? message : "Enter a value"),
      message: opts.message ?? "",
      defaultValue,
      tone: opts.tone ?? "info",
      confirmLabel: opts.confirmLabel ?? "OK",
      cancelLabel: opts.cancelLabel ?? "Cancel",
      inputType: opts.inputType ?? "text",
    }),

  // Optimistic-delete / reversible-action toast. Caller must already have
  // applied the change to local state (e.g. removed the row from an array)
  // before calling this — onUndo puts it back, onCommit fires the real API
  // call. Rendered via toast.warning() so it picks up the app's existing
  // amber warning tone (components/ui/ToastProvider.js's --warning-bg /
  // --warning-border / --warning-text) instead of inventing a new color for
  // "pending, reversible action".
  undo: (message, { onUndo, onCommit, windowMs = 5000, actionLabel = "Undo" } = {}) => {
    const settler = createUndoSettler({ onUndo, onCommit });
    return toast.warning(message, {
      duration: windowMs,
      action: {
        label: actionLabel,
        onClick: () => settler.undo(),
      },
      // Timer elapsed naturally -> commit. onDismiss covers the close
      // button / a swipe / a manual toast.dismiss(id) elsewhere — a
      // separate real path from onAutoClose. The settler guarantees only
      // one of onUndo/onCommit ever actually runs regardless of which of
      // these fires, or whether more than one does.
      onAutoClose: () => settler.commit(),
      onDismiss: () => settler.commit(),
    });
  },
};

export default notify;
