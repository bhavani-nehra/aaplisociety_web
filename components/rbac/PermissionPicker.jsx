"use client";

/**
 * <PermissionPicker> — plain-language permission picker (Phase 3, revised).
 * ----------------------------------------------------------------------------
 * Built for NON-technical admins. Design rules:
 *   - NEVER show raw permission ids (e.g. "billing.balanceSheet.view"). Only
 *     human labels from the catalog are shown. Ids stay internal.
 *   - A resource with a SINGLE action renders as ONE simple checkbox — no
 *     dropdown, no nesting. (e.g. “View Members” is just a checkbox.)
 *   - A resource with MULTIPLE actions shows the actions as inline toggle
 *     pills (View / Create / Update / Delete…) — no click-to-expand needed.
 *   - Dangerous actions are red and ask for a one-tap confirm before turning on.
 *   - Modules are collapsible groups with a running “N on” badge.
 *   - “Deny” overrides are an ADVANCED, opt-in control (hidden by default) so
 *     ordinary use stays dead simple.
 *
 * Controlled component:
 *   value    = { permissions: string[], denies: string[] }
 *   onChange = (next) => void
 *
 * Data source: GET /api/rbac/permissions -> { tree } where tree is
 *   [{ key, label, resources: [{ key, label, page, path,
 *      actions: [{ id, key, label, dangerous }] }] }]
 */

import { useEffect, useMemo, useState } from "react";
import { rbacFetch } from "@/lib/rbac/client/rbac-client";

// A single action label, made friendly for a lone-checkbox resource.
function soloLabel(resource, action) {
  // For a page/view-only resource, the resource label reads best on its own.
  if (action.key === "view") return resource.label;
  return `${action.label} — ${resource.label}`;
}

