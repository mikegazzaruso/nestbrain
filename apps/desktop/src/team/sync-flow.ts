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

export async function walkLocal(dir: string, root = dir, out: FileMap = {}): Promise<FileMap> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || IGNORE.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walkLocal(full, root, out);
    } else {
      const buf = await readFile(full);
      const st = await stat(full);
      out[relative(root, full).split(sep).join("/")] = {
        hash: createHash("sha256").update(buf).digest("hex"),
        size: buf.length,
        mtime: Math.floor(st.mtimeMs / 1000),
      };
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

export async function runSync(
  backend: SyncBackend,
  workspaceId: string,
  dir: string,
  base: FileMap,
  maxRetries = 5,
): Promise<SyncResult> {
  let cur = base;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const local = await walkLocal(dir);
    const remote = await backend.getManifest(workspaceId);
    const actions = diffFiles(cur, local, remote.files);

    // Nothing differs between local and remote → don't churn a new manifest
    // version (important for the idle background poll). Adopt remote as base.
    if (actions.length === 0) {
      return { version: remote.version, base: remote.files, conflicts: [], uploaded: 0, downloaded: 0, changed: [] };
    }

    const newFiles: FileMap = {};
    const conflicts: string[] = [];
    const changed: string[] = [];
    let uploaded = 0;
    let downloaded = 0;

    for (const p of Object.keys(local)) {
      if (local[p].hash === remote.files[p]?.hash) newFiles[p] = local[p];
    }

    for (const a of actions) {
      const p = a.path;
      if (a.action === "upload") {
        await backend.putBlob(workspaceId, local[p].hash, await readFile(join(dir, p)));
        uploaded++;
        newFiles[p] = local[p];
      } else if (a.action === "download") {
        const entry = remote.files[p];
        await writeLocalFile(dir, p, await backend.getBlob(workspaceId, entry.hash));
        downloaded++;
        newFiles[p] = entry;
        changed.push(p);
      } else if (a.action === "keep-both") {
        await backend.putBlob(workspaceId, local[p].hash, await readFile(join(dir, p)));
        uploaded++;
        newFiles[p] = local[p];
        const rentry = remote.files[p];
        const cpath = conflictName(p);
        await writeLocalFile(dir, cpath, await backend.getBlob(workspaceId, rentry.hash));
        downloaded++;
        newFiles[cpath] = rentry;
        conflicts.push(cpath);
        changed.push(cpath);
      } else if (a.action === "delete-local") {
        await rm(join(dir, p), { force: true });
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
