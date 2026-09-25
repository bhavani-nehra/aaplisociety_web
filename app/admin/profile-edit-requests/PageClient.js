"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PageHeader, Card, Btn, Pill, Icon, Tabs, SearchInput, RevampSkeleton, EmptyState, Modal, Toast, SmallStat,
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

const SECTION_LABELS = {
  Contact: "Contact",
  FamilyMember: "Family member",
  EmergencyContact: "Emergency contact",
  Parking: "Parking",
};
const STATUS_TONE = { Pending: "warning", Approved: "paid", Rejected: "unpaid" };
const TABS = ["Pending", "Approved", "Rejected", "All"];
const DASH = "—";

function fmtTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// Business logic — unchanged from the pre-revamp page. Sections not covered
// here (TenantContact, OwnershipInfo, TenantInfo — added to the backend
// later than this page's display logic) fall through to the family-member
// shape below, same as before this rewrite; not something this pass adds.
function describePayload(item) {
  const { section, action, payload = {} } = item;
  if (section === "Contact") {
    return Object.entries(payload).map(([k, v]) => `${k}: ${v}`).join(" / ") || DASH;
  }
  if (section === "EmergencyContact") {
    return `${payload.name || DASH} (${payload.relation || DASH}) / ${payload.phoneNumber || DASH}${payload.address ? ` / ${payload.address}` : ""}`;
  }
  if (section === "Parking") {
    if (action === "Remove") return `Remove parking slot ${payload.slotNumber || payload.slotId || ""}`.trim();
    return [payload.slotNumber && `Slot ${payload.slotNumber}`, payload.type, payload.vehicleType].filter(Boolean).join(" / ") || DASH;
  }
  if (action === "Remove") return "Remove this family member";
  return `${payload.name || DASH} / ${payload.relation || DASH}${payload.age ? ` / ${payload.age} yrs` : ""}`;
}

const S = {
  statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 18 },
  filterRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  name: { fontSize: 14.5, fontWeight: 700, color: "var(--r-fg-1)" },
  meta: { fontSize: 12, color: "var(--r-fg-4)", marginTop: 3 },
  body: { fontSize: 13, color: "var(--r-fg-2)", lineHeight: 1.5 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 },
  center: { display: "flex", justifyContent: "center", padding: 48 },
  pre: {
    background: "var(--r-surface-2)", border: "1px solid var(--r-hairline)", borderRadius: 8,
    padding: 12, fontSize: 12, color: "var(--r-fg-2)", whiteSpace: "pre-wrap", wordBreak: "break-word",
  },
};

