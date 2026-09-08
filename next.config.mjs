/** @type {import('next').NextConfig} */
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { execSync } from "node:child_process";

// Deployed-version stamp for the site footer: the most recent PR number in
// the commit log plus the short commit hash, computed at build time.
// Cloudflare Workers Builds clones the repo, so git is available on deploys;
// local dev without git history falls back to "dev".
function buildVersion() {
  try {
    const subjects = execSync("git log -20 --pretty=%s", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const pr = subjects.match(/#(\d+)/);
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return pr ? `PR #${pr[1]} · ${sha}` : sha;
  } catch {
    return "dev";
  }
}

// Expose Cloudflare bindings (D1, Durable Objects) to route handlers during
// `next dev` via wrangler's platform proxy. Guard to dev only: during a
// production `next build` (e.g. Cloudflare Workers Builds / CI) this call sets
// up the local platform proxy and, because of the Hyperdrive binding, demands a
// local Postgres connection string that CI has no reason to provide — throwing
// and failing the build. Production uses the real bindings at runtime, so the
// dev proxy is never needed there.
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

// Content Security Policy. Two third-party origins: Cloudflare Turnstile
// (challenges.cloudflare.com) on the signup form (its api.js script, its widget
// iframe, and the XHRs it makes), and Cloudflare Web Analytics (the beacon
// script from static.cloudflareinsights.com, which reports to
// cloudflareinsights.com). The beacon is only rendered when
// NEXT_PUBLIC_CF_BEACON_TOKEN is set (see src/app/layout.tsx); the grant is
// unconditional so flipping analytics on never needs a CSP edit.
// Fonts come from Google Fonts (see src/app/layout.tsx).
// 'unsafe-inline' for styles is needed because tailwind + next inject style tags;
// 'unsafe-inline' for scripts is required by Next's hydration boot script.
// 'unsafe-eval' is only needed by webpack's dev-mode source maps, so it is
// kept out of production builds.
const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
// Tier 3 direct-arena gate (see the env block below): the client fetches the
// arena's /lobby over plain HTTPS, so its origin must be in connect-src or the
// browser silently blocks every arena call — which broke the whole Tier 3
// spectating path (lobby merge dead, TV stuck "Tuning in…" on arena games).
// The wss:// spectator socket was already covered by the `wss:` scheme source.
const arenaUrl = (process.env.NEXT_PUBLIC_ARENA_URL || "https://arena.nerfchess.com").trim().replace(/\/$/, "");
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com${devEval}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src 'self' ws: wss: https://challenges.cloudflare.com https://cloudflareinsights.com${arenaUrl ? ` ${arenaUrl}` : ""}`,
  "frame-src https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Deep-import rewriting for the one animation library the match routes
    // pull in (lucide-react is already on Next's default list).
    optimizePackageImports: ["framer-motion"],
  },
  env: {
    NEXT_PUBLIC_BUILD_VERSION: buildVersion(),
    // Public Turnstile sitekey for the signup widget. Override per-environment
    // via NEXT_PUBLIC_TURNSTILE_SITEKEY at build time; the secret lives only as
    // the TURNSTILE_SECRET_KEY Worker secret.
    NEXT_PUBLIC_TURNSTILE_SITEKEY:
      process.env.NEXT_PUBLIC_TURNSTILE_SITEKEY ?? "0x4AAAAAADyLZ_9QP6JEhhkU",
    // Tier 3 direct-arena gate: the public base URL of the arena service.
    // Baked to the prod arena here (like the Turnstile sitekey above) so it is
    // inlined at every build and survives CI/dashboard var resets — a runtime
    // wrangler var can't drive it because NEXT_PUBLIC_* is inlined into the
    // client at build time. `||` (not `??`) so a stray empty CI var still falls
    // through to this default. Override with a non-empty NEXT_PUBLIC_ARENA_URL
    // for non-prod; to turn client Tier 3 off, change this default to "".
    // See src/lib/arenaLobby.ts.
    // (Kept in lockstep with the CSP connect-src grant above — both read the
    // same `arenaUrl` fallback so the origin the client calls is always the
    // origin the CSP allows.)
    NEXT_PUBLIC_ARENA_URL: arenaUrl,
    // Cloudflare Web Analytics site token (cookieless). Empty = no beacon
    // rendered. Set it in the Workers Builds environment; see the note in
    // src/app/layout.tsx.
    NEXT_PUBLIC_CF_BEACON_TOKEN: process.env.NEXT_PUBLIC_CF_BEACON_TOKEN ?? "",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Content-hashed build output (JS, CSS, media): the filename changes
        // whenever the bytes change, so it is safe — and correct — to cache it
        // for a year and never revalidate. These were being served
        // `public, max-age=0, must-revalidate`, forcing a revalidation round
        // trip on every hashed chunk. `immutable` tells the browser not to
        // even conditionally re-request. HTML and data routes are deliberately
        // left out of this rule (see the security-headers rule above) so their
        // freshness is unaffected. A matching Cloudflare-assets-layer rule
        // lives in public/_headers for requests the ASSETS binding serves
        // before the worker ever runs.
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  async redirects() {
    // Cards converted from nerfs to buffs keep their old codex URLs alive.
    return [
      { source: "/codex/nerf/middle_part", destination: "/codex/buff/middle_part", permanent: true },
      { source: "/codex/nerf/forearm_veins", destination: "/codex/buff/forearm_veins", permanent: true },
    ];
  },
};

export default nextConfig;
