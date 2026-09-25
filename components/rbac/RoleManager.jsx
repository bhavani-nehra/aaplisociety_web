"use client";

/**
 * <RoleManager> — role management UI (Phase 3, revised; Plan 06 Config-group
 * rewrite onto components/revamp, Calm/minimal register).
 * ----------------------------------------------------------------------------
 * Lists roles and lets an authorized admin create / clone / edit / delete them,
 * restore system-role defaults, and — via the “Assign” action — open the
 * <AssignmentManager> to create login users or assign existing ones.
 *
 * The create/edit editor is a centered <Modal> (components/revamp) over the
 * page. The permission chooser is the spoon-fed <PageAccessPicker>
 * (NONE/VIEW/MANAGE per page — no raw permission ids shown to the admin).
 * Every mutating control is a <PermissionButton> (visible-but-disabled with a
 * tooltip when the caller lacks the permission); the server still enforces
 * authorization on every request. This is a security-sensitive, infrequent,
 * high-consequence screen — Calm/minimal register (06-skills-and-execution-
 * tooling.md §13): maximum legibility, zero decoration, no colour used except
 * to carry meaning (system/custom, view/manage, destructive).
 *
 * Backend contract (frozen Phase 2 + Phase 3 additive users route) — UNCHANGED
 * by this rewrite, every request body / permission key / role id below is
 * byte-identical to the previous version:
 *   GET    /api/rbac/roles                    -> { roles }
 *   POST   /api/rbac/roles                     -> { role, warnings }   (create/clone)
 *   PATCH  /api/rbac/roles/[id]                -> { role, warnings }   (edit)
 *   DELETE /api/rbac/roles/[id]                -> { ok }
 *   GET    /api/rbac/roles/[id]/impact         -> { assignments, users, ... }
 *   POST   /api/rbac/roles/[id]/restore-defaults
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { rbacFetch } from "@/lib/rbac/client/rbac-client";
import { PermissionButton } from "@/components/rbac/PermissionButton";
import { PageAccessPicker } from "@/components/rbac/PageAccessPicker";
import { AssignmentManager } from "@/components/rbac/AssignmentManager";
import { reduceToPageAccess } from "@/lib/rbac/page-access-map";
import { Btn, Card, CardHead, DataTable, Modal, Pill } from "@/components/revamp";

const EMPTY_DRAFT = {
  name: "",
  description: "",
  color: "var(--accent)",
  pageAccess: [],
};

// Metadata only (name/description/color) — kept separate from
// lib/rbac/system-role-defaults.js so the client bundle never needs the
// server-side permission-expansion logic, just enough to render checkboxes.
// Keys must match SYSTEM_ROLE_DEFAULTS keys in that file.
export const SEED_TEMPLATES = [
  { key: "admin", name: "Admin", description: "Full administrative control of the society.", color: "var(--danger)" },
  { key: "secretary", name: "Secretary", description: "Day-to-day operations: members, notices, complaints, visitors.", color: "var(--accent)" },
  { key: "accountant", name: "Treasurer", description: "Finance, billing, payments, ledger and statements.", color: "var(--success)" },
  { key: "auditor", name: "Auditor", description: "Read-only access to finance, billing and audit records.", color: "#a855f7" },
  { key: "committeeMember", name: "Committee Member", description: "Broad read access with limited management.", color: "#14b8a6" },
  { key: "security", name: "Security", description: "Gate operations: visitor entry/exit, passes and SOS.", color: "var(--warning)" },
  { key: "clubhouseManager", name: "Clubhouse Manager", description: "Runs the clubhouse from the mobile app: scan residents in, attendance, open/close, timings, maintenance, incidents.", color: "#14b8a6" },
];

// Small labeled-field wrapper, matches the .label/.input token classes the
// rest of the revamped admin already uses (app/admin/payments/PageClient.js
// etc.) rather than inventing a second convention here.
function Field({ label, hint, children }) {
  return (
    <label style={{ display: "block", fontSize: 13 }}>
      <span className="label" style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        {label}
        {hint ? <span style={{ fontWeight: 400, color: "var(--r-fg-4)" }}>{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export function RoleManager() {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editor, setEditor] = useState(null); // { mode, roleId?, draft, warnings?, busy?, err? }
  const [impact, setImpact] = useState(null); // { role, data, busy }
  const [assigning, setAssigning] = useState(null); // role being managed
  const [seedPicked, setSeedPicked] = useState(() => new Set());
  const [seeding, setSeeding] = useState(false);
  const [seedErr, setSeedErr] = useState(null);
  // pageKey -> { label, dangerous[] }. Same payload PageAccessPicker fetches;
  // needed here too so the save review can name pages and destructive actions
  // in the admin's own words rather than echoing page keys back at them.
  const [pageMeta, setPageMeta] = useState(null);

  // Templates the society doesn't have a system role for yet. Keyed by role
  // `key` only (not name) — the whole point of the seed routes' name-clash
  // guard is that a same-named CUSTOM role does not count as "already have
  // this", so it isn't excluded here either; the admin sees it's missing and
  // the seed call itself is what refuses to double it up.
  const missingTemplates = useMemo(() => {
    const seededKeys = new Set(roles.filter((r) => r.isSystem).map((r) => r.key));
    return SEED_TEMPLATES.filter((t) => !seededKeys.has(t.key));
  }, [roles]);

  const load = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const data = await rbacFetch("/api/rbac/roles", { signal });
      setRoles(data?.roles || []);
    } catch (e) {
      if (e?.name !== "AbortError") setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    rbacFetch("/api/rbac/permissions", { signal: ac.signal })
      .then((d) => {
        const map = {};
        for (const g of d?.groups || []) {
          for (const p of g.pages || []) {
            map[p.key] = { label: p.label, dangerous: p.dangerous || [] };
          }
        }
        setPageMeta(map);
      })
      // A failed fetch costs the review its labels, not the ability to save.
      // reviewOf() falls back to page keys and an empty dangerous list.
      .catch(() => setPageMeta({}));
    return () => ac.abort();
  }, []);

  const roleId = (r) => r.id || r._id || r.key;
  const isSystem = (r) => !!(r.isSystem ?? r.system ?? r.locked);

  function openCreate() {
    setEditor({ mode: "create", draft: { ...EMPTY_DRAFT } });
  }
  function openClone(role) {
    setEditor({
      mode: "clone",
      cloneFromRoleId: roleId(role),
      draft: {
        ...EMPTY_DRAFT,
        name: `${role.name} (copy)`,
        color: role.color || EMPTY_DRAFT.color,
        pageAccess: reduceToPageAccess(role.permissions || []),
      },
    });
  }
  function openEdit(role) {
    // The Admin system role is a hardcoded superuser at the server
    // (lib/rbac/permission-engine.js: role.isSystem && role.key === "admin"
    // bypasses every permission check, unconditionally). Its `permissions`
    // list is never actually read for that check, so showing a per-page
    // VIEW/MANAGE picker here would be lying — whatever you toggle here has
    // zero effect on what an Admin can do. Show that plainly instead of a
    // picker that implies otherwise.
    if (role.key === "admin" && isSystem(role)) {
      setEditor({
        mode: "admin-locked",
        roleId: roleId(role),
        draft: { name: role.name, description: role.description, color: role.color },
      });
      return;
    }
    const pageAccess = reduceToPageAccess(role.permissions || []);
    setEditor({
      mode: "edit",
      roleId: roleId(role),
      // What the role could do when the dialog opened. saveEditor() diffs the
      // draft against this to work out what is actually changing — without it
      // there is no way to tell "left Manage alone" from "just granted Manage".
      baseline: pageAccess,
      draft: {
        name: role.name || "",
        description: role.description || "",
        color: role.color || EMPTY_DRAFT.color,
        pageAccess,
      },
    });
  }

  // What is about to change, in the admin's own vocabulary.
  //
  // `lost`      pages this role could open and no longer will, or drops from
  //             Manage to View. Everyone holding the role is forced to re-auth
  //             on save (updateRole, Q11), so this is the half that surprises.
  // `dangerous` pages newly raised to Manage that carry a destructive action.
  //             A grant is not undone by a re-auth; it is undone by noticing.
  function reviewOf(editorState) {
    const meta = pageMeta || {};
    const labelOf = (key) => meta[key]?.label || key;
    const levelIn = (list, key) =>
      list.find((v) => v.pageKey === key)?.level || "none";

    const before = editorState.baseline || [];
    const after = editorState.draft.pageAccess || [];
    const keys = new Set([
      ...before.map((v) => v.pageKey),
      ...after.map((v) => v.pageKey),
    ]);

    const lost = [];
    const dangerous = [];
    for (const key of keys) {
      const was = levelIn(before, key);
      const now = levelIn(after, key);
      if (was === now) continue;
      if (now === "none") lost.push({ label: labelOf(key), detail: "loses access" });
      else if (was === "manage" && now === "view")
        lost.push({ label: labelOf(key), detail: "drops to view only" });
      if (now === "manage" && meta[key]?.dangerous?.length) {
        dangerous.push({ label: labelOf(key), actions: meta[key].dangerous });
      }
    }
    return { lost, dangerous };
  }

  // Step one of saving: decide whether this edit deserves a second look.
  // A create or a purely additive edit goes straight through — a confirmation
  // dialog that always appears is a dialog nobody reads.
  async function saveEditor() {
    if (!editor) return;
    const review = reviewOf(editor);
    if (!review.lost.length && !review.dangerous.length) return commitSave();

    setEditor((s) => ({ ...s, review: { ...review, holders: null }, err: null }));

    // How many people this actually lands on. Only meaningful for an existing
    // role, and only worth blocking the dialog on if it answers quickly — a
    // failed count leaves the review standing without it.
    if (editor.mode === "edit" && editor.roleId) {
      try {
        const data = await rbacFetch(`/api/rbac/roles/${editor.roleId}/impact`);
        setEditor((s) =>
          s?.review
            ? { ...s, review: { ...s.review, holders: data?.affectedUserCount ?? null } }
            : s,
        );
      } catch {
        /* count is a nicety; the review stands without it */
      }
    }
  }

  async function commitSave() {
    if (!editor) return;
    setEditor((s) => ({ ...s, busy: true, err: null, warnings: null, review: null }));
    try {
      const { draft, mode, roleId: id, cloneFromRoleId } = editor;
      const body = {
        name: draft.name,
        description: draft.description,
        color: draft.color,
        pageAccess: draft.pageAccess,
      };
      let res;
      if (mode === "edit") {
        res = await rbacFetch(`/api/rbac/roles/${id}`, {
          method: "PATCH",
          body,
        });
      } else {
        res = await rbacFetch("/api/rbac/roles", {
          method: "POST",
          body: cloneFromRoleId ? { ...body, cloneFromRoleId } : body,
        });
      }
      if (res?.warnings?.length) {
        setEditor((s) => ({ ...s, busy: false, warnings: res.warnings }));
      } else {
        setEditor(null);
      }
      await load();
    } catch (e) {
      const extra =
        e?.code === "UNKNOWN_PERMISSIONS" && e?.payload?.unknown
          ? ` (${e.payload.unknown.join(", ")})`
          : "";
      setEditor((s) => ({ ...s, busy: false, err: e.message + extra }));
    }
  }

  async function openImpact(role) {
    setImpact({ role, busy: true, data: null });
    try {
      const data = await rbacFetch(`/api/rbac/roles/${roleId(role)}/impact`);
      setImpact({ role, busy: false, data });
    } catch (e) {
      setImpact({ role, busy: false, data: null, err: e.message });
    }
  }

  async function confirmDelete() {
    if (!impact?.role) return;
    setImpact((s) => ({ ...s, busy: true }));
    try {
      await rbacFetch(`/api/rbac/roles/${roleId(impact.role)}`, {
        method: "DELETE",
      });
      setImpact(null);
      await load();
    } catch (e) {
      setImpact((s) => ({ ...s, busy: false, err: e.message }));
    }
  }

  function toggleSeedPick(key) {
    setSeedPicked((s) => {
      const next = new Set(s);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function seedTemplates(roleKeys) {
    setSeeding(true);
    setSeedErr(null);
    try {
      const res = await rbacFetch("/api/rbac/bootstrap", {
        method: "POST",
        body: { roleKeys },
      });
      if (res?.nameCollisions?.length) {
        setSeedErr(
          res.nameCollisions
            .map((c) => `"${c.name}" skipped — a custom role with that exact name already exists.`)
            .join(" "),
        );
      }
      setSeedPicked(new Set());
      await load();
    } catch (e) {
      setSeedErr(e.message);
    } finally {
      setSeeding(false);
    }
  }

  async function restoreDefaults(role) {
    try {
      await rbacFetch(`/api/rbac/roles/${roleId(role)}/restore-defaults`, {
        method: "POST",
      });
      await load();
    } catch (e) {
      setError(e);
    }
  }

  if (loading)
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--r-fg-4)" }}>Loading roles…</div>
    );
  if (error)
    return (
      <div style={{ padding: 24, fontSize: 13, color: "var(--r-danger)" }}>
        Failed to load roles: {error.message}
      </div>
    );

  const rows = roles.map((r) => ({ ...r, _dtKey: roleId(r) }));

  const cols = [
    {
      key: "role",
      label: "Role",
      render: (r) => (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <span
            style={{
              marginTop: 5, width: 8, height: 8, borderRadius: 999, flexShrink: 0,
              background: r.color || "var(--r-fg-5)",
            }}
          />
          <div>
            <div style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{r.name}</div>
            {r.description ? (
              <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 1 }}>{r.description}</div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      key: "type",
      label: "Type",
      width: 96,
      render: (r) =>
        isSystem(r) ? (
          <Pill tone="warning" dot={false}>System</Pill>
        ) : (
          <Pill tone="neutral" dot={false}>Custom</Pill>
        ),
    },
    {
      key: "permissions",
      label: "Permissions",
      render: (r) => (
        <span style={{ color: "var(--r-fg-4)" }}>
          {(r.permissions || []).length} allowed
          {(r.denies || []).length ? ` · ${(r.denies || []).length} blocked` : ""}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      render: (r) => (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <PermissionButton
            permission="rbac.assignment.view"
            onClick={() => setAssigning(r)}
            as={Btn}
            size="sm"
            variant="secondary"
          >
            Assign
          </PermissionButton>
          <PermissionButton
            permission="rbac.role.create"
            onClick={() => openClone(r)}
            as={Btn}
            size="sm"
            variant="secondary"
          >
            Clone
          </PermissionButton>
          <PermissionButton
            permission="rbac.role.update"
            onClick={() => openEdit(r)}
            as={Btn}
            size="sm"
            variant="secondary"
          >
            Edit
          </PermissionButton>
          {isSystem(r) ? (
            <PermissionButton
              permission="rbac.role.restoreDefaults"
              onClick={() => restoreDefaults(r)}
              as={Btn}
              size="sm"
              variant="secondary"
              style={{ color: "var(--r-warning)", borderColor: "var(--r-warning)" }}
            >
              Restore defaults
            </PermissionButton>
          ) : (
            <PermissionButton
              permission="rbac.role.delete"
              onClick={() => openImpact(r)}
              as={Btn}
              size="sm"
              variant="danger"
            >
              Delete
            </PermissionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--r-fg-4)", margin: 0 }}>
          Create a role, choose what it can do, then use <strong>Assign</strong>{" "}
          to create logins or add people to it.
        </p>
        <PermissionButton permission="rbac.role.create" onClick={openCreate} as={Btn} variant="primary" icon="plus">
          New role
        </PermissionButton>
      </div>

      <DataTable
        cols={cols}
        rows={rows}
        rowKey="_dtKey"
        emptyIcon="shield"
        emptyTitle="No roles yet"
      />

      {missingTemplates.length > 0 ? (
        <Card style={{ marginTop: 16 }}>
          <CardHead
            title={roles.length === 0 ? "Seed starter roles" : "Add more starter roles"}
            sub={
              roles.length === 0
                ? "Pick the roles you actually need — you don't have to seed all of them at once. Each one is still fully editable afterward."
                : "These standard roles haven't been added to this society yet. Pick any you need — each one is still fully editable afterward."
            }
          />
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", marginBottom: 14 }}>
            {missingTemplates.map((t) => (
              <label
                key={t.key}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8, borderRadius: 8,
                  border: "1px solid var(--r-hairline)", padding: 8, fontSize: 13, cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  style={{ marginTop: 3 }}
                  checked={seedPicked.has(t.key)}
                  onChange={() => toggleSeedPick(t.key)}
                />
                <span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--r-fg-1)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: t.color, flexShrink: 0 }} />
                    {t.name}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--r-fg-4)" }}>{t.description}</span>
                </span>
              </label>
            ))}
          </div>
          {seedErr ? (
            <div style={{ marginBottom: 10, fontSize: 12, color: "var(--r-danger)" }}>{seedErr}</div>
          ) : null}
          <div style={{ display: "flex", gap: 8 }}>
            <Btn
              variant="primary"
              disabled={seeding || seedPicked.size === 0}
              onClick={() => seedTemplates([...seedPicked])}
            >
              {seeding ? "Seeding…" : `Seed selected (${seedPicked.size})`}
            </Btn>
            <Btn
              variant="secondary"
              disabled={seeding}
              onClick={() => seedTemplates(missingTemplates.map((t) => t.key))}
            >
              Seed all
            </Btn>
          </div>
        </Card>
      ) : null}

      {/* ── Admin role: explainer instead of a picker that would lie ───────── */}
      <Modal
        open={editor?.mode === "admin-locked"}
        onClose={() => setEditor(null)}
        title="Admin always has full access"
        width={440}
      >
        <p style={{ fontSize: 13.5, color: "var(--r-fg-2)", lineHeight: 1.6, margin: 0 }}>
          Admin is a superuser — it can do everything in the society, and that never
          depends on a per-page list. There is nothing to turn off here, which is why
          this role has no page-access picker like the others do.
        </p>
        <p style={{ fontSize: 13.5, color: "var(--r-fg-2)", lineHeight: 1.6, marginTop: 10 }}>
          To control who <em>has</em> the Admin role, use <strong>Assign</strong> on the
          roles list — grant it to someone there, or remove it from someone who
          shouldn't have it. That's the only lever for this role.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <Btn variant="primary" onClick={() => setEditor(null)}>Got it</Btn>
        </div>
      </Modal>

      {/* ── Create / edit / clone ───────────────────────────────────────────── */}
      <Modal
        open={!!editor && editor.mode !== "admin-locked"}
        onClose={() => setEditor(null)}
        title={
          editor?.mode === "edit" ? "Edit role" : editor?.mode === "clone" ? "Clone role" : "New role"
        }
        width={760}
      >
        {editor && editor.mode !== "admin-locked" ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr auto" }}>
              <Field label="Role name">
                <input
                  className="input"
                  value={editor.draft.name}
                  onChange={(e) =>
                    setEditor((s) => ({ ...s, draft: { ...s.draft, name: e.target.value } }))
                  }
                  placeholder="e.g. Front-desk staff"
                />
              </Field>
              <Field label="Colour">
                <input
                  type="color"
                  value={editor.draft.color}
                  onChange={(e) =>
                    setEditor((s) => ({ ...s, draft: { ...s.draft, color: e.target.value } }))
                  }
                  style={{ height: 38, width: 52, borderRadius: 8, border: "1px solid var(--r-border)", background: "none", cursor: "pointer" }}
                />
              </Field>
            </div>

            <Field label="Description" hint="(optional)">
              <textarea
                className="input"
                value={editor.draft.description}
                onChange={(e) =>
                  setEditor((s) => ({ ...s, draft: { ...s.draft, description: e.target.value } }))
                }
                rows={2}
                placeholder="What is this role for?"
              />
            </Field>

            <div>
              <span className="label">Which pages can this role open?</span>
              <PageAccessPicker
                value={editor.draft.pageAccess}
                onChange={(next) =>
                  setEditor((s) => ({ ...s, draft: { ...s.draft, pageAccess: next } }))
                }
              />
            </div>

            {editor.warnings?.length ? (
              <div
                style={{
                  borderRadius: 8, border: "1px solid var(--r-warning)", background: "var(--r-warning-soft)",
                  padding: 12, fontSize: 12.5, color: "var(--r-fg-1)",
                }}
              >
                <strong>Some permissions were trimmed:</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {editor.warnings.map((w, i) => (
                    <li key={i}>
                      {typeof w === "string" ? w : w.message || (w.refused ? w.refused.join(", ") : "trimmed")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {editor.err ? (
              <div
                style={{
                  borderRadius: 8, border: "1px solid var(--r-danger)", background: "var(--r-danger-soft)",
                  padding: 12, fontSize: 12.5, color: "var(--r-danger)",
                }}
              >
                {editor.err}
              </div>
            ) : null}

            {editor.review ? (
              <div style={{ borderTop: "1px solid var(--r-hairline)", paddingTop: 14 }}>
                <p style={{ marginBottom: 10, fontWeight: 600, color: "var(--r-fg-1)", fontSize: 13.5 }}>
                  Before you save
                </p>

                {editor.review.lost.length ? (
                  <div
                    style={{
                      marginBottom: 12, borderRadius: 8, border: "1px solid var(--r-warning)",
                      background: "var(--r-warning-soft)", padding: 12,
                    }}
                  >
                    <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "var(--r-fg-1)" }}>
                      {editor.review.holders === null
                        ? "Anyone holding this role"
                        : editor.review.holders === 1
                          ? "1 person holds this role and"
                          : `${editor.review.holders} people hold this role and`}{" "}
                      will be signed out and lose:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--r-fg-1)" }}>
                      {editor.review.lost.map((l) => (
                        <li key={l.label}>
                          {l.label} — {l.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {editor.review.dangerous.length ? (
                  <div
                    style={{
                      marginBottom: 4, borderRadius: 8, border: "1px solid var(--r-danger)",
                      background: "var(--r-danger-soft)", padding: 12,
                    }}
                  >
                    <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "var(--r-danger)" }}>
                      This role will be able to do things that cannot be undone:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--r-fg-1)" }}>
                      {editor.review.dangerous.map((d) => (
                        <li key={d.label}>
                          <strong>{d.label}</strong> — {d.actions.join(", ").toLowerCase()}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
                  <Btn variant="secondary" onClick={() => setEditor((s) => ({ ...s, review: null }))}>
                    Go back
                  </Btn>
                  <Btn variant="primary" disabled={editor.busy} onClick={commitSave}>
                    {editor.busy ? "Saving…" : "Save anyway"}
                  </Btn>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--r-hairline)", paddingTop: 14 }}>
                <Btn variant="secondary" onClick={() => setEditor(null)}>Cancel</Btn>
                <Btn
                  variant="primary"
                  disabled={editor.busy || !editor.draft.name.trim()}
                  onClick={saveEditor}
                >
                  {editor.busy ? "Saving…" : "Save role"}
                </Btn>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* ── Delete impact preview ──────────────────────────────────────────── */}
      <Modal
        open={!!impact}
        onClose={() => setImpact(null)}
        title={impact ? `Delete role "${impact.role.name}"?` : ""}
        width={440}
      >
        {impact ? (
          <>
            {impact.busy && !impact.data ? (
              <p style={{ fontSize: 13, color: "var(--r-fg-4)" }}>Loading impact…</p>
            ) : impact.err ? (
              <p style={{ fontSize: 13, color: "var(--r-danger)" }}>{impact.err}</p>
            ) : (
              <div style={{ marginBottom: 14, fontSize: 13, color: "var(--r-fg-2)", lineHeight: 1.6 }}>
                <p style={{ margin: 0 }}>This will remove the role from everyone who has it.</p>
                <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
                  <li>
                    Affected assignments:{" "}
                    <strong>{impact.data?.assignments ?? impact.data?.assignmentCount ?? 0}</strong>
                  </li>
                  <li>
                    Affected users: <strong>{impact.data?.users ?? impact.data?.userCount ?? 0}</strong>
                  </li>
                </ul>
                <p style={{ margin: 0, fontSize: 12, color: "var(--r-warning)" }}>
                  People losing access will be signed out and asked to log in again.
                </p>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Btn variant="secondary" onClick={() => setImpact(null)}>Cancel</Btn>
              <Btn variant="dangerSolid" disabled={impact.busy} onClick={confirmDelete}>
                {impact.busy ? "Deleting…" : "Delete role"}
              </Btn>
            </div>
          </>
        ) : null}
      </Modal>

      {/* ── Manage access (create login / assign) ──────────────────────────── */}
      {assigning ? (
        <AssignmentManager
          role={assigning}
          onClose={() => setAssigning(null)}
          onChanged={() => load()}
        />
      ) : null}
    </div>
  );
}

export default RoleManager;
