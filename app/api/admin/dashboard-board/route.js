/**
 * GET /api/admin/dashboard-board
 *
 * Operational counts and short lists for the admin dashboard board (the tabbed
 * Security / Amenities / Shops / Members slab, the "waiting on you" queue and
 * the registry panels). Money figures come from /api/admin/money/insights, not
 * from here. Every block is counted from the society's own collections; a block
 * that cannot be read comes back empty rather than failing the whole board.
 */
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Member from "@/models/Member";
import Visitor from "@/models/Visitor";
import Complaint from "@/models/Complaint";
import TenantRequest from "@/models/TenantRequest";
import ProfileEditRequest from "@/models/ProfileEditRequest";
import OwnershipTransfer from "@/models/OwnershipTransfer";
import Notice from "@/models/Notice";
import Shop from "@/models/Shop";
import Blacklist from "@/models/Blacklist";
import Society from "@/models/Society";
import Amenity from "@/models/amenities/Amenity";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import { TRANSFER_OPEN_STATUSES as OPEN_STATUSES } from "@/models/OwnershipTransfer";

export const dynamic = "force-dynamic";

const safe = async (p, fallback) => {
  try {
    return await p;
  } catch (e) {
    console.error("[dashboard-board]", e?.message);
    return fallback;
  }
};

