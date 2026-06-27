#!/usr/bin/env node
// Print a pairing deep-link + a scannable terminal QR for a device to join this
// box's Battlestation. Reuses the SAME token resolution as token.cjs (real env
// wins, then the persisted config-dir file), so the URL it prints is exactly the
// one the middleware accepts (?token=... -> sets bs_token cookie -> in).
//
//   npm run pair                          → auto-detect base URL, current token
//   npm run pair -- https://host.ts.net   → explicit base URL
//   BS_BASE_URL=https://host npm run pair  → base URL via env
//
// Base URL detection order: argv[2] > BS_BASE_URL > `tailscale serve status`
// (first https URL) > http://<lan-ip>:PORT. Never invents a token; if none is
// configured it tells you to run `npm run token` first.

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { execSync } = require("node:child_process");

function userConfigDir() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "locals-only");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "locals-only");
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return path.join(xdg || path.join(os.homedir(), ".config"), "locals-only");
}

function parseEnvFile(file) {
  const out = {};
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const eq = s.indexOf("=");
    if (eq < 1) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function resolveToken() {
  if ((process.env.BATTLESTATION_TOKEN || "").trim()) {
    return process.env.BATTLESTATION_TOKEN.trim();
  }
  const files = [
    path.join(userConfigDir(), "battlestation.env"),
    path.join(__dirname, "..", ".env.local"),
  ];
  for (const f of files) {
    const v = (parseEnvFile(f).BATTLESTATION_TOKEN || "").trim();
    if (v) return v;
  }
  return null;
}

function port() {
  return (process.env.PORT || "9119").trim();
}

function lanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return "127.0.0.1";
}

function tailscaleUrl() {
  // Pull the first https URL tailscale is already serving, if any.
  try {
    const out = execSync("tailscale serve status 2>/dev/null", {
      encoding: "utf8",
      timeout: 4000,
    });
    const m = out.match(/https:\/\/[^\s]+/);
    if (m) return m[0].replace(/\/+$/, "");
  } catch {
    /* tailscale not running / not serving */
  }
  return null;
}

function baseUrl() {
  const arg = process.argv[2];
  if (arg && /^https?:\/\//.test(arg)) return arg.replace(/\/+$/, "");
  if ((process.env.BS_BASE_URL || "").trim()) {
    return process.env.BS_BASE_URL.trim().replace(/\/+$/, "");
  }
  const ts = tailscaleUrl();
  if (ts) return ts;
  return `http://${lanIp()}:${port()}`;
}

async function main() {
  const token = resolveToken();
  if (!token) {
    console.error("No BATTLESTATION_TOKEN configured.");
    console.error("Run `npm run token` first to mint one, then re-run `npm run pair`.");
    process.exit(1);
  }
  const base = baseUrl();
  const link = `${base}/?token=${encodeURIComponent(token)}`;

  let QRCode;
  try {
    QRCode = require("qrcode");
  } catch {
    console.error("qrcode dep missing — run `npm install` first.");
    console.error("\nPairing link:\n  " + link);
    process.exit(1);
  }

  const qr = await QRCode.toString(link, { type: "terminal", small: true });
  console.log("");
  console.log("  Scan to pair a device with this Battlestation:");
  console.log("");
  console.log(qr);
  console.log("  Or open this link on the device:");
  console.log("  " + link);
  console.log("");
  if (base.startsWith("http://")) {
    console.log("  NOTE: this is a plain-HTTP LAN URL. For a phone off your LAN,");
    console.log("  run `tailscale serve --bg " + port() + "` and re-run `npm run pair`.");
    console.log("");
  }
}

main().catch((e) => {
  console.error("pair-qr failed:", e && e.message ? e.message : e);
  process.exit(1);
});
