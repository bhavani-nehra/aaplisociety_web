// middleware.js
import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import cache from "@/lib/cache";
import { getSessionEpochFloor } from "@/lib/session-epoch";
import { moduleForPath, isNeverGated } from "@/lib/entitlements/modules";
import { readEntitlementSnapshot } from "@/lib/entitlements/snapshot";
import { recordDenial } from "@/lib/entitlements/denials";
import { lifecycleRefusal } from "@/lib/entitlements/readOnly";
const ALLOWED_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
// Extra CSRF-allowed origins (comma-separated). Use for tunnels like ngrok.
// e.g. ALLOWED_ORIGINS="https://nguyet-diffusible-madonna.ngrok-free.dev"
const EXTRA_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
async function parseJwt(t, secretEnvKey = "JWT_SECRET") {
  try {
    const secret = new TextEncoder().encode(process.env[secretEnvKey]);
    const { payload } = await jwtVerify(t, secret);
    return payload;
  } catch {
    return null;
  }
}
// Single choke point for the logout/session-revocation denylist (see
// app/api/auth/logout and app/api/v1/auth/logout, which write
// revoked:jti:<jti>). Both lib/authz.js's requireAuth (123 legacy routes)
// and lib/rbac/authorize.js call verifyToken() but neither reads this key,
// so without this check a "logged out" token stayed valid for up to 7 days.
// jose + lib/cache.js (Upstash REST) are both edge-safe, so this runs before
// any route handler regardless of runtime.
async function isRevoked(payload) {
  if (!payload?.jti) return false;
  return Boolean(await cache.get(`revoked:jti:${payload.jti}`));
}
// Session-freshness backstop (Q11 in lib/rbac/session.js): rejects any token
// whose sessionEpoch predates a privilege reduction / suspendUser() call,
// even on the 123 routes still guarded by the legacy lib/authz.js (which
// never re-checks role/status per request). Sourced from the Redis floor
// lib/rbac/session.js.bumpSessionEpoch writes — no Mongo access needed here.
async function isStaleSession(payload) {
  const userId = payload?.userId || payload?.sub || payload?.id;
  if (!userId) return false;
  const floor = await getSessionEpochFloor(userId);
  if (floor === null) return false; // nothing ever bumped for this user — nothing to enforce
  const tokenEpoch = payload.sessionEpoch || 0;
  return tokenEpoch < floor;
}
// LOOP-05: written by the lifecycle route (pause / pause-until / delete-
// until), TTL'd to match, and cleared on resume / delete-permanently.
async function isSocietyPaused(payload) {
  const societyId = payload?.activeContext?.societyId || payload?.societyId;
  if (!societyId) return false;
  return Boolean(await cache.get(`paused-society:${societyId}`));
}
// ── Module entitlements ──────────────────────────────────────────────────
//
// The central gate. Every route belonging to an add-on module is checked here,
// by path, before it reaches a handler.
//
// ## Why here and not in each route
//
// There are 173 API routes under the six module prefixes today, and more will
// be written. Gating them one handler at a time works right up until somebody
// forgets, and the failure is silent — a paid feature served to a society that
// never bought it, nothing thrown, nothing logged, no test red. Gating by path
// covers every route that exists and every route not yet written, which is the
// only version of this that stays true over time.
//
// Middleware runs on the edge and cannot reach Mongo, so it reads the
// self-contained snapshot lib/entitlements/snapshot.js maintains. See that file
// for why a missing snapshot lets the request through rather than blocking it.
//
// The response is a bare 404 — never a 403. A 403 says "this exists and you
// cannot have it", which is a product catalogue for anyone mapping the
// platform. Only a superadmin gets the header explaining why.
async function moduleDenied(request, pathname, payload, nonce) {
  if (isNeverGated(pathname)) return null;
  const mod = moduleForPath(pathname);
  if (!mod) return null;

  const societyId = payload?.activeContext?.societyId || payload?.societyId;
  if (!societyId) return null; // no society context — the route's own auth decides

  const snapshot = await readEntitlementSnapshot(societyId);
  if (!snapshot) return null; // cold key — see snapshot.js
  if (snapshot.modules?.[mod.key] === true) return null;

  // Folded into an hourly Redis bucket, which a cron drains into Mongo and
  // turns into at most one email per society per day. Awaited rather than
  // fire-and-forget: an edge function can be frozen the moment it returns, and
  // a dangling promise would simply never run. It is one Redis round trip on a
  // request that was going to be refused anyway.
  await recordDenial({
    societyId,
    module: mod.key,
    userId: payload?.userId || payload?.sub || null,
    userName: payload?.name || null,
    role: payload?.role || null,
    method: request.method,
    path: pathname,
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    surface: request.headers.get("authorization") ? "app" : "web",
  });

  const res = pathname.startsWith("/api/")
    ? NextResponse.json({ error: "Not found" }, { status: 404 })
    : NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
  if (payload?.role === "SuperAdmin") {
    res.headers.set("X-Denied-Reason", `entitlement:${mod.key}`);
  }
  // Read by the Phase 3 denial recorder, which needs to know a request was
  // refused without middleware itself touching a database.
  res.headers.set("X-Entitlement-Denied", mod.key);
  return withCsp(res, nonce);
}

