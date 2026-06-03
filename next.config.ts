import type { NextConfig } from "next";

// Standalone operational cockpit. No public rewrites: every data source is
// reached server-side inside app/api/* route handlers (child_process / ssh /
// dashboard token-proxy), so nothing here is exposed to the browser.
const nextConfig: NextConfig = {
  // Ops data + the embedded chat are private. Tailscale-only bind is enforced
  // at serve time (next start -H <tailnet-ip>), not in nginx.
  poweredByHeader: false,
  // node-pty is a native addon (Terminal pane PTY) — keep it as a runtime
  // require so the build never tries to bundle the .node binary.
  serverExternalPackages: ["node-pty"],
};

export default nextConfig;
