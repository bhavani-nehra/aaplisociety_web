// app/api/auth/login/route.js
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import AuditLog from "@/models/AuditLog";
import { signToken } from "@/lib/jwt";
import { issueRefreshToken, setRefreshCookie } from "@/lib/refresh-token";
import { getStaffProfiles } from "@/lib/rbac/staff-profiles";
import { legacyRoleForKey } from "@/lib/rbac/legacy-role-bridge";
import { loginBlockFor, pauseHasExpired } from "@/lib/auth/login-block";
import { enforceRateLimit } from "@/lib/v1/ratelimit";
import { ApiError } from "@/lib/v1/http";
import { refreshEntitlementSnapshot } from "@/lib/entitlements/resolve";
import { verifyTurnstileToken } from "@/lib/turnstile";
import TermsAcceptance from "@/models/TermsAcceptance";
import { BUNDLE_VERSION } from "@/lib/legal/documents";
const MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_LOGIN, 10) || 10;
const WINDOW_MS = 15 * 60 * 1000;
export async function POST(request) {
  // Shared Redis-backed limiter (lib/v1/ratelimit.js) keyed per-identifier,
  // same window/limit/reset-on-success semantics as the old in-memory Map —
  // just no longer reset to zero on every cold start / new serverless
  // instance, which made the old limit effectively decorative.
  let commit;
  try {
    await connectDB();
    const body = await request.json();
    const rawIdentifier = body.username || body.email || "";
    const rawPassword = body.password;
    if (typeof rawIdentifier !== "string" || typeof rawPassword !== "string") {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 400 },
      );
    }
    const identifier = rawIdentifier.trim().toLowerCase();
    const password = rawPassword;
    if (!identifier || !password) {
      return NextResponse.json(
        { error: "Username/email and password are required" },
        { status: 400 },
      );
    }
    const ipForTurnstile = request.headers.get("x-forwarded-for") || undefined;
    const turnstileOk = await verifyTurnstileToken(
      body.turnstileToken,
      ipForTurnstile,
    );
    if (!turnstileOk) {
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 400 },
      );
    }
    try {
      commit = await enforceRateLimit(request, "web-login", {
        windowMs: WINDOW_MS,
        limit: MAX_ATTEMPTS,
        key: identifier,
        skipSuccessfulRequests: true,
        message: "Too many login attempts. Try again later.",
      });
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json(err.body, { status: err.status });
      }
      throw err;
    }
    // Find by username  OR  email  (covers both Member and Admin flows)
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
      // Deliberately NOT filtered on isActive. A disabled account used to fall
      // through to "Invalid credentials", so the person retyped a correct
      // password over and over with no idea their login had been switched off.
      // The block is checked below, AFTER the password is verified, so this
      // still leaks nothing to someone who does not know the password.
    });
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const ua = request.headers.get("user-agent") || "unknown";
    if (!user) {
      await AuditLog.create({
        action: "LOGIN_FAILURE",
        newData: { identifier, reason: "user_not_found", ip, ua },
        timestamp: new Date(),
      }).catch(() => {});
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await AuditLog.create({
        userId: user._id,
        societyId: user.societyId,
        action: "LOGIN_FAILURE",
        newData: { identifier, reason: "wrong_password", ip, ua },
        timestamp: new Date(),
      }).catch(() => {});
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    // ── Account switched off, or login paused ────────────────────────────────
    const block = loginBlockFor(user);
    if (block) {
      await AuditLog.create({
        userId: user._id,
        societyId: user.societyId,
        action: "LOGIN_BLOCKED",
        newData: { identifier, reason: block.code, ip, ua },
        timestamp: new Date(),
      }).catch(() => {});
      return NextResponse.json({ error: block.message, code: block.code }, { status: 403 });
    }
    // An elapsed pause is cleared on the way through, so nobody has to remember
    // to switch the account back on.
    if (pauseHasExpired(user)) {
      user.loginPausedUntil = null;
      await User.updateOne({ _id: user._id }, { $set: { loginPausedUntil: null } }).catch(() => {});
    }

    // Legacy Admin/Secretary/Accountant/Security/SOCIETY_ADMIN branch removed
    // 2026-08-20: every one of those accounts now has a RoleAssignment (see
    // scripts/rbac/backfill-assignments.js) and flows through the SAME merged
    // picker every member/staff account uses below. A single-hat account
    // (the common case) still auto-logs in with no picker shown — see CASE A
    // just below, unchanged in effect, just reached via RoleAssignment instead
    // of a hardcoded role-string branch. Multi-hat accounts (e.g. admin of two
    // societies, or an admin who is also a resident) now correctly see the
    // picker, which the old branch could never show them.
    //
    // Five orphaned SOCIETY_ADMIN test accounts whose societyId points at a
    // deleted/nonexistent Society were left unmigrated on purpose (see
    // scripts/rbac/backfill-assignments.js output) — they were already unusable
    // (no real society to operate on) and now fail at CASE C below with an
    // honest "no active society profiles" instead of minting a token scoped to
    // a society that does not exist.
    // ── MEMBER — multi-profile logic ─────────────────────────────────────────
    const activeProfiles = (user.profiles ?? []).filter(
      (p) => p.status === "Active",
    );
    // A member can ALSO hold a staff RoleAssignment (e.g. "Auditor" on top of
    // their own flat) — those need to appear as selectable entries too, or
    // granting the role gives them no way to ever use it.
    const staffProfiles = await getStaffProfiles(user._id);
    const totalProfileCount = activeProfiles.length + staffProfiles.length;
    // CASE A: exactly one profile total (member OR staff, never both) → auto-login
    if (totalProfileCount === 1 && staffProfiles.length === 1) {
      commit(true);
      const assignment = staffProfiles[0];
      // Warm the edge entitlement snapshot while we are already in Mongo, so
      // the session starts with middleware able to gate correctly on its very
      // first request. A failure here must never block a login — the snapshot
      // is a cache, and a cold one simply lets requests through until the next
      // read repopulates it (see lib/entitlements/snapshot.js).
      await refreshEntitlementSnapshot(assignment.societyId).catch(() => {});
      // Legal document (Terms of Service / Privacy Policy / Refund policy)
      // acceptance gate — checked right at login so a Society's first
      // Admin/Secretary login goes straight to /legal/accept instead of
      // flashing the dashboard first. See legal/*.md,
      // lib/legal/documents.js. DashboardLayout's own check (app/api/auth/
      // me) is the catch-all for every other entry path (profile-select,
      // switch-profile, a direct URL) — this is purely the fast path for
      // the common case.
      let legalAcceptanceRequired = false;
      if (assignment.role === "Admin" || assignment.role === "Secretary") {
        const accepted = await TermsAcceptance.exists({
          societyId: assignment.societyId,
          bundleVersion: BUNDLE_VERSION,
        });
        legalAcceptanceRequired = !accepted;
      }
      const token = signToken({
        userId: user._id,
        activeContext: { societyId: assignment.societyId, hat: "staff" },
        // Root-level societyId, additive: authorize()/page-guard.js read
        // activeContext.societyId (checked first, takes priority) — this is
        // only for the large amount of pre-RBAC route code that reads
        // decoded.societyId directly and would otherwise silently scope
        // queries to "undefined" for any RBAC-only staff role.
        societyId: assignment.societyId,
        // Legacy bridge: lib/authz.js's requireRoles() still reads decoded.role
        // directly and knows nothing about activeContext. Admin/Secretary/
        // Accountant/Security resolve to their old string here so every
        // requireRoles()-gated route keeps working for a migrated staff
        // account; a pure-RBAC role (Auditor etc) resolves to undefined, same
        // as before this bridge existed. See lib/rbac/legacy-role-bridge.js.
        role: legacyRoleForKey(assignment.roleKey),
        sessionEpoch: user.sessionEpoch || 0,
      });
      const response = NextResponse.json({
        success: true,
        requiresProfileSelect: false,
        user: {
          id: user._id,
          name: user.name,
          username: user.username,
          role: assignment.role,
          kind: "Staff",
          societyId: assignment.societyId,
          societyName: assignment.societyName,
          ...(legalAcceptanceRequired ? { legalAcceptanceRequired: true } : {}),
        },
      });
      response.cookies.set("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 8,
      });
      setRefreshCookie(response, await issueRefreshToken(user._id));
      return response;
    }
    if (activeProfiles.length === 1 && staffProfiles.length === 0) {
      commit(true);
      const profile = activeProfiles[0];
      // Persist activeProfileId
      await User.updateOne(
        { _id: user._id },
        { activeProfileId: profile.profileId },
      );
      await refreshEntitlementSnapshot(profile.societyId).catch(() => {});
      const token = signToken({
        userId: user._id,
        activeProfileId: profile.profileId,
        memberId: profile.memberId,
        societyId: profile.societyId,
        role: profile.role,
        occupancyType: profile.occupancyType,
      });
      const response = NextResponse.json({
        success: true,
        requiresProfileSelect: false,
        user: {
          id: user._id,
          name: user.name,
          username: user.username,
          role: profile.role,
          societyId: profile.societyId,
          memberId: profile.memberId,
          flatNo: profile.flatNo,
          wing: profile.wing,
          societyName: profile.societyName,
          activeProfile: profile,
        },
      });
      response.cookies.set("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 8,
      });
      setRefreshCookie(response, await issueRefreshToken(user._id));
      return response;
    }
    // CASE B: multiple profiles (member flats and/or staff roles) → return
    // the merged list, frontend shows one selector for all of them.
    if (totalProfileCount > 1) {
      commit(true);
      const profileSelectToken = signToken(
        {
          userId: user._id,
          purpose: "profile-select",
        },
        { expiresIn: "30m" },
      );
      // Commercial profiles have no flatNo/wing of their own (they link a
      // Shop, not a Member) — resolve the shop label instead of showing a
      // blank "Flat -".
      const commercialShopIds = activeProfiles
        .filter((p) => p.kind === "Commercial" && p.shopId)
        .map((p) => p.shopId);
      let shopLabelById = new Map();
      if (commercialShopIds.length) {
        const Shop = (await import("@/models/Shop")).default;
        const shops = await Shop.find({ _id: { $in: commercialShopIds } })
          .select("wing shopNo")
          .lean();
        shopLabelById = new Map(
          shops.map((s) => [String(s._id), [s.wing, s.shopNo].filter(Boolean).join("-")]),
        );
      }
      // No cookie yet — user must pick a society first
      return NextResponse.json({
        success: true,
        requiresProfileSelect: true,
        userId: user._id,
        profileSelectToken,
        name: user.name,
        username: user.username,
        profiles: [
          ...activeProfiles.map((p) => ({
            profileId: p.profileId,
            societyId: p.societyId,
            societyName: p.societyName,
            flatNo:
              p.kind === "Commercial"
                ? shopLabelById.get(String(p.shopId)) || ""
                : p.flatNo,
            wing: p.kind === "Commercial" ? "" : p.wing,
            role: p.role,
            kind: p.kind || "Residential",
          })),
          ...staffProfiles,
        ],
      });
    }
    // CASE C: Member with zero active profiles (edge case / misconfigured)
    return NextResponse.json(
      { error: "No active society profiles found for this account" },
      { status: 403 },
    );
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
