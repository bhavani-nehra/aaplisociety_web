// GET/PUT /api/admin/society-contacts
//
// Admin-managed essential-contacts directory. Read by
// app/api/v1/society/contacts/route.js (the resident app's phone book) off
// the same Society.contacts field this route writes — no separate sync step.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Society from "@/models/Society";
import { getTokenFromRequest, verifyToken } from "@/lib/jwt";
import cache from "@/lib/cache";
import { authorize } from "@/lib/rbac/authorize";

const CATEGORIES = [
  "Society Office",
  "Watchman/Security",
  "Plumber",
  "Electrician",
  "Gas Agency",
  "Housekeeping",
  "Pest Control",
  "Lift AMC",
  "Other",
];

// A number the dialer can actually use — matches the digit range the v1
// route's phone-book entries assume (bare 10-digit local, or with a country
// code prefix).
const NUMBER_RE = /^[0-9]{10,15}$/;

function validate(contacts) {
  if (!Array.isArray(contacts)) return ["contacts must be an array"];
  const errors = [];
  contacts.forEach((c, i) => {
    if (!CATEGORIES.includes(c.category)) {
      errors.push(`Row ${i + 1}: category must be one of ${CATEGORIES.join(", ")}`);
    }
    if (c.category === "Other" && !`${c.name || ""}`.trim()) {
      errors.push(`Row ${i + 1}: "Other" contacts need a name`);
    }
    const numbers = (c.numbers || []).map((n) => `${n}`.replace(/[^0-9]/g, "")).filter(Boolean);
    if (numbers.length > 3) errors.push(`Row ${i + 1}: at most 3 numbers`);
    if (numbers.some((n) => !NUMBER_RE.test(n))) {
      errors.push(`Row ${i + 1}: each number must be 10-15 digits`);
    }
  });
  return errors;
}

export async function GET(request) {
  const gate = await authorize(request, "society.contacts.view");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const societyId = gate.context.societyId || decoded.societyId;
    const society = await Society.findById(societyId).select("contacts").lean();
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });
    return NextResponse.json({ contacts: society.contacts || [], categories: CATEGORIES });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request) {
  const gate = await authorize(request, "society.contacts.update");
  if (!gate.ok) return gate.response;
  try {
    await connectDB();
    const token = getTokenFromRequest(request);
    const decoded = token ? verifyToken(token) : null;
    if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const societyId = gate.context.societyId || decoded.societyId;
    const body = await request.json();
    // A row left blank by "Seed defaults" and never filled in is dropped
    // here rather than rejected — the admin didn't ask to save an empty
    // placeholder, they asked to save the list as they left it.
    const submitted = Array.isArray(body.contacts) ? body.contacts : [];
    const contacts = submitted
      .map((c) => ({
        category: c.category,
        name: `${c.name || ""}`.trim(),
        numbers: (c.numbers || []).map((n) => `${n}`.trim()).filter(Boolean).slice(0, 3),
      }))
      .filter((c) => c.numbers.length > 0);
    const errors = validate(contacts);
    if (errors.length) {
      return NextResponse.json({ error: errors.join("; "), errors }, { status: 400 });
    }
    const society = await Society.findByIdAndUpdate(
      societyId,
      { $set: { contacts } },
      { new: true, runValidators: true },
    ).select("contacts");
    if (!society) return NextResponse.json({ error: "Society not found" }, { status: 404 });
    // Invalidate the resident app's cache immediately rather than waiting
    // out the 5-minute hard TTL in v1/society/contacts/route.js.
    await cache.del(`v1:society-contacts:${societyId}`);
    return NextResponse.json({ success: true, contacts: society.contacts });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