// ── Subscription lifecycle ───────────────────────────────────────────────
//
// Grace → read-only → blocked, enforced by HTTP method rather than by a check
// in every mutating handler. Method is the one property every write shares and
// no handler can opt out of; several hundred per-route guards would work until
// somebody forgot, and the forgotten one is a society that stopped paying still
// creating bills.
//
// 402 Payment Required, not 404: unlike an unbought module, there is nothing to
// conceal here. The society knows perfectly well it has not paid, and the
// client needs to tell it something useful.
//
// Members are exempt from the blocked state for their own reads — they did not
// fail to pay, and locking a resident out of their own receipts applies
// pressure to entirely the wrong person.
async function lifecycleDenied(request, pathname, payload, nonce) {
  const societyId = payload?.activeContext?.societyId || payload?.societyId;
  if (!societyId) return null;

  const snapshot = await readEntitlementSnapshot(societyId);
  const refusal = lifecycleRefusal({
    snapshot,
    method: request.method,
    pathname,
    isMemberOwnData:
      payload?.role === "Member" ||
      payload?.activeContext?.hat === "member" ||
      Boolean(payload?.memberId),
  });
  if (!refusal) return null;

  const res = NextResponse.json(
    { error: refusal.message, code: refusal.code },
    { status: refusal.status },
  );
  return withCsp(res, nonce);
}

// LOOP-05 Phase 3: the one carve-out from the pause gate above.
//
// delete-until sets the same paused-society:<id> key as pause does, so during
// the grace window the society is locked out of the whole app — including the
// page we email them asking them to log in and collect their records from.
// Sending the handover *before* the pause is not a fix: the record has to stay
// downloadable for the entire window, not only the instant it was built.
//
// So this prefix, and only this prefix, stays reachable while paused. It is
// still fully authenticated (requireRoles + SOCIETY_ADMIN_ROLES) and still
// society-scoped in its own queries — the exemption is from the pause gate,
// not from auth. Kept as an exact prefix rather than a pattern so a future
// route cannot accidentally inherit it.
const HANDOVER_PATH_PREFIX = "/api/v1/society-handover";
function isHandoverPath(pathname) {
  return (
    pathname === HANDOVER_PATH_PREFIX || pathname.startsWith(`${HANDOVER_PATH_PREFIX}/`)
  );
}

