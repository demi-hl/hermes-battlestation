import type { NextConfig } from "next";

// Standalone operational cockpit. No public rewrites: every data source is
// reached server-side inside app/api/* route handlers (child_process / ssh /
// dashboard token-proxy), so nothing here is exposed to the browser.
const nextConfig: NextConfig = {
  // Ops data + the embedded chat are private. Tailscale-only bind is enforced
  // at serve time (next start -H <tailnet-ip>), not in nginx.
  poweredByHeader: false,
};

export default nextConfig;
