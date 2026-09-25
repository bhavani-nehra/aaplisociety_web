"use client";

/**
 * /my-access — "My Roles & Permissions" + denial landing (Phase 3, blueprint #8).
 * ----------------------------------------------------------------------------
 * Any authenticated user may view their OWN access here (AUTH_ONLY — this page is
 * intentionally NOT wrapped in requirePagePermission, because it is the
 * destination every page/action denial redirects to). When arrived at via a
 * denial, ?denied=<permissionId> renders an explanatory banner.
 *
 * Reads the effective set from PermissionContext (bootstrapped from
 * GET /api/rbac/my-access).
 */

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { usePermissions } from "@/lib/rbac/client/use-permissions";
import { prettyPermissionId } from "@/lib/rbac/client/can";
import { PermissionProvider } from "@/lib/rbac/client/permission-context";
import { rbacFetch } from "@/lib/rbac/client/rbac-client";
import DashboardLayout from "@/components/DashboardLayout";
import { useVisibleAdminNavigation } from "@/components/adminNavigation";

function MyAccessInner() {
  const sp = useSearchParams();
  const denied = sp.get("denied");
  const {
    grouped,
    roles,
    context,
    pages,
    societyHasRoles,
    loading,
    error,
    refresh,
  } = usePermissions();
  const [open, setOpen] = useState({});
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapError, setBootstrapError] = useState(null);

  async function handleEnableRoleManagement() {
    setBootstrapping(true);
    setBootstrapError(null);
    try {
      await rbacFetch("/api/rbac/bootstrap", { method: "POST" });
      await refresh();
    } catch (e) {
      setBootstrapError(
        e?.status === 403
          ? "Only the society Admin can turn this on."
          : e?.message || "Failed to enable role management.",
      );
    } finally {
      setBootstrapping(false);
    }
  }

  // Minimalist register (final_audit_fix_plan/06-skills-and-execution-tooling.md
  // §13): "config and chrome — infrequent, high-consequence screens, maximum
  // legibility, zero decoration." Previously hardcoded Tailwind gray-*/amber-*
  // utilities, which bypass this app's token layer entirely — no dark-mode
  // support (this app's dark mode is opt-in via data-theme, not Tailwind's
  // media-query default, so a raw `text-gray-400` never repaints) and the
  // same contrast bug the design-system audit found in the token layer
  // itself (gray-400 = 2.54:1 on white, fails AA). Rewritten onto
  // var(--fg-*)/var(--bg-*)/var(--warning-*) via Tailwind arbitrary values
  // so this page now follows theme toggles and the token fixes automatically.
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-semibold" style={{ color: "var(--fg-1)" }}>My Access</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--fg-4)" }}>
        Your roles and effective permissions in this society.
      </p>

      {denied ? (
        <div
          className="mb-4 rounded-lg border p-4"
          style={{ borderColor: "var(--warning)", background: "var(--warning-bg)" }}
        >
          <div className="font-medium" style={{ color: "var(--warning-fg)" }}>
            You don’t have access to that feature.
          </div>
          <div className="mt-1 text-sm" style={{ color: "var(--warning-fg)" }}>
            It requires the permission{" "}
            <code className="rounded px-1" style={{ background: "var(--bg-surface)" }}>{denied}</code> (
            {prettyPermissionId(denied)}). If you need it, contact your society
            admin to have it added to one of your roles.
          </div>
        </div>
      ) : null}

      {/* This is the actual navigation for a staff-hat login — there is no
          sidebar on this page on purpose (it's the landing/denial page and
          has to work even for a role granted nothing yet). Every page the
          caller can actually open is a real link here. */}
      {!loading && !error && context?.hat === "staff" ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--fg-3)" }}>
            Where you can go
          </h2>
          {(pages || []).filter((p) => p.level !== "none").length === 0 ? (
            <div className="rounded-lg px-3 py-4 text-sm" style={{ background: "var(--bg-sunken)", color: "var(--fg-5)" }}>
              No pages granted yet. Contact your society admin to be assigned
              a role.
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(
                (pages || [])
                  .filter((p) => p.level !== "none")
                  .reduce((acc, p) => {
                    (acc[p.group] ||= []).push(p);
                    return acc;
                  }, {}),
              ).map(([group, groupPages]) => (
                <div key={group}>
                  <div className="mb-1 text-xs font-semibold uppercase" style={{ color: "var(--fg-5)" }}>
                    {group}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {groupPages.map((p) => (
                      <Link
                        key={p.key}
                        href={p.path}
                        className="rounded-lg border px-3 py-1.5 text-sm transition-colors"
                        style={{ borderColor: "var(--border-strong)", background: "var(--bg-surface)", color: "var(--fg-3)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--primary)"; e.currentTarget.style.color = "var(--primary)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.color = "var(--fg-3)"; }}
                      >
                        {p.label}
                        <span className="ml-1.5 text-xs" style={{ color: "var(--fg-5)" }}>
                          {p.level === "manage" ? "Manage" : "View"}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {loading ? (
        <div className="text-sm" style={{ color: "var(--fg-4)" }}>Loading your access…</div>
      ) : error ? (
        <div className="text-sm" style={{ color: "var(--danger)" }}>
          Couldn’t load your access: {error.message}
          <button onClick={refresh} className="ml-2 underline">
            Retry
          </button>
        </div>
      ) : (
        <>
          <section className="mb-5">
            <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--fg-3)" }}>
              Active context
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded px-2 py-0.5" style={{ background: "var(--bg-muted)", color: "var(--fg-2)" }}>
                {context?.hat === "member" ? "Member" : "Staff"} hat
              </span>
              {roles.length ? (
                roles.map((r) => (
                  <span
                    key={r.id}
                    className="flex items-center gap-1 rounded-full border px-2 py-0.5"
                    style={{ borderColor: r.color || "var(--border)", color: "var(--fg-2)" }}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: r.color || "var(--fg-5)" }}
                    />
                    {r.name}
                  </span>
                ))
              ) : (
                <span style={{ color: "var(--fg-5)" }}>
                  No staff roles (fixed member capabilities)
                </span>
              )}
            </div>
            {/* SEC-25: gated on the SOCIETY having no roles, not on this user
                holding none. The old condition (`roles.length === 0`) fired for
                any staff account not yet assigned a role and told them role
                management was "not turned on" — on societies where it was
                seeded at import and working fine. RBAC is on by default; this
                is a recovery action for the one case where seeding genuinely
                did not happen, not a feature to switch on. */}
            {context?.hat === "staff" && societyHasRoles === false ? (
              <div
                className="mt-3 rounded-lg border p-3"
                style={{ borderColor: "var(--warning)", background: "var(--warning-bg)" }}
              >
                <div className="text-sm" style={{ color: "var(--warning-fg)" }}>
                  Troubleshooting — this society has no roles set up.
                </div>
                <div className="mt-1 text-xs" style={{ color: "var(--warning-fg)" }}>
                  Roles are normally created automatically when a society is
                  imported. If you’re the society Admin, this repairs the
                  default set (Admin, Secretary, Accountant, Security) and
                  assigns you the Admin role.
                </div>
                <button
                  type="button"
                  onClick={handleEnableRoleManagement}
                  disabled={bootstrapping}
                  className="btn btn-sm mt-2"
                  style={{ background: "var(--warning)", color: "var(--on-solid)" }}
                >
                  {bootstrapping ? "Repairing…" : "Repair role setup"}
                </button>
                {bootstrapError ? (
                  <div className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
                    {bootstrapError}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--fg-3)" }}>
              Permissions by area
            </h2>
            {Object.keys(grouped).length === 0 ? (
              <div className="text-sm" style={{ color: "var(--fg-5)" }}>
                You have no permissions in this context.
              </div>
            ) : (
              <div className="rounded-lg border" style={{ borderColor: "var(--border)" }}>
                {Object.entries(grouped)
                  .sort()
                  .map(([mod, ids], i, arr) => {
                    const isOpen = open[mod];
                    return (
                      <div key={mod} style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                        <button
                          type="button"
                          onClick={() =>
                            setOpen((s) => ({ ...s, [mod]: !s[mod] }))
                          }
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium capitalize"
                          style={{ color: "var(--fg-1)" }}
                        >
                          <span>
                            <span className="mr-1 inline-block w-3" style={{ color: "var(--fg-5)" }}>
                              {isOpen ? "▾" : "▸"}
                            </span>
                            {mod}
                          </span>
                          <span className="rounded-full px-2 text-xs" style={{ background: "var(--bg-muted)", color: "var(--fg-3)" }}>
                            {ids.length}
                          </span>
                        </button>
                        {isOpen ? (
                          <ul className="space-y-0.5 px-8 py-2">
                            {ids.sort().map((id) => (
                              <li
                                key={id}
                                className="flex items-center justify-between text-sm"
                                style={{ color: "var(--fg-2)" }}
                              >
                                <span>{prettyPermissionId(id)}</span>
                                <code className="text-[10px]" style={{ color: "var(--fg-5)" }}>
                                  {id}
                                </code>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default function MyAccessPage() {
  const { visibleNavigation } = useVisibleAdminNavigation();
  return (
    <DashboardLayout role="Staff" navigation={visibleNavigation} title="AapliSociety" subtitle="My Access">
      <PermissionProvider>
        <Suspense
          fallback={
            <div className="p-8 text-sm" style={{ color: "var(--fg-4)" }}>Loading your access…</div>
          }
        >
          <MyAccessInner />
        </Suspense>
      </PermissionProvider>
    </DashboardLayout>
  );
}
