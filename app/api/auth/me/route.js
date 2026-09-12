// app/api/auth/me/route.js
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { getAdminModels } from "@/lib/admin-models";
import { getTokenFromRequest } from "@/lib/jwt";
import { loginBlockFor } from "@/lib/auth/login-block";
import { getSessionContext, HAT_STAFF, HAT_MEMBER } from "@/lib/auth/session-context";
import TermsAcceptance from "@/models/TermsAcceptance";
import { BUNDLE_VERSION } from "@/lib/legal/documents";
// Reads req.cookies.get() directly rather than next/headers' cookies(), which
// doesn't opt this route out of Next's route cache by itself — force it, or a
// stale response (e.g. a Member profile fetched before a staff-hat switch)
// can be served back after the cookie has already moved on.
export const dynamic = "force-dynamic";
export async function GET(req) {
  try {
    const adminToken = req.cookies.get("admin_token")?.value;
    const cookieToken = req.cookies.get("token")?.value;
    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.substring(7)
      : null;
    const userToken = cookieToken || bearerToken;
    // ── SUPERADMIN ────────────────────────────────────────────────────────────
    if (adminToken) {
      let decoded;
      try {
        decoded = jwt.verify(adminToken, process.env.ADMIN_JWT_SECRET);
      } catch {
        return NextResponse.json(
          { error: "Invalid admin token" },
          { status: 401 },
        );
      }
      if (decoded.role !== "SuperAdmin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const { SuperAdmin } = await getAdminModels();
      const admin = await SuperAdmin.findById(decoded.userId).select(
        "name email role",
      );
      if (!admin) {
        return NextResponse.json({ error: "Admin not found" }, { status: 404 });
      }
      return NextResponse.json({ user: admin });
    }
    // ── ADMIN / SECRETARY / MEMBER ────────────────────────────────────────────
    else if (userToken) {
      let decoded;
      try {
        decoded = jwt.verify(userToken, process.env.JWT_SECRET);
      } catch {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
      await connectDB();
      // Single source of truth for MEMBER vs STAFF — see session-context.js
      // header comment for the bug this replaced (two endpoints, same
      // cookie, disagreeing about which hat was active).
      const session = getSessionContext(decoded);
      if (!session) {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }

      // ── STAFF hat — RoleAssignment-backed (modern) or a pre-RBAC hardcoded
      // Admin/Secretary/Accountant/Security/SOCIETY_ADMIN account (legacy,
      // no activeContext — session.isLegacyToken is true for those). ───────
      if (session.hat === HAT_STAFF) {
        const user = await User.findById(session.userId).select(
          "name email username role isActive loginPausedUntil loginBlockedReason societyCode",
        );
        if (!user) {
          return NextResponse.json({ error: "User not found" }, { status: 404 });
        }
        const block = loginBlockFor(user);
        if (block) {
          return NextResponse.json({ error: block.message, code: block.code }, { status: 403 });
        }

        // Legal document (Terms of Service / Privacy Policy / Refund
        // policy) acceptance gate — see legal/*.md, lib/legal/documents.js.
        // Only Admin/Secretary can accept (app/api/v1/legal/accept), so
        // only they're ever asked; other staff roles never see this, and
        // a superadmin's takeover session never does either (decoded.takeover
        // present) — that's not their acceptance to give.
        let legalAcceptanceRequired = false;
        if (!decoded.takeover && (session.role === "Admin" || session.role === "Secretary")) {
          const accepted = await TermsAcceptance.exists({
            societyId: session.societyId,
            bundleVersion: BUNDLE_VERSION,
          });
          legalAcceptanceRequired = !accepted;
        }

        return NextResponse.json({
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            username: user.username,
            // session.role is decoded.role — for a modern staff-hat token
            // this is the legacy-bridge string (e.g. "Admin") set by
            // switch-profile/route.js; for a legacy token it's the same
            // string the token was issued with. NEVER the DB's root
            // User.role — that reflects the account's default hat, not
            // this session's active one, and can differ (see comment atop
            // session-context.js).
            role: session.role || "Staff",
            societyId: session.societyId,
            ...(session.isLegacyToken ? { societyCode: user.societyCode } : {}),
            // Present only on a superadmin's impersonation token — see
            // docs/superpowers/specs/2026-09-11-society-takeover-design.md.
            // Lets the dashboard shell render the persistent support-session
            // banner without the shell needing to know about JWTs at all.
            ...(decoded.takeover ? { takeover: decoded.takeover } : {}),
            ...(legalAcceptanceRequired ? { legalAcceptanceRequired: true } : {}),
          },
        });
      }

      // ── MEMBER hat — derive context from the user's profiles[] array.
      // JWT/session carries only activeProfileId (+legacy societyId/memberId
      // on old tokens) — never trust societyName/flatNo/role from the token
      // itself, always resolve fresh from the current profile record. ─────
      const user = await User.findById(session.userId).select(
        "name username email phone profiles activeProfileId isActive loginPausedUntil loginBlockedReason",
      );
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      const block = loginBlockFor(user);
      if (block) {
        return NextResponse.json({ error: block.message, code: block.code }, { status: 403 });
      }
      if (session.activeProfileId) {
        const activeProfile = user.profiles.find(
          (p) => String(p.profileId) === String(session.activeProfileId),
        );
        if (!activeProfile) {
          return NextResponse.json(
            { error: "Active profile not found — please log in again" },
            { status: 401 },
          );
        }
        return NextResponse.json({
          user: {
            id: user._id,
            name: user.name,
            username: user.username,
            email: user.email,
            phone: user.phone,
            role: activeProfile.role,
            societyId: activeProfile.societyId,
            memberId: activeProfile.memberId,
            flatNo: activeProfile.flatNo,
            wing: activeProfile.wing,
            societyName: activeProfile.societyName,
            activeProfile,
            profiles: user.profiles.filter((p) => p.status === "Active"),
          },
        });
      }
      // Legacy Member token (pre-migration) with no activeProfileId — fall
      // back to the first active profile, or the bare old shape if this
      // account was never migrated at all.
      if (user.profiles?.length > 0) {
        const profile =
          user.profiles.find((p) => p.status === "Active") ?? user.profiles[0];
        return NextResponse.json({
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: profile.role,
            societyId: profile.societyId,
            memberId: profile.memberId,
            flatNo: profile.flatNo,
            wing: profile.wing,
            activeProfile: profile,
          },
        });
      }
      return NextResponse.json({ user });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  } catch (err) {
    console.error("/api/auth/me error:", err.message);
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
