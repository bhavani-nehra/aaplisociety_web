'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import styles from '@/styles/ViewMembers.module.css';
import MemberEditor from './_MemberEditor';
import { PageHeader, SmallStat, Segmented, SearchInput, Select, Card, Avatar, Pill, Icon, EmptyState, RevampSkeleton } from '@/components/revamp';

/** The period a parking change should re-bill: the current calendar month. */
function currentBillPeriodId() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
export default function ViewMembersPage() {
  const qc = useQueryClient();
  const billPeriodId = currentBillPeriodId();
  const [selectedMember, setSelectedMember] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterOwnership, setFilterOwnership] = useState('all');
  const { data, isLoading } = useQuery({
    queryKey: ['members-detailed'],
    queryFn: async () => {
      const response = await fetch('/api/members/list?limit=1000', {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch');
      return response.json();
    }
  });
  const members = data?.members || [];

  // A section saved: fold the server's own copy of what changed into the open
  // drawer so it reflects the truth immediately, and refetch the list behind it
  // so the cards match too. No optimistic guessing — every value here came back
  // from the server.
  const applyPatch = (patch) => {
    if (patch && typeof patch === 'object') {
      setSelectedMember((m) => (m ? { ...m, ...patch } : m));
    }
    qc.invalidateQueries({ queryKey: ['members-detailed'] });
  };
  // Filter members
  const filteredMembers = members.filter(member => {
    const matchesSearch = 
      member.flatNo?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.wing?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.ownerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.contactNumber?.includes(searchTerm) ||
      member.emailPrimary?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || member.membershipStatus === filterStatus;
    const matchesOwnership = filterOwnership === 'all' || member.ownershipType === filterOwnership;
    return matchesSearch && matchesStatus && matchesOwnership;
  });
  // ── Wing filter + the counts behind the stat strip ──────────────────
  // Declared here (still unconditionally, above every early return) so the
  // revamped filter row has a wing segmented control like the design kit's
  // Members screen, layered on top of the existing search/status/ownership
  // filtering above.
  const [filterWing, setFilterWing] = useState('all');
  const wings = [...new Set(members.map((m) => String(m.wing || '').trim()).filter(Boolean))].sort();
  const visibleMembers = filteredMembers.filter(
    (m) => filterWing === 'all' || String(m.wing || '').trim() === filterWing,
  );
  const countBy = (fn) => members.filter(fn).length;
  const ownerCount = countBy((m) => m.ownershipType === 'Owner-Occupied');
  const rentedCount = countBy((m) => m.ownershipType === 'Rented');
  const activeCount = countBy((m) => m.membershipStatus === 'Active');

  const statusTone = (s) =>
    s === 'Active' ? 'active' : s === 'Inactive' ? 'expired' : s === 'Suspended' ? 'partial' : 'unpaid';

  if (isLoading) {
    return (
      <div className={styles.container}>
        <PageHeader title="Members" sub="Loading the member directory…" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {Array.from({ length: 8 }).map((_, i) => <RevampSkeleton key={i} h={150} />)}
        </div>
      </div>
    );
  }
  return (
    <div className={styles.container}>
      <PageHeader
        eyebrow={<><Icon name="users" size={11} /> {members.length} residents on record</>}
        title="Members"
        sub="Everyone living in or owning a flat in the society."
        right={
          <div style={{ width: 300 }}>
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search flat, name, phone, email…"
              size="sm"
            />
          </div>
        }
      />

      {/* ── Stat strip ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
        <SmallStat icon="users" label="Total members" value={members.length} />
        <SmallStat icon="circle-check" label="Active" value={activeCount} tone="success" />
        <SmallStat icon="user-circle" label="Owner-occupied" value={ownerCount} />
        <SmallStat icon="key-round" label="Rented" value={rentedCount} />
      </div>

      {/* ── Filters ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
        <Segmented
          value={filterWing}
          onChange={setFilterWing}
          options={[
            { value: 'all', label: 'All wings', count: filteredMembers.length },
            ...wings.map((w) => ({
              value: w,
              label: `Wing ${w}`,
              count: filteredMembers.filter((m) => String(m.wing || '').trim() === w).length,
            })),
          ]}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select value={filterStatus} onChange={setFilterStatus} title="Membership status">
            <option value="all">All status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Suspended">Suspended</option>
            <option value="Blocked">Blocked</option>
          </Select>
          <Select value={filterOwnership} onChange={setFilterOwnership} title="Ownership type">
            <option value="all">All ownership</option>
            <option value="Owner-Occupied">Owner-Occupied</option>
            <option value="Rented">Rented</option>
            <option value="Vacant">Vacant</option>
            <option value="Under-Dispute">Under-Dispute</option>
          </Select>
          <span style={{ fontSize: 12, color: 'var(--r-fg-4)', fontWeight: 500, whiteSpace: 'nowrap' }}>
            {visibleMembers.length} of {members.length}
          </span>
        </div>
      </div>

      {/* ── Member cards ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {visibleMembers.map((member) => {
          const flat = `${member.wing ? `${member.wing}-` : ''}${member.flatNo || ''}`;
          return (
            <Card
              key={member._id}
              hover
              onClick={() => setSelectedMember(member)}
              style={{ padding: 14, cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <Avatar name={member.ownerName || flat} size={42} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--r-fg-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {member.ownerName || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--r-fg-4)' }}>
                    {flat}{member.flatType ? ` · ${member.flatType}` : ''}
                  </div>
                </div>
                <Pill tone={statusTone(member.membershipStatus)}>{member.membershipStatus || 'Active'}</Pill>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11, marginBottom: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--r-fg-4)', marginBottom: 2 }}>Phone</div>
                  <div className="revamp-num" style={{ color: 'var(--r-fg-2)', fontWeight: 500 }}>{member.contactNumber || '—'}</div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--r-fg-4)', marginBottom: 2 }}>Ownership</div>
                  <div style={{ color: 'var(--r-fg-2)', fontWeight: 500 }}>{member.ownershipType || '—'}</div>
                </div>
                <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
                  <div style={{ color: 'var(--r-fg-4)', marginBottom: 2 }}>Email</div>
                  <div style={{ color: 'var(--r-fg-2)', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {member.emailPrimary || '—'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid var(--r-hairline)' }}>
                <span style={{ fontSize: 11, color: 'var(--r-fg-4)' }}>
                  {member.carpetAreaSqft ? `${member.carpetAreaSqft} sq.ft` : '—'}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--r-brand)' }}>
                  Full details <Icon name="arrow-right" size={13} />
                </span>
              </div>
            </Card>
          );
        })}
      </div>
      {visibleMembers.length === 0 && (
        <EmptyState icon="users" title="No members found" sub="No one matches the current search and filters." />
      )}

      {/* Detailed Dialog */}
      {selectedMember && (
        <div className={styles.dialogOverlay} onClick={() => setSelectedMember(null)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.dialogHeader}>
              <h2>
                Complete Details - {selectedMember.wing ? `${selectedMember.wing}-` : ''}
                {selectedMember.flatNo}
              </h2>
              <button
                className={styles.closeButton}
                onClick={() => setSelectedMember(null)}
              >
                ✕
              </button>
            </div>
            <div className={styles.dialogContent}>
              {/* Flat + owner details, family, parking, status and login are
                  all editable here. This block used to be ~110 lines of
                  read-only <div>s with no way to change anything. */}
              <MemberEditor
                member={selectedMember}
                billPeriodId={billPeriodId}
                onPatch={applyPatch}
              />
{/* Owner History - FIXED */}
{selectedMember.ownerHistory && selectedMember.ownerHistory.length > 0 && (
  <section className={styles.section}>
    <h3 className={styles.sectionTitle}>📜 Ownership Timeline</h3>
    <div className={styles.infoBox}>
      <strong>Current Owner:</strong> {selectedMember.ownerName}
      {/* Was hardcoded "● Active" for every flat, including ones marked
          Blocked or Exited. Derived from the flat's real status now. */}
      <span style={{
        marginLeft: '1rem',
        color: (selectedMember.membershipStatus || 'Active') === 'Active' ? 'var(--success)' : 'var(--warning-fg)',
        fontWeight: 600
      }}>
        ● {selectedMember.membershipStatus || 'Active'}
      </span>
    </div>
    {selectedMember.ownerHistory.length > 0 && (
      <>
        <h4 style={{ 
          marginTop: '1.5rem', 
          marginBottom: '1rem', 
          fontSize: '0.9rem',
          color: 'var(--fg-4)',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          Previous Owners
        </h4>
        <div className={styles.timeline}>
          {[...selectedMember.ownerHistory]
            .sort((a, b) => (b.ownerSequence || 0) - (a.ownerSequence || 0))
            .map((owner, idx) => (
              <div key={idx} className={styles.timelineItem}>
                <div className={styles.timelineDot} />
                <div className={styles.timelineContent}>
                  {/* Header */}
                  <div className={styles.timelineHeader}>
                    <span className={styles.sequenceBadge}>
                      Owner #{owner.ownerSequence || (selectedMember.ownerHistory.length - idx)}
                    </span>
                    <strong style={{ marginLeft: '0.75rem', fontSize: '1.05rem' }}>
                      {owner.ownerName}
                    </strong>
                  </div>
                  {/* Dates */}
                  <div className={styles.timelineDate} style={{ marginTop: '0.5rem' }}>
                    {owner.ownershipStartDate && (
                      <span style={{ fontWeight: 500 }}>
                        📅 {new Date(owner.ownershipStartDate).toLocaleDateString('en-IN', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </span>
                    )}
                    {owner.ownershipEndDate && (
                      <>
                        <span style={{ margin: '0 0.75rem', color: 'var(--fg-5)' }}>→</span>
                        <span style={{ fontWeight: 500 }}>
                          {new Date(owner.ownershipEndDate).toLocaleDateString('en-IN', { 
                            year: 'numeric', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </span>
                      </>
                    )}
                    {owner.durationMonths && (
                      <span style={{ 
                        marginLeft: '1rem', 
                        padding: '0.25rem 0.5rem',
                        backgroundColor: 'var(--bg-muted)',
                        borderRadius: '6px',
                        color: 'var(--fg-3)',
                        fontSize: '0.85rem',
                        fontWeight: 500
                      }}>
                        {Math.floor(owner.durationMonths / 12)}y {owner.durationMonths % 12}m
                      </span>
                    )}
                  </div>
                  {/* Contact & ID Details */}
                  <div className={styles.ownerDetails} style={{ marginTop: '1rem' }}>
                    {owner.contactNumber && (
                      <div className={styles.detailItem}>
                        <span className={styles.detailIcon}>📞</span>
                        {owner.contactNumber}
                      </div>
                    )}
                    {owner.emailPrimary && (
                      <div className={styles.detailItem}>
                        <span className={styles.detailIcon}>📧</span>
                        <span style={{ fontSize: '0.9rem' }}>{owner.emailPrimary}</span>
                      </div>
                    )}
                    {owner.panCard && (
                      <div className={styles.detailItem}>
                        <span className={styles.detailIcon}>🆔</span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {owner.panCard}
                        </span>
                      </div>
                    )}
                  </div>
                  {/* Financial Details */}
                  {(owner.purchaseAmount || owner.saleAmount) && (
                    <div style={{
                      marginTop: '1rem',
                      padding: '1rem',
                      backgroundColor: 'var(--warning-bg)',
                      borderRadius: '8px',
                      border: '1px solid #FCD34D'
                    }}>
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: '0.75rem'
                      }}>
                        {owner.purchaseAmount && (
                          <div>
                            <div style={{ 
                              fontSize: '0.75rem', 
                              color: 'var(--warning-fg)',
                              marginBottom: '0.25rem',
                              fontWeight: 600
                            }}>
                              💰 Purchase Price
                            </div>
                            <div style={{ 
                              fontWeight: 700, 
                              color: 'var(--warning-fg)',
                              fontSize: '1rem' 
                            }}>
                              ₹{Number(owner.purchaseAmount).toLocaleString('en-IN')}
                            </div>
                          </div>
                        )}
                        {owner.saleAmount && (
                          <div>
                            <div style={{ 
                              fontSize: '0.75rem', 
                              color: 'var(--warning-fg)',
                              marginBottom: '0.25rem',
                              fontWeight: 600
                            }}>
                              💵 Sale Price
                            </div>
                            <div style={{ 
                              fontWeight: 700, 
                              color: 'var(--warning-fg)',
                              fontSize: '1rem' 
                            }}>
                              ₹{Number(owner.saleAmount).toLocaleString('en-IN')}
                            </div>
                          </div>
                        )}
                        {owner.purchaseAmount && owner.saleAmount && (
                          <div>
                            <div style={{ 
                              fontSize: '0.75rem', 
                              color: 'var(--warning-fg)',
                              marginBottom: '0.25rem',
                              fontWeight: 600
                            }}>
                              📈 Profit/Loss
                            </div>
                            <div style={{ 
                              fontWeight: 700, 
                              fontSize: '1rem',
                              color: owner.saleAmount >= owner.purchaseAmount ? 'var(--success)' : 'var(--danger)'
                            }}>
                              {owner.saleAmount >= owner.purchaseAmount ? '+' : ''}
                              ₹{Math.abs(Number(owner.saleAmount) - Number(owner.purchaseAmount)).toLocaleString('en-IN')}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </>
    )}
  </section>
)}
             {/* Tenant History */}
{selectedMember.tenantHistory && selectedMember.tenantHistory.length > 0 && (
  <section className={styles.section}>
    <h3 className={styles.sectionTitle}>🏠 Tenant History</h3>
    <div className={styles.timeline}>
      {selectedMember.tenantHistory
        .sort((a, b) => new Date(b.startDate) - new Date(a.startDate))
        .map((tenant, idx) => (
          <div 
            key={idx} 
            className={`${styles.timelineItem} ${tenant.isCurrent ? styles.currentTenant : ''}`}
          >
            <div 
              className={styles.timelineDot} 
              style={{ 
                backgroundColor: tenant.isCurrent ? 'var(--success)' : 'var(--fg-4)',
                boxShadow: tenant.isCurrent ? '0 0 0 4px rgba(16, 185, 129, 0.2)' : 'none'
              }}
            />
            <div className={styles.timelineContent}>
              <div className={styles.timelineHeader}>
                <span className={styles.sequenceBadge}>
                  Tenant #{tenant.tenantSequence || (idx + 1)}
                </span>
                <strong style={{ marginLeft: '0.5rem' }}>{tenant.name}</strong>
                {tenant.isCurrent && (
                  <span 
                    className={styles.currentBadge}
                    style={{
                      marginLeft: 'auto',
                      background: 'var(--success)',
                      color: 'var(--on-solid)',
                      padding: '0.25rem 0.75rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: '600'
                    }}
                  >
                    ● Current
                  </span>
                )}
              </div>
              <div className={styles.timelineDate}>
                <span>
                  📅 {new Date(tenant.startDate).toLocaleDateString('en-IN', { 
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric' 
                  })}
                </span>
                <span style={{ margin: '0 0.5rem' }}>→</span>
                {tenant.endDate ? (
                  <span>
                    {new Date(tenant.endDate).toLocaleDateString('en-IN', { 
                      year: 'numeric', 
                      month: 'short', 
                      day: 'numeric' 
                    })}
                  </span>
                ) : (
                  <span style={{ color: 'var(--success)', fontWeight: '600' }}>Present</span>
                )}
              </div>
              <div className={styles.ownerDetails}>
                {tenant.contactNumber && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>📞</span>
                    {tenant.contactNumber}
                  </div>
                )}
                {tenant.email && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>📧</span>
                    {tenant.email}
                  </div>
                )}
                {tenant.panCard && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>🆔</span>
                    PAN: {tenant.panCard}
                  </div>
                )}
                {tenant.depositAmount && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>💵</span>
                    Deposit: ₹{Number(tenant.depositAmount).toLocaleString('en-IN')}
                  </div>
                )}
                {tenant.rentPerMonth && (
                  <div className={styles.detailItem}>
                    <span className={styles.detailIcon}>💰</span>
                    Rent: ₹{Number(tenant.rentPerMonth).toLocaleString('en-IN')}/month
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
    </div>
  </section>
)}
              {/* Financial Info */}
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>💰 Financial Information</h3>
                <div className={styles.grid}>
                  <div className={styles.field}>
                    <label>Opening Balance</label>
                    <div className={selectedMember.openingBalance >= 0 ? styles.credit : styles.debit}>
                      ₹{Math.abs(selectedMember.openingBalance || 0).toLocaleString()}
                      {selectedMember.openingBalance >= 0 ? ' (CR)' : ' (DR)'}
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label>Membership Number</label>
                    <div>{selectedMember.membershipNumber || 'N/A'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Voting Rights</label>
                    <div>{selectedMember.hasVotingRights ? '✅ Yes' : '❌ No'}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Status</label>
                    <div><span className={`${styles.badge} ${styles[`badge${selectedMember.membershipStatus}`]}`}>
                      {selectedMember.membershipStatus}
                    </span></div>
                  </div>
                </div>
              </section>
              {/* System Info */}
              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>⚙️ System Information</h3>
                <div className={styles.grid}>
                  <div className={styles.field}>
                    <label>Created At</label>
                    <div>{new Date(selectedMember.createdAt).toLocaleString()}</div>
                  </div>
                  <div className={styles.field}>
                    <label>Last Updated</label>
                    <div>{new Date(selectedMember.updatedAt).toLocaleString()}</div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}