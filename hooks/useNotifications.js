"use client";
import { useState, useEffect, useCallback } from "react";
import { installIdleTracking, isPageIdleForPolling } from "@/lib/idle-tracker";

// Poll cadence (ms) while the tab is visible.
const DEFAULT_POLL_INTERVAL = 20000;

/**
 * Notification polling hook.
 *
 * @param {Object}  [options]
 * @param {boolean} [options.enabled=true]  When false the hook does NO fetching
 *   and holds NO interval at all. Callers gate this to "needful" pages so
 *   unrelated screens (superadmin console, gate terminal, etc.) never poll.
 * @param {number}  [options.pollInterval]  Poll cadence in ms while visible.
 */
export function useNotifications({
  enabled = true,
  pollInterval = DEFAULT_POLL_INTERVAL,
} = {}) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [toasts, setToasts] = useState([]);

  // Fetch from DB (persistent)
  const fetchNotifications = useCallback(async () => {
    // Never hit the network on a page that doesn't need notifications.
    if (!enabled) return;
    // Plan 05 §A3: a VISIBLE-but-abandoned tab (document.hidden stays false —
    // the user just walked away with the tab still focused) must not keep
    // polling forever; that would silently renew the refresh token and
    // requirement 2 ("logged out if not opened for a while") would never
    // fire. The interval keeps ticking (cheap); this just skips the request.
    if (isPageIdleForPolling()) return;
    try {
      const res = await fetch("/api/notifications?limit=20", {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok) {
        setNotifications((prev) => {
          // Toast any notification that's new since the last poll.
          const prevIds = new Set(prev.map((n) => n._id));
          const fresh = data.notifications.filter((n) => !prevIds.has(n._id));
          if (fresh.length && prev.length) {
            setToasts((t) => [
              ...t,
              ...fresh.map((n) => ({ ...n, id: Date.now() + Math.random() })),
            ]);
          }
          return data.notifications;
        });
        setUnreadCount(data.unreadCount);
      }
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  // No realtime push server (socket.io needs a persistent Node server, which
  // Vercel's serverless deployment doesn't run) — poll instead. But poll ONLY
  // when (a) this page needs notifications AND (b) the tab is actually
  // visible. A hidden/background tab holds no interval; polling resumes with
  // an immediate catch-up fetch when the tab is foregrounded again. This kills
  // the old "every open page polls forever in the background" waste.
  useEffect(() => {
    // Idempotent — safe even though components/session/SessionGuard.js also
    // calls this from the root layout; a page rendered before that effect
    // fires must not be left with no interaction listeners at all.
    installIdleTracking();
    if (!enabled) {
      // Disabled page: make sure nothing lingers from a previous enabled state.
      setNotifications([]);
      setUnreadCount(0);
      setToasts([]);
      setLoading(false);
      return;
    }

    let intervalId = null;

    const startPolling = () => {
      if (intervalId != null) return; // already running
      fetchNotifications(); // immediate catch-up
      intervalId = setInterval(fetchNotifications, pollInterval);
    };

    const stopPolling = () => {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) stopPolling();
      else startPolling();
    };

    // Start immediately unless the tab was opened in the background.
    if (typeof document === "undefined" || !document.hidden) {
      startPolling();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stopPolling();
    };
  }, [enabled, pollInterval, fetchNotifications]);

  const markRead = useCallback(async (notificationId) => {
    setNotifications((prev) =>
      prev.map((n) => (n._id === notificationId ? { ...n, isRead: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId }),
    });
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await fetch("/api/notifications/mark-all-read", {
      method: "POST",
      credentials: "include",
    });
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    notifications,
    unreadCount,
    loading,
    toasts,
    markRead,
    markAllRead,
    dismissToast,
    refetch: fetchNotifications,
  };
}
