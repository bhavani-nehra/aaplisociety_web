"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import {
  PageHeader, Card, Btn, Icon, Pill, Avatar, SectionLabel, RevampSkeleton,
  EmptyState, Toast,
} from "@/components/revamp";
import {
  RequestFamilyMember,
  RequestRemoveFamilyMember,
  RequestParkingSlot,
  RequestRemoveParkingSlot,
} from "./_ChangeRequests";

const statusTone = (s) =>
  s === "Active" ? "active" : s === "Inactive" ? "expired" : s === "Suspended" ? "suspended" : "neutral";

/** One label/value line. Renders nothing when there is no value, same as
 * the plain-JS `value ? (...) : null` this replaces. */
function InfoRow({ label, value, highlight }) {
  if (!value) return null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "10px 0",
        borderBottom: "1px solid var(--r-hairline)",
        fontSize: 13,
      }}
    >
      <span style={{ color: "var(--r-fg-4)" }}>{label}</span>
      <span
        style={{
          fontWeight: highlight ? 700 : 600,
          color: highlight ? "var(--r-brand)" : "var(--r-fg-1)",
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** One profile section — a Card with an icon+label header, same grouping
 * as the page had before (Flat Details, Contact Information, ...). */
function Section({ icon, title, children }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <SectionLabel icon={icon}>{title}</SectionLabel>
      {children}
    </Card>
  );
}

export default function MemberProfilePage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [banner, setBanner] = useState(null); // { tone: "ok" | "error", text }
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => apiClient.get("/api/member/profile"),
    // NOTE: useQuery's `onSuccess` was removed in react-query v5, so seeding
    // the form here silently never ran and `form` stayed {}. The form is now
    // seeded when the person presses Edit, from the data already on screen.
  });
  // What is already pending, so the family/parking request widgets never let
  // someone ask for the same change twice.
  const editRequestsQuery = useQuery({
    queryKey: ["my-profile-edit-requests"],
    queryFn: () => apiClient.get("/api/member/profile-edit-requests"),
  });
  const pendingRequests = editRequestsQuery.data?.requests ?? [];
  const refetchRequests = () =>
    queryClient.invalidateQueries({ queryKey: ["my-profile-edit-requests"] });
  const saveMutation = useMutation({
    mutationFn: (updates) => apiClient.put("/api/member/profile", updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      setEditing(false);
      setBanner({ tone: "ok", text: "Your contact details have been updated." });
    },
    // The server's own words, in the page — not a browser alert() the person
    // has to dismiss before they can see which field was wrong.
    onError: (e) =>
      setBanner({
        tone: "error",
        text: e?.message || "Those details could not be saved. Please try again.",
      }),
  });

  const startEditing = () => {
    setForm({
      whatsappNumber: data?.member?.whatsappNumber || "",
      alternateContact: data?.member?.alternateContact || "",
      emailSecondary: data?.member?.emailSecondary || "",
    });
    setBanner(null);
    setEditing(true);
  };

  if (isLoading)
    return (
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <RevampSkeleton h={64} style={{ marginBottom: 16 }} />
        <RevampSkeleton h={140} style={{ marginBottom: 16 }} />
        <RevampSkeleton h={220} style={{ marginBottom: 16 }} />
        <RevampSkeleton h={180} />
      </div>
    );

  const member = data?.member;
  const society = data?.society;
  // A tenant viewing this page must see THEIR OWN identity/contact, not the
  // flat owner's — member is the shared flat record, and the tenant's own
  // details live in member.currentTenant.
  const isTenantViewer = data?.viewerOccupancyType === "Tenant";
  const tenantSelf = isTenantViewer ? member?.currentTenant : null;
  const displayName = tenantSelf?.name || member?.ownerName;
  const displayContact = tenantSelf?.contactNumber || member?.contactNumber;
  const displayEmail = tenantSelf?.email || member?.emailPrimary;

  if (!member)
    return (
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <EmptyState
          icon={loadError ? "alert-circle" : "user-x"}
          title={loadError ? "Your profile could not be loaded" : "Your profile is not set up yet"}
          sub={
            loadError
              ? // The real reason, so "my profile is blank" is answerable.
                `Your profile could not be loaded: ${loadError.message}`
              : "Your profile has not been set up yet. Please contact your society office."
          }
        />
      </div>
    );

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <PageHeader
        eyebrow={<><Icon name="user" size={11} /> My Profile</>}
        title="My Profile"
        sub={`${society?.name || ""} — Member Information`}
        right={
          editing ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Btn
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setBanner(null);
                }}
                disabled={saveMutation.isPending}
              >
                Cancel
              </Btn>
              <Btn
                variant="primary"
                icon={saveMutation.isPending ? undefined : "save"}
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save changes"}
              </Btn>
            </div>
          ) : (
            <Btn variant="secondary" icon="pencil" onClick={startEditing}>
              Edit contact info
            </Btn>
          )
        }
      />

      {banner?.tone === "error" && (
        <Card style={{ marginBottom: 16, borderColor: "var(--r-danger)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <Icon name="alert-circle" size={16} color="var(--r-danger)" />
            <div role="alert" style={{ fontSize: 13, color: "var(--r-fg-2)", lineHeight: 1.55 }}>
              {banner.text}
            </div>
          </div>
        </Card>
      )}

      {/* Identity Card */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar name={displayName} size={48} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--r-fg-1)" }}>{displayName}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "var(--r-fg-4)" }}>{member.membershipNumber}</span>
                <Pill tone={statusTone(member.membershipStatus)}>{member.membershipStatus}</Pill>
              </div>
              <div style={{ fontSize: 12, color: "var(--r-fg-4)", marginTop: 4 }}>{society?.name}</div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="revamp-num" style={{ fontSize: 28, fontWeight: 700, color: "var(--r-brand)", letterSpacing: "-0.02em" }}>
              {member.wing}-{member.flatNo}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--r-fg-3)", marginTop: 2 }}>
              {member.flatType} • {member.carpetAreaSqft} sq ft
            </div>
            <div style={{ marginTop: 6, display: "flex", justifyContent: "flex-end" }}>
              <Pill tone="neutral" dot={false}>{member.ownershipType}</Pill>
            </div>
          </div>
        </div>
      </Card>

      {/* Basic Info */}
      <Section icon="home" title="Flat Details">
        <InfoRow label="Flat No." value={`${member.wing}-${member.flatNo}`} highlight />
        <InfoRow
          label="Floor"
          value={member.floor !== undefined ? `Floor ${member.floor}` : null}
        />
        <InfoRow label="Flat Type" value={member.flatType} />
        <InfoRow label="Ownership Type" value={member.ownershipType} />
        <InfoRow
          label="Carpet Area"
          value={member.carpetAreaSqft ? `${member.carpetAreaSqft} sq ft` : null}
        />
        {member.builtUpAreaSqft && (
          <InfoRow label="Built-up Area" value={`${member.builtUpAreaSqft} sq ft`} />
        )}
        {member.possessionDate && (
          <InfoRow
            label="Possession Date"
            value={new Date(member.possessionDate).toLocaleDateString("en-IN")}
          />
        )}
        <InfoRow label="Membership No." value={member.membershipNumber} />
        <InfoRow label="Status" value={member.membershipStatus} />
        <InfoRow label="Voting Rights" value={member.hasVotingRights ? "Yes" : "No"} />
      </Section>

      {/* Contact Info */}
      <Section icon="phone" title="Contact Information">
        <InfoRow label="Primary Contact" value={displayContact} />
        <InfoRow label="Primary Email" value={displayEmail} />
        {editing ? (
          <>
            <div style={{ padding: "10px 0" }}>
              <label className="label">WhatsApp Number</label>
              <input
                className="input"
                value={form.whatsappNumber}
                onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
                placeholder="WhatsApp number"
              />
            </div>
            <div style={{ padding: "10px 0" }}>
              <label className="label">Alternate Contact</label>
              <input
                className="input"
                value={form.alternateContact}
                onChange={(e) => setForm({ ...form, alternateContact: e.target.value })}
                placeholder="Alternate phone"
              />
            </div>
            <div style={{ padding: "10px 0" }}>
              <label className="label">Secondary Email</label>
              <input
                className="input"
                value={form.emailSecondary}
                onChange={(e) => setForm({ ...form, emailSecondary: e.target.value })}
                placeholder="Secondary email"
              />
            </div>
          </>
        ) : (
          <>
            <InfoRow label="WhatsApp" value={member.whatsappNumber} />
            <InfoRow label="Alternate Contact" value={member.alternateContact} />
            <InfoRow label="Secondary Email" value={member.emailSecondary} />
          </>
        )}
      </Section>

      {/* Identity Documents — show only if data exists */}
      {(member.panCard || member.aadhaar) && (
        <Section icon="credit-card" title="Identity Documents">
          {member.panCard && <InfoRow label="PAN Card" value={member.panCard} />}
          {member.aadhaar && (
            <InfoRow label="Aadhaar" value={`XXXX XXXX ${member.aadhaar.slice(-4)}`} />
          )}
        </Section>
      )}

      {/* Parking Slots — a wrong slot changes a bill, so add/remove goes
          through admin approval rather than a direct edit here. Always
          rendered (with a real empty state) rather than vanishing when
          the flat has none, per "serve everything" — a resident with no
          slots still needs to see how to request one. */}
      <Section icon="car" title="Parking Slots">
        {(member.parkingSlots?.length ?? 0) === 0 && (
          <div style={{ padding: "10px 0", fontSize: 13, color: "var(--r-fg-4)" }}>
            No parking slots recorded for this flat yet.
          </div>
        )}
        {(member.parkingSlots || []).map((slot, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              padding: "10px 0",
              borderBottom: "1px solid var(--r-hairline)",
              fontSize: 13,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--r-fg-1)", minWidth: 100 }}>
              {slot.slotNumber}
            </span>
            <Pill tone="info" dot={false}>{slot.type}</Pill>
            <Pill tone="neutral" dot={false}>{slot.vehicleType}</Pill>
            <span style={{ marginLeft: "auto" }}>
              <RequestRemoveParkingSlot
                slotNumber={slot.slotNumber}
                requests={pendingRequests}
                onSent={refetchRequests}
              />
            </span>
          </div>
        ))}
        <RequestParkingSlot requests={pendingRequests} onSent={refetchRequests} />
      </Section>

      {/* Family Members — same reasoning as Parking: always rendered with a
          real empty state, add/remove goes through admin approval. */}
      <Section icon="users" title="Family Members">
        {(member.familyMembers?.length ?? 0) === 0 && (
          <div style={{ padding: "10px 0", fontSize: 13, color: "var(--r-fg-4)" }}>
            No family members recorded for this flat yet.
          </div>
        )}
        {(member.familyMembers || []).map((fm, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 0",
              borderBottom: "1px solid var(--r-hairline)",
              fontSize: 13,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div>
              <span style={{ fontWeight: 600, color: "var(--r-fg-1)" }}>{fm.name}</span>
              {fm.relation && (
                <span style={{ color: "var(--r-fg-4)", marginLeft: 8, fontSize: 12.5 }}>
                  ({fm.relation})
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 12.5, color: "var(--r-fg-4)", alignItems: "center", flexWrap: "wrap" }}>
              {fm.age && <span>Age: {fm.age}</span>}
              {fm.occupation && <span>{fm.occupation}</span>}
              {fm.contactNumber && <span>{fm.contactNumber}</span>}
              <RequestRemoveFamilyMember
                familyMemberId={fm._id}
                requests={pendingRequests}
                onSent={refetchRequests}
              />
            </div>
          </div>
        ))}
        <RequestFamilyMember requests={pendingRequests} onSent={refetchRequests} />
      </Section>

      {/* Current Tenant */}
      {member.ownershipType === "Rented" && member.currentTenant && (
        <Section icon="key" title="Current Tenant">
          <InfoRow label="Tenant Name" value={member.currentTenant.name} />
          <InfoRow label="Contact" value={member.currentTenant.contactNumber} />
          <InfoRow
            label="Start Date"
            value={
              member.currentTenant.startDate
                ? new Date(member.currentTenant.startDate).toLocaleDateString("en-IN")
                : null
            }
          />
          <InfoRow
            label="Rent/Month"
            value={
              member.currentTenant.rentPerMonth
                ? `₹${member.currentTenant.rentPerMonth.toLocaleString("en-IN")}`
                : null
            }
          />
          <InfoRow
            label="Deposit"
            value={
              member.currentTenant.depositAmount
                ? `₹${member.currentTenant.depositAmount.toLocaleString("en-IN")}`
                : null
            }
          />
        </Section>
      )}

      {/* Emergency Contact */}
      {member.emergencyContact?.name && (
        <Section icon="life-buoy" title="Emergency Contact">
          <InfoRow label="Name" value={member.emergencyContact.name} />
          <InfoRow label="Relation" value={member.emergencyContact.relation} />
          <InfoRow label="Phone" value={member.emergencyContact.phoneNumber} />
        </Section>
      )}

      {/* Society Info */}
      <Section icon="building-2" title="Society Information">
        <InfoRow label="Society Name" value={society?.name} />
        <InfoRow label="Address" value={society?.address} />
        <InfoRow
          label="Maintenance Rate"
          value={society?.config?.maintenanceRate ? `₹${society.config.maintenanceRate}/sq.ft` : null}
        />
        <InfoRow
          label="Interest Rate"
          value={society?.config?.interestRate ? `${society.config.interestRate}% p.a.` : null}
        />
        <InfoRow
          label="Grace Period"
          value={society?.config?.gracePeriodDays ? `${society.config.gracePeriodDays} days` : null}
        />
        <InfoRow
          label="Bill Due Day"
          value={society?.config?.billDueDay ? `${society.config.billDueDay}th of every month` : null}
        />
      </Section>

      <Toast
        toast={banner?.tone === "ok" ? { message: banner.text, type: "success" } : null}
        onClose={() => setBanner(null)}
      />
    </div>
  );
}