export function PermissionPicker({ value, onChange, disabled = false }) {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("");
  const [openModules, setOpenModules] = useState(() => new Set());
  const [advanced, setAdvanced] = useState(false);
  const [pendingDangerous, setPendingDangerous] = useState(null);

  const selected = useMemo(
    () => new Set(value?.permissions || []),
    [value?.permissions],
  );
  const denies = useMemo(() => new Set(value?.denies || []), [value?.denies]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const data = await rbacFetch("/api/rbac/permissions", {
          signal: ac.signal,
        });
        setTree(data?.tree || []);
      } catch (e) {
        if (e?.name !== "AbortError") setError(e);
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  function emit(nextSelected, nextDenies) {
    onChange?.({
      permissions: [...nextSelected].sort(),
      denies: [...(nextDenies || denies)].sort(),
    });
  }

  function setAction(action, on) {
    if (disabled) return;
    if (on && action.dangerous && !selected.has(action.id)) {
      setPendingDangerous(action); // confirm first
      return;
    }
    const next = new Set(selected);
    if (on) next.add(action.id);
    else next.delete(action.id);
    emit(next);
  }

  function confirmDangerous() {
    if (!pendingDangerous) return;
    const next = new Set(selected);
    next.add(pendingDangerous.id);
    setPendingDangerous(null);
    emit(next);
  }

  function toggleDeny(action, on) {
    if (disabled) return;
    const next = new Set(denies);
    if (on) next.add(action.id);
    else next.delete(action.id);
    emit(selected, next);
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tree;
    return tree
      .map((mod) => {
        const resources = mod.resources
          .map((r) => {
            const actions = r.actions.filter((a) =>
              a.label.toLowerCase().includes(q),
            );
            const resMatch = r.label.toLowerCase().includes(q);
            return resMatch ? r : actions.length ? { ...r, actions } : null;
          })
          .filter(Boolean);
        const modMatch = mod.label.toLowerCase().includes(q);
        return modMatch ? mod : resources.length ? { ...mod, resources } : null;
      })
      .filter(Boolean);
  }, [tree, filter]);

  function toggleModule(key) {
    const next = new Set(openModules);
    next.has(key) ? next.delete(key) : next.add(key);
    setOpenModules(next);
  }

  if (loading)
    return (
      <div className="p-4 text-sm text-gray-500">Loading permissions…</div>
    );
  if (error)
    return (
      <div className="p-4 text-sm text-red-600">
        Couldn’t load permissions: {error.message}
      </div>
    );

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search, e.g. ‘members’ or ‘delete’…"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <span className="whitespace-nowrap rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          {selected.size} allowed
        </span>
        <label className="flex items-center gap-1 whitespace-nowrap text-xs text-gray-500">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(e) => setAdvanced(e.target.checked)}
          />
          Advanced
        </label>
      </div>

      <div className="max-h-[52vh] space-y-2 overflow-auto p-3">
        {filtered.map((mod) => {
          const open = openModules.has(mod.key) || !!filter;
          const onCount = mod.resources.reduce(
            (n, r) => n + r.actions.filter((a) => selected.has(a.id)).length,
            0,
          );
          return (
            <div
              key={mod.key}
              className="overflow-hidden rounded-lg border border-gray-200"
            >
              <button
                type="button"
                onClick={() => toggleModule(mod.key)}
                className="flex w-full items-center justify-between bg-gray-50 px-3 py-2 text-left hover:bg-gray-100"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                  <span className="inline-block w-3 text-gray-400">
                    {open ? "▾" : "▸"}
                  </span>
                  {mod.label}
                </span>
                {onCount > 0 ? (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {onCount} on
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">none</span>
                )}
              </button>

              {open ? (
                <div className="divide-y divide-gray-50">
                  {mod.resources.map((r) => {
                    const single = r.actions.length === 1;
                    return (
                      <div key={r.key} className="px-3 py-2">
                        {single ? (
                          // ── single action → one plain checkbox ──────────
                          (() => {
                            const a = r.actions[0];
                            const isOn = selected.has(a.id);
                            const isDenied = denies.has(a.id);
                            return (
                              <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 text-sm text-gray-800">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    disabled={disabled || isDenied}
                                    checked={isOn}
                                    onChange={(e) =>
                                      setAction(a, e.target.checked)
                                    }
                                  />
                                  <span
                                    className={
                                      a.dangerous ? "text-red-600" : ""
                                    }
                                  >
                                    {soloLabel(r, a)}
                                  </span>
                                  {r.page ? (
                                    <span className="rounded bg-sky-100 px-1.5 text-[10px] text-sky-700">
                                      page
                                    </span>
                                  ) : null}
                                  {a.dangerous ? (
                                    <span className="rounded bg-red-100 px-1.5 text-[10px] text-red-700">
                                      careful
                                    </span>
                                  ) : null}
                                </label>
                                {advanced ? (
                                  <label className="flex items-center gap-1 text-[11px] text-gray-400">
                                    <input
                                      type="checkbox"
                                      disabled={disabled}
                                      checked={isDenied}
                                      onChange={(e) =>
                                        toggleDeny(a, e.target.checked)
                                      }
                                    />
                                    block
                                  </label>
                                ) : null}
                              </div>
                            );
                          })()
                        ) : (
                          // ── multiple actions → inline toggle pills ──────
                          <div>
                            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700">
                              {r.label}
                              {r.page ? (
                                <span className="rounded bg-sky-100 px-1.5 text-[10px] text-sky-700">
                                  page
                                </span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {r.actions.map((a) => {
                                const isOn = selected.has(a.id);
                                const isDenied = denies.has(a.id);
                                const base =
                                  "rounded-full border px-3 py-1 text-xs transition select-none ";
                                const cls = isDenied
                                  ? base +
                                    "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300 line-through"
                                  : isOn
                                    ? base +
                                      (a.dangerous
                                        ? "border-red-500 bg-red-500 text-white"
                                        : "border-indigo-500 bg-indigo-500 text-white")
                                    : base +
                                      (a.dangerous
                                        ? "border-red-200 bg-white text-red-600 hover:bg-red-50"
                                        : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50");
                                return (
                                  <span
                                    key={a.id}
                                    className="inline-flex items-center gap-1"
                                  >
                                    <button
                                      type="button"
                                      disabled={disabled || isDenied}
                                      onClick={() => setAction(a, !isOn)}
                                      className={cls}
                                      title={a.label}
                                    >
                                      {a.dangerous ? "" : ""}
                                      {a.label}
                                    </button>
                                    {advanced ? (
                                      <label className="flex items-center gap-0.5 text-[10px] text-gray-400">
                                        <input
                                          type="checkbox"
                                          disabled={disabled}
                                          checked={isDenied}
                                          onChange={(e) =>
                                            toggleDeny(a, e.target.checked)
                                          }
                                        />
                                        block
                                      </label>
                                    ) : null}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">
            Nothing matches “{filter}”.
          </div>
        ) : null}
      </div>

      {advanced ? (
        <div className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-400">
          “Block” wins over any allow — use it to carve an exception out of an
          otherwise-allowed area. {denies.size} blocked.
        </div>
      ) : null}

      {pendingDangerous ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="mb-1 text-sm font-semibold text-red-600">
              Allow a high-impact action?
            </h3>
            <p className="mb-4 text-sm text-gray-600">
              <strong>{pendingDangerous.label}</strong> can’t be undone easily.
              Only allow it if this role really needs it.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDangerous(null)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDangerous}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white"
              >
                Yes, allow it
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default PermissionPicker;
