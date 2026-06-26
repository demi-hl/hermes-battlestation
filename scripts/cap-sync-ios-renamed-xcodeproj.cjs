#!/usr/bin/env node
// Capacitor CLI currently assumes the iOS native project is named App.xcodeproj.
// The public build project is intentionally renamed to "Hermes Battlestation.xcodeproj",
// so create a temporary compatibility symlink only for the sync command.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const iosDir = path.join(root, "ios", "App");
const expected = path.join(iosDir, "App.xcodeproj");
const renamed = path.join(iosDir, "Hermes Battlestation.xcodeproj");
let madeSymlink = false;

try {
  if (!fs.existsSync(renamed)) {
    console.error(`[cap-sync-ios] missing renamed project: ${path.relative(root, renamed)}`);
    process.exit(1);
  }

  if (!fs.existsSync(expected)) {
    fs.symlinkSync(path.basename(renamed), expected, "dir");
    madeSymlink = true;
    console.log(`[cap-sync-ios] linked ${path.relative(root, expected)} -> ${path.basename(renamed)}`);
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npx, ["cap", "sync", "ios"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    console.error(`[cap-sync-ios] ${result.error.message}`);
    process.exit(1);
  }
  process.exitCode = result.status ?? 1;
} finally {
  if (madeSymlink) {
    try {
      fs.unlinkSync(expected);
      console.log(`[cap-sync-ios] removed temporary ${path.relative(root, expected)}`);
    } catch (error) {
      console.error(`[cap-sync-ios] failed to remove temporary symlink: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
