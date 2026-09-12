"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LogOut, LayoutDashboard, Building2, ClipboardList,
  DatabaseZap, ScrollText, PackageOpen, Search, Bell, Shield, Activity, SlidersHorizontal,
  CreditCard,
  Archive,
  LifeBuoy,
  RefreshCw,
  Lock,
} from "lucide-react";
import RouteLoadingBar from "./RouteLoadingBar";
import ThemeToggle from "./theme/ThemeToggle";
import styles from "@/styles/SuperAdminLayout.module.css";
const NAV = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", path: "/superadmin/dashboard", icon: <LayoutDashboard size={16} strokeWidth={1.75} /> },
    ],
  },
  {
    title: "Platform",
    items: [
      { name: "Societies",     path: "/superadmin/societies",     icon: <Building2 size={16} strokeWidth={1.75} /> },
      { name: "Support Tickets", path: "/superadmin/tickets",     icon: <LifeBuoy size={16} strokeWidth={1.75} /> },
      { name: "Takeover Sessions", path: "/superadmin/takeover",  icon: <Lock size={16} strokeWidth={1.75} /> },
      { name: "Subscriptions", path: "/superadmin/subscriptions", icon: <CreditCard size={16} strokeWidth={1.75} /> },
      { name: "Offboarding",   path: "/superadmin/lifecycle",     icon: <Archive size={16} strokeWidth={1.75} /> },
      { name: "Audit Reports", path: "/superadmin/audit-reports", icon: <ClipboardList size={16} strokeWidth={1.75} /> },
      { name: "Data Browser",  path: "/superadmin/data-browser",  icon: <DatabaseZap size={16} strokeWidth={1.75} /> },
      { name: "DB Sync",       path: "/superadmin/db-sync",       icon: <RefreshCw size={16} strokeWidth={1.75} /> },
      { name: "Logs",          path: "/superadmin/logs",          icon: <ScrollText size={16} strokeWidth={1.75} /> },
      { name: "Exports",       path: "/superadmin/exports",       icon: <PackageOpen size={16} strokeWidth={1.75} /> },
      { name: "Operations",    path: "/superadmin/operations",    icon: <Activity size={16} strokeWidth={1.75} /> },
      { name: "Settings",      path: "/superadmin/settings",      icon: <SlidersHorizontal size={16} strokeWidth={1.75} /> },
    ],
  },
];
const [queryClient] = [new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      cacheTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
  },
})];
export default function SuperAdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [navigating, setNavigating] = useState(false);
  const navTimeoutRef = useRef(null);
  useEffect(() => {
    if (pathname.includes("/auth/login")) return;
    const fetchUser = async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setUser(data.user);
      } catch {
        if (!pathname.includes("/auth/login")) {
          window.location.href = "/auth/login";
        }
      }
    };
    fetchUser();
  }, []);
  useEffect(() => {
    setNavigating(false);
    clearTimeout(navTimeoutRef.current);
  }, [pathname]);
  const handleNav = useCallback((path) => {
    if (pathname === path) return;
    setNavigating(true);
    navTimeoutRef.current = setTimeout(() => setNavigating(false), 3000);
    router.push(path);
  }, [pathname, router]);
  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/auth/login");
  };
  if (!user) {
    return (
      <div className={styles.fullPageLoader}>
        <div className={styles.fullPageLoaderInner}>
          <svg width="28" height="28" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
            <g fill="rgba(255,255,255,0.9)">
              <rect x="10" y="20" width="11" height="32" rx="0.5"/>
              <rect x="23" y="10" width="14" height="42" rx="0.5"/>
              <rect x="39" y="26" width="15" height="26" rx="0.5"/>
              <path d="M 6 52 Q 32 60 58 52 L 58 56 Q 32 64 6 56 Z"/>
            </g>
          </svg>
          <span className={styles.fullPageLoaderTitle}>AapliSocietyy</span>
          <span className={styles.fullPageLoaderSub}>Super Admin</span>
        </div>
        <div className={styles.fullPageLoaderDots}>
          <div className={styles.fullPageLoaderDot} />
          <div className={styles.fullPageLoaderDot} />
          <div className={styles.fullPageLoaderDot} />
        </div>
      </div>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <div className={styles.container}>
        <RouteLoadingBar />
        {navigating && (
          <div className={styles.navOverlay}>
            <div className={styles.navSpinner} />
          </div>
        )}
        {/* SIDEBAR — dark blue per design spec */}
        <aside className={styles.sidebar}>
          {/* Logo */}
          <div className={styles.sidebarHeader}>
            {/* Logo mark on the sidebar's fixed brand-blue background (never
                themed, see comment above styles.sidebar in tokens.css) — stays
                literal white in both modes, not var(--bg-surface) which would
                flip dark and vanish against the blue. */}
            <svg width="28" height="28" viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
              <g fill="#ffffff">
                <rect x="10" y="20" width="11" height="32" rx="0.5"/>
                <rect x="23" y="10" width="14" height="42" rx="0.5"/>
                <rect x="39" y="26" width="15" height="26" rx="0.5"/>
                <path d="M 6 52 Q 32 60 58 52 L 58 56 Q 32 64 6 56 Z"/>
              </g>
            </svg>
            <div>
              <div className={styles.sidebarTitle}>AapliSocietyy</div>
              <div className={styles.sidebarSubtitle}>
                <Shield size={9} strokeWidth={2} style={{ opacity: 0.7 }} />
                Super Admin
              </div>
            </div>
          </div>
          {/* Nav */}
          <nav className={styles.sidebarNav}>
            {NAV.map((group, i) => (
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
                <div className={styles.userRole}>Platform Owner</div>
              </div>
              <button className={styles.logoutBtn} onClick={handleLogout} title="Logout">
                <LogOut size={15} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </aside>
        {/* MAIN */}
        <div className={styles.mainWrapper}>
          {/* Top header — white with search */}
          <header className={styles.topHeader}>
            <div className={styles.searchWrap}>
              <Search size={14} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                placeholder="Search societies, members, transactions…"
              />
              <span className={styles.searchKbd}>⌘K</span>
            </div>
            <div className={styles.topHeaderRight}>
              <ThemeToggle />
              <div className={styles.headerUser}>
                <div className={styles.headerAvatar}>
                  {user.name?.charAt(0)?.toUpperCase()}
                </div>
                <span className={styles.headerUserName}>{user.name}</span>
              </div>
            </div>
          </header>
          <main className={styles.mainContent}>
            <div className={styles.contentFrame}>{children}</div>
          </main>
        </div>
      </div>
    </QueryClientProvider>
  );
}
