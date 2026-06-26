#!/usr/bin/env node
/**
 * build-extension.cjs — package the MV3 browser extension.
 *
 * Fourth delivery target alongside the Electron desktop app, the Capacitor PWA,
 * and the Hermes dashboard. The extension is a thin side-panel shell that frames
 * the running box and authenticates via an injected Authorization header (DNR),
 * so there's no Next build step here — just stamp the version, validate, and zip.
 *
 *   - syncs extension/manifest.json "version" from package.json (one source of truth)
 *   - sanity-checks required files exist and the manifest parses
 *   - writes release/hermes-battlestation-extension-v<version>.zip
 *
 * Usage: node scripts/build-extension.cjs   (or: npm run dist:extension)
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXT = path.join(ROOT, "extension");
const RELEASE = path.join(ROOT, "release");

const REQUIRED = [
  "manifest.json",
  "sw.js",
  "sidepanel.html",
  "panel.js",
  "options.html",
  "options.js",
  "icons/icon-16.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// 1. Verify the extension tree is intact.
for (const rel of REQUIRED) {
  if (!fs.existsSync(path.join(EXT, rel))) fail(`missing extension/${rel}`);
}

// 2. Stamp version from package.json.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const manifestPath = path.join(EXT, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`• synced manifest version → ${pkg.version}`);
}

// 3. Zip the extension/ tree into release/.
fs.mkdirSync(RELEASE, { recursive: true });
const out = path.join(RELEASE, `hermes-battlestation-extension-v${pkg.version}.zip`);
fs.rmSync(out, { force: true });

try {
  // -r recurse, -X strip extra attrs for reproducibility. Run inside extension/
  // so paths in the zip are relative (manifest.json at the root, as required).
  execFileSync("zip", ["-rX", out, ".", "-x", "*.DS_Store"], { cwd: EXT, stdio: "inherit" });
} catch (e) {
  fail(`zip failed (is the 'zip' CLI installed?): ${e.message}`);
}

const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`✓ extension packaged → ${path.relative(ROOT, out)} (${kb} KB)`);
