import type { NextConfig } from "next";

// Operational cockpit. Two ship targets from one codebase:
//   - Desktop (Electron): `output: "standalone"` emits .next/standalone/server.js,
//     which the Electron main process boots as a child node server and loads in a
//     BrowserWindow. node-pty / ssh / hermes all run in that server, not the renderer.
//   - Mobile (Capacitor): wraps the same server reachable over the tailnet.
// No public rewrites: every data source is reached server-side inside
// app/api/* route handlers (child_process / ssh / dashboard token-proxy).
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // node-pty is a native addon (Terminal pane PTY) — keep it a runtime require
  // so the build never tries to bundle the .node binary. Electron rebuilds it
  // against its own ABI via @electron/rebuild (see package.json postinstall).
  serverExternalPackages: ["node-pty"],
  // The standalone tracer walks the project root and will otherwise sweep our
  // own build output (release/, dist/) and stray PNGs INTO the standalone copy,
  // which electron-builder then packs — recursively bloating the installer
  // (saw 166MB -> 347MB). Exclude them from tracing for every route.
  outputFileTracingExcludes: {
    "*": ["release/**", "dist/**", "*.png", ".next/standalone/**", "next.config.*"],
  },
  // The mobile WKWebView (iOS app) and PWA honor HTTP caching. Next's default
  // for a statically-prerendered root is `Cache-Control: s-maxage=31536000`,
  // which makes the WebView serve a year-old HTML shell pointing at stale JS
  // chunks — a refresh never reaches the new build. Force the HTML document
  // (and the service worker) to always revalidate; the content-hashed
  // /_next/static assets keep their immutable long cache (safe — filenames
  // change per build).
  async headers() {
    // Security headers applied to EVERY response (defense-in-depth on top of the
    // token/OAuth gate in middleware.ts). NOTE: intentionally NO X-Frame-Options
    // / restrictive frame-ancestors — the browser extension frames this app in a
    // cross-origin side-panel iframe and the iOS WKWebView loads it as the top
    // document; a DENY/SAMEORIGIN frame rule would break the extension target.
    const securityHeaders = [
      // Force HTTPS for a year incl. subdomains (the box is served over TLS via
      // nginx/tunnel). Harmless on loopback (browsers ignore HSTS on localhost).
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      // Stop MIME sniffing — a JSON/api response can't be coerced into script.
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Don't leak the box URL (which may embed a ?token=) to third-party sites.
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // Drop ambient device access the cockpit never uses.
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
    ];
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        // The mobile WKWebView (iOS app) keeps its own NSURLCache. Any /api
        // response that lacks an explicit cache directive gets HEURISTICALLY
        // cached, so the 15s pollers (Kanban, Sessions, Fleet…) serve stale
        // bodies even though the server data changed — the "board not updating
        // on the phone" bug. Force every API response to revalidate.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
