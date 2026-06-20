/**
 * Apple Push Notification service (APNs) sender — zero external deps, using
 * Node's built-in `crypto` (ES256 JWT provider auth) and `http2` (APNs is
 * HTTP/2-only). Token-based auth with a .p8 key, so one key serves every app
 * and never expires (the JWT is re-minted hourly).
 *
 * Config comes from the runtime env the standalone server loads (.env.local):
 *   APNS_KEY_P8        the .p8 contents (PEM), or APNS_KEY_PATH to a file
 *   APNS_KEY_ID        the 10-char Key ID from the Apple dev console
 *   APNS_TEAM_ID       the 10-char Apple Team ID
 *   APNS_BUNDLE_ID     the app bundle id / APNs topic (ai.hermes.agent)
 *   APNS_PRODUCTION    "1" to hit api.push.apple.com (default = sandbox)
 *
 * Tokens are read from ~/.hermes/push-native-tokens.json (written by the
 * /api/push/register-native route). Best-effort: missing config => no-op.
 */

import os from "os";
import path from "path";
import { createSign } from "crypto";
import http2 from "http2";

interface ApnsConfig {
  key: string;
  keyId: string;
  teamId: string;
  bundleId: string;
  production: boolean;
}

function loadConfig(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim() || "ai.hermes.agent";
  let key = process.env.APNS_KEY_P8;
  if (!key && process.env.APNS_KEY_PATH) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      key = require("fs").readFileSync(process.env.APNS_KEY_PATH, "utf8");
    } catch {
      key = undefined;
    }
  }
  if (!key || !keyId || !teamId) return null;
  // Allow \n-escaped single-line keys from .env.
  key = key.replace(/\\n/g, "\n");
  return {
    key,
    keyId,
    teamId,
    bundleId,
    production: process.env.APNS_PRODUCTION === "1",
  };
}

// JWT provider tokens are valid up to 60 min; Apple rejects ones older than
// that, so cache and re-mint at ~50 min.
let cachedJwt: { token: string; mintedAt: number } | null = null;

function mintJwt(cfg: ApnsConfig): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && now - cachedJwt.mintedAt < 3000) return cachedJwt.token;
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "ES256", kid: cfg.keyId });
  const payload = b64({ iss: cfg.teamId, iat: now });
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const sig = signer.sign({ key: cfg.key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const token = `${header}.${payload}.${sig}`;
  cachedJwt = { token, mintedAt: now };
  return token;
}

function tokensPath() {
  return path.join(os.homedir(), ".hermes", "push-native-tokens.json");
}

async function loadTokens(): Promise<string[]> {
  try {
    const fs = await import("fs/promises");
    const raw = await fs.readFile(tokensPath(), "utf-8");
    const arr = JSON.parse(raw) as { token: string }[];
    return Array.isArray(arr) ? arr.map((t) => t.token).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function removeToken(token: string): Promise<void> {
  try {
    const fs = await import("fs/promises");
    const raw = await fs.readFile(tokensPath(), "utf-8");
    const arr = (JSON.parse(raw) as { token: string }[]).filter((t) => t.token !== token);
    await fs.writeFile(tokensPath(), JSON.stringify(arr, null, 2));
  } catch {
    /* best-effort prune */
  }
}

export interface ApnsResult {
  configured: boolean;
  sent: number;
  failed: number;
}

/** Send a notification to every registered iOS device via APNs. */
export async function sendApns(opts: {
  title: string;
  body: string;
  threadId?: string | null;
  tag?: string;
}): Promise<ApnsResult> {
  const cfg = loadConfig();
  if (!cfg) return { configured: false, sent: 0, failed: 0 };

  const tokens = await loadTokens();
  if (tokens.length === 0) return { configured: true, sent: 0, failed: 0 };

  const jwt = mintJwt(cfg);
  const host = cfg.production
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";

  const payload = JSON.stringify({
    aps: {
      alert: { title: opts.title, body: opts.body },
      sound: "default",
      "thread-id": opts.threadId ?? undefined,
    },
    threadId: opts.threadId ?? null,
  });

  const client = http2.connect(host);
  let sent = 0;
  let failed = 0;
  const dead: string[] = [];

  await new Promise<void>((resolve) => {
    let pending = tokens.length;
    const done = () => {
      if (--pending <= 0) resolve();
    };
    client.on("error", () => resolve());

    for (const token of tokens) {
      const req = client.request({
        ":method": "POST",
        ":path": `/3/device/${token}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": cfg.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        ...(opts.tag ? { "apns-collapse-id": opts.tag.slice(0, 64) } : {}),
        "content-type": "application/json",
      });
      let status = 0;
      req.on("response", (h) => {
        status = Number(h[":status"]) || 0;
      });
      req.on("end", () => {
        if (status === 200) sent++;
        else {
          failed++;
          // 410 = the device unregistered; prune it.
          if (status === 410) dead.push(token);
        }
        done();
      });
      req.on("error", () => {
        failed++;
        done();
      });
      req.setEncoding("utf8");
      req.write(payload);
      req.end();
    }
  });

  try {
    client.close();
  } catch {
    /* already closed */
  }
  for (const t of dead) await removeToken(t);

  return { configured: true, sent, failed };
}
