import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import TermsAcceptance from "@/models/TermsAcceptance";
import { requireRoles, SOCIETY_ADMIN_ROLES } from "@/lib/authz";
import { BUNDLE_VERSION, LEGAL_DOCUMENTS } from "@/lib/legal/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/legal/status — has this Society accepted the current
// document bundle? One acceptance covers the whole Society (see
// models/TermsAcceptance.js) — any Admin/Secretary checking sees the same
// answer.
export async function GET(request) {
  const auth = requireRoles(request, SOCIETY_ADMIN_ROLES);
  if (!auth.valid) return auth;

  try {
    await connectDB();
    const record = await TermsAcceptance.findOne({
      societyId: auth.user.societyId,
      bundleVersion: BUNDLE_VERSION,
    }).lean();

    return NextResponse.json({
      bundleVersion: BUNDLE_VERSION,
      accepted: Boolean(record),
      acceptedAt: record?.acceptedAt || null,
      acceptedByName: record?.acceptedByName || null,
      documents: LEGAL_DOCUMENTS.map((d) => ({ id: d.id, title: d.title })),
    });
  } catch (error) {
    console.error("legal status check failed:", error);
    return NextResponse.json({ error: error.message || "Could not check acceptance status." }, { status: 500 });
  }
}
