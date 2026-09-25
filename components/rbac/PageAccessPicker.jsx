"use client";

/**
 * <PageAccessPicker> — the ENTIRE admin-facing permission UI.
 * ----------------------------------------------------------------------------
 * Replaces the old CRUD-tree <PermissionPicker>. No permission ids, no
 * create/update/delete/export checkboxes, no wildcards shown to the admin.
 * Just: page name, and NONE / VIEW / MANAGE. Grouped exactly like the
 * sidebar (Society, Billing, Finance, Communication, Security, ...).
 *
 * value:    [{ pageKey, level }]   (level omitted/absent == "none")
 * onChange: (next: [{ pageKey, level }]) => void
 */

import { useEffect, useState } from "react";
import { rbacFetch } from "@/lib/rbac/client/rbac-client";

const LEVELS = [
  { value: "none", label: "No access" },
  { value: "view", label: "View only" },
  { value: "manage", label: "Manage" },
];

export function PageAccessPicker({ value = [], onChange }) {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    rbacFetch("/api/rbac/permissions")
      .then((d) => {
        if (alive) setGroups(d?.groups || []);
      })
      .catch((e) => {
        if (alive) setError(e);
      });
    return () => {
      alive = false;
    };
  }, []);

  const levelFor = (pageKey) =>
    value.find((v) => v.pageKey === pageKey)?.level || "none";

  function setLevel(pageKey, level) {
    const rest = value.filter((v) => v.pageKey !== pageKey);
    onChange(level === "none" ? rest : [...rest, { pageKey, level }]);
  }

  if (error)
    return (
      <p className="text-sm text-red-600">
        Couldn't load pages: {error.message}
      </p>
    );
  if (!groups) return <p className="text-sm text-gray-400">Loading pages…</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        For each area, choose what this role can do.{" "}
        <strong>View only</strong> lets them look; <strong>Manage</strong>{" "}
        lets them make changes.
      </p>
      {groups.map((g) => (
        <div key={g.group} className="rounded-lg border border-gray-200">
          <div className="border-b bg-gray-50 px-3 py-1.5 text-xs font-semibold uppercase text-gray-500">
            {g.group}
          </div>
          <div className="divide-y divide-gray-100">
            {g.pages.map((p) => (
              <div
                key={p.key}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className="text-sm text-gray-800">
                  {p.label}
                  {p.adminOnly ? (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      Admin only
                    </span>
                  ) : null}
                  {/* Only while Manage is actually selected. Shown against
                      every page with a destructive action it would be
                      wallpaper — twenty warnings nobody reads. Shown against
                      the choice the admin just made, it is information. */}
                  {p.dangerous?.length && levelFor(p.key) === "manage" ? (
                    <span
                      className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
                      title={`Manage on this page also allows: ${p.dangerous.join(", ")}`}
                    >
                      includes {p.dangerous.join(", ").toLowerCase()}
                    </span>
                  ) : null}
                </span>
                <div className="flex overflow-hidden rounded-lg border border-gray-300">
                  {LEVELS.map((lvl) => {
                    const active = levelFor(p.key) === lvl.value;
                    return (
                      <button
                        key={lvl.value}
                        type="button"
                        disabled={p.adminOnly}
                        onClick={() => setLevel(p.key, lvl.value)}
                        title={p.adminOnly ? "Only the Admin role can access this page" : undefined}
                        className={`px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? lvl.value === "manage"
                              ? "bg-indigo-600 text-white"
                              : lvl.value === "view"
                                ? "bg-indigo-100 text-indigo-700"
                                : "bg-gray-100 text-gray-500"
                            : "bg-white text-gray-500 hover:bg-gray-50"
                        }`}
                      >
                        {lvl.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default PageAccessPicker;
