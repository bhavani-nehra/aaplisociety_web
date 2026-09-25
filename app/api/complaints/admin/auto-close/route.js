import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { authorize } from "@/lib/rbac/authorize";
import Complaint from "@/models/Complaint";

// POST /api/complaints/admin/auto-close
//
// SEC-21: two fixes here, and the second is the serious one.
//
// 1. Converged off the inline `["Admin","Secretary"].includes(decoded.role)`
//    string check onto authorize(), so the permission is authoritative rather
//    than whatever role string a possibly-stale token carries.
//
// 2. **Added the missing society scope.** The updateMany below matched on
//    `status: "REJECTED"` and the cutoff ALONE — no societyId. Any society's
//    admin calling this bulk-closed rejected complaints in EVERY society on
//    the platform, including societies they have nothing to do with. It is a
//    cross-tenant write, exactly the class Master Prompt 1 §5 exists to
//    prevent, and it was invisible because the endpoint has no UI caller and
//    reports only a count.
export async function POST(request) {
  const gate = await authorize(request, "complaint.complaint.close");
  if (!gate.ok) return gate.response;
  const { societyId } = gate.context;
  try {
    await connectDB();
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const result = await Complaint.updateMany(
      {
        societyId,
        status: "REJECTED",
        $or: [
          { lastReplyAt: { $lt: cutoff } },
          { lastReplyAt: null, updatedAt: { $lt: cutoff } },
        ],
      },
      { $set: { status: "CLOSED" } },
    );
    return NextResponse.json({ success: true, closed: result.modifiedCount });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
