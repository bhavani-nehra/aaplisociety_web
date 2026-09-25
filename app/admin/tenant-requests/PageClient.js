"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PageHeader, Card, Btn, Pill, Icon, Tabs, SearchInput,
  SectionLabel, EmptyState, RevampSkeleton, Modal, Toast, SmallStat,
} from "@/components/revamp";
import notify from "@/lib/notify";

async function api(url, opts) {
  const res = await fetch(url, {
    credentials: "include",
    headers: opts && opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Request failed");
  return data;
}

const DOCUMENT_FIELDS = [
  { field: "contract", label: "Lease contract" },
  { field: "policeVerification", label: "Police verification" },
];
const TABS = ["Requests", "Active", "Inactive", "All"];
const STATE_TONE = { Active: "paid", Requests: "warning", Inactive: "neutral" };
const DASH = "—";

function d(v) {
  if (!v) return DASH;
  const p = new Date(v);
  return Number.isNaN(p.getTime()) ? DASH : p.toLocaleDateString("en-IN");
}
function when(v) {
  if (!v) return DASH;
  const p = new Date(v);
  return Number.isNaN(p.getTime()) ? DASH : p.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function DL({ rows }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "6px 12px", fontSize: 13 }}>
      {rows.map(([label, value]) => [
        <div key={`${label}-k`} style={{ color: "var(--r-fg-4)" }}>{label}</div>,
        <div key={`${label}-v`} style={{ color: "var(--r-fg-1)", fontWeight: 600 }}>{value}</div>,
      ])}
    </div>
  );
}

