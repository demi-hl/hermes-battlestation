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
    "*": ["release/**", "dist/**", "*.png", ".next/standalone/**"],
  },
  // The mobile WKWebView (iOS app) and PWA honor HTTP caching. Next's default
  // for a statically-prerendered root is `Cache-Control: s-maxage=31536000`,
  // which makes the WebView serve a year-old HTML shell pointing at stale JS
  // chunks — a refresh never reaches the new build. Force the HTML document
  // (and the service worker) to always revalidate; the content-hashed
  // /_next/static assets keep their immutable long cache (safe — filenames
  // change per build).
  async headers() {
    return [
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
    ];
  },
};

export default nextConfig;
