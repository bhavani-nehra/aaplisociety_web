"use client";
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useNotifications } from "../hooks/useNotifications";
import NotificationToast from "./NotificationToast";
import styles from "@/styles/NotificationBell.module.css";

// Only these route trees consume the billing / payment / notice / complaint
// notification stream, so the bell AND its 20s polling are limited to them.
// Everything else — the superadmin platform console (/superadmin/*), the
// security gate terminal (/security/*), auth/login screens, etc. — renders no
// bell and never hits /api/notifications.
// Need live notifications on a new area later? Add its prefix here.
const NEEDFUL_NOTIFICATION_ROUTES = ["/member", "/admin"];

const TYPE_ICONS = {
  BILL_GENERATED: "\ud83e\uddfe",
  PAYMENT_RECEIVED: "\u2705",
  PAYMENT_FAILED: "\u274c",
  DUE_REMINDER: "\u23f0",
  NOTICE_POSTED: "\ud83d\udce2",
  COMPLAINT_APPROVED: "\ud83d\udc4d",
  COMPLAINT_REJECTED: "\ud83d\udc4e",
  MAINTENANCE_ALERT: "\ud83d\udd27",
  ADMIN_MESSAGE: "\ud83d\udce3",
  CUSTOM: "\ud83d\udd14",
};
function timeAgo(date) {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const [mounted, setMounted] = useState(false);
  const ref = useRef(null);
  const bellRef = useRef(null);
  const dropdownRef = useRef(null);
  const pathname = usePathname();

  useEffect(() => setMounted(true), []);

  const updateCoords = useCallback(() => {
    if (!bellRef.current) return;
    const rect = bellRef.current.getBoundingClientRect();
    const width = 360;
    const margin = 12;
    let left = rect.left;
    if (left + width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    setCoords({ top: rect.bottom + 10, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    window.addEventListener("resize", updateCoords);
    window.addEventListener("scroll", updateCoords, true);
    return () => {
      window.removeEventListener("resize", updateCoords);
      window.removeEventListener("scroll", updateCoords, true);
    };
  }, [open, updateCoords]);

  // Is the current page one that actually needs notifications?
  const isNeedful = NEEDFUL_NOTIFICATION_ROUTES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const {
    notifications,
    unreadCount,
    loading,
    toasts,
    markRead,
    markAllRead,
    dismissToast,
  } = useNotifications({ enabled: isNeedful });
  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && ref.current.contains(e.target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Not a notification-needful page — render nothing (and, per the hook above,
  // nothing is ever polled here either).
  if (!isNeedful) return null;

  const handleOpen = () => setOpen((o) => !o);
  const handleItemClick = (n) => {
    if (!n.isRead) markRead(n._id);
    if (n.actionUrl) window.location.href = n.actionUrl;
  };
  return (
    <>
      {/* Toast container */}
      {mounted && createPortal(
        <div className={styles.toastContainer}>
          {toasts.map((t) => (
            <NotificationToast
              key={t.id}
              notification={t}
              onDismiss={() => dismissToast(t.id)}
            />
          ))}
        </div>,
        document.body,
      )}
      {/* Bell */}
      <div className={styles.wrapper} ref={ref}>
        <button
          ref={bellRef}
          className={styles.bell}
          onClick={handleOpen}
          aria-label="Notifications"
          aria-expanded={open}
        >
          <Bell size={15} />
          {unreadCount > 0 && (
            <span className={styles.badge}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </div>
      {open &&
        mounted &&
        coords &&
        createPortal(
          <div
            ref={dropdownRef}
            className={styles.dropdown}
            style={{ top: coords.top, left: coords.left, width: coords.width }}
          >
            <div className={styles.header}>
              <span>Notifications</span>
              {unreadCount > 0 && (
                <button className={styles.markAll} onClick={markAllRead}>
                  Mark all read
                </button>
              )}
            </div>
            <div className={styles.list}>
              {loading && <div className={styles.empty}>Loading...</div>}
              {!loading && notifications.length === 0 && (
                <div className={styles.empty}>
                  <span></span>
                  <p>No notifications yet</p>
                </div>
              )}
              {notifications.map((n) => (
                <div
                  key={n._id}
                  className={`${styles.item} ${!n.isRead ? styles.unread : ""}`}
                  onClick={() => handleItemClick(n)}
                >
                  <div className={styles.icon}>
                    {TYPE_ICONS[n.type] || ""}
                  </div>
                  <div className={styles.content}>
                    <div className={styles.title}>{n.title}</div>
                    <div className={styles.message}>{n.message}</div>
                    <div className={styles.time}>{timeAgo(n.createdAt)}</div>
                  </div>
                  {!n.isRead && <div className={styles.dot} />}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
