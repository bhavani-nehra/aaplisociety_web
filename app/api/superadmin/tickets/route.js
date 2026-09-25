import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/admin-middleware";
import connectDB from "@/lib/mongodb";
import SupportTicket from "@/models/SupportTicket";
import { TICKET_CATEGORIES, TICKET_STATUSES } from "@/lib/support/ticketPolicy";
import { safeRegex } from "@/lib/query-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/superadmin/tickets — every ticket, every society. Lightweight
// (no screenshots/logs — see [id]/route.js for the full read) with
// optional ?status=&category=&societyName=&q= filters, newest first.
export async function GET(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  await connectDB();

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const q = searchParams.get("q")?.trim();

  const filter = {};
  if (status && TICKET_STATUSES.includes(status)) filter.status = status;
  if (category && TICKET_CATEGORIES.includes(category)) filter.category = category;
  if (q) {
    const rx = safeRegex(q);
    filter.$or = [{ title: rx }, { societyName: rx }, { submittedByName: rx }];
  }

  const tickets = await SupportTicket.find(filter)
    .select(
      "societyId societyName submittedByName category title status createdAt updatedAt",
    )
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  return NextResponse.json({
    tickets: tickets.map((t) => ({
      id: t._id,
      societyId: t.societyId,
      societyName: t.societyName,
      submittedByName: t.submittedByName,
      category: t.category,
      title: t.title,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  });
}
