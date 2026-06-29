// Electron main process — boots the standalone Next server as a child and loads
// it in a window. This is what turns the cockpit into a downloadable desktop app:
// the user runs the installer, we start their LOCAL node server (talking to their
// own `hermes`, repos, ssh) and render it. Nothing phones home.
const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const isDev = !app.isPackaged;
let serverProc = null;
let win = null;

const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");

// User config dir (matches lib/app-config.ts): XDG on Linux, ~/Library on mac,
// %APPDATA% on win. The personal env file lives OUTSIDE the bundle so a shipped
// app reads the user's own fleet/vault config without a repo checkout.
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

// Minimal .env parser (KEY=VALUE, # comments, optional quotes). No deps.
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

// Resolve the personal env: user config dir wins, then (in dev) the repo's
// .env.local. Real process.env still overrides both (set a var to force it).
function loadUserEnv() {
  const merged = {};
  const candidates = [path.join(userConfigDir(), "battlestation.env")];
  if (isDev) candidates.push(path.join(__dirname, "..", ".env.local"));
  // dev .env.local is the source of truth while developing; load it LAST so it
  // wins over a stale config-dir copy on the dev box.
  for (const f of candidates) Object.assign(merged, parseEnvFile(f));
  return merged;
}

// First-run token autogen. A downloaded DMG ships with no token configured, so
// the loopback server would have no shared secret to pair a phone against. On
// first launch (local-server mode only) we mint a strong token, persist it to
// the user env file with 0600 perms, and let loadUserEnv() pick it up so it's
// injected into the child server's env — zero manual setup. Precedence is
// preserved: a real BATTLESTATION_TOKEN in process.env OR already present in the
// env file always wins and is never overwritten. Never hardcoded, never logged.
function ensureToken() {
  if ((process.env.BATTLESTATION_TOKEN || "").trim()) return; // real env wins
  const existing = loadUserEnv();
  if ((existing.BATTLESTATION_TOKEN || "").trim()) return; // already provisioned
  let token;
  try {
    token = crypto.randomBytes(18).toString("base64url");
  } catch {
    return; // crypto unavailable — fall back to open loopback, don't crash
  }
  const dir = userConfigDir();
  const file = path.join(dir, "battlestation.env");
  try {
    fs.mkdirSync(dir, { recursive: true });
    let prior = "";
    try {
      prior = fs.readFileSync(file, "utf8");
    } catch {
      // file does not exist yet — fine
    }
    const sep = prior && !prior.endsWith("\n") ? "\n" : "";
    const block =
      `${sep}# Auto-generated on first launch — loopback API token.\n` +
      `# Copy it from Settings to pair your phone. Delete to regenerate.\n` +
      `BATTLESTATION_TOKEN=${token}\n`;
    fs.appendFileSync(file, block, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch (e) {
    // Persisting failed (read-only home, perms) — log without the token value.
    process.stderr.write(
      `[token] could not persist first-run token: ${e && e.message ? e.message : e}\n`,
    );
  }
}

// In a packaged app the standalone server is unpacked next to resources.
// In dev we point at the repo's built standalone output.

// Persist a chosen remote target (URL + optional token) to the user env file so
// the choice sticks across launches — the desktop equivalent of the iOS app's
// Keychain pairing. Writes BATTLESTATION_REMOTE_URL (+ BATTLESTATION_TOKEN when
// the pairing link carried one) with 0600 perms. Never logged.
function persistRemote(url, token) {
  const dir = userConfigDir();
  const file = path.join(dir, "battlestation.env");
  fs.mkdirSync(dir, { recursive: true });
  let lines = [];
  try {
    lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    // no file yet
  }
  const setKey = (key, value) => {
    const idx = lines.findIndex((l) => l.trim().startsWith(key + "="));
    const entry = `${key}=${value}`;
    if (idx >= 0) lines[idx] = entry;
    else lines.push(entry);
  };
  setKey("BATTLESTATION_REMOTE_URL", url);
  if (token) setKey("BATTLESTATION_TOKEN", token);
  fs.writeFileSync(file, lines.join("\n").replace(/\n+$/, "") + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

// Clear the persisted remote target so the next launch boots a local server
// (the "use a local server instead" path).
function clearRemote() {
  const file = path.join(userConfigDir(), "battlestation.env");
  let lines = [];
  try {
    lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    return;
  }
  lines = lines.filter((l) => !l.trim().startsWith("BATTLESTATION_REMOTE_URL="));
  fs.writeFileSync(file, lines.join("\n").replace(/\n+$/, "") + "\n", { mode: 0o600 });
}


function serverEntry() {
  if (isDev) {
    return path.join(__dirname, "..", ".next", "standalone", "server.js");
  }
  return path.join(process.resourcesPath, "standalone", "server.js");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 2000 },
        (res) => {
          res.destroy();
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Next server did not start in time"));
        } else {
          setTimeout(tick, 300);
        }
      });
      req.on("timeout", () => {
        req.destroy();
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Next server start timed out"));
        } else {
          setTimeout(tick, 300);
        }
      });
    };
    tick();
  });
}

