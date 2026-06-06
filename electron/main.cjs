// Electron main process — boots the standalone Next server as a child and loads
// it in a window. This is what turns the cockpit into a downloadable desktop app:
// the user runs the installer, we start their LOCAL node server (talking to their
// own `hermes`, repos, ssh) and render it. Nothing phones home.
const { app, BrowserWindow, shell, dialog } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");

const isDev = !app.isPackaged;
let serverProc = null;
let win = null;

const fs = require("node:fs");
const os = require("node:os");

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

// In a packaged app the standalone server is unpacked next to resources.
// In dev we point at the repo's built standalone output.
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

async function createWindow() {
  let port;
  try {
    port = await startServer();
  } catch (e) {
    dialog.showErrorBox("Failed to start", String(e && e.message ? e.message : e));
    app.quit();
    return;
  }

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

  win.loadURL(`http://127.0.0.1:${port}/`);
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
