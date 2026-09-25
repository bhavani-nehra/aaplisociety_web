// POST /v1/calls/webhook — Plan 03 §14. Provider status callback.
//
// No user token here: the caller is the telephony provider, not the app, so
// this is authenticated by an HMAC signature over the raw body instead of a
// Bearer token. There is no provider wired in yet (§11), so
// CALL_PROVIDER_WEBHOOK_SECRET stays unset until one is, and this route
// refuses every request until it is — never open-by-default.
import { NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import { ApiError } from "@/lib/v1/http";
import { verifyWebhookSignature, applyProviderStatusUpdate } from "@/lib/v1/calls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  await connectDB();

  const raw = await req.text();
  const signature = req.headers.get("x-call-signature") || "";
  const secret = process.env.CALL_PROVIDER_WEBHOOK_SECRET;

  if (!verifyWebhookSignature(raw, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    // applyProviderStatusUpdate is idempotent on providerCallId, so a
    // provider's at-least-once retry of the same event is safe to re-run.
    const session = await applyProviderStatusUpdate(body);
    return NextResponse.json({ ok: true, status: session.status });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(err.body, { status: err.status });
    }
    console.error("[v1/calls/webhook] unhandled error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
