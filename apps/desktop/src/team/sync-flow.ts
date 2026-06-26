import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir, stat, rm } from "node:fs/promises";
import { join, relative, dirname, sep } from "node:path";
import { diffFiles, type FileMap, type SyncBackend } from "@nestbrain/sync";

// Drives the GPL `diffFiles` 3-way reconcile against a SyncBackend: walk the
// local wiki folder, diff base/local/remote, transfer blobs, write keep-both
// conflict siblings, and commit with optimistic-concurrency retry on 409.

// `vector-index.json` is the per-device LOCAL embeddings index — it must never
// be shared (it's rebuilt locally from the synced articles, and it's large/
// churny). Everything else under Library/Knowledge is structured wiki content.
const IGNORE = new Set([".git", "node_modules", ".nestbrain", ".obsidian", "vector-index.json"]);

/**
 * Walk the wiki folder into a path → {hash(sha256), size, mtime} map.
 * Incremental: when `cache[path]` matches a file's current size + mtime, its
 * hash is reused without reading/hashing the file — mirroring the Drive
 * engine's mtime/size fast-path so an unchanged tree costs only stat()s.
 */
export async function walkLocal(
  dir: string,
  cache: FileMap = {},
  root = dir,
  out: FileMap = {},
  extraIgnore?: ReadonlySet<string>,
): Promise<FileMap> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || IGNORE.has(e.name) || extraIgnore?.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walkLocal(full, cache, root, out, extraIgnore);
    } else if (e.isFile()) {
      // Only real files are synced. Symlinks (a Dirent symlink reports neither
      // isFile nor isDirectory for its target) and other special entries are
      // skipped — following a symlink-to-directory would `readFile` a directory
      // and throw EISDIR, and could loop. This is what broke Projects sharing.
      const rel = relative(root, full).split(sep).join("/");
      const st = await stat(full);
      const mtime = Math.floor(st.mtimeMs / 1000);
      const cached = cache[rel];
      if (cached && cached.size === st.size && cached.mtime === mtime) {
        out[rel] = cached; // unchanged → reuse hash, skip read+sha256
      } else {
        const buf = await readFile(full);
        out[rel] = { hash: createHash("sha256").update(buf).digest("hex"), size: buf.length, mtime };
      }
    }
  }
  return out;
}

export interface SyncResult {
  version: number;
  base: FileMap;
  conflicts: string[];
  uploaded: number;
  downloaded: number;
  /** Local article paths written this sync (downloads + conflict siblings) —
   *  the ones that need (re)indexing into the local vector store. */
  changed: string[];
}

function conflictName(path: string): string {
  const ts = Date.now();
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? `${path.slice(0, dot)}.conflict-${ts}${path.slice(dot)}` : `${path}.conflict-${ts}`;
}

async function writeLocalFile(dir: string, path: string, bytes: Uint8Array): Promise<void> {
  const full = join(dir, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes);
}

/**
 * A local directory mapped to a server-side path prefix inside the workspace.
 * Knowledge uses prefix "" (the existing layout, no migration); Team notes use
 * "Team/". `index` flags whether downloaded files should be embedded into the
 * local vector store — true for the wiki, false for plain Team notes (they
 * sync but must never pollute knowledge/search).
 */
export interface SyncRoot {
  dir: string;
  prefix: string;
  index: boolean;
  /** Top-level entry names to skip in this root's walk (e.g. "Nests" so the
   *  global workspace never swallows the restricted subtrees). */
  ignore?: string[];
}

/**
 * Map a server path back to its local root + relative path. Longest non-empty
 * prefix wins; the "" prefix is the catch-all (knowledge).
 */
function resolveRoot(roots: SyncRoot[], serverPath: string): { root: SyncRoot; rel: string } {
  const ranked = [...roots].filter((r) => r.prefix !== "").sort((a, b) => b.prefix.length - a.prefix.length);
  for (const r of ranked) {
    if (serverPath === r.prefix || serverPath.startsWith(r.prefix)) {
      return { root: r, rel: serverPath.slice(r.prefix.length) };
    }
  }
  const fallback = roots.find((r) => r.prefix === "");
  if (!fallback) throw new Error(`sync: no root for "${serverPath}"`);
  return { root: fallback, rel: serverPath };
}

