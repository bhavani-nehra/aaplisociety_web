"use client";

/**
 * Permission hooks (Phase 3). Thin ergonomic wrappers over PermissionContext.
 *
 *   const canEdit = useCan("rbac.role.update");
 *   const canModerate = useCanAny(["complaint.complaint.approve", "complaint.complaint.reject"]);
 *   const canFullyManage = useCanAll(["rbac.role.update", "rbac.role.delete"]);
 *   const { permissions, roles, context, loading, refresh } = usePermissions();
 *
 * All matching is client-side UX only — servers still enforce every action.
 */

import { useMemo } from "react";
import { usePermissionContext } from "./permission-context";
import { canWith } from "./can";

export function usePermissions() {
  const {
    permissions,
    grouped,
    roles,
    context,
    pagePermissions,
    pages,
    bootstrapped,
    societyHasRoles,
    loading,
    error,
    refresh,
  } = usePermissionContext();
  return {
    permissions,
    grouped,
    roles,
    context,
    pagePermissions,
    pages,
    bootstrapped,
    societyHasRoles,
    loading,
    error,
    refresh,
  };
}

export function useCan(permissionId) {
  const { permissions } = usePermissionContext();
  return useMemo(
    () => canWith(permissions, permissionId),
    [permissions, permissionId],
  );
}

export function useCanAny(ids = []) {
  const { permissions } = usePermissionContext();
  const key = Array.isArray(ids) ? ids.join("|") : "";
  return useMemo(
    () =>
      key.length > 0 && key.split("|").some((id) => canWith(permissions, id)),
    [permissions, key],
  );
}

export function useCanAll(ids = []) {
  const { permissions } = usePermissionContext();
  const key = Array.isArray(ids) ? ids.join("|") : "";
  return useMemo(
    () =>
      key.length > 0 && key.split("|").every((id) => canWith(permissions, id)),
    [permissions, key],
  );
}

/** True if the caller can access a given page-access permission id. */
export function useCanViewPage(pagePermissionId) {
  const { pagePermissions, permissions } = usePermissionContext();
  return useMemo(
    () =>
      pagePermissions.has(pagePermissionId) ||
      canWith(permissions, pagePermissionId),
    [pagePermissions, permissions, pagePermissionId],
  );
}
