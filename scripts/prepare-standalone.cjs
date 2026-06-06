// Post-build fixups for the Electron standalone bundle.
//
// 1. Next's standalone output traces server deps, but a native addon declared in
//    `serverExternalPackages` (node-pty) can be missed. Ensure it (and its
//    prebuilt .node binary) lands in .next/standalone/node_modules so the booted
//    server can require it.
// 2. Mirror static assets into the standalone tree the same way `next start`
//    serves them, so the Electron-booted server finds them at the expected path.
//    (electron-builder also copies these via extraResources; doing it here too
//    keeps `electron .` working straight off the build with no packaging step.)
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isSymbolicLink()) {
      try {
        fs.symlinkSync(fs.readlinkSync(s), d);
      } catch {
        fs.copyFileSync(s, d);
      }
    } else fs.copyFileSync(s, d);
  }
}

function ensure(label, fn) {
  try {
    fn();
    console.log(`[prepare-standalone] ${label}: ok`);
  } catch (e) {
    console.error(`[prepare-standalone] ${label}: FAILED — ${e.message}`);
    process.exitCode = 1;
  }
}

if (!fs.existsSync(standalone)) {
  console.error(
    "[prepare-standalone] .next/standalone not found — run `next build` with output:'standalone' first.",
  );
  process.exit(1);
}

// 1. node-pty
ensure("node-pty -> standalone/node_modules", () => {
  const src = path.join(root, "node_modules", "node-pty");
  const dest = path.join(standalone, "node_modules", "node-pty");
  if (!fs.existsSync(src)) throw new Error("node_modules/node-pty missing");
  fs.rmSync(dest, { recursive: true, force: true });
  copyDir(src, dest);
});

// 1b. Next 16 + Turbopack standalone tracing misses the compiled next-server
//     runtime files that route/page handlers require at boot (notably
//     app-route-turbo.runtime.prod.js). Without them every /api/* route throws
//     "Cannot find module .../app-route-turbo.runtime.prod.js" and the booted
//     server returns 500s (no repos, dead Kanban). Copy all *.runtime.prod.js.
ensure("next-server runtime -> standalone", () => {
  const src = path.join(
    root,
    "node_modules",
    "next",
    "dist",
    "compiled",
    "next-server",
  );
  const dest = path.join(
    standalone,
    "node_modules",
    "next",
    "dist",
    "compiled",
    "next-server",
  );
  if (!fs.existsSync(src)) throw new Error("compiled/next-server missing");
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(src)) {
    if (!name.endsWith(".runtime.prod.js")) continue;
    fs.copyFileSync(path.join(src, name), path.join(dest, name));
    copied++;
  }
  if (copied === 0) throw new Error("no *.runtime.prod.js found to copy");
});

// 2. static assets
ensure("static -> standalone/.next/static", () => {
  const src = path.join(root, ".next", "static");
  const dest = path.join(standalone, ".next", "static");
  if (fs.existsSync(src)) copyDir(src, dest);
});

ensure("public -> standalone/public", () => {
  const src = path.join(root, "public");
  const dest = path.join(standalone, "public");
  if (fs.existsSync(src)) copyDir(src, dest);
});

console.log("[prepare-standalone] done");
