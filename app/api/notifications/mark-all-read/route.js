import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Notification from "@/models/Notification";

// SEC-21: converged off inline `verifyToken()` onto authorize(). Gated on
// `notice.notice.view` for the same reason as ../mark-read: this only ever
// writes the CALLER'S OWN read state, scoped by `readBy.userId`, and that
// permission is in MEMBER_CAPABILITIES so residents keep working.
export async function POST(request) {
  const gate = await authorize(request, "notice.notice.view");
  if (!gate.ok) return gate.response;
  const { userId, societyId } = gate.context;
  try {
    await connectDB();
    // Every notification this user has not yet read, in their society only.
    await Notification.updateMany(
      {
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
