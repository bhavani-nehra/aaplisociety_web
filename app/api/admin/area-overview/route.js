/**
 * GET /api/admin/area-overview?area=security|amenities|shops
 *
 * Data for the three area overview pages (Security, Amenities, Shops &
 * offices). Everything is read from the society's own collections; a block that
 * cannot be read comes back empty instead of failing the page.
 */
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import { authorizeAny } from "@/lib/rbac/authorize";
import Visitor from "@/models/Visitor";
import Blacklist from "@/models/Blacklist";
import User from "@/models/User";
import Member from "@/models/Member";
import Shop from "@/models/Shop";
import Bill from "@/models/Bill";
import Amenity from "@/models/amenities/Amenity";
import AmenityEvent from "@/models/amenities/AmenityEvent";
import AmenityIncident from "@/models/amenities/AmenityIncident";

export const dynamic = "force-dynamic";

const PERMS = {
  security: ["visitor.admin.view", "security.guards.view", "dashboard.stats.view"],
  amenities: ["amenities.admin.view", "dashboard.stats.view"],
  shops: ["commercial.admin.view", "dashboard.stats.view"],
};
const safe = async (p, d) => { try { return await p; } catch (e) { console.error("[area-overview]", e?.message); return d; } };
const flat = (m) => (m?.flatNo ? `${m.wing ? `${m.wing}-` : ""}${m.flatNo}` : "");

async function security(societyId, now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const [inside, today, byPurpose, guards, blacklist, flagged, week] = await Promise.all([
    safe(Visitor.find({ societyId, status: "Entered", exitTime: null }).sort({ entryTime: -1 }).limit(10).populate("memberId", "wing flatNo").select("name purpose entryTime memberId").lean(), []),
    safe(Visitor.find({ societyId, entryTime: { $gte: dayStart } }).select("entryTime exitTime status purpose").lean(), []),
    safe(Visitor.aggregate([{ $match: { societyId, entryTime: { $gte: dayStart } } }, { $group: { _id: "$purpose", n: { $sum: 1 } } }, { $sort: { n: -1 } }]), []),
    safe(User.find({ societyId, role: "Security" }).select("name status isActive").lean(), []),
    safe(Blacklist.find({ societyId }).sort({ createdAt: -1 }).limit(6).select("name phone reason level createdAt").lean(), []),
    safe(Visitor.countDocuments({ societyId, entryTime: { $gte: dayStart }, status: { $in: ["Rejected"] } }), 0),
    safe(Visitor.aggregate([{ $match: { societyId, entryTime: { $gte: weekAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$entryTime", timezone: "+05:30" } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }]), []),
  ]);
  const hours = Array.from({ length: 24 }, () => 0);
  today.forEach((v) => { hours[new Date(v.entryTime).getHours()] += 1; });
  const exited = today.filter((v) => v.exitTime).length;
  return {
    inside: inside.map((v) => ({ name: v.name, purpose: v.purpose || "Visitor", flat: flat(v.memberId), since: v.entryTime })),
    today: { total: today.length, exited, inside: inside.length, rejected: flagged },
    hours,
    mix: byPurpose.map((p) => ({ label: p._id || "Other", n: p.n })),
    guards: guards.map((g) => ({ name: g.name, active: g.isActive !== false && g.status !== "Suspended" })),
    blacklist: blacklist.map((b) => ({ name: b.name || b.phone || "Entry", reason: b.reason || "", level: b.level || "flag", at: b.createdAt })),
    week: week.map((w) => ({ day: w._id, n: w.n })),
  };
}

async function amenities(societyId, now) {
  const [list, events, incidents, open] = await Promise.all([
    safe(Amenity.find({ societyId, isActive: true }).sort({ displayOrder: 1, name: 1 }).select("name location openingTime closingTime operatingDays").lean(), []),
    safe(AmenityEvent.find({ societyId, startAt: { $gte: now } }).sort({ startAt: 1 }).limit(8).select("title venue startAt endAt capacity status").lean(), []),
    safe(AmenityIncident.find({ societyId }).sort({ occurredAt: -1 }).limit(8).select("incidentNo title severity status occurredAt").lean(), []),
    safe(AmenityIncident.countDocuments({ societyId, status: { $nin: ["RESOLVED", "CLOSED", "Resolved", "Closed"] } }), 0),
  ]);
  return {
    amenities: list.map((a) => ({ name: a.name, location: a.location || "", hours: `${a.openingTime} to ${a.closingTime}`, days: (a.operatingDays || []).length })),
    events: events.map((e) => ({ title: e.title, venue: e.venue || "", at: e.startAt, end: e.endAt, capacity: e.capacity, status: e.status })),
    incidents: incidents.map((i) => ({ no: i.incidentNo, title: i.title, severity: i.severity, status: i.status, at: i.occurredAt })),
    openIncidents: open,
  };
}

async function shops(societyId, now) {
  const base = { societyId, isDeleted: { $ne: true } };
  const [list, dues] = await Promise.all([
    safe(Shop.find(base).sort({ wing: 1, shopNo: 1 }).select("shopNo wing floor tradeName ownerName unitKind occupancyType tenantName leaseEndDate areaSqft").lean(), []),
    safe(Bill.aggregate([
      { $match: { societyId, isDeleted: { $ne: true }, billSeries: "COMMERCIAL", status: { $in: ["Unpaid", "Partial", "Overdue"] }, shopId: { $type: "objectId" } } },
      { $group: { _id: "$shopId", owed: { $sum: { $ifNull: ["$balanceAmount", 0] } }, bills: { $sum: 1 } } },
    ]), []),
  ]);
  const owed = new Map(dues.map((d) => [String(d._id), d]));
  const rows = list.map((s) => {
    const d = owed.get(String(s._id));
    const ends = s.leaseEndDate ? new Date(s.leaseEndDate) : null;
    return {
      id: [s.wing, s.shopNo].filter(Boolean).join("-"),
      name: s.tradeName || s.ownerName,
      kind: s.unitKind,
      floor: s.floor,
      occupancy: s.occupancyType,
      area: s.areaSqft,
      owed: Math.round((d?.owed || 0) * 100) / 100,
      leaseEnds: s.leaseEndDate,
      leaseDays: ends ? Math.round((ends - now) / 864e5) : null,
    };
  });
  return {
    rows,
    totals: {
      units: rows.length,
      occupied: rows.filter((r) => r.occupancy !== "Vacant").length,
      vacant: rows.filter((r) => r.occupancy === "Vacant").length,
      owed: Math.round(rows.reduce((a, r) => a + r.owed, 0) * 100) / 100,
      late: rows.filter((r) => r.owed > 0).length,
      ending: rows.filter((r) => r.leaseDays != null && r.leaseDays <= 60).length,
    },
  };
}

export async function GET(request) {
  const area = new URL(request.url).searchParams.get("area");
  if (!PERMS[area]) return NextResponse.json({ error: "Unknown area" }, { status: 400 });
  const gate = await authorizeAny(request, PERMS[area]);
  if (!gate.ok) return gate.response;
  const sid = gate.context?.societyId;
  if (!sid || !mongoose.Types.ObjectId.isValid(String(sid))) return NextResponse.json({ error: "Invalid society context" }, { status: 400 });
  await connectDB();
  const societyId = new mongoose.Types.ObjectId(String(sid));
  const now = new Date();
  const data = area === "security" ? await security(societyId, now) : area === "amenities" ? await amenities(societyId, now) : await shops(societyId, now);
  return NextResponse.json({ success: true, area, ...data });
}
