import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Notification from "@/models/Notification";

// SEC-21: converged off inline `verifyToken()` onto authorize().
//
// The gate is `notice.notice.view`, not a write permission, and deliberately:
// marking a notification read changes nothing about the notification itself,
// only this caller's own read state, and the query below is scoped to
// `readBy.userId = <this user>`. Anyone entitled to SEE a notice is entitled to
// mark it read; nobody can mark it read for anyone else.
//
// `notice.notice.view` is in MEMBER_CAPABILITIES (lib/rbac/system-role-defaults.js),
// so residents keep working. Gating this on an admin permission would have
// silently broken every member's notification list — which is why the route
// files, not just the route count, had to be read before converging them.
export async function POST(request) {
  const gate = await authorize(request, "notice.notice.view");
  if (!gate.ok) return gate.response;
  const { userId, societyId } = gate.context;
  try {
    await connectDB();
    const { notificationId } = await request.json();
    if (!notificationId)
      return NextResponse.json(
        { error: "notificationId required" },
        { status: 400 },
      );
    await Notification.updateOne(
      {
        _id: notificationId,
        societyId,
        isDeleted: false,
        "readBy.userId": { $ne: userId },
      },
      {
        $push: { readBy: { userId, readAt: new Date() } },
      },
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
