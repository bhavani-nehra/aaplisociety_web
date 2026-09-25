/**
 * POST /api/ownership-transfers/[id]/invite-buyer
 *
 * Creates or links the buyer's login and emails them a setup link.
 *
 * Two rules from Master Prompt 2 §5, both load-bearing:
 *
 * 1. **If the buyer already has an account, do not create a duplicate.** One
 *    person can own flats in several societies on one login — that is what
 *    User.profiles[] is for. A second account would split their identity and
 *    leave them unable to see both flats.
 *
 * 2. **Never email a password.** The account is created with a random secret
 *    nobody ever sees and the buyer sets their own via a 7-day setup link —
 *    the same flow SEC-19 put behind every other account creation path.
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import User from "@/models/User";
import Member from "@/models/Member";
import Society from "@/models/Society";
import { signToken } from "@/lib/jwt";
import { sendEmail, onboardingEmailHtml } from "@/lib/brevo-email";
import { markBuyerInvited } from "@/lib/services/OwnershipTransferService";
import { loadTransferFor, transferErrorResponse } from "@/lib/services/ownershipTransferHttp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const loaded = await loadTransferFor(request, params, "member.ownershipTransfer.initiate");
  if (!loaded.ok) return loaded.response;

  try {
    const { transfer, gate } = loaded;
    const email = (transfer.buyer.emailPrimary || "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json(
        {
          error:
            "The buyer has no email address on this transfer, so there is nowhere to send the setup link. Add one and try again.",
          code: "BUYER_EMAIL_REQUIRED",
        },
        { status: 400 },
      );
    }

    // Rule 1: reuse an existing login rather than forking the person in two.
    let user = await User.findOne({ email });
    const reusedExistingAccount = Boolean(user);

    if (!user) {
      // Rule 2: a secret nobody sees. The account is unusable until the setup
      // link is used, which is the point.
      const throwaway = crypto.randomBytes(32).toString("base64url");
      user = await User.create({
        name: transfer.buyer.name,
        email,
        phone: transfer.buyer.contactNumber || undefined,
        password: await bcrypt.hash(throwaway, 10),
        role: "Member",
        mustChangePassword: true,
        isActive: true,
      });
    }

    const member = await Member.findById(transfer.memberId).select("flatNo wing").lean();
    const society = await Society.findById(transfer.societyId).select("name address").lean();
    const unitLabel = member?.wing ? `${member.wing}-${member.flatNo}` : member?.flatNo || "";

    // The buyer's profile for THIS flat is attached only once the transfer is
    // approved — until then they are an invited party, not a resident. Approval
    // is what moves ownership; an invitation must not pre-grant access.
    const onboardingToken = signToken(
      { userId: String(user._id), purpose: "onboarding" },
      { expiresIn: "7d" },
    );
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const setCredentialsUrl = `${appUrl}/onboarding/set-credentials?token=${onboardingToken}`;

    let emailSent = false;
    let emailError = null;
    if (!reusedExistingAccount) {
      try {
        await sendEmail({
          to: email,
          subject: `Set up your account — ${society?.name || "your society"}`,
          html: onboardingEmailHtml({
            memberName: transfer.buyer.name,
            societyName: society?.name || "",
            societyAddress: society?.address || "",
            unitKind: "Flat",
            unitLabel,
            setCredentialsUrl,
          }),
        });
        emailSent = true;
      } catch (err) {
        emailError = err?.message || String(err);
        console.error("[ownership-transfers] buyer invite email failed:", emailError);
      }
    }

    await markBuyerInvited({
      transfer,
      actorUserId: gate.context.userId,
      buyerUserId: user._id,
    });

    return NextResponse.json({
      success: true,
      transfer,
      buyer: {
        userId: String(user._id),
        email,
        reusedExistingAccount,
        // An existing account already has a password — sending a setup link
        // would be an unprompted "reset your password" email for a flat they
        // have not yet agreed to buy.
        setCredentialsUrl: reusedExistingAccount ? null : setCredentialsUrl,
        emailSent,
        emailError,
      },
    });
  } catch (err) {
    return transferErrorResponse(err);
  }
}
