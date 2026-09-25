"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LostDoor from "@/components/brand/LostDoor";
import styles from "@/styles/NotFound.module.css";
import { Btn } from "@/components/revamp";

// The page a rewrite lands on when a route does not exist — including when it
// exists but the society has not bought the module it belongs to.
//
// Deliberately says nothing about entitlements. A page reading "upgrade to
// unlock Amenities" would be the 403 problem all over again: it confirms the
// feature exists, tells anyone mapping the platform what to look for, and
// turns a plain miss into a locked door somebody now wants to open. To the
// visitor this is, and must look like, a URL that was never a route.
//
// The society still finds out what it could buy — from a sales conversation
// prompted by the Phase 3 alert, which is a person talking to a person rather
// than a wall with a price on it.
//
// Auto-redirect: pings /api/auth/me (cookie-based, no token read client-side)
// to find the right home — a logged-in visitor goes to their own dashboard,
// not a generic one, since /admin/dashboard 404s for a Member and vice versa.
// No session at all falls back to /auth/login. Kept as a short delay with a
// visible button so it reads as a redirect, not a silent bounce.
const ROLE_HOME = {
  SuperAdmin: "/superadmin/dashboard",
  Admin: "/admin/dashboard",
  Secretary: "/admin/dashboard",
  Accountant: "/admin/dashboard",
  SOCIETY_ADMIN: "/admin/dashboard",
  Security: "/security/dashboard",
  Member: "/member/dashboard",
};

function destinationFor(user) {
  if (!user) return "/auth/login";
  if (user.role && ROLE_HOME[user.role]) return ROLE_HOME[user.role];
  if (user.activeProfile || user.memberId || user.flatNo) return "/member/dashboard";
  if (user.activeContext?.hat === "staff") return "/my-access";
  return "/auth/login";
}

export default function NotFound() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(4);
  const [destination, setDestination] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setDestination(destinationFor(data?.user));
      })
      .catch(() => {
        if (!cancelled) setDestination("/auth/login");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!destination) return;
    if (seconds <= 0) {
      router.replace(destination);
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [destination, seconds, router]);

  const home = destination || "/auth/login";
  const homeLabel = home === "/auth/login" ? "Sign in" : "Take me home";

  return (
    <div className={styles.wrap}>
      <span className={`${styles.blob} ${styles.blobA}`} aria-hidden="true" />
      <span className={`${styles.blob} ${styles.blobB}`} aria-hidden="true" />
      <div className={styles.card}>
        <div className={styles.art}>
          <LostDoor />
        </div>
        <div className={styles.copy}>
          <h1 className={styles.title}>Oops — you came in the wrong house.</h1>
          <p className={styles.line}>
            This door opens to nothing. No sofa, no chai, not even a watchman. Let&apos;s get you back to your own place.
          </p>
          <div className={styles.actions}>
            <Btn variant="ghost" size="lg" icon="arrow-left" onClick={() => router.back()}>
              Retrace steps
            </Btn>
            <Btn variant="primary" size="lg" iconR="arrow-right" onClick={() => router.replace(home)}>
              {homeLabel}
            </Btn>
          </div>
          <div className={styles.timer}>
            {destination ? `Escorting you out in ${seconds}s…` : "Checking where you live…"}
          </div>
        </div>
      </div>
    </div>
  );
}
