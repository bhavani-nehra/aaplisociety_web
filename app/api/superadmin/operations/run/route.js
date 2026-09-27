import { NextResponse } from "next/server";
import { validateAdminRequest } from "@/lib/admin-middleware";
import { cronJob } from "@/lib/ops/cronRegistry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "http://localhost:3000";

/**
 * POST /api/superadmin/operations/run
 * Body: { job: "<key>", dryRun?: boolean }
 *
 * Run a scheduled job by hand, from the operations dashboard.
 *
 * ## Why this is a proxy and not a direct call
 *
 * The obvious implementation imports the handler and calls it. That would mean
 * a manual run exercises different code from a scheduled one — different auth,
 * different runtime, different timeout — so a job that works here could still
 * fail at 4am, which is the opposite of what a test button is for.
 *
 * So this makes the same HTTP request cron-job.org makes, with the same secret
 * and against the same route. If it works here it works there.
 *
 * ## Why a dry run does not count as a run
 *
 * The tracker records `dryRun: true`, and collectHealth() ignores dry runs when
 * deciding whether a job is stale. Otherwise pressing this button would reset
 * the clock and hide a dead schedule for another full interval — a monitor you
 * can silence by looking at it.
 */
export async function POST(request) {
  const validation = validateAdminRequest(request);
  if (!validation.valid) return validation;

  try {
    const body = await request.json().catch(() => ({}));
    const job = cronJob(String(body.job || ""));
    if (!job) {
      return NextResponse.json(
        { error: "Unknown job. It must be listed in lib/ops/cronRegistry.js." },
        { status: 400 },
      );
    }

    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json(
        {
          error:
            "CRON_SECRET is not configured, so this cannot make the same request the scheduler makes.",
        },
        { status: 400 },
      );
    }

    const dryRun = body.dryRun !== false;
    const url = `${APP_URL}${job.path}${dryRun ? "?dryRun=1" : ""}`;

    const startedAt = Date.now();
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        // So a run started from this page is distinguishable in any log from
        // one the scheduler started.
        "X-Triggered-By": `superadmin:${validation.admin?.userId || "unknown"}`,
      },
      cache: "no-store",
    });

    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 2000) };
    }

    return NextResponse.json({
      job: job.key,
      dryRun,
      status: res.status,
      ok: res.ok,
      tookMs: Date.now() - startedAt,
      result: payload,
    });
  } catch (err) {
    console.error("manual cron run error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
