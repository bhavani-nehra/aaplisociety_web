import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { verifyToken, getTokenFromRequest } from "@/lib/jwt";
import { authorize } from "@/lib/rbac/authorize";
import Complaint from "@/models/Complaint";
import ComplaintReply from "@/models/ComplaintReply";
import { hasBlockedContent, hasProfanity } from "@/lib/complaintUtils";
export async function POST(request, { params }) {
  try {
    const gate = await authorize(request, "complaint.complaint.reply");
    if (!gate.ok) return gate.response;
    await connectDB();
    const token = getTokenFromRequest(request);
    if (!token)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const decoded = verifyToken(token);
    if (!decoded)
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    // SEC-21: staff/member branching comes from the RBAC hat authorize()
    // already resolved, not the literal role string. `User.role` carries
    // "SOCIETY_ADMIN" and "Staff" in live data, and a custom RBAC staff role
    // carries no legacy role string at all — each of those matched NEITHER
    // branch below, so they were subject to neither the member restrictions
    // nor the staff status check.
    const isMemberHat = gate.context.hat === "member";
    const isStaffHat = gate.context.hat === "staff";

    const { id } = await params;
    const { message } = await request.json();
    if (!message || message.trim().length < 10) {
      return NextResponse.json(
        { error: "Reply must be at least 10 characters" },
        { status: 400 },
      );
    }
    if (hasProfanity(message) || hasBlockedContent(message)) {
      return NextResponse.json(
        { error: "Reply contains invalid content" },
        { status: 400 },
      );
    }
    const complaint = await Complaint.findOne({
      _id: id,
      societyId: gate.context.societyId || decoded.societyId,
    });
    if (!complaint)
      return NextResponse.json(
        { error: "Complaint not found" },
        { status: 404 },
      );
    // Member can only reply to their own rejected complaints
    if (isMemberHat) {
      if (complaint.memberId.toString() !== decoded.memberId.toString()) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (complaint.status !== "REJECTED") {
        return NextResponse.json(
          { error: "You can only reply to rejected complaints" },
          { status: 400 },
        );
      }
      // Max 3 member replies
      const existingMemberReplies = await ComplaintReply.countDocuments({
        complaintId: id,
        authorRole: "Member",
      });
      if (existingMemberReplies >= 3) {
        return NextResponse.json(
          { error: "Maximum 3 replies allowed per complaint" },
          { status: 400 },
        );
      }
    }
    // Staff can reply to any complaint in their society
    if (isStaffHat) {
      if (!["PENDING", "REJECTED"].includes(complaint.status)) {
        return NextResponse.json(
          { error: "Cannot reply to this complaint" },
          { status: 400 },
        );
      }
    }
    const reply = await ComplaintReply.create({
      complaintId: id,
      // SEC-21: verified context only — no second, less-trusted source for
      // the same fact.
      societyId: gate.context.societyId,
      authorId: gate.context.userId,
      // `authorRole` is persisted and read back by the member reply cap above
      // (`authorRole: "Member"`), so it must stay a stable literal rather than
      // whatever role string a given token happens to carry.
      authorRole: isMemberHat ? "Member" : decoded.role || "Staff",
      displayName: isMemberHat ? complaint.anonymousName : "Society Admin",
      message: message.trim(),
    });
    // Update complaint reply count and lastReplyAt
    complaint.replyCount = (complaint.replyCount || 0) + 1;
    complaint.lastReplyAt = new Date();
    // Auto-close after 3 days inactivity is handled by a cron job.
    // If complaint was REJECTED and member replies, keep as REJECTED (not re-opened).
    await complaint.save();
    return NextResponse.json({ success: true, reply }, { status: 201 });
  } catch (error) {
    console.error("Reply error:", error);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 },
    );
  }
}
