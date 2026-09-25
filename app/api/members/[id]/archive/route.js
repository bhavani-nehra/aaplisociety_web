/**
 * POST   /api/members/[id]/archive  — soft-delete a flat
 * DELETE /api/members/[id]/archive  — restore one
 *
 * Plan 02 §2.
 *
 * ## Why archive and not delete
 *
 * A flat is referenced by every bill, receipt, transaction and ledger line ever
 * raised against it. Removing the row would orphan a society's financial
 * history — the numbers would still exist but nothing would say whose they
 * were. `isDeleted` is already read by every member query in the app; nothing
 * ever set it.
 *
 * ## Why restore exists at the same time
 *
 * A soft delete without a restore is a delete with extra steps: the admin sees
 * the flat vanish, discovers the mistake, and has no way back except a database
 * console. Both directions ship together or neither is safe to offer.
 */
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import mongoose from "mongoose";
import Member from "@/models/Member";
import Bill from "@/models/Bill";
import { authorize } from "@/lib/rbac/authorize";
import { logAudit } from "@/lib/audit-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badId() {
  return NextResponse.json(
    { error: "Invalid flat id.", code: "BAD_ID" },
    { status: 400 },
  );
}

export async function POST(request, { params }) {
  const gate = await authorize(request, "member.member.delete");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) return badId();

    const member = await Member.findOne({
      _id: id,
      societyId: gate.context.societyId,
      isDeleted: { $ne: true },
    });
    if (!member) {
      return NextResponse.json(
        { error: "Flat not found.", code: "MEMBER_NOT_FOUND" },
        { status: 404 },
      );
    }

    // Refuse while money is outstanding. Archiving a flat mid-dispute hides it
    // from every list the admin uses to chase payment, and the debt does not go
    // away — it just stops being visible.
    const unpaid = await Bill.countDocuments({
      societyId: gate.context.societyId,
      memberId: member._id,
      status: { $in: ["Unpaid", "Overdue", "PartiallyPaid"] },
    });
    if (unpaid > 0) {
      return NextResponse.json(
        {
          error: `This flat has ${unpaid} unpaid bill${unpaid === 1 ? "" : "s"}. Settle or write them off before archiving it.`,
          code: "MEMBER_HAS_UNPAID_BILLS",
          unpaidCount: unpaid,
        },
        { status: 409 },
      );
    }

    const body = await request.json().catch(() => ({}));
    member.isDeleted = true;
    member.membershipStatus = "Exited";
    member.lastModifiedBy = gate.context.userId;
    await member.save();

    await logAudit(gate.context.userId, gate.context.societyId, "MEMBER_ARCHIVED", null, {
      memberId: String(member._id),
      flat: member.wing ? `${member.wing}-${member.flatNo}` : member.flatNo,
      ownerName: member.ownerName,
      reason: body.reason || null,
    });

    return NextResponse.json({
      success: true,
      member: { id: String(member._id), isDeleted: true },
      // Said plainly, because "archived" reads like "gone" and it is not.
      message:
        "Flat archived. Its bills, receipts and history are untouched, and it can be restored.",
    });
  } catch (err) {
    console.error("[members/archive] failed:", err);
    return NextResponse.json(
      { error: "Something went wrong on our side. Your data is safe.", code: "INTERNAL" },
      { status: 500 },
    );
  }
}

export async function DELETE(request, { params }) {
  // Restoring is an update, not a delete: it puts a flat back into the lists it
  // came from and destroys nothing.
  const gate = await authorize(request, "member.member.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) return badId();

    const member = await Member.findOne({
      _id: id,
      societyId: gate.context.societyId,
      isDeleted: true,
    });
    if (!member) {
      return NextResponse.json(
        { error: "No archived flat found with that id.", code: "MEMBER_NOT_FOUND" },
        { status: 404 },
      );
    }

    // No flat-number clash check here, deliberately.
    //
    // `MemberSchema.index({ societyId, flatNo, wing }, { unique: true })`
    // carries NO partial filter on `isDeleted` (verified against the live
    // index). So an archived flat still occupies its number: the database
    // refuses to create a replacement while the original exists, archived or
    // not.
    //
    // That means restore can never collide — the slot was never released. An
    // earlier version of this route checked for a clash and returned 409
    // FLAT_NUMBER_TAKEN, which was unreachable code describing a state the
    // index makes impossible. A test creating the "replacement" failed with
    // E11000, which is what exposed it.
    //
    // Making archiving free the number is a different change: it needs the
    // index rebuilt as a partial one, which is a migration on a live unique
    // constraint, and it would let a society reuse a flat number while the
    // archived flat's bills still reference it. Not done as a side effect of
    // adding restore.
    member.isDeleted = false;
    member.membershipStatus = "Active";
    member.lastModifiedBy = gate.context.userId;
    await member.save();

    await logAudit(gate.context.userId, gate.context.societyId, "MEMBER_RESTORED", null, {
      memberId: String(member._id),
      flat: member.wing ? `${member.wing}-${member.flatNo}` : member.flatNo,
      ownerName: member.ownerName,
    });

    return NextResponse.json({
      success: true,
      member: { id: String(member._id), isDeleted: false },
      message: "Flat restored.",
    });
  } catch (err) {
    console.error("[members/restore] failed:", err);
    return NextResponse.json(
      { error: "Something went wrong on our side. Your data is safe.", code: "INTERNAL" },
      { status: 500 },
    );
  }
}
