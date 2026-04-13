#!/usr/bin/env node
// After `next build` with output: standalone, Next.js traces imports and
// copies only the files it detected. For native-binding packages (e.g.
// onnxruntime-node, pdfjs-dist, sharp, pdf-parse) this misses sibling assets
// like .dylib, .so, worker files, etc. We fix two things:
//
// 1) Create top-level symlinks in standalone/node_modules/<pkg> → real pnpm
//    store location, so Node's resolver can find externalized packages.
// 2) Replace the (partial) NFT-copied package directories inside
//    standalone/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg> with
//    symlinks to the real pnpm package dirs, so dlopen of .node files can
//    find their sibling .dylib/.so files.
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  symlinkSync,
  rmSync,
  readdirSync,
  statSync,
  readFileSync,
  lstatSync,
  chmodSync,
  cpSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// When set (by the packaging scripts), replace the symlink strategy with
// real file copies that dereference all symlinks. Symlinks work great for
// dev iteration but break during electron-builder's code-signing pass: it
// walks into symlinks pointing back to the repo's pnpm store, which is
// outside the .app bundle, and either follows them out-of-bundle or hits
// dangling entries (e.g. .pnpm/node_modules/semver ENOENT).
const COPY_MODE = process.env.MINDNEST_STANDALONE_COPY === "1";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const STANDALONE_ROOT = join(REPO_ROOT, "apps/web/.next/standalone/node_modules");
const APPS_WEB_ROOT = join(REPO_ROOT, "apps/web");
const REAL_STORE = join(REPO_ROOT, "node_modules/.pnpm");
const STANDALONE_STORE = join(STANDALONE_ROOT, ".pnpm");

if (!existsSync(STANDALONE_ROOT)) {
  console.error("Standalone node_modules not found at:", STANDALONE_ROOT);
  process.exit(1);
}

// Top-level packages we want resolvable by Node require from standalone
const TOP_LEVEL_PACKAGES = [
  "pdf-parse",
  "pdfjs-dist",
  "@huggingface/transformers",
  "onnxruntime-node",
  "onnxruntime-common",
  "sharp",
];

// Packages with native binaries that need full pnpm store dir replacement
// Format: { nameInStore: "onnxruntime-node@1.24.3", nameInNm: "onnxruntime-node" }
const NATIVE_PACKAGES_TO_REPLACE = [];

// Discover which .pnpm entries exist in the standalone copy and target them
if (existsSync(STANDALONE_STORE)) {
  for (const entry of readdirSync(STANDALONE_STORE)) {
    // Match packages that commonly ship native bins
    if (
      entry.startsWith("onnxruntime-node@") ||
      entry.startsWith("onnxruntime-web@") ||
      entry.startsWith("pdfjs-dist@") ||
      entry.startsWith("sharp@") ||
      entry.startsWith("@img+sharp-") ||
      entry.startsWith("pdf-parse@")
    ) {
      // Determine the actual package name inside .pnpm/<entry>/node_modules/
      const nmDir = join(STANDALONE_STORE, entry, "node_modules");
      if (!existsSync(nmDir)) continue;
      for (const subEntry of readdirSync(nmDir)) {
        if (subEntry.startsWith("@")) {
          // scoped: go one deeper
          const scopedDir = join(nmDir, subEntry);
          try {
            for (const sub2 of readdirSync(scopedDir)) {
              NATIVE_PACKAGES_TO_REPLACE.push({
                storeDir: entry,
                pkgName: `${subEntry}/${sub2}`,
              });
            }
          } catch { /* ignore */ }
        } else if (!subEntry.startsWith(".")) {
          NATIVE_PACKAGES_TO_REPLACE.push({
            storeDir: entry,
            pkgName: subEntry,
          });
        }
      }
    }
  }
}

function forceRemove(p) {
  try {
    const st = lstatSync(p);
    if (st.isSymbolicLink() || st.isFile()) {
      rmSync(p, { force: true });
    } else {
      rmSync(p, { recursive: true, force: true });
    }
  } catch { /* already gone */ }
}

function makeSymlink(linkPath, target) {
  // Ensure parent dir exists
  mkdirSync(dirname(linkPath), { recursive: true });
  forceRemove(linkPath);
  symlinkSync(target, linkPath, "dir");
}

function makeLinkOrCopy(linkPath, target) {
  mkdirSync(dirname(linkPath), { recursive: true });
  forceRemove(linkPath);
  if (COPY_MODE) {
    // Recursive copy, dereferencing any nested symlinks so the result is
    // self-contained and safe to put inside a packaged .app bundle.
    cpSync(target, linkPath, { recursive: true, dereference: true });
  } else {
    symlinkSync(target, linkPath, "dir");
  }
}

// Surgical native-file sync: copy only the NATIVE binary files (.node,
// .dylib, .so, .wasm) from the real pnpm store into the standalone's
// partial package dir, WITHOUT replacing whole packages. This avoids the
// duplication bloat that wholesale `cpSync(dereference:true)` causes when
// a package directory contains relative symlinks to sibling deps.
const NATIVE_EXTS = new Set([".node", ".dylib", ".so", ".wasm", ".dll"]);
function hasNativeExt(name) {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return NATIVE_EXTS.has(name.slice(dot).toLowerCase());
}
function syncNativeFiles(realDir, standaloneDir) {
  if (!existsSync(realDir)) return 0;
  let synced = 0;
  for (const entry of readdirSync(realDir, { withFileTypes: true })) {
    const realChild = join(realDir, entry.name);
    const standaloneChild = join(standaloneDir, entry.name);
    if (entry.isDirectory()) {
      if (!existsSync(standaloneChild)) {
        mkdirSync(standaloneChild, { recursive: true });
      }
      synced += syncNativeFiles(realChild, standaloneChild);
    } else if (entry.isFile() && hasNativeExt(entry.name)) {
      if (!existsSync(standaloneChild)) {
        mkdirSync(dirname(standaloneChild), { recursive: true });
        cpSync(realChild, standaloneChild);
        synced++;
      }
    }
  }
  return synced;
}

