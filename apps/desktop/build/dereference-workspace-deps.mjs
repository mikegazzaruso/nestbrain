// Replace pnpm-managed workspace symlinks in apps/desktop/node_modules/@nestbrain/
// with real copies of the target packages.
//
// Why: electron-builder validates that every file it bundles resolves to a
// path under the app dir (apps/desktop/). pnpm workspaces create symlinks
// like apps/desktop/node_modules/@nestbrain/shared → packages/shared, whose
// target is OUTSIDE apps/desktop/. electron-builder follows the symlink and
// aborts with "<file> must be under apps/desktop/".
//
// This script:
//   1. Looks at every entry in apps/desktop/node_modules/@nestbrain/
//   2. For each symlink, resolves its real target, removes the symlink, and
//      copies the target as a real directory in place.
//   3. Uses `dereference: true` so further symlinks inside (transitive
//      workspace deps like @nestbrain/shared inside @nestbrain/sync, plus
//      pnpm-store symlinks for third-party deps like chokidar) also become
//      real files.
//   4. Skips the TS sources and tsbuildinfo — runtime only needs dist/.
//
// Run just before `electron-builder`. After packaging, `pnpm install`
// restores the symlinks (pnpm sees the real dirs as drift and re-symlinks).

import {
  existsSync,
  lstatSync,
  unlinkSync,
  cpSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCOPE_DIR = join(__dirname, "../node_modules/@nestbrain");

if (!existsSync(SCOPE_DIR)) {
  console.log("[deref] no apps/desktop/node_modules/@nestbrain/ to dereference; nothing to do.");
  process.exit(0);
}

let changed = 0;
for (const pkg of readdirSync(SCOPE_DIR)) {
  const link = join(SCOPE_DIR, pkg);
  let st;
  try {
    st = lstatSync(link);
  } catch {
    continue;
  }
  if (!st.isSymbolicLink()) {
    console.log(`[deref] @nestbrain/${pkg}: already a real dir, skipping.`);
    continue;
  }
  const target = realpathSync(link);
  // unlink (not rm) so we remove the symlink itself, not its target dir.
  unlinkSync(link);
  cpSync(target, link, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = src.slice(target.length).replace(/\\/g, "/");
      if (rel === "/src" || rel.startsWith("/src/")) return false;
      if (rel.endsWith(".tsbuildinfo")) return false;
      if (rel === "/tsconfig.json") return false;
      return true;
    },
  });
  changed += 1;
  console.log(`[deref] @nestbrain/${pkg}: copied ${target} → ${link}`);
}

console.log(`[deref] done — ${changed} workspace package(s) dereferenced.`);
