import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Notification from "@/models/Notification";

// SEC-21: converged off the inline `["Admin","Secretary"].includes(decoded.role)`
// string check onto authorize(). Tenant scope still comes from the verified
// context, never the request, so a notification from another society cannot be
// deleted by guessing its id.
export async function DELETE(request, { params }) {
  const gate = await authorize(request, "notice.notice.delete");
  if (!gate.ok) return gate.response;
  const { societyId } = gate.context;
  try {
    await connectDB();
    const { id } = await params;
    await Notification.findOneAndUpdate(
      { _id: id, societyId },
      { $set: { isDeleted: true } },
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