export default function ManageTenantsPage() {
  const [flats, setFlats] = useState([]);
  const [summary, setSummary] = useState({ active: 0, requests: 0, inactive: 0 });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState("Requests");
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState("");

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/api/admin/tenants");
      setFlats(data.flats || []);
      setSummary(data.summary || { active: 0, requests: 0, inactive: 0 });
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return flats
      .filter((f) => (tab === "All" ? true : f.state === tab))
      .filter((f) => {
        if (!term) return true;
        return [f.flatNo, f.wing, f.ownerName, f.currentTenant && f.currentTenant.name,
          ...(f.pendingRequests || []).map((r) => r.tenantName)]
          .filter(Boolean).join(" ").toLowerCase().includes(term);
      });
  }, [flats, tab, q]);

  async function viewDocument(requestId, field) {
    try {
      const data = await api(`/api/admin/tenant-requests/${requestId}/documents/${field}`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) { showToast(err.message, "error"); }
  }

  async function approve(id) {
    setBusyId(id);
    try {
      const data = await api(`/api/admin/tenant-requests/${id}/approve`, { method: "POST" });
      showToast(`Approved. Username: ${data.username}${data.emailDelivered ? "" : " (email not sent - check email provider config)"}`);
      setDetail(null); load();
    } catch (err) { showToast(err.message, "error"); }
    finally { setBusyId(null); }
  }

  async function reject(id) {
    const reason = await notify.prompt("Reason for rejection (shown to the owner):", "");
    if (reason === null) return;
    setBusyId(id);
    try {
      await api(`/api/admin/tenant-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      showToast("Request rejected");
      setDetail(null); load();
    } catch (err) { showToast(err.message, "error"); }
    finally { setBusyId(null); }
  }

  // Admin half of the two-party move-out. The owner ends the lease from the
  // app; this closes the tenancy and disables the tenant login.
  async function confirmMoveOut(id) {
    if (!(await notify.confirm("Close this tenancy and disable the tenant login?", { tone: "warning" }))) return;
    setBusyId(id);
    try {
      await api(`/api/admin/tenant-requests/${id}/confirm-move-out`, { method: "POST" });
      showToast("Tenancy closed");
      setDetail(null); load();
    } catch (err) { showToast(err.message, "error"); }
    finally { setBusyId(null); }
  }

  const tabBadge = (t) => {
    if (t === "Requests") return summary.requests || undefined;
    if (t === "Active") return summary.active || undefined;
    if (t === "Inactive") return summary.inactive || undefined;
    return flats.length || undefined;
  };

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="home" size={11} /> People · Tenants</>}
        title="Manage Tenants"
        sub="Flat-wise view of every tenancy: live tenants, pending onboarding requests, and past tenants."
        right={<Btn variant="ghost" icon="refresh-cw" onClick={load}>Refresh</Btn>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 18 }}>
        <SmallStat icon="check-circle-2" label="Active tenancies" value={summary.active} tone="success" />
        <SmallStat icon="clock" label="Awaiting approval" value={summary.requests} tone={summary.requests > 0 ? "danger" : undefined} />
        <SmallStat icon="home" label="Flats without a tenant" value={summary.inactive} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={TABS.map((t) => ({ key: t, label: t, badge: tabBadge(t) }))}
      />

      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="label" style={{ marginBottom: 4 }}>Search</div>
            <SearchInput value={q} onChange={setQ} placeholder="Search flat, owner or tenant..." size="md" />
          </div>
        </div>
      </Card>

      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {[1, 2, 3].map((i) => <RevampSkeleton key={i} h={160} />)}
        </div>
      ) : visible.length === 0 ? (
        <Card><EmptyState icon="home" title="Nothing here" sub="No flats match this filter." /></Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {visible.map((f) => {
            const live = f.currentTenant;
            const pending = f.pendingRequests || [];
            return (
              <Card key={f.memberId} hover style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "var(--r-fg-1)" }}>
                      {f.wing ? `${f.wing}-` : ""}{f.flatNo || DASH}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginTop: 3 }}>
                      Owner: {f.ownerName || DASH}{f.ownershipType ? ` / ${f.ownershipType}` : ""}
                    </div>
                  </div>
                  <Pill tone={STATE_TONE[f.state]}>{f.state}</Pill>
                </div>

                {live ? (
                  <div>
                    <div style={{ fontSize: 13, color: "var(--r-fg-1)", fontWeight: 600 }}>{live.name || "Tenant"}</div>
                    <div style={{ fontSize: 12.5, color: "var(--r-fg-4)", marginTop: 3, lineHeight: 1.5 }}>
                      {live.contactNumber || live.phoneNumber || live.phone || DASH}
                      {live.rentPerMonth ? ` / Rs ${live.rentPerMonth}/mo` : ""}
                      <br />
                      Lease {d(live.leaseStartDate)} to {d(live.leaseEndDate)}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>No live tenancy on this flat.</div>
                )}

                {pending.length > 0 && (
                  <Pill tone="warning">
                    {pending.length} request{pending.length > 1 ? "s" : ""} awaiting approval
                  </Pill>
                )}
                {f.counts.past > 0 && (
                  <div style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>{f.counts.past} past tenant(s) on record</div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <Btn size="sm" variant="ghost" icon="eye" onClick={() => setDetail({ flat: f, request: null })}>Show details</Btn>
                  {pending.map((r) => (
                    <Btn key={r._id} size="sm" variant="primary" icon="file-text" onClick={() => setDetail({ flat: f, request: r })}>
                      Review {r.tenantName || "request"}
                    </Btn>
                  ))}
                  {live && f.activeRequest && (
                    <Btn size="sm" variant="ghost" icon="log-out" disabled={busyId === f.activeRequest._id}
                      onClick={() => confirmMoveOut(f.activeRequest._id)}>Close tenancy</Btn>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(detail)}
        title={detail ? `${detail.flat.wing ? `${detail.flat.wing}-` : ""}${detail.flat.flatNo || ""} tenancy` : ""}
        onClose={() => setDetail(null)}
        width={620}
      >
        {detail && (
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <SectionLabel>Flat</SectionLabel>
              <DL rows={[
                ["Owner", detail.flat.ownerName || DASH],
                ["Ownership", detail.flat.ownershipType || DASH],
              ]} />
            </div>

            {detail.flat.currentTenant && (
              <div>
                <SectionLabel>Current tenant</SectionLabel>
                <DL rows={[
                  ["Name", detail.flat.currentTenant.name || DASH],
                  ["Phone", detail.flat.currentTenant.contactNumber || detail.flat.currentTenant.phoneNumber || detail.flat.currentTenant.phone || DASH],
                  ["Email", detail.flat.currentTenant.email || DASH],
                  ["Rent", detail.flat.currentTenant.rentAmount ? `Rs ${detail.flat.currentTenant.rentAmount}/mo` : DASH],
                  ["Deposit", detail.flat.currentTenant.depositAmount ? `Rs ${detail.flat.currentTenant.depositAmount}` : DASH],
                  ["Lease", `${d(detail.flat.currentTenant.leaseStartDate)} to ${d(detail.flat.currentTenant.leaseEndDate)}`],
                ]} />
              </div>
            )}

            {detail.request && (
              <div>
                <SectionLabel>Request under review</SectionLabel>
                <DL rows={[
                  ["Tenant", detail.request.tenantName || DASH],
                  ["Phone", detail.request.tenantPhone || DASH],
                  ["Email", detail.request.tenantEmail || DASH],
                  ["Rent", detail.request.rentPerMonth ? `Rs ${detail.request.rentPerMonth}/mo` : DASH],
                  ["Lease", `${d(detail.request.leaseStartDate)} to ${d(detail.request.leaseEndDate)}`],
                  ["Submitted", detail.request.createdAt ? when(detail.request.createdAt) : DASH],
                ]} />

                {detail.request.pendingLeaseChange && detail.request.pendingLeaseChange.status === "Pending" && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "var(--r-warning-soft)", color: "var(--r-warning)", fontSize: 12.5, fontWeight: 600 }}>
                    Owner proposed new lease dates: {d(detail.request.pendingLeaseChange.leaseStartDate)} to {d(detail.request.pendingLeaseChange.leaseEndDate)}
                  </div>
                )}

                <div style={{ marginTop: 14 }}>
                  <SectionLabel>Documents</SectionLabel>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {DOCUMENT_FIELDS.map(({ field, label }) => (
                      <Btn key={field} variant="secondary" size="sm" icon="file-text" onClick={() => viewDocument(detail.request._id, field)}>
                        View {label}
                      </Btn>
                    ))}
                  </div>
                </div>

                {(detail.request.notes || []).length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <SectionLabel>Owner notes</SectionLabel>
                    <div style={{ display: "grid", gap: 5 }}>
                      {detail.request.notes.map((n, i) => (
                        <div key={i} style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>
                          {n.text} - {n.by || "Owner"}{n.at ? `, ${when(n.at)}` : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {detail.request.status === "Pending" && (
                  <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                    <Btn variant="primary" icon="check" disabled={busyId === detail.request._id} onClick={() => approve(detail.request._id)}>
                      Approve and create login
                    </Btn>
                    <Btn variant="danger" icon="x" disabled={busyId === detail.request._id} onClick={() => reject(detail.request._id)}>
                      Reject
                    </Btn>
                  </div>
                )}
              </div>
            )}

            {(detail.flat.pastTenants || []).length > 0 && (
              <div>
                <SectionLabel>Past tenants</SectionLabel>
                <div style={{ display: "grid", gap: 6 }}>
                  {detail.flat.pastTenants.map((p, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>
                      {p.name || DASH} / {d(p.leaseStartDate)} to {d(p.leaseEndDate)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