async function startServer() {
  const port = await freePort();
  const entry = serverEntry();
  const cwd = path.dirname(entry);
  ensureToken(); // first-run: mint+persist a loopback token if none exists yet
  const userEnv = loadUserEnv();
  serverProc = spawn(process.execPath, [entry], {
    cwd,
    env: {
      // personal config (fleet/vault/etc) first, then the live process env so a
      // real env var always wins, then the fixed server runtime settings.
      ...userEnv,
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      // ELECTRON_RUN_AS_NODE lets us run the bundled node, not a second Electron.
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", (d) => process.stdout.write(`[next] ${d}`));
  serverProc.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
  serverProc.on("exit", (code) => {
    if (code && code !== 0 && !app.isQuitting) {
      dialog.showErrorBox(
        "Server stopped",
        `The local server exited (code ${code}).`,
      );
    }
  });
  await waitForServer(port);
  return port;
}

// Resolve a remote thin-client target, if configured. When set, the desktop
// app does NOT spawn a local server — it loads the remote Hermes box directly,
// exactly like the iOS app / PWA (same profiles + sessions, mirrored). Reads
// the live env first (a real var still forces it), then the persisted choice
// written by the Connect screen.
function remoteTarget() {
  const env = loadUserEnv();
  const raw = (process.env.BATTLESTATION_REMOTE_URL || env.BATTLESTATION_REMOTE_URL || "").trim();
  if (!raw) return null;
  let u = raw.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// Has the user already made a choice (paired a remote, or explicitly picked a
// local server)? If neither, first launch shows the native Connect screen.
function hasChosenMode() {
  if (remoteTarget()) return true;
  const env = loadUserEnv();
  return (process.env.BATTLESTATION_MODE || env.BATTLESTATION_MODE || "").trim() === "local";
}

function persistLocalChoice() {
  const dir = userConfigDir();
  const file = path.join(dir, "battlestation.env");
  fs.mkdirSync(dir, { recursive: true });
  let lines = [];
  try {
    lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    // no file yet
  }
  const idx = lines.findIndex((l) => l.trim().startsWith("BATTLESTATION_MODE="));
  if (idx >= 0) lines[idx] = "BATTLESTATION_MODE=local";
  else lines.push("BATTLESTATION_MODE=local");
  fs.writeFileSync(file, lines.join("\n").replace(/\n+$/, "") + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

// Load the native Connect screen into the window. The user pastes a pairing
// link (URL + token) and we persist + reload into the chosen target — the
// desktop equivalent of the iOS app's native onboarding. No env editing.
function showConnect() {
  win.loadFile(path.join(__dirname, "connect.html"));
}

// Boot the dashboard for whatever mode is configured (remote box or local
// server). Called on launch when a choice exists, and after the Connect screen
// saves a new one.
async function showDashboard() {
  const remote = remoteTarget();
  let loadTarget;
  if (remote) {
    loadTarget = `${remote}/`;
  } else {
    let port;
    try {
      port = await startServer();
    } catch (e) {
      dialog.showErrorBox("Failed to start", String(e && e.message ? e.message : e));
      app.quit();
      return;
    }
    loadTarget = `http://127.0.0.1:${port}/`;
  }
  win.loadURL(loadTarget);
}

// IPC from the Connect screen.
ipcMain.handle("connect:get", () => {
  return { url: remoteTarget() || "" };
});

ipcMain.handle("connect:save", async (_evt, payload) => {
  const url = ((payload && payload.url) || "").trim();
  const token = ((payload && payload.token) || "").trim();
  if (!url) return { ok: false, error: "No server URL in the pairing link." };
  let normalized = url.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
  // Reachability probe so a bad link fails on the Connect screen, not a blank
  // dashboard. Token goes in the header the middleware accepts.
  try {
    await probeReachable(normalized, token);
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
  try {
    persistRemote(normalized, token);
    if (token) process.env.BATTLESTATION_TOKEN = token;
    process.env.BATTLESTATION_REMOTE_URL = normalized;
  } catch (e) {
    return { ok: false, error: "Could not save: " + String(e && e.message ? e.message : e) };
  }
  await showDashboard();
  return { ok: true };
});

ipcMain.handle("connect:local", async () => {
  try {
    persistLocalChoice();
  } catch {
    // non-fatal: we still boot local this session
  }
  await showDashboard();
  return { ok: true };
});

// Lightweight HTTPS/HTTP reachability check for a pairing target. Resolves on
// any HTTP response (even 401/307 — the box is up); rejects on network failure.
function probeReachable(url, token) {
  return new Promise((resolve, reject) => {
    let lib, opts;
    try {
      const u = new URL(url + "/");
      lib = u.protocol === "http:" ? http : require("node:https");
      opts = {
        method: "GET",
        host: u.hostname,
        port: u.port || (u.protocol === "http:" ? 80 : 443),
        path: "/",
        timeout: 8000,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      };
    } catch {
      reject(new Error("That URL is not valid."));
      return;
    }
    const req = lib.request(opts, (res) => {
      res.destroy();
      resolve();
    });
    req.on("error", () => reject(new Error("Could not reach that box. Check the URL and that it is online (Tailscale up?).")));
    req.on("timeout", () => { req.destroy(); reject(new Error("Connection timed out reaching the box.")); });
    req.end();
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 380,
    minHeight: 600,
    title: "Hermes Battlestation",
    backgroundColor: "#041c1c",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "connect-preload.cjs"),
    },
  });

  // Paint to the offscreen buffer first, then reveal — no white flash on launch.
  win.once("ready-to-show", () => win.show());

  // Keep the window title fixed regardless of the page's <title>.
  win.on("page-title-updated", (e) => e.preventDefault());

  // Open external links in the system browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // First launch with no choice yet → native Connect screen. Once paired (or
  // local chosen), every later launch goes straight to the dashboard.
  if (hasChosenMode()) {
    await showDashboard();
  } else {
    showConnect();
  }

  win.on("closed", () => {
    win = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverProc && !serverProc.killed) {
    serverProc.kill();
  }
});