// === Step 1: hydrate native files into NFT-copied partial packages ===
// Dev mode (symlinks): replace wholesale, fast, bytes reused.
// Copy mode (packaging): SURGICAL — only copy native files NFT missed,
//   leaving relative sibling symlinks intact. This avoids duplicating
//   entire transitive dep dirs (pdfjs-dist used to end up 3x in the
//   packaged .app).
let replaced = 0;
let surgicalFiles = 0;
for (const { storeDir, pkgName } of NATIVE_PACKAGES_TO_REPLACE) {
  const standalonePkgPath = join(STANDALONE_STORE, storeDir, "node_modules", pkgName);
  const realPkgPath = join(REAL_STORE, storeDir, "node_modules", pkgName);
  if (!existsSync(realPkgPath)) {
    console.warn(`[warn] real package missing: ${realPkgPath}`);
    continue;
  }
  if (COPY_MODE) {
    const added = syncNativeFiles(realPkgPath, standalonePkgPath);
    if (added > 0) {
      console.log(`+ hydrated ${added} native file(s) in .pnpm/${storeDir}/node_modules/${pkgName}`);
      surgicalFiles += added;
    }
  } else {
    makeLinkOrCopy(standalonePkgPath, realPkgPath);
    console.log(`✓ replaced .pnpm/${storeDir}/node_modules/${pkgName}`);
    replaced++;
  }
}

// === Step 2: create top-level symlinks for externalized packages ===
const require = createRequire(join(APPS_WEB_ROOT, "package.json"));

function packageRoot(pkg) {
  const searchPaths = [APPS_WEB_ROOT, join(REPO_ROOT, "packages/core"), REPO_ROOT];
  try {
    const pkgJson = require.resolve(`${pkg}/package.json`, { paths: searchPaths });
    return dirname(pkgJson);
  } catch { /* fall through */ }
  try {
    const entry = require.resolve(pkg, { paths: searchPaths });
    let dir = dirname(entry);
    while (dir !== "/" && dir.length > 1) {
      const pj = join(dir, "package.json");
      if (existsSync(pj)) {
        try {
          const content = JSON.parse(readFileSync(pj, "utf-8"));
          if (content.name === pkg) return dir;
        } catch { /* ignore */ }
      }
      dir = dirname(dir);
    }
  } catch (err) {
    console.warn(`[warn] cannot resolve ${pkg}:`, err.message);
  }
  return null;
}

for (const pkg of TOP_LEVEL_PACKAGES) {
  const root = packageRoot(pkg);
  if (!root) continue;
  const linkPath = join(STANDALONE_ROOT, pkg);
  makeLinkOrCopy(linkPath, root);
  console.log(`✓ node_modules/${pkg} → ${root}`);
}

// === Step 3: ensure node-pty spawn-helper is executable ===
// pnpm strips the +x bit during extraction, which causes posix_spawnp to fail
// at runtime when node-pty tries to launch the shell.
const nodePtyPrebuilds = join(
  REPO_ROOT,
  "node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty/prebuilds",
);
if (existsSync(nodePtyPrebuilds)) {
  for (const platDir of readdirSync(nodePtyPrebuilds)) {
    const helper = join(nodePtyPrebuilds, platDir, "spawn-helper");
    if (existsSync(helper)) {
      try {
        chmodSync(helper, 0o755);
        console.log(`✓ chmod +x ${platDir}/spawn-helper`);
      } catch (err) {
        console.warn(`[warn] chmod spawn-helper failed: ${err.message}`);
      }
    }
  }
}

// === Step 4: Remove dangling symlinks in .pnpm/node_modules/ ===
// Next.js's NFT output sometimes contains symlink shims at
// standalone/node_modules/.pnpm/node_modules/<pkg> that point at package
// versions that were never copied into the standalone tree (e.g.
// semver → ../semver@6.3.1/... when only semver@7.7.4 was copied).
// These are harmless in dev (nothing stats them) but crash electron-builder's
// code-signing pass with ENOENT. Scrub them.
const pnpmNmDir = join(STANDALONE_STORE, "node_modules");
let danglingRemoved = 0;
function scrubDangling(dir, depth = 0) {
  if (depth > 3 || !existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        statSync(p); // throws on dangling
      } catch {
        try {
          rmSync(p, { force: true });
          danglingRemoved++;
        } catch {
          /* ignore */
        }
      }
    } else if (entry.isDirectory()) {
      scrubDangling(p, depth + 1);
    }
  }
}
scrubDangling(pnpmNmDir);
if (danglingRemoved > 0) {
  console.log(`✗ removed ${danglingRemoved} dangling symlink(s) in .pnpm/node_modules/`);
}

console.log(
  `\nStandalone modules prepared: ${replaced} native packages ${COPY_MODE ? "copied" : "replaced (symlinks)"}, ${danglingRemoved} dangling scrubbed, top-level entries in place.`,
);
