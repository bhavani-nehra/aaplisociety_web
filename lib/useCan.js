"use client";
/**
 * Shared role-aware permission-gate hook for every area's Command Bar
 * (components/global/CommandBar.jsx) and, in future, anything else outside
 * accounting that needs it. Generalized from lib/accounting/useCan.js (left
 * untouched — the standalone accounting QuickBar keeps using it): pure
 * relocate/rename, no logic change — GET /api/rbac/my-access is already
 * app-wide/generic (see app/api/rbac/my-access/route.js: it resolves the
 * caller's own permissions from their token/society context, nothing
 * accounting-specific), so it was never accounting's endpoint to begin with.
 *
 * Same fail-open behaviour everywhere: until permissions load (or if the
 * fetch fails), can() returns true — never blocks on a slow/failed
 * permission check, only hides once it actually knows the answer. Real
 * permission ids only (see call sites).
 */
import { useCallback, useEffect, useState } from "react";

export function useCan() {
  const [perms, setPerms] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/rbac/my-access", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.permissions) setPerms(new Set(d.permissions)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return useCallback((perm) => !perms || perms.has(perm), [perms]);
}
