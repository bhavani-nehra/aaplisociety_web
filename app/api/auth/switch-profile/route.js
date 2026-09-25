// app/api/auth/switch-profile/route.js
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import { signToken } from "@/lib/jwt";
import { issueRefreshToken, setRefreshCookie, peekSessionStartedAt } from "@/lib/refresh-token";
import {
  isStaffProfileId,
  assignmentIdFromProfileId,
  loadActiveAssignment,
} from "@/lib/rbac/staff-profiles";
import Society from "@/models/Society";
import { loginBlockFor } from "@/lib/auth/login-block";
import { legacyRoleForKey } from "@/lib/rbac/legacy-role-bridge";
export async function POST(request) {
  try {
    await connectDB();
    const body = await request.json();
    const { profileId, profileSelectToken } = body;
    if (!profileId) {
      return NextResponse.json({ error: "profileId is required" }, { status: 400 });
    }
    // Auth: existing session cookie OR short-lived profile-select token from login
    const userToken = request.cookies.get("token")?.value;
    let resolvedUserId;
    if (userToken) {
      let decoded;
      try {
        decoded = jwt.verify(userToken, process.env.JWT_SECRET);
      } catch {
        return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      }
      resolvedUserId = decoded.userId;
    } else if (profileSelectToken) {
      let decoded;
      try {
        decoded = jwt.verify(profileSelectToken, process.env.JWT_SECRET);
      } catch {
        return NextResponse.json({ error: "Invalid or expired profile-select token" }, { status: 401 });
      }
      if (decoded.purpose !== "profile-select") {
        return NextResponse.json({ error: "Invalid token purpose" }, { status: 401 });
      }
      resolvedUserId = decoded.userId;
    } else {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const user = await User.findById(resolvedUserId);
    const block = loginBlockFor(user);
    if (block) {
      return NextResponse.json({ error: block.message, code: block.code }, { status: 403 });
    }

    // Plan 05 Part A: switching profiles/hats mid-session is not a new
    // login — the 24h absolute cap must keep counting from when the user
    // actually signed in, not reset every time they switch flats/hats.
    // Best-effort: a genuinely new session (profileSelectToken path, no
    // refreshToken cookie yet) has nothing to carry forward, which is
    // correct — that IS a new session.
    const sessionStartedAt = peekSessionStartedAt(request.cookies.get("refreshToken")?.value);

    // Staff/management profile (backed by a RoleAssignment, not user.profiles[]).
    if (isStaffProfileId(profileId)) {
      const assignmentId = assignmentIdFromProfileId(profileId);
      const assignment = await loadActiveAssignment(user._id, assignmentId);
      if (!assignment) {
        return NextResponse.json(
          { error: "Role assignment not found or inactive" },
          { status: 404 },
        );
      }
      const society = await Society.findById(assignment.societyId).select("name").lean();
      const newToken = signToken({
        userId: user._id,
        activeContext: { societyId: assignment.societyId, hat: "staff" },
        // Root-level societyId, additive — see login/route.js CASE A comment.
        societyId: assignment.societyId,
        // Legacy bridge — see lib/rbac/legacy-role-bridge.js and the identical
        // comment in login/route.js. Switching INTO a staff hat mid-session
        // must restore the same legacy `role` string login would have given it,
        // or every lib/authz.js-gated route 403s the moment someone switches
        // to it instead of it being their first login of the session.
        role: legacyRoleForKey(assignment.roleKey),
        sessionEpoch: user.sessionEpoch || 0,
      });
      const response = NextResponse.json({
        success: true,
        activeProfile: {
          profileId,
          societyId: assignment.societyId,
          societyName: society?.name || "",
          kind: "Staff",
        },
        user: { id: user._id, name: user.name, username: user.username },
      });
      response.cookies.set("token", newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 15, // Plan 05 Part A — matches lib/jwt.js's 15m access-token default
      });
      setRefreshCookie(response, await issueRefreshToken(user._id, { sessionStartedAt }));
      return response;
    }

    // Find the requested member profile
    const profile = user.profiles.find(
      (p) => String(p.profileId) === String(profileId) && p.status === "Active",
    );
    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found or inactive" },
        { status: 404 },
      );
    }
    // Persist activeProfileId on user document
    await User.updateOne(
      { _id: user._id },
      { activeProfileId: profile.profileId },
    );
    // Issue fresh JWT — include profile fields so member API routes work
    const newToken = signToken({
      userId: user._id,
      activeProfileId: profile.profileId,
      memberId: profile.memberId,
      societyId: profile.societyId,
      role: profile.role,
      occupancyType: profile.occupancyType,
    });
    const response = NextResponse.json({
      success: true,
      activeProfile: {
        profileId: profile.profileId,
        societyId: profile.societyId,
        memberId: profile.memberId,
        societyName: profile.societyName,
        flatNo: profile.flatNo,
        wing: profile.wing,
        role: profile.role,
      },
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
      },
    });
    response.cookies.set("token", newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 15, // Plan 05 Part A — matches lib/jwt.js's 15m access-token default
    });
    setRefreshCookie(response, await issueRefreshToken(user._id, { sessionStartedAt }));
    return response;
  } catch (error) {
    console.error("switch-profile error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