export async function GET(request) {
  const gate = await authorize(request, "dashboard.stats.view");
  if (!gate.ok) return gate.response;
  const sid = gate.context?.societyId;
  if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) {
    return NextResponse.json({ error: "Invalid society context" }, { status: 400 });
  }
  await connectDB();
  const societyId = new mongoose.Types.ObjectId(String(sid));
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const inDays = (n) => new Date(now.getTime() + n * 864e5);
  const base = { societyId, isDeleted: { $ne: true } };

  const [
    society, flats, ownership, amenities, shops, shopsLet, inside, visitorsToday,
    complaintsOpen, tenantReqs, profileEdits, transfers, blacklisted, notices,
    shopRows, amenityRows, events, tenantQueue, editQueue, transferQueue, complaintRows, wingRows,
  ] = await Promise.all([
    safe(Society.findById(societyId).select("name").lean(), null),
    safe(Member.countDocuments(base), 0),
    safe(Member.aggregate([{ $match: base }, { $group: { _id: "$ownershipType", n: { $sum: 1 } } }]), []),
    safe(Amenity.countDocuments({ societyId, isActive: true }), 0),
    safe(Shop.countDocuments(base), 0),
    safe(Shop.countDocuments({ ...base, occupancyType: { $ne: "Vacant" } }), 0),
    safe(
      Visitor.find({ societyId, status: "Entered", exitTime: null })
        .sort({ entryTime: -1 }).limit(8).populate("memberId", "wing flatNo").select("name purpose status entryTime memberId").lean(),
      [],
    ),
    safe(Visitor.countDocuments({ societyId, entryTime: { $gte: dayStart } }), 0),
    safe(Complaint.countDocuments({ societyId, status: "PENDING" }), 0),
    safe(TenantRequest.countDocuments({ societyId, status: "Pending" }), 0),
    safe(ProfileEditRequest.countDocuments({ societyId, status: "Pending" }), 0),
    safe(OwnershipTransfer.countDocuments({ societyId, status: { $in: OPEN_STATUSES } }), 0),
    safe(Blacklist.countDocuments({ societyId }), 0),
    safe(Notice.find({ societyId, isDeleted: { $ne: true } }).sort({ pinned: -1, createdAt: -1 }).limit(4).select("title priority viewedBy createdAt").lean(), []),
    safe(Shop.find(base).sort({ wing: 1, shopNo: 1 }).limit(14).select("shopNo wing tradeName ownerName occupancyType tenantName leaseEndDate").lean(), []),
    safe(Amenity.find({ societyId, isActive: true }).sort({ displayOrder: 1, name: 1 }).limit(9).select("name location openingTime closingTime").lean(), []),
    safe(AmenityEvent.find({ societyId, startAt: { $gte: now } }).sort({ startAt: 1 }).limit(7).select("title venue startAt capacity status").lean(), []),
    safe(TenantRequest.find({ societyId, status: "Pending" }).sort({ createdAt: 1 }).limit(4).select("createdAt").populate("memberId", "wing flatNo").lean(), []),
    safe(ProfileEditRequest.find({ societyId, status: "Pending" }).sort({ createdAt: 1 }).limit(4).select("createdAt action").populate("memberId", "wing flatNo").lean(), []),
    safe(OwnershipTransfer.find({ societyId, status: { $in: OPEN_STATUSES } }).sort({ createdAt: 1 }).limit(4).select("createdAt status").lean(), []),
    safe(Complaint.find({ societyId, status: "PENDING" }).sort({ createdAt: 1 }).limit(4).select("title createdAt category").lean(), []),
    safe(Member.aggregate([{ $match: base }, { $group: { _id: { w: "$wing", t: "$ownershipType" }, n: { $sum: 1 } } }]), []),
  ]);

  const flat = (m) => (m?.flatNo ? `${m.wing ? `${m.wing}-` : ""}${m.flatNo}` : "");
  const daysOld = (d) => Math.max(0, Math.floor((now - new Date(d)) / 864e5));
  const count = (k) => ownership.find((o) => o._id === k)?.n || 0;

  const queue = [
    ...transferQueue.map((t) => ({ kind: "transfer", title: "Ownership transfer", sub: String(t.status).replace(/_/g, " ").toLowerCase(), age: daysOld(t.createdAt), href: "/admin/view-members" })),
    ...tenantQueue.map((t) => ({ kind: "tenant", title: `Tenant request${flat(t.memberId) ? ` · ${flat(t.memberId)}` : ""}`, sub: "Waiting for your decision", age: daysOld(t.createdAt), href: "/admin/tenant-requests" })),
    ...editQueue.map((t) => ({ kind: "edit", title: `Profile edit${flat(t.memberId) ? ` · ${flat(t.memberId)}` : ""}`, sub: `${t.action || "Edit"} request`, age: daysOld(t.createdAt), href: "/admin/profile-edit-requests" })),
    ...complaintRows.map((c) => ({ kind: "complaint", title: c.title, sub: c.category || "Complaint", age: daysOld(c.createdAt), href: "/admin/complaints" })),
  ].sort((a, b) => b.age - a.age).slice(0, 5);

  return NextResponse.json({
    success: true,
    society: society?.name || "",
    counts: {
      flats,
      owners: count("Owner-Occupied"),
      tenants: count("Rented"),
      vacant: count("Vacant"),
      amenities,
      shops,
      shopsLet,
      inside: inside.length,
      visitorsToday,
      complaintsOpen,
      tenantRequests: tenantReqs,
      profileEdits,
      transfers,
      blacklisted,
      requestsOpen: tenantReqs + profileEdits + transfers,
    },
    inside: inside.map((v) => ({
      name: v.name,
      purpose: v.purpose || "Visitor",
      flat: flat(v.memberId),
      since: v.entryTime,
      status: v.status,
    })),
    queue,
    wings: Object.values(
      wingRows.reduce((acc, r) => {
        const w = r._id.w || "—";
        const o = (acc[w] ||= { wing: w, owner: 0, tenant: 0, vacant: 0 });
        if (r._id.t === "Rented") o.tenant += r.n;
        else if (r._id.t === "Vacant") o.vacant += r.n;
        else o.owner += r.n;
        return acc;
      }, {}),
    ).sort((a, b) => a.wing.localeCompare(b.wing)),
    notices: notices.map((n) => ({ title: n.title, priority: n.priority, reads: (n.viewedBy || []).length, at: n.createdAt })),
    shopRows: shopRows.map((s) => ({
      id: [s.wing, s.shopNo].filter(Boolean).join("-"),
      name: s.tradeName || s.ownerName,
      occupancy: s.occupancyType,
      leaseEnds: s.leaseEndDate,
      ending: s.leaseEndDate ? new Date(s.leaseEndDate) <= inDays(60) : false,
    })),
    amenityRows: amenityRows.map((a) => ({ name: a.name, location: a.location || "", hours: `${a.openingTime} to ${a.closingTime}` })),
    events: events.map((e) => ({ title: e.title, venue: e.venue || "", at: e.startAt, capacity: e.capacity, status: e.status })),
  });
}
