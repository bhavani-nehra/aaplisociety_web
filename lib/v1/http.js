// Shared HTTP helpers for /v1 route handlers. Replaces the Express
// errorHandler middleware: withRoute connects to Mongo, runs the handler, and
// converts thrown ApiError / unexpected errors into JSON responses.
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import connectDB from "@/lib/mongodb";
import { wantsTiming, recordTiming } from "@/lib/appserverlogs";

export class ApiError extends Error {
  // message may be a string OR an already-shaped body object (e.g. a zod
  // flatten result under { error: ... }).
  constructor(status, message) {
    super(typeof message === "string" ? message : "error");
    this.status = status;
    this.body = typeof message === "string" ? { error: message } : message;
  }
}

export function json(data, init) {
  return NextResponse.json(data, init);
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

// Throw for a failed zod safeParse, preserving the flattened field errors
// the Flutter client's api_error.dart already knows how to read.
export function zodError(parsed) {
  return new ApiError(400, { error: parsed.error.flatten() });
}

// Wraps a route handler: ensures a DB connection, catches ApiError and
// unexpected errors. Handlers receive (req, ctx) exactly like Next.js passes.
export function withRoute(fn) {
  return async (req, ctx) => {
    const timing = wantsTiming(req);
    const startedAt = timing ? Date.now() : 0;
    let status = 500;
    try {
      await connectDB();
      const res = await fn(req, ctx);
      status = res.status;
      return res;
    } catch (e) {
      if (e instanceof ApiError) {
        status = e.status;
        return NextResponse.json(e.body, { status: e.status });
      }
      // SEC-15: the previous version interpolated `e.message` straight into
      // the response body in every environment. Its own comment said "TEMP DEV
      // TOOL — DELETE ... revert to the generic message before real users are
      // on this", and there was no NODE_ENV guard, so Mongo CastErrors, driver
      // internals and filesystem paths were being printed on residents' and
      // guards' phones.
      //
      // The real reason still rides along — it rides in the server log, tagged
      // with a requestId the client shows the user, so support can find the
      // exact request without the user ever seeing the internals.
      const requestId = crypto.randomUUID().slice(0, 8);
      console.error(`[v1] unhandled error requestId=${requestId}`, e);
      return NextResponse.json(
        {
          // `error` is kept because every existing client (api_error.dart's
          // apiErrorMessage(), the web api-client) reads that key today.
          // Dropping it would turn every 500 into a blank message on shipped
          // Flutter builds. New fields are additive.
          error: "Something went wrong on our side. Your data is safe.",
          code: "INTERNAL",
          message: "Internal server error",
          userMessage: "Something went wrong on our side. Your data is safe.",
          retryable: true,
          requestId,
        },
        { status: 500 },
      );
    } finally {
      if (timing) {
        recordTiming({
          method: req.method,
          path: new URL(req.url).pathname,
          durationMs: Date.now() - startedAt,
          status,
        });
      }
    }
  };
}