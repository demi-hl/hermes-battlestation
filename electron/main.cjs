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
  serverProc = spawn(process.execPath, [entry], {
    cwd,
    env: {
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
    title: "Locals Only",
    backgroundColor: "#041c1c",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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
