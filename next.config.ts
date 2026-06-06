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
};

export default nextConfig;
