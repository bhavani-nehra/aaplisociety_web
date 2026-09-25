// app/api/admin/security-guards/[id]/route.js
// Admin: update, reset password, or remove a security guard.
//   PATCH  { isActive?, gateLabel?, phone?, name? }
//   POST   { action: "reset-password", password? }  -> returns temp password if generated
//   DELETE -> soft-delete (isDeleted + deactivate)
import { NextResponse } from "next/server";
import crypto from "crypto";
import mongoose from "mongoose";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { requireRoles } from "@/lib/authz";
import { logAudit } from "@/lib/audit-logger";
import { authorize } from "@/lib/rbac/authorize";
import { passwordPolicyProblem } from "@/lib/password-policy";
// SEC-19: a password reset must also end the sessions running on the old one.
import { bumpSessionEpoch } from "@/lib/rbac/session";
function isPlausiblePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}
async function loadGuard(id, societyId) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return User.findOne({
    _id: id,
    role: "Security",
    societyId,
    isDeleted: { $ne: true },
  });
}
export async function PATCH(request, { params }) {
  const gate = await authorize(request, "security.guard.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const guard = await loadGuard(id, gate.context.societyId);
    if (!guard)
      return NextResponse.json({ error: "Guard not found" }, { status: 404 });
    const body = await request.json();
    const updates = {};
    if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
    if (typeof body.gateLabel === "string") {
      const g = body.gateLabel.trim();
      if (g.length > 50)
        return NextResponse.json({ error: "Gate label too long" }, { status: 400 });
      updates.gateLabel = g || "Main Gate";
    }
    if (typeof body.name === "string" && body.name.trim())
      updates.name = body.name.trim();
    if (typeof body.phone === "string") {
      if (body.phone && !isPlausiblePhone(body.phone))
        return NextResponse.json({ error: "Invalid phone" }, { status: 400 });
      updates.phone = body.phone.trim();
    }
    if (Object.keys(updates).length === 0)
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    const before = {
      isActive: guard.isActive,
      gateLabel: guard.gateLabel,
      phone: guard.phone,
      name: guard.name,
    };
    Object.assign(guard, updates);
    await guard.save();
    await logAudit(gate.context.userId, gate.context.societyId, "SECURITY_GUARD_UPDATED", before, {
      id: guard._id.toString(),
      ...updates,
    });
    return NextResponse.json({
      success: true,
      guard: {
        id: guard._id.toString(),
        name: guard.name,
        username: guard.username,
        gateLabel: guard.gateLabel,
        phone: guard.phone || "",
        isActive: guard.isActive,
      },
    });
  } catch (err) {
    console.error("Update guard error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function POST(request, { params }) {
  const gate = await authorize(request, "security.guard.resetPin");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const guard = await loadGuard(id, gate.context.societyId);
    if (!guard)
      return NextResponse.json({ error: "Guard not found" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    if (body.action !== "reset-password")
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    // Either accept an admin-supplied password or generate a strong temp one.
    let newPassword = String(body.password || "");
    let generated = false;
    if (!newPassword) {
      newPassword = generatePassword();
      generated = true;
    } else {
      const pwProblem = passwordPolicyProblem(newPassword);
      if (pwProblem) return NextResponse.json({ error: pwProblem }, { status: 400 });
    }
    guard.password = await bcrypt.hash(newPassword, 10);
    // SEC-19: a guard account has no email address (only name / username /
    // phone — see POST /api/admin/security-guards), so the setup-link flow used
    // for society admins and members is not available here: there is no channel
    // to send it on. The temp password genuinely has to be handed over in
    // person at the gate.
    //
    // What makes that acceptable is that it must be single-use. Without this
    // flag the "temporary" password is simply the guard's password, for as long
    // as they keep using it, and a value that was read aloud and possibly
    // written down stays valid indefinitely.
    guard.mustChangePassword = true;
    await guard.save();
    // Any session the guard already had is running on the OLD password. A reset
    // that leaves it working is not a reset — this is the same mechanism role
    // handover and the admin setup-link reset use.
    try {
      await bumpSessionEpoch(String(guard._id));
    } catch (err) {
      // Never fatal: the password is already changed, so an un-bumped old
      // session is the lesser problem and it expires on its own.
      console.error("[security-guards] bumpSessionEpoch failed:", err?.message);
    }
    await logAudit(gate.context.userId, gate.context.societyId, "SECURITY_GUARD_PASSWORD_RESET", null, {
      id: guard._id.toString(),
      username: guard.username,
    });
    // Shown exactly once, and only when WE generated it. An admin-supplied
    // password is never echoed back — the admin already knows it, and echoing
    // it only widens where it can be captured.
    return NextResponse.json({
      success: true,
      username: guard.username,
      mustChangePassword: true,
      tempPassword: generated ? newPassword : undefined,
    });
  } catch (err) {
    console.error("Reset guard password error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
export async function DELETE(request, { params }) {
  const gate = await authorize(request, "security.guard.delete");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const { id } = await params;
    const guard = await loadGuard(id, gate.context.societyId);
    if (!guard)
      return NextResponse.json({ error: "Guard not found" }, { status: 404 });
    guard.isDeleted = true;
    guard.isActive = false;
    await guard.save();
    await logAudit(gate.context.userId, gate.context.societyId, "SECURITY_GUARD_DELETED", null, {
      id: guard._id.toString(),
      username: guard.username,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Delete guard error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
function generatePassword() {
  // 10-char temp password guaranteed to contain lower+upper+digit+symbol
  // (matches lib/password-policy.js).
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = lower + upper + digits + symbols;
  let out =
    lower[crypto.randomInt(lower.length)] +
    upper[crypto.randomInt(upper.length)] +
    digits[crypto.randomInt(digits.length)] +
    symbols[crypto.randomInt(symbols.length)];
  for (let i = 0; i < 6; i++) out += all[crypto.randomInt(all.length)];
  return out
    .split("")
    .sort(() => crypto.randomInt(3) - 1)
    .join("");
}
