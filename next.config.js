const { withReticle } = require('@reticlehq/next');
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // ## Why this came down from "10mb"
      //
      // 10mb was misleading. Vercel rejects any request body over 4.5MB at the
      // edge, before the function runs — this setting cannot raise that ceiling,
      // it only relaxes Next's own additional check. Declaring 10mb meant the
      // codebase advertised a limit it could never honour, which is exactly how
      // the "upload just fails with no error" bug survived so long.
      //
      // 4mb sits safely under the platform limit, so oversized bodies now fail
      // with our own error message instead of a bodyless platform 413.
      // Anything larger must use the presigned direct-to-R2 flow
      // (POST /v1/uploads/sign) which has no such ceiling.
      bodySizeLimit: "4mb",
    },
  },

  // Image Optimization counters all read zero because there was no images
  // config at all — next/image cannot optimise an R2 URL it has not been told
  // to trust, so every image was being served unoptimised at full size.
  images: {
    formats: ["image/avif", "image/webp"],
    // Presigned R2 URLs carry a query string; remotePatterns matches on host
    // and path, so the signature does not interfere.
    remotePatterns: [
      // Replace <account>.r2.cloudflarestorage.com with your actual R2 host,
      // or set R2_PUBLIC_HOST and this picks it up automatically.
      ...(process.env.R2_PUBLIC_HOST
        ? [{ protocol: "https", hostname: process.env.R2_PUBLIC_HOST, pathname: "/**" }]
        : []),
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com", pathname: "/**" },
      { protocol: "https", hostname: "**.r2.dev", pathname: "/**" },
    ],
    // Derived variants are immutable; cache them hard so a resident scrolling
    // the visitor log does not re-fetch the same thumbnails all day.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    deviceSizes: [360, 480, 640, 828, 1080],
    imageSizes: [48, 64, 96, 128, 256],
  },

  // Mobile API compatibility: the Flutter app calls `/v1/...`. On Vercel this
  // is handled by vercel.json rewrites, but those are NOT applied during local
  // dev (`node server.js`) or `next start`. Declaring it here as well makes
  // `/v1/*` -> `/api/v1/*` work in every environment (the custom server.js
  // routes through Next's handler, which honors these rewrites).
  // Security headers (test 08). TLS + HSTS are already handled by Vercel;
  // these close the real gaps: CSP, frame, sniffing, referrer, permissions.
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      // SEC-11: Content-Security-Policy moved to middleware.js — it needs a
      // fresh random nonce per request (script-src 'nonce-<value>'
      // 'strict-dynamic', no more 'unsafe-inline'/'unsafe-eval'), which a
      // static next.config header can't generate. See middleware.js's
      // buildCsp() for the actual policy and the reasoning.
    ];
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },

  async rewrites() {
    return [{ source: "/v1/:path*", destination: "/api/v1/:path*" }];
  },

  // Dev only: keep Watchpack off Windows system files and heavy dirs (it was
  // lstat-ing C:\hiberfil.sys etc.), which slows compiles and bloats memory.
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.next/**",
          "C:/hiberfil.sys",
          "C:/pagefile.sys",
          "C:/swapfile.sys",
          "C:/DumpStack.log.tmp",
        ],
      };
    }
    return config;
  },
};

// withSentryConfig's webpack plugin does real work during `next build`
// (auto-instrumenting every route handler) independent of whether
// SENTRY_AUTH_TOKEN is set — that's expensive enough to OOM a `next build`
// on a memory-constrained dev machine. Vercel sets VERCEL=1 automatically in
// its build environment and has the RAM for it; a local build doesn't set
// that var, so it gets the plain, unwrapped config instead. Runtime error
// capture (instrumentation.js / instrumentation-client.js) is unaffected —
// those only key off NEXT_PUBLIC_SENTRY_DSN, not this.
const { withSentryConfig } = require("@sentry/nextjs");
const withReticleMaybe = process.env.RETICLE === "1" ? withReticle : (c) => c;
module.exports = withReticleMaybe(process.env.VERCEL
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disableLogger: true,
      widenClientFileUpload: false,
      // instrumentation.js's onRequestError hook (Next's own native
      // error-reporting API) already captures every request error globally.
      // Sentry's per-route auto-wrapping is redundant on top of that and is
      // the expensive part of the build (transforms all 300+ route files) —
      // ~2 of the ~4 minutes this build step takes. Turning it off loses no
      // coverage, just build time.
      autoInstrumentServerFunctions: false,
      autoInstrumentAppDirectory: false,
      autoInstrumentMiddleware: false,
    })
  : nextConfig);