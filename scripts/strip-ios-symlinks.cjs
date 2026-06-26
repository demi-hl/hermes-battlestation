#!/usr/bin/env node
// Strip server-only node_modules symlinks that `cap copy` drags from .next into
// the iOS bundle's public/. iOS install REJECTS bundles containing symlinks that
// point outside the container (devicectl error 3002 "Invalid symlink"), e.g.
//   public/node_modules/node-pty-* -> ../../../../node_modules/node-pty
// node-pty is a native server dep with no meaning in the WebView shell, so we
// just remove any node_modules dirs + dangling symlinks under the copied public.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "ios", "App", "App", "public");

if (!fs.existsSync(PUBLIC)) {
  console.log("[strip-ios-symlinks] no ios public dir yet, skipping");
  process.exit(0);
}

let removed = 0;

// 1) nuke server-only dirs wholesale. The iOS shell loads the live remote URL,
// so bundling Next standalone/server output just exposes source and bloats the IPA.
for (const name of ["node_modules", "standalone", "server", "cache"]) {
  for (const dir of findDirs(PUBLIC, name)) {
    fs.rmSync(dir, { recursive: true, force: true });
    removed++;
    console.log(`[strip-ios-symlinks] removed ${path.relative(PUBLIC, dir)}`);
  }
}

// 2) remove any remaining dangling symlinks (point to a non-existent target)
walk(PUBLIC, (p) => {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink() && !fs.existsSync(p)) {
    fs.unlinkSync(p);
    removed++;
    console.log(`[strip-ios-symlinks] removed dangling symlink ${path.relative(PUBLIC, p)}`);
  }
});

console.log(`[strip-ios-symlinks] done (${removed} removed)`);

function findDirs(root, name) {
  const out = [];
  walk(root, (p) => {
    try {
      if (fs.lstatSync(p).isDirectory() && path.basename(p) === name) out.push(p);
    } catch {}
  });
  return out;
}

function walk(dir, fn) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    fn(full);
    // do not descend into symlinked dirs (avoid loops); only real dirs
    let real = false;
    try {
      real = fs.lstatSync(full).isDirectory() && !fs.lstatSync(full).isSymbolicLink();
    } catch {}
    if (real && e.name !== "node_modules") walk(full, fn);
  }
}