export default function ProfileChangesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [tab, setTab] = useState("Pending");
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState("");

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Pull every status so the tabs filter client-side and counters stay honest.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/api/admin/profile-edit-requests?status=all");
      setItems(data.items || []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    Pending: items.filter((i) => i.status === "Pending").length,
    Approved: items.filter((i) => i.status === "Approved").length,
    Rejected: items.filter((i) => i.status === "Rejected").length,
  }), [items]);

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((i) => (tab === "All" ? true : i.status === tab))
      .filter((i) => {
        if (!term) return true;
        return [i.member && i.member.ownerName, i.member && i.member.flatNo, i.member && i.member.wing, i.section, i.action]
          .filter(Boolean).join(" ").toLowerCase().includes(term);
      });
  }, [items, tab, q]);

  async function approve(id) {
    setBusyId(id);
    try {
      await api(`/api/admin/profile-edit-requests/${id}/approve`, { method: "POST" });
      showToast("Change approved");
      setDetail(null); load();
    } catch (err) { showToast(err.message, "error"); }
    finally { setBusyId(null); }
  }

  async function reject(id) {
    const reason = await notify.prompt("Reason for rejection (shown to the owner):", "");
    if (reason === null) return;
    setBusyId(id);
    try {
      await api(`/api/admin/profile-edit-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
      showToast("Request rejected");
      setDetail(null); load();
    } catch (err) { showToast(err.message, "error"); }
    finally { setBusyId(null); }
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="users" size={11} /> People · Profile Changes</>}
        title="Profile Edit Requests"
        sub="Contact, family, emergency contact and parking changes submitted from the mobile app."
        right={<Btn variant="ghost" icon="refresh-cw" onClick={load}>Refresh</Btn>}
      />

      <div style={S.statGrid}>
        <SmallStat icon="clock" label="Pending" value={counts.Pending} />
        <SmallStat icon="check-circle" label="Approved" value={counts.Approved} tone="success" />
        <SmallStat icon="x-circle" label="Rejected" value={counts.Rejected} tone="danger" />
      </div>

      <div style={S.filterRow}>
        <Tabs
          value={tab}
          onChange={setTab}
          style={{ marginBottom: 0, flex: 1, minWidth: 220 }}
          tabs={TABS.map((t) => ({ key: t, label: t, badge: t !== "All" ? (counts[t] || 0) : undefined }))}
        />
        <SearchInput value={q} onChange={setQ} placeholder="Search flat or owner…" style={{ maxWidth: 240 }} />
      </div>

      {loading ? (
        <div style={{ display: "grid", gap: 12 }}>
          {[1, 2, 3].map((i) => <RevampSkeleton key={i} h={120} />)}
        </div>
      ) : visible.length === 0 ? (
        <Card><EmptyState icon="inbox" title="Nothing here" sub="No requests match this filter." /></Card>
      ) : (
        <div style={S.cardGrid}>
          {visible.map((item) => (
            <Card key={item._id} hover>
              <div style={S.head}>
                <div>
                  <div style={S.name}>
                    {(item.member && item.member.ownerName) || DASH} / {(item.member && item.member.flatNo) || DASH}
                    {item.member && item.member.wing ? ` (${item.member.wing})` : ""}
                  </div>
                  <div style={S.meta}>
                    {SECTION_LABELS[item.section] || item.section} · {item.action}
                    {item.createdAt ? ` · ${fmtTime(item.createdAt)}` : ""}
                  </div>
                </div>
                <Pill tone={STATUS_TONE[item.status] || "neutral"}>{item.status}</Pill>
              </div>

              <div style={S.body}>{describePayload(item)}</div>

              <div style={S.actions}>
                <Btn size="sm" variant="ghost" onClick={() => setDetail(item)}>Show details</Btn>
                {item.status === "Pending" && (
                  <>
                    <Btn size="sm" variant="primary" icon="check" disabled={busyId === item._id} onClick={() => approve(item._id)}>Approve</Btn>
                    <Btn size="sm" variant="danger" icon="x" disabled={busyId === item._id} onClick={() => reject(item._id)}>Reject</Btn>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(detail)}
        title={detail ? `${SECTION_LABELS[detail.section] || detail.section} · ${detail.action}` : ""}
        sub={detail ? `${(detail.member && detail.member.ownerName) || DASH} — flat ${(detail.member && detail.member.flatNo) || DASH}${detail.createdAt ? ` — submitted ${fmtTime(detail.createdAt)}` : ""}` : ""}
        onClose={() => setDetail(null)}
        width={560}
      >
        {detail && (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={S.body}>{describePayload(detail)}</div>

            {detail.rejectionReason && (
              <div style={{
                fontSize: 12.5, lineHeight: 1.5, padding: "10px 12px", borderRadius: 8,
                background: "var(--r-danger-soft)", color: "var(--r-fg-2)",
              }}>
                <strong style={{ color: "var(--r-danger)" }}>Rejection reason:</strong> {detail.rejectionReason}
              </div>
            )}

            <div style={S.pre}>{JSON.stringify(detail.payload || {}, null, 2)}</div>

            {detail.status === "Pending" && (
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="primary" icon="check" disabled={busyId === detail._id} onClick={() => approve(detail._id)}>Approve</Btn>
                <Btn variant="danger" icon="x" disabled={busyId === detail._id} onClick={() => reject(detail._id)}>Reject</Btn>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
