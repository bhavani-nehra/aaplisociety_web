"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import NotificationBell from "./NotificationBell";
import ProfileSwitcher from "./ProfileSwitcher";
import RouteLoadingBar from "./RouteLoadingBar";
import ThemeToggle from "./theme/ThemeToggle";
import CommandBar from "./global/CommandBar";
import HelpButton from "@/components/global/HelpButton";
import styles from "@/styles/Dashboard.module.css";
// Legacy role strings a staff-hat session can carry (see legacyRoleForKey /
// session-context.js) — flagged with a colored pill in the sidebar so a
// staff/admin session never reads visually the same as a plain member one.
const STAFF_ROLES = new Set(["Admin", "Secretary", "Accountant", "Security", "SOCIETY_ADMIN", "Staff"]);
export default function DashboardLayout({
  children,
  role,
  navigation,
  title,
  subtitle,
  withQueryClient = false,
  sidebarExtra = null,
  commandBarConfig = null,
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [navigating, setNavigating] = useState(false);
  const navTimeoutRef = useRef(null);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,
            cacheTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
            refetchOnMount: false,
            retry: 1,
          },
        },
      }),
  );
  useEffect(() => {
    if (pathname.includes("/auth/login")) return;
    const fetchUser = async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setUser(data.user);
        if (data.user?.wing) localStorage.setItem("userWing", data.user.wing);
      } catch {
        if (!pathname.includes("/auth/login")) {
          window.location.href = "/auth/login";
        }
      }
    };
    fetchUser();
  }, []);
  // Clear navigating state when route actually changes, and scroll back to
  // the top — the scroll container is `window` (mainWrapper/mainContent
  // carry no overflow of their own), and <main key={pathname}> remounting
  // does not reset that on its own, so a page navigated to from partway down
  // a long previous page (e.g. the accounting nav list) would otherwise open
  // already scrolled, with its own top content and header off-screen.
  useEffect(() => {
    setNavigating(false);
    clearTimeout(navTimeoutRef.current);
    window.scrollTo(0, 0);
  }, [pathname]);
  const handleNav = useCallback((path) => {
    if (pathname === path) return;
    setNavigating(true);
    // Safety fallback — clear after 3s if route never resolves
    navTimeoutRef.current = setTimeout(() => setNavigating(false), 3000);
    router.push(path);
  }, [pathname, router]);
  const handleLogout = async () => {
    localStorage.removeItem("userWing");
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/auth/login");
  };
  if (!user) {
    return (
      <div className={styles.fullPageLoader}>
        <div className={styles.fullPageLoaderDots}>
          <div className={styles.fullPageLoaderDot} />
          <div className={styles.fullPageLoaderDot} />
          <div className={styles.fullPageLoaderDot} />
        </div>
      </div>
    );
  }
  const LayoutUI = (
    <div className={styles.dashboardContainer}>
      <RouteLoadingBar />
      {navigating && (
        <div className={styles.navLoadingOverlay}>
          <div className={styles.navLoadingSpinner} />
        </div>
      )}
      {/* SIDEBAR */}
      <aside className={styles.sidebar}>
        {/* Logo */}
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarLogoMark}>N</div>
          <div>
            <h1 className={styles.sidebarTitle}>{title}</h1>
            <div className={styles.sidebarSubtitle}>{subtitle}</div>
          </div>
        </div>
        {/* Quick actions — static, never scrolls with the nav list below it
            (a flex sibling of sidebarNav, not a child, so sidebarNav's own
            overflow-y:auto is the only thing that scrolls). Notifications
            and the light/dark toggle live here for every role that uses
            this component (Admin/Member/Security) — NotificationBell
            already no-ops on routes that don't need it, and ThemeToggle is
            now permanent app-wide (previously shown only on Commercial
            pages). sidebarExtra remains available for any other future
            per-role slot; this component doesn't know or care what it is. */}
        <div className={styles.sidebarQuickActions}>
          <NotificationBell />
          <ThemeToggle />
          {sidebarExtra}
        </div>
        {/* Nav */}
        <nav className={styles.sidebarNav}>
          {navigation.map((group, i) => (
            <div key={i} className={styles.navGroup}>
              <div className={styles.navGroupTitle}>{group.title}</div>
              {group.items.map((item) => {
                const isActive = pathname.startsWith(item.path);
                return (
                  <div
                    key={item.path}
                    className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
                    onClick={() => handleNav(item.path)}
                    title={item.name}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span>{item.name}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        {/* User footer */}
        <div className={styles.sidebarFooter}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar}>
              {user.name?.charAt(0)?.toUpperCase()}
            </div>
            <div className={styles.userDetails}>
              <div className={styles.userName}>{user.name}</div>
              {STAFF_ROLES.has(user.role) ? (
                <div className={styles.userRoleStaff}>{user.role}</div>
              ) : (
                <div className={styles.userRole}>{user.role}</div>
              )}
            </div>
            <button className={styles.logoutBtn} onClick={handleLogout} title="Logout">
              <LogOut size={16} strokeWidth={1.75} />
            </button>
          </div>
          {/* Renders nothing for a single-profile account. Lets anyone whose
              account spans multiple flats, multiple societies, or a staff hat
              plus a flat, change context without logging out. */}
          <ProfileSwitcher />
        </div>
      </aside>
      {/* Contextual help — one fixed trigger per shell, always visible.
          Mounted here (not inside sidebarQuickActions) so it never competes
          for the same JSX region as CommandBar's mount (that one lives
          inside .mainContent, above {children} — see the commandBarConfig
          block below); see
          docs/superpowers/plans/2026-09-12-contextual-help-phase1.md.
          Skipped on /admin/accounting/* and /admin/opening-balances: those
          routes already mount their own <Assistant> (components/accounting/
          Assistant.jsx) at the exact same fixed bottom-right position —
          having both meant two overlapping help buttons stacked on the
          same 46-48px spot. Assistant is the accounting-specific one and
          wins there; the generic HelpButton covers every other page. */}
      {!(pathname.startsWith("/admin/accounting") || pathname === "/admin/opening-balances") && (
        <HelpButton role={role} />
      )}
      {/* MAIN AREA */}
      <div className={styles.mainWrapper}>
        {/* No top header: it used to hold only the user avatar+name (already
            shown in the sidebar footer below — redundant) and the
            notification bell (now in the sidebar's quick-actions row above
            the nav list). Nothing was left to put in an empty 56px bar, so
            it's gone rather than kept as dead space on every page. The
            styles.topHeader* / headerUser* / headerAvatar classes stay
            defined in Dashboard.module.css — components/SuperAdminLayout.js
            still uses them for its own, separate header. */}
        <main key={pathname} className={styles.mainContent}>
          {/* Global command bar — one shared component
              (components/global/CommandBar.jsx) mounted once per shell,
              config-driven per area. Renders nothing when the calling
              layout doesn't pass commandBarConfig (member/security, this
              phase) — see docs/ux-overhaul/2026-09-01-global-command-bar-
              design.md. */}
          {commandBarConfig ? (
            <div style={{ marginBottom: 12 }}>
              <CommandBar navigation={navigation} {...commandBarConfig} />
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
  return withQueryClient ? (
    <QueryClientProvider client={queryClient}>{LayoutUI}</QueryClientProvider>
  ) : (
    LayoutUI
  );
}
