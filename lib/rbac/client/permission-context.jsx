"use client";

/**
 * PermissionProvider / PermissionContext (Phase 3)
 * ----------------------------------------------------------------------------
 * Bootstraps the caller's EFFECTIVE permissions for their active context from
 * GET /api/rbac/my-access and exposes them to the client tree.
 *
 * Wiring (add once, high in the tree — e.g. app/layout.js, inside the auth'd
 * area, alongside QueryProvider):
 *
 *   import { PermissionProvider } from "@/lib/rbac/client/permission-context";
 *   <PermissionProvider>{children}</PermissionProvider>
 *
 * Optionally pass `initialData` (the my-access payload fetched in a Server
 * Component) to avoid a client round-trip / flash.
 *
 * The set held here is the already-resolved effective set (deny-override
 * applied server-side). This is UX state only; never treat it as security.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { rbacFetch } from "./rbac-client";

const PermissionContext = createContext(null);

function normalize(data) {
  return {
    permissions: new Set(data?.permissions || []),
    grouped: data?.grouped || {},
    roles: data?.roles || [],
    context: data?.context || null,
    pagePermissions: new Set(data?.pagePermissions || []),
    // Plain-language page list ({key,label,path,group,level}) — the actual
    // "where can I go" answer. See app/api/rbac/my-access/route.js.
    pages: data?.pages || [],
    bootstrapped: data?.bootstrapped !== false,
    // SEC-25: whether the SOCIETY has any roles seeded, as opposed to whether
    // THIS USER holds one. Defaults to true so a missing/failed response never
    // renders the "no roles set up" repair prompt on a healthy society.
    societyHasRoles: data?.societyHasRoles !== false,
  };
}

export function PermissionProvider({ children, initialData = null }) {
  const [state, setState] = useState(() => normalize(initialData));
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await rbacFetch("/api/rbac/my-access", { signal });
      if (mounted.current) setState(normalize(data));
    } catch (e) {
      if (e?.name !== "AbortError" && mounted.current) setError(e);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!initialData) {
      const ac = new AbortController();
      load(ac.signal);
      return () => {
        mounted.current = false;
        ac.abort();
      };
    }
    return () => {
      mounted.current = false;
    };
  }, [initialData, load]);

  const value = useMemo(
    () => ({ ...state, loading, error, refresh: () => load() }),
    [state, loading, error, load],
  );

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissionContext() {
  const ctx = useContext(PermissionContext);
  if (!ctx)
    throw new Error(
      "usePermissionContext must be used within a <PermissionProvider>",
    );
  return ctx;
}

export default PermissionProvider;
