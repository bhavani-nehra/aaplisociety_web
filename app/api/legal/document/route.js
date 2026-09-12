import { NextResponse } from "next/server";
import { findDocument } from "@/lib/legal/documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/legal/document?doc=tos|privacy|refund — placeholder text for one
// of the legal documents. Full text isn't published yet; this just backs the
// acceptance flow's "read the document" panel until it is.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const doc = findDocument(searchParams.get("doc"));
  if (!doc) {
    return NextResponse.json({ error: "Unknown document" }, { status: 404 });
  }

  return NextResponse.json({
    id: doc.id,
    title: doc.title,
    content: `_Full text of the ${doc.title} is coming soon._`,
  });
}