function extractBearerToken(request) {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

// SEC-11: nonce-based CSP, generated fresh per request (edge-safe — Web
// Crypto, no Node APIs). script-src drops 'unsafe-inline'/'unsafe-eval'
// entirely in favour of 'nonce-<value>' + 'strict-dynamic': only a script
// tagged with THIS request's nonce (or loaded by one) can run, so an
// attacker-injected <script> or onerror="..." from unescaped user input has
// no way to guess it and does not execute — CSP as a real second layer
// behind output-escaping, not a decorative header. Next.js reads the nonce
// back out of this same header to nonce its own hydration/chunk-loading
// scripts automatically (see https://nextjs.org/docs/app/guides/content-security-policy) —
// no manual wiring needed for anything rendered through next/script or
// Next's own bootstrap.
//
// style-src keeps 'unsafe-inline' for now: JSX `style={{...}}` props are DOM
// property writes, not CSS text, and are NOT affected either way — but a
// small number of routes (app/api/bills/download, app/api/member/receipts/
// [id]/download, PrintArea.js, Drawer.jsx) build literal `<style>` tags for
// print CSS. Nonce-ing those needs the nonce threaded into server-rendered
// HTML strings, not just React components — left as a follow-up, tracked
// separately from this pass.
//
// 'unsafe-eval' is re-added ONLY outside production. Next.js dev mode's Fast
// Refresh/webpack HMR runtime calls eval() internally to apply hot-reloaded
// modules — this is Next's own dev tooling, not app code, and there is no
// nonce-based way around it. Without this the entire dev server hangs dead
// on first load (main-app.js throws EvalError before React ever mounts, no
// visible error except in the console — learned this the hard way). A
// production build's webpack output does not eval, so prod stays fully
// locked down with no 'unsafe-eval'.
function buildCsp(nonce) {
  const isDev = process.env.NODE_ENV !== "production";

  // Sentry's ingest host, derived from the DSN rather than hardcoded, and
  // added only when error reporting is actually configured.
  //
  // Without it every crash report was refused by our own CSP —
  // "Refused to connect ... violates the document's Content Security Policy"
  // in the console, and nothing arriving in Sentry. The reporting looked
  // installed and was silently dead in production, which is the worst state
  // for a monitor to be in.
  //
  // A DSN looks like https://<key>@o123.ingest.us.sentry.io/456, so the
  // origin is what we need and the key must NOT end up in the header.
  let sentryOrigin = "";
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (dsn) {
    try {
      sentryOrigin = ` ${new URL(dsn).origin}`;
    } catch {
      // A malformed DSN disables reporting anyway; never break the CSP over it.
    }
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://*.r2.dev",
    "font-src 'self' data:",
    // Turnstile: challenges.cloudflare.com both runs an XHR challenge
    // exchange (connect-src) and renders its own checkbox in an iframe
    // (frame-src) — default-src's 'self' fallback blocks both without these.
    `connect-src 'self' https://*.r2.cloudflarestorage.com https://*.r2.dev https://challenges.cloudflare.com${sentryOrigin}`,
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function withCsp(response, nonce) {
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  return response;
}

export async function middleware(request) {
  // The Flutter app talks to /v1/*, which next.config.js and vercel.json
  // rewrite to /api/v1/*. Those rewrites run AFTER middleware, so as far as
  // this file is concerned the path is still /v1/... — and once the CSP
  // matcher was broadened to "every page", that fell through the API block
  // below into the cookie-gated page rules and 307'd every mobile API call
  // to the HTML login page. Normalize first so all the /api/v1 handling
  // (CSRF skip, revocation, module gates) sees the path it expects.
  const rawPathname = request.nextUrl.pathname;
  const pathname = rawPathname.startsWith("/v1/")
    ? `/api${rawPathname}`
    : rawPathname;
  const method = request.method;
  const nonce = btoa(crypto.randomUUID());

  // Forwarded to the request so Server Components can read it via
  // headers().get("x-nonce") if a route needs to hand the nonce to a raw
  // <script>/<style> it renders itself (see the follow-up note above).
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-nonce", nonce);
  const nextArgs = { request: { headers: forwardedHeaders } };

  // API routes: CSRF check, then a revocation check, then pass through —
  // never redirect to a login page (routes own their 401/403 shape).
  if (pathname.startsWith("/api/")) {
    // /api/v1/* is the bearer-token mobile API — no cookies involved, so
    // there's nothing for a CSRF/Origin check to protect. Enforcing it here
    // only blocks legitimate native-app requests, which don't send Origin.
    const isUnsafeMethod =
      !pathname.startsWith("/api/v1/") &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    if (isUnsafeMethod) {
      const origin = request.headers.get("origin");
      // Non-production only: allow Playwright APIRequestContext which sends no Origin.
      // Double-gated: NODE_ENV check ensures this path is dead in production even if
      // an attacker crafts x-test-mode header.
      const isTestBypass =
        process.env.NODE_ENV !== "production" &&
        request.headers.get("x-test-mode") === "true";
      // Allowed origins: the canonical app URL + any explicit extras.
      const allowedOrigins = [ALLOWED_ORIGIN, ...EXTRA_ALLOWED_ORIGINS];
      // DEV ONLY: also accept same-origin requests (Origin host === Host header).
      // Lets you tunnel via ngrok / LAN IP on mobile without hardcoding URLs.
      // Hard-disabled in production.
      let isSameOriginDev = false;
      if (process.env.NODE_ENV !== "production" && origin) {
        try {
          isSameOriginDev =
            new URL(origin).host === request.headers.get("host");
        } catch {
          isSameOriginDev = false;
        }
      }
      const originOk =
        !!origin && (allowedOrigins.includes(origin) || isSameOriginDev);
      if (!isTestBypass && !originOk) {
        return withCsp(NextResponse.json({ error: "Forbidden" }, { status: 403 }), nonce);
      }
    }
    // Revocation check: only runs when a "token" (regular JWT_SECRET) is
    // actually presented, via cookie (web) or Bearer header (mobile/API
    // clients). No token / an already-invalid token is left for the route's
    // own auth guard to reject as today.
    const apiToken =
      request.cookies.get("token")?.value || extractBearerToken(request);
    if (apiToken) {
      const payload = await parseJwt(apiToken);
      if (await isRevoked(payload)) {
        return withCsp(NextResponse.json({ error: "Token revoked" }, { status: 401 }), nonce);
      }
      if (await isStaleSession(payload)) {
        return withCsp(
          NextResponse.json(
            { error: "Your access changed. Please sign in again.", code: "UNAUTHENTICATED", reauth: true },
            { status: 401 },
          ),
          nonce,
        );
      }
      // LOOP-05: a superadmin-paused society is locked out of the app without
      // touching any data — see app/api/superadmin/societies/[id]/lifecycle.
      // Superadmin's own routes are exempt so they can still manage (and
      // resume) the society they just paused.
      if (
        !pathname.startsWith("/api/superadmin/") &&
        !isHandoverPath(pathname) &&
        (await isSocietyPaused(payload))
      ) {
        return withCsp(
          NextResponse.json(
            { error: "This society is currently paused by the platform admin.", code: "SOCIETY_PAUSED" },
            { status: 403 },
          ),
          nonce,
        );
      }
      // Ending a session is the one write-shaped call a read-only takeover
      // token must still be allowed to make — it only ever narrows access,
      // never exercises it. Exact-path match, same reasoning as
      // isHandoverPath above: a future route must not accidentally inherit
      // the exemption.
      const isTakeoverEndPath =
        payload?.takeover?.grantId &&
        pathname === `/api/v1/takeover/${payload.takeover.grantId}/end`;
      // Society takeover, read-only mode: a superadmin viewing a society's
      // dashboard under a `mode: "read"` grant (see docs/superpowers/specs/
      // 2026-09-11-society-takeover-design.md) can look at anything the
      // real admin's token would allow, but can never write. Method is the
      // one property every mutating request shares — same reasoning as
      // lifecycleDenied below — so this is the one place that needs to
      // know about takeover mode at all; every route stays unmodified.
      // Edge-safe: reads only the token claim, no DB.
      if (
        payload?.takeover?.mode === "read" &&
        !isTakeoverEndPath &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ) {
        return withCsp(
          NextResponse.json(
            { error: "Read-only support session — writes are disabled.", code: "TAKEOVER_READ_ONLY" },
            { status: 403 },
          ),
          nonce,
        );
      }
      // Superadmins operate across societies and are never gated by one
      // society's plan.
      if (!pathname.startsWith("/api/superadmin/") && payload?.role !== "SuperAdmin") {
        const denied = await moduleDenied(request, pathname, payload, nonce);
        if (denied) return denied;
        // After the module gate, so an unbought module still reads as a plain
        // 404 rather than announcing itself as a payment problem.
        const lapsed = await lifecycleDenied(request, pathname, payload, nonce);
        if (lapsed) return lapsed;
      }
    }
    return withCsp(NextResponse.next(nextArgs), nonce);
  }
  const token = request.cookies.get("token")?.value;
  const adminToken = request.cookies.get("admin_token")?.value;
  // ── PUBLIC ROUTES ─────────────────────────────────────────────────────────
  const publicRoutes = [
    "/auth/login",
    // Post-login, pre-cookie step: the login route deliberately issues no
    // "token" cookie when a user has multiple profiles (see app/api/auth/
    // login/route.js "No cookie yet — user must pick a society first") —
    // auth here runs on the short-lived profileSelectToken held in
    // sessionStorage instead, sent by the page's own API calls. Broadening
    // the CSP matcher below now routes /auth/* through this same
    // cookie-gated block for the first time (previously matcher didn't
    // cover /auth/* at all), which without this entry bounced a successful
    // multi-profile login straight back to /auth/login with no error.
    "/auth/select-society",
    "/admin/login",
    "/security/login",
    "/member/login",
    "/superadmin/login",
    "/onboarding",
  ];
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return withCsp(NextResponse.next(nextArgs), nonce);
  }
  // ── ROOT REDIRECT ─────────────────────────────────────────────────────────
  if (pathname === "/") {
    if (adminToken) {
      const adminPayload = await parseJwt(adminToken, "ADMIN_JWT_SECRET");
      if (adminPayload?.role === "SuperAdmin") {
        return withCsp(
          NextResponse.redirect(new URL("/superadmin/dashboard", request.url)),
          nonce,
        );
      }
    }
    if (token) {
      const payload = await parseJwt(token);
      if (payload?.role === "Security") {
        return withCsp(
          NextResponse.redirect(new URL("/security/dashboard", request.url)),
          nonce,
        );
      }
      if (
        payload?.role === "Admin" ||
        payload?.role === "Secretary" ||
        payload?.role === "Accountant"
      ) {
        return withCsp(NextResponse.redirect(new URL("/admin/dashboard", request.url)), nonce);
      }
      // RBAC-only staff role (e.g. Auditor) — no legacy role string, and may
      // not hold Dashboard access. /my-access always works.
      if (payload?.activeContext?.hat === "staff") {
        return withCsp(NextResponse.redirect(new URL("/my-access", request.url)), nonce);
      }
      // Member token: new shape has activeProfileId, no role
      // Old shape: role === "Member"
      if (payload?.activeProfileId || payload?.role === "Member") {
        return withCsp(NextResponse.redirect(new URL("/member/dashboard", request.url)), nonce);
      }
    }
    return withCsp(NextResponse.next(nextArgs), nonce);
  }
  // ── SUPERADMIN ROUTES ─────────────────────────────────────────────────────
  if (pathname.startsWith("/superadmin")) {
    if (!adminToken) {
      return withCsp(NextResponse.redirect(new URL("/superadmin/login", request.url)), nonce);
    }
    const adminPayload = await parseJwt(adminToken, "ADMIN_JWT_SECRET");
    if (!adminPayload || adminPayload.role !== "SuperAdmin") {
      return withCsp(NextResponse.redirect(new URL("/superadmin/login", request.url)), nonce);
    }
    return withCsp(NextResponse.next(nextArgs), nonce);
  }
  // ── ADMIN + MEMBER PROTECTED ROUTES ──────────────────────────────────────
  if (!token) {
    return withCsp(NextResponse.redirect(new URL("/auth/login", request.url)), nonce);
  }
  const payload = await parseJwt(token);
  if (!payload || (await isRevoked(payload)) || (await isStaleSession(payload))) {
    return withCsp(NextResponse.redirect(new URL("/auth/login", request.url)), nonce);
  }
  // Determine effective role:
  // - Admin/Secretary: payload.role present
  // - Member (new JWT): payload.activeProfileId present, no role
  // - Member (old JWT): payload.role === "Member"
  // - RBAC staff-hat (new JWT, from a RoleAssignment-backed profile, e.g. a
  //   member who was also granted "Auditor"): payload.activeContext.hat==="staff",
  //   no legacy role string at all. This is only a coarse, edge-safe gate
  //   (no DB access here) — the real per-page permission check still happens
  //   in lib/rbac/page-guard.js's requirePagePermission().
  const isAdmin =
    payload.role === "Admin" ||
    payload.role === "Secretary" ||
    payload.role === "Accountant" ||
    payload.role === "SOCIETY_ADMIN" ||
    payload.activeContext?.hat === "staff";
  const isMember = payload.role === "Member" || !!payload.activeProfileId;
  const isSecurity = payload.role === "Security";
  // /admin exact → redirect to dashboard
  if (pathname === "/admin") {
    return withCsp(NextResponse.redirect(new URL("/admin/dashboard", request.url)), nonce);
  }
  if (pathname === "/security")
    return withCsp(NextResponse.redirect(new URL("/security/dashboard", request.url)), nonce);
  if (pathname.startsWith("/admin") && !isAdmin) {
    return withCsp(NextResponse.redirect(new URL("/auth/login", request.url)), nonce);
  }
  if (pathname.startsWith("/member") && !isMember) {
    return withCsp(NextResponse.redirect(new URL("/auth/login", request.url)), nonce);
  }
  if (pathname.startsWith("/security") && !isSecurity) {
    return withCsp(NextResponse.redirect(new URL("/auth/login", request.url)), nonce);
  }
  // Phase 2 — the same gate, for pages.
  //
  // A redirect to the dashboard would tell the visitor the page exists and
  // that they are not allowed on it, which is the 403 problem wearing a
  // different hat. A rewrite to the not-found page is indistinguishable from a
  // URL that was never a route.
  if (token && !pathname.startsWith("/superadmin")) {
    const pagePayload = await parseJwt(token);
    if (pagePayload?.role !== "SuperAdmin") {
      const denied = await moduleDenied(request, pathname, pagePayload, nonce);
      if (denied) return denied;

      // A blocked society gets ONE page, and every route leads to it.
      //
      // A banner on every page would be forty reminders to a committee that
      // needs one. And there is nothing to hide here — unlike an unbought
      // module, they know they have not paid, so the honest thing is a screen
      // that says so and offers the two things they can still do: renew, or
      // take their records and go.
      //
      // Members are exempt: they did not fail to pay, and they keep read
      // access to their own records until the society is actually offboarded.
      const societyId = pagePayload?.activeContext?.societyId || pagePayload?.societyId;
      const isMember =
        pagePayload?.role === "Member" ||
        pagePayload?.activeContext?.hat === "member" ||
        Boolean(pagePayload?.memberId);
      if (societyId && !isMember && !pathname.startsWith("/subscription")) {
        const snapshot = await readEntitlementSnapshot(societyId);
        // isNeverGated, not isHandoverPath: the latter covers only the API
        // prefix, and redirecting a blocked society away from
        // /admin/data-handover would trap them inside the very state the page
        // exists to let them leave.
        if (snapshot && snapshot.canRead === false && !isNeverGated(pathname)) {
          return withCsp(
            NextResponse.redirect(new URL("/subscription", request.url)),
            nonce,
          );
        }
      }
    }
  }
  return withCsp(NextResponse.next(nextArgs), nonce);
}
export const config = {
  matcher: [
    // Every page + API route except Next's own static/image pipeline and
    // plain static files — the standard Next.js CSP-nonce matcher. Broader
    // than the old list (which missed /auth/*, /onboarding/*, /my-access and
    // anything else outside admin/member/security/superadmin/api), so every
    // page now actually gets the CSP header instead of falling back to
    // next.config.js's old static, un-nonced one.
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|map)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
