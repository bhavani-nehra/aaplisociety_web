"use client";
import { useEffect } from "react";
import { Icon } from "@/components/revamp";
import styles from "@/styles/NotificationToast.module.css";
const TYPE_ICONS = {
  BILL_GENERATED: "file-text",
  PAYMENT_RECEIVED: "indian-rupee",
  PAYMENT_FAILED: "circle-alert",
  DUE_REMINDER: "bell",
  NOTICE_POSTED: "megaphone",
  COMPLAINT_APPROVED: "circle-check",
  COMPLAINT_REJECTED: "circle-x",
  MAINTENANCE_ALERT: "wrench",
  ADMIN_MESSAGE: "message-square",
  CUSTOM: "bell",
};
export default function NotificationToast({ notification, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  return (
    <div className={styles.toast}>
      <div className={styles.icon}><Icon name={TYPE_ICONS[notification.type] || "bell"} size={18} /></div>
      <div className={styles.body}>
        <div className={styles.title}>{notification.title}</div>
        <div className={styles.message}>{notification.message}</div>
      </div>
      <button className={styles.close} onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