export async function runSync(
  backend: SyncBackend,
  workspaceId: string,
  roots: SyncRoot[],
  base: FileMap,
  maxRetries = 5,
  readOnly = false,
  skipPrefixes: string[] = [],
): Promise<SyncResult> {
  // Server paths under a skipped prefix (e.g. "Projects/" when this device
  // opted out) are not ours to manage: they're excluded from the diff and
  // carried through commits untouched, so opting out never deletes them.
  const skipped = (p: string) => skipPrefixes.some((s) => p.startsWith(s));
  let cur = base;
  if (skipPrefixes.length) {
    cur = Object.fromEntries(Object.entries(cur).filter(([p]) => !skipped(p)));
  }
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Walk every root into a single prefixed local map, reusing the matching
    // slice of `cur` as each root's mtime/size→hash cache.
    const local: FileMap = {};
    for (const r of roots) {
      const subCache: FileMap = {};
      for (const [k, v] of Object.entries(cur)) {
        if (resolveRoot(roots, k).root.dir === r.dir) subCache[resolveRoot(roots, k).rel] = v;
      }
      const sub = await walkLocal(r.dir, subCache, r.dir, {}, r.ignore ? new Set(r.ignore) : undefined);
      for (const [rel, entry] of Object.entries(sub)) local[r.prefix + rel] = entry;
    }

    const remote = await backend.getManifest(workspaceId);
    let actions = diffFiles(cur, local, remote.files);
    if (skipPrefixes.length) actions = actions.filter((a) => !skipped(a.path));

    // Nothing differs between local and remote → don't churn a new manifest
    // version (important for the idle background poll). Adopt remote as base.
    if (actions.length === 0) {
      return { version: remote.version, base: remote.files, conflicts: [], uploaded: 0, downloaded: 0, changed: [] };
    }

    // Read-only (reader role): apply downloads/deletes locally, never upload,
    // never commit — the server would 403 a reader's writes anyway. Local
    // edits simply stay local (and keep re-appearing as skipped uploads).
    if (readOnly) {
      const changed: string[] = [];
      let downloaded = 0;
      for (const a of actions) {
        const { root, rel } = resolveRoot(roots, a.path);
        if (a.action === "download") {
          const entry = remote.files[a.path];
          await writeLocalFile(root.dir, rel, await backend.getBlob(workspaceId, entry.hash));
          downloaded++;
          changed.push(a.path);
        } else if (a.action === "keep-both") {
          // Reader edited a file locally AND remote moved: keep their local
          // copy untouched, land the remote next to it as .conflict-….
          const rentry = remote.files[a.path];
          const cpath = conflictName(a.path);
          const c = resolveRoot(roots, cpath);
          await writeLocalFile(c.root.dir, c.rel, await backend.getBlob(workspaceId, rentry.hash));
          downloaded++;
          changed.push(cpath);
        } else if (a.action === "delete-local") {
          await rm(join(root.dir, rel), { force: true });
        }
      }
      return { version: remote.version, base: remote.files, conflicts: [], uploaded: 0, downloaded, changed };
    }

    const newFiles: FileMap = {};
    const conflicts: string[] = [];
    const changed: string[] = [];
    let uploaded = 0;
    let downloaded = 0;

    for (const p of Object.keys(local)) {
      if (local[p].hash === remote.files[p]?.hash) newFiles[p] = local[p];
    }
    // Carry skipped-prefix entries through the commit untouched.
    for (const [p, e] of Object.entries(remote.files)) {
      if (skipped(p)) newFiles[p] = e;
    }

    for (const a of actions) {
      const p = a.path;
      const { root, rel } = resolveRoot(roots, p);
      if (a.action === "upload") {
        await backend.putBlob(workspaceId, local[p].hash, await readFile(join(root.dir, rel)));
        uploaded++;
        newFiles[p] = local[p];
      } else if (a.action === "download") {
        const entry = remote.files[p];
        await writeLocalFile(root.dir, rel, await backend.getBlob(workspaceId, entry.hash));
        downloaded++;
        newFiles[p] = entry;
        changed.push(p);
      } else if (a.action === "keep-both") {
        await backend.putBlob(workspaceId, local[p].hash, await readFile(join(root.dir, rel)));
        uploaded++;
        newFiles[p] = local[p];
        const rentry = remote.files[p];
        const cpath = conflictName(p);
        const c = resolveRoot(roots, cpath);
        await writeLocalFile(c.root.dir, c.rel, await backend.getBlob(workspaceId, rentry.hash));
        downloaded++;
        newFiles[cpath] = rentry;
        conflicts.push(cpath);
        changed.push(cpath);
      } else if (a.action === "delete-local") {
        await rm(join(root.dir, rel), { force: true });
      }
      // delete-remote → simply omit from newFiles
    }

    const res = await backend.commit(workspaceId, remote.version, newFiles);
    if (res.ok) {
      return { version: res.manifest.version, base: newFiles, conflicts, uploaded, downloaded, changed };
    }
    cur = newFiles; // a peer committed first — adopt our merge as base and retry
  }
  throw new Error("sync: too many conflict retries");
}
