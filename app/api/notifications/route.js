import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Notification from "@/models/Notification";
import Member from "@/models/Member";
import { emitNotification } from "@/lib/socket-server";

// POST /api/notifications — send a notification to the society
//
// SEC-21: converged off an inline `["Admin","Secretary"].includes(decoded.role)`
// string check onto authorize(). That check read the literal role STRING on the
// token, so it accepted a stale token after a role handover and ignored
// whatever RBAC had actually granted — e.g. a custom role explicitly given
// notice-create could not use it, while a demoted Secretary still could.
export async function POST(request) {
  const gate = await authorize(request, "notice.notice.create");
  if (!gate.ok) return gate.response;
  const { userId, societyId, decoded } = gate.context;
  try {
    await connectDB();
    const {
      type,
      title,
      message,
      recipientType,
      recipientIds = [],
      actionUrl,
      expiresInDays,
    } = await request.json();
    if (!title?.trim() || !message?.trim() || !type || !recipientType) {
      return NextResponse.json(
        { error: "title, message, type, recipientType are required" },
        { status: 400 },
      );
    }
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    }
    const notification = await Notification.create({
      societyId,
      createdBy: userId,
      createdByName: decoded?.name || "Admin",
      type,
      title: title.trim(),
      message: message.trim(),
      recipientType,
      recipientIds,
      actionUrl: actionUrl || null,
      expiresAt,
    });
    // Emit realtime event
    emitNotification(notification);
    return NextResponse.json({ success: true, notification }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
// GET /api/notifications — the caller's own notifications, with unread count
//
// SEC-21: gated on `notice.notice.view`, which is in MEMBER_CAPABILITIES, so
// this stays readable by residents as well as staff. The scoping below is
// unchanged — a member still only sees notifications addressed to them.
export async function GET(request) {
  const gate = await authorize(request, "notice.notice.view");
  if (!gate.ok) return gate.response;
  const { societyId, userId, hat, decoded } = gate.context;
  try {
    await connectDB();
    const searchParams = new URL(request.url).searchParams;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const memberId = decoded?.memberId;
    // Build recipient filter — show notification if:
    // recipientType=all OR user's memberId/wing is in recipientIds
    const member = memberId
      ? await Member.findById(memberId).select("wing flatNo").lean()
      : null;
    const recipientFilter = {
      $or: [
        { recipientType: "all" },
        {
          recipientType: "member",
          recipientIds: memberId ? memberId.toString() : "",
        },
        { recipientType: "wing", recipientIds: member?.wing || "__none__" },
        {
          recipientType: "flats",
          recipientIds: memberId ? memberId.toString() : "",
        },
      ],
    };
    // Staff see every notification in their society (they send them and need to
    // audit delivery); a member sees only what was addressed to them.
    //
    // Keyed on the RBAC hat rather than the legacy role string it used to read:
    // a custom staff role (Auditor, Committee Member) got the member-scoped
    // view before, because its token carries no literal "Admin"/"Secretary".
    const isStaff = hat === "staff";
    const baseQuery = isStaff
      ? { societyId, isDeleted: false }
      : { societyId, isDeleted: false, ...recipientFilter };
    const [notifications, total] = await Promise.all([
      Notification.find(baseQuery)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(baseQuery),
    ]);
    // Per-notification read flag for current user
    const enriched = notifications.map((n) => ({
      ...n,
      isRead: n.readBy.some((r) => r.userId?.toString() === userId?.toString()),
      readCount: n.readBy.length,
    }));
    const unreadCount = enriched.filter((n) => !n.isRead).length;
    return NextResponse.json({
      success: true,
      notifications: enriched,
      unreadCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
