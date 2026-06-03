// Server-side bridge to the local Hermes dashboard. The dashboard mints an
// ephemeral per-process session token and injects it into its own SPA HTML as
// window.__HERMES_SESSION_TOKEN__. We scrape that token here (server-side) and
// use it to call gated dashboard APIs (e.g. /api/cron/jobs). The token NEVER
// reaches the browser.
const BASE = process.env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:9119";

let tokenCache: { token: string; expires: number } | null = null;

async function dashboardToken(): Promise<string | null> {
  const now = Date.now();
  if (tokenCache && tokenCache.expires > now) return tokenCache.token;
  try {
    const res = await fetch(`${BASE}/`, { cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/);
    if (!m) return null;
    // Token is per dashboard process; re-scrape every 60s in case it restarts.
    tokenCache = { token: m[1], expires: now + 60_000 };
    return m[1];
  } catch {
    return null;
  }
}

export async function dashboardGet(
  path: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = await dashboardToken();
  if (!token) return { ok: false, status: 0, data: null };
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
