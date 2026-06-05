// Sync engine — one-cycle orchestrator (push, pull, soft-delete, hard-delete).
//
// The engine is Electron-free: only `fetch` + `node:fs`. It can move into a
// utility process later without changing its API.

import { unlink, mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SYNC_DRIVE_FOLDER_NAME } from "@nestbrain/shared";
import type { SyncPreferences, SyncProgress } from "@nestbrain/shared";
import { DriveError, type DriveAdapter, type DriveFile } from "./drive-adapter";
import type { Manifest, WalkEntry } from "./types";
import { buildExcludes } from "./excludes";
import { walk } from "./walker";
import { hashFile } from "./hash";

const TRASH_PREFIX = ".trash";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface EngineOptions {
  workspacePath: string;
  drive: DriveAdapter;
  manifest: Manifest;
  prefs: SyncPreferences;
  onProgress: (p: SyncProgress) => void;
  persistManifest: () => Promise<void>;
  signal: AbortSignal;
}

export interface SkippedFile {
  relPath: string;
  reason: "too-large" | "unreadable";
  size?: number;
}

export interface CycleResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  softDeletes: number;
  skippedFiles: SkippedFile[];
  durationMs: number;
}

export class SyncEngine {
  constructor(private readonly opts: EngineOptions) {}

  /** Pull-only cycle. Used by the periodic poll. */
  async runPull(): Promise<CycleResult> {
    const start = Date.now();
    try {
      await this.ensureRoot();
      const { downloaded, conflicts, softDeletes } = await this.pull();
      this.opts.manifest.lastSyncAt = Date.now();
      return {
        uploaded: 0,
        downloaded,
        conflicts,
        softDeletes,
        skippedFiles: [],
        durationMs: Date.now() - start,
      };
    } finally {
      // Persist once per cycle — including on abort/error — so partial progress isn't lost
      // but we don't pay the atomic-rewrite cost per-file the way the old loop-internal
      // saves did.
      await this.opts.persistManifest();
    }
  }

  /** Push-only cycle. Used by the watcher and by the "Sync now" button.
   *
   * If `hintedPaths` is provided (set of POSIX-relative paths the watcher saw
   * change), we skip the full workspace walk and only inspect those paths.
   * Without a hint we fall back to a full walk — used by manual sync and by
   * the initial cycle after sign-in.
   */
  async runPush(hintedPaths?: string[]): Promise<CycleResult> {
    const start = Date.now();
    try {
      await this.ensureRoot();
      const { uploaded, skippedFiles } = await this.push(hintedPaths);
      this.opts.manifest.lastSyncAt = Date.now();
      return {
        uploaded,
        downloaded: 0,
        conflicts: 0,
        softDeletes: 0,
        skippedFiles,
        durationMs: Date.now() - start,
      };
    } finally {
      await this.opts.persistManifest();
    }
  }

  /** Pull then push — the canonical "sync everything" cycle. */
  async runFullCycle(): Promise<CycleResult> {
    const start = Date.now();
    try {
      await this.ensureRoot();
      const pullRes = await this.pull();
      this.checkAborted();
      const pushRes = await this.push();
      this.opts.manifest.lastSyncAt = Date.now();
      return {
        uploaded: pushRes.uploaded,
        downloaded: pullRes.downloaded,
        conflicts: pullRes.conflicts,
        softDeletes: pullRes.softDeletes,
        skippedFiles: pushRes.skippedFiles,
        durationMs: Date.now() - start,
      };
    } finally {
      await this.opts.persistManifest();
    }
  }

  // ---------- internals ----------

  private async ensureRoot(): Promise<void> {
    const { manifest, drive } = this.opts;
    if (!manifest.rootFolderDriveId) {
      manifest.rootFolderDriveId = await drive.ensureFolder(SYNC_DRIVE_FOLDER_NAME, "root");
      manifest.folders[""] = manifest.rootFolderDriveId;
    }
    this.checkAborted();
  }

  // ===== PUSH =====

  private async push(hintedPaths?: string[]): Promise<{ uploaded: number; skippedFiles: SkippedFile[] }> {
    const { workspacePath, prefs } = this.opts;
    const isExcluded = buildExcludes({ includeProjects: prefs.includeProjects });
    const isHinted = !!(hintedPaths && hintedPaths.length > 0);

    // Only show "Scanning workspace…" for the full-walk case — a hinted push
    // is O(hint size) and finishes in ms, the scan label would just flicker.
    this.emit(
      {
        total: 0,
        done: 0,
        skipped: 0,
        currentFile: isHinted
          ? `Checking ${hintedPaths!.length} change${hintedPaths!.length === 1 ? "" : "s"}…`
          : "Scanning workspace…",
      },
      true,
    );
    const candidates: WalkEntry[] = [];
    if (isHinted) {
      // Watcher-targeted push: only the paths chokidar saw change. Each one
      // still goes through the mtime/size fast-path in pushOne, so unchanged
      // files cost ~one stat and zero hashes.
      for (const relPath of hintedPaths!) {
        this.checkAborted();
        if (isExcluded(relPath)) continue;
        const absPath = join(workspacePath, relPath);
        try {
          const s = await stat(absPath);
          if (!s.isFile()) continue;
          if (s.size > prefs.maxFileSizeBytes) {
            // pushOne would skip it; we'd rather record it as too-large here so
            // the manager can surface it.
            continue;
          }
          candidates.push({
            relPath,
            absPath,
            size: s.size,
            mtime: s.mtimeMs,
          });
        } catch {
          // Hinted file disappeared between event and now (e.g. tmp file in an
          // atomic save). Skip silently.
        }
      }
    } else {
      for await (const entry of walk(workspacePath, isExcluded)) {
        candidates.push(entry);
      }
    }
    this.checkAborted();

    const skippedFiles: SkippedFile[] = [];
    const toProcess = candidates.filter((c) => {
      if (c.size > prefs.maxFileSizeBytes) {
        skippedFiles.push({ relPath: c.relPath, reason: "too-large", size: c.size });
        return false;
      }
      return true;
    });

    let done = 0;
    let uploaded = 0;
    this.emit({ total: toProcess.length, done, skipped: skippedFiles.length }, true);

    for (const f of toProcess) {
      this.checkAborted();
      this.emit({
        total: toProcess.length,
        done,
        skipped: skippedFiles.length,
        currentFile: f.relPath,
        bytesTotal: f.size,
        bytesUploaded: 0,
      });
      try {
        const wasUploaded = await this.pushOne(f);
        if (wasUploaded) uploaded += 1;
      } catch (err) {
        console.error(`[sync] failed to upload ${f.relPath}:`, err);
        skippedFiles.push({ relPath: f.relPath, reason: "unreadable", size: f.size });
      }
      done += 1;
      this.emit({
        total: toProcess.length,
        done,
        skipped: skippedFiles.length,
        currentFile: f.relPath,
      });
    }

    return { uploaded, skippedFiles };
  }

  private async pushOne(f: WalkEntry): Promise<boolean> {
    const { manifest, drive } = this.opts;
    const existing = manifest.files[f.relPath];

    // Fast path: mtime + size unchanged → assume content unchanged, no hash.
    if (existing && existing.mtime === f.mtime && existing.size === f.size) {
      return false;
    }

    // mtime/size differs → hash to know if content actually changed.
    const md5 = await hashFile(f.absPath);
    if (existing && existing.md5 === md5) {
      // Same content, only the mtime/size drifted. Refresh stats, no upload.
      manifest.files[f.relPath] = { ...existing, mtime: f.mtime, size: f.size };
      return false;
    }

    // Upload (PATCH if we already have a driveId, otherwise create-or-update).
    const dirRel = posixDirname(f.relPath);
    const parentDriveId = await this.ensureFolderChain(dirRel);
    const name = posixBasename(f.relPath);

    let result;
    if (existing?.driveId) {
      result = await drive.updateFile({ fileId: existing.driveId, localPath: f.absPath });
    } else {
      result = await drive.createOrUpdateFile({ name, parentId: parentDriveId, localPath: f.absPath });
    }

    manifest.files[f.relPath] = {
      md5: result.md5Checksum || md5, // fall back to local md5 if Drive omitted it
      driveId: result.id,
      mtime: f.mtime,
      size: f.size,
    };
    // Manifest is persisted at end-of-cycle (incl. abort) by runPush/runFullCycle.
    return true;
  }

  // ===== PULL =====

  private async pull(): Promise<{ downloaded: number; conflicts: number; softDeletes: number }> {
    const { manifest, drive } = this.opts;
    if (!manifest.rootFolderDriveId) return { downloaded: 0, conflicts: 0, softDeletes: 0 };

    // Fast path: we have a Drive page token from a previous pull. Ask Drive
    // for the delta since then — when nothing changed remotely the request
    // returns zero changes and we exit in milliseconds. This replaces the
    // old "walk the entire Drive tree every 60s" behavior.
    if (manifest.driveChangesPageToken) {
      try {
        return await this.pullIncremental(manifest.driveChangesPageToken);
      } catch (err) {
        // Tokens older than ~30 days are invalidated by Google; recover by
        // falling through to the full walk, which re-seeds the token.
        if (isInvalidPageTokenError(err)) {
          console.warn("[sync] Drive page token expired, falling back to full walk");
          manifest.driveChangesPageToken = undefined;
        } else {
          throw err;
        }
      }
    }

    // Slow path: first sync (or recovery from expired token). Capture the
    // current page token BEFORE the walk so any change that happens during
    // the walk is visible to the next listChanges() call. Re-processing a
    // few changes is fine — the md5/mtime fast-paths make it idempotent.
    const tokenBeforeWalk = await drive.getStartPageToken();
    const result = await this.pullFullWalk();
    manifest.driveChangesPageToken = tokenBeforeWalk;
    return result;
  }

  /** Incremental pull — process only the changes Drive reports. */
  private async pullIncremental(
    pageToken: string,
  ): Promise<{ downloaded: number; conflicts: number; softDeletes: number }> {
    const { manifest, drive } = this.opts;
    this.checkAborted();

    const { changes, newStartPageToken } = await drive.listChanges(pageToken);
    manifest.driveChangesPageToken = newStartPageToken;
    if (changes.length === 0) {
      // Nothing remote changed since last pull — exit silently.
      return { downloaded: 0, conflicts: 0, softDeletes: 0 };
    }

    // Build the driveId → relPath reverse index from known folders so we can
    // map a change's parents to a workspace path without walking the tree.
    const folderRelByDriveId = new Map<string, string>();
    for (const [rel, id] of Object.entries(manifest.folders)) folderRelByDriveId.set(id, rel);
    const driveIdToManifestRel = new Map<string, string>();
    for (const [rel, entry] of Object.entries(manifest.files)) {
      if (entry.driveId) driveIdToManifestRel.set(entry.driveId, rel);
    }

    let downloaded = 0;
    let conflicts = 0;
    let softDeletes = 0;
    let processed = 0;

    this.emit({ total: changes.length, done: 0, skipped: 0 }, true);

    for (const change of changes) {
      this.checkAborted();
      processed += 1;

      // Removed-or-trashed: treat as a soft-delete locally (mirror existing
      // behavior — we move to .trash/ instead of hard-deleting).
      const isGone = change.removed || change.file?.trashed === true;
      if (isGone) {
        const knownRel = driveIdToManifestRel.get(change.fileId);
        if (!knownRel) continue; // file we never tracked; nothing to do
        const softDeleted = await this.applySoftDeleteForRemote(knownRel);
        if (softDeleted) softDeletes += 1;
        continue;
      }

      const file = change.file;
      if (!file) continue;

      // Folder change: just update the folder cache. New folders created
      // remotely get an entry; renames overwrite. (Old keys may go stale; the
      // next full walk would clean them. We accept that — folder renames are
      // rare and don't break the per-file sync.)
      if (file.mimeType === FOLDER_MIME) {
        const rel = await resolveDriveRelPath(file, folderRelByDriveId, manifest.rootFolderDriveId!, drive);
        if (rel !== null) {
          manifest.folders[rel] = file.id;
          folderRelByDriveId.set(file.id, rel);
        }
        continue;
      }

      // File change: resolve its workspace path, then run it through the
      // same per-file reconciliation as the full walk.
      const rel = await resolveDriveRelPath(file, folderRelByDriveId, manifest.rootFolderDriveId!, drive);
      if (rel === null) continue;

      this.emit({
        total: changes.length,
        done: processed,
        skipped: 0,
        currentFile: `↓ ${rel}`,
      });
      const r = await this.reconcileRemoteFile(rel, file);
      downloaded += r.downloaded;
      conflicts += r.conflicts;
    }

    return { downloaded, conflicts, softDeletes };
  }

  /** Full Drive walk — used for first sync and as a recovery fallback. */
  private async pullFullWalk(): Promise<{
    downloaded: number;
    conflicts: number;
    softDeletes: number;
  }> {
    const { manifest, drive } = this.opts;

    const remoteFiles = new Map<string, DriveFile>();
    const folderCache = new Map<string, string>(Object.entries(manifest.folders));
    for await (const { relPath, file } of drive.walkFiles(manifest.rootFolderDriveId!, folderCache)) {
      remoteFiles.set(relPath, file);
      this.checkAborted();
    }
    for (const [k, v] of folderCache) manifest.folders[k] = v;

    let downloaded = 0;
    let conflicts = 0;
    let softDeletes = 0;

    let i = 0;
    const remoteEntries = [...remoteFiles.entries()];
    this.emit({ total: remoteEntries.length, done: 0, skipped: 0 }, true);
    for (const [relPath, remote] of remoteEntries) {
      this.checkAborted();
      i += 1;
      this.emit({
        total: remoteEntries.length,
        done: i,
        skipped: 0,
        currentFile: `↓ ${relPath}`,
      });
      const r = await this.reconcileRemoteFile(relPath, remote);
      downloaded += r.downloaded;
      conflicts += r.conflicts;
    }

    // Detect Drive-side hard-deletes by diffing manifest vs the just-walked
    // remote tree. (Incremental pulls don't need this — Drive tells us
    // explicitly via `removed: true` / `trashed: true`.)
    for (const [relPath, entry] of Object.entries(manifest.files)) {
      if (relPath.startsWith(TRASH_PREFIX + "/")) continue;
      if (remoteFiles.has(relPath)) continue;
      if (!entry.driveId) continue;
      this.checkAborted();
      const softDeleted = await this.applySoftDeleteForRemote(relPath);
      if (softDeleted) softDeletes += 1;
    }

    return { downloaded, conflicts, softDeletes };
  }

  /**
   * Reconcile a single remote file against the local copy. Used by both
   * incremental and full-walk pull paths so the four-case logic
   * (download / no-op / overwrite / conflict) lives in exactly one place.
   */
  private async reconcileRemoteFile(
    relPath: string,
    remote: DriveFile,
  ): Promise<{ downloaded: number; conflicts: number }> {
    const { manifest, drive, workspacePath } = this.opts;
    const localEntry = manifest.files[relPath];
    const remoteMd5 = remote.md5Checksum ?? "";
    const localAbsPath = join(workspacePath, relPath);
    const localExists = await pathExists(localAbsPath);

    // Case A: nothing locally → easy download.
    if (!localExists) {
      await drive.downloadFile(remote.id, localAbsPath);
      const st = await stat(localAbsPath);
      manifest.files[relPath] = {
        md5: remoteMd5 || (await hashFile(localAbsPath)),
        driveId: remote.id,
        mtime: st.mtimeMs,
        size: st.size,
      };
      return { downloaded: 1, conflicts: 0 };
    }

    const localStat = await stat(localAbsPath);
    let localMd5: string;
    if (
      localEntry?.md5 &&
      localStat.mtimeMs === localEntry.mtime &&
      localStat.size === localEntry.size
    ) {
      localMd5 = localEntry.md5;
    } else {
      localMd5 = await hashFile(localAbsPath);
    }

    // Case B: contents already match — just reconcile the manifest if stale.
    if (localMd5 === remoteMd5) {
      if (!localEntry || localEntry.md5 !== remoteMd5 || localEntry.driveId !== remote.id) {
        manifest.files[relPath] = {
          md5: remoteMd5,
          driveId: remote.id,
          mtime: localStat.mtimeMs,
          size: localStat.size,
        };
      }
      return { downloaded: 0, conflicts: 0 };
    }

    // Case C: local unchanged since last sync, only remote moved → overwrite local.
    if (localEntry?.md5 && localEntry.md5 === localMd5) {
      await drive.downloadFile(remote.id, localAbsPath);
      const st = await stat(localAbsPath);
      manifest.files[relPath] = {
        md5: remoteMd5,
        driveId: remote.id,
        mtime: st.mtimeMs,
        size: st.size,
      };
      return { downloaded: 1, conflicts: 0 };
    }

    // Case D: both sides drifted → keep-both. Local stays; remote lands as .conflict-<ts>.
    const conflictPath = makeConflictPath(localAbsPath);
    await drive.downloadFile(remote.id, conflictPath);
    return { downloaded: 0, conflicts: 1 };
  }

  /**
   * Move a tracked file into the local `.trash/` because it disappeared on
   * Drive (either explicit `removed: true` from Changes API, or absent from
   * a full walk). Returns true if we actually moved something — false when
   * the file was already gone or already in `.trash/`.
   */
  private async applySoftDeleteForRemote(relPath: string): Promise<boolean> {
    const { workspacePath, manifest } = this.opts;
    if (relPath.startsWith(TRASH_PREFIX + "/")) return false;
    const entry = manifest.files[relPath];
    if (!entry) return false;

    const localAbsPath = join(workspacePath, relPath);
    if (!(await pathExists(localAbsPath))) {
      delete manifest.files[relPath];
      return false;
    }
    const trashRel = `${TRASH_PREFIX}/${relPath}`;
    const trashAbs = join(workspacePath, trashRel);
    await mkdir(dirname(trashAbs), { recursive: true });
    try {
      await rename(localAbsPath, trashAbs);
    } catch (err) {
      console.error(`[sync] failed to move ${relPath} to local trash:`, err);
      return false;
    }
    const st = await stat(trashAbs).catch(() => null);
    manifest.files[trashRel] = {
      md5: entry.md5,
      driveId: "",
      mtime: st?.mtimeMs ?? Date.now(),
      size: st?.size ?? entry.size,
    };
    delete manifest.files[relPath];
    return true;
  }

  // ===== Soft / hard delete (called by SyncManager, not by cycle) =====

  /**
   * Move a file to the workspace .trash/, and mirror the move on Drive
   * (single Drive op — change parent + path prefix).
   * The Drive file id is preserved so re-syncing the trashed copy doesn't
   * upload its content again.
   */
  async softDelete(relPath: string): Promise<void> {
    const { workspacePath, manifest, drive } = this.opts;
    if (relPath.startsWith(TRASH_PREFIX + "/")) return; // already in trash

    const entry = manifest.files[relPath];
    const absPath = join(workspacePath, relPath);
    const trashRel = `${TRASH_PREFIX}/${relPath}`;
    const trashAbs = join(workspacePath, trashRel);

    await mkdir(dirname(trashAbs), { recursive: true });
    await rename(absPath, trashAbs);

    if (entry?.driveId) {
      const oldParentId = manifest.folders[posixDirname(relPath)];
      const newParentId = await this.ensureFolderChain(posixDirname(trashRel));
      if (oldParentId) {
        try {
          await drive.moveFile({
            fileId: entry.driveId,
            oldParentId,
            newParentId,
          });
        } catch (err) {
          console.error(`[sync] Drive move on soft-delete of ${relPath} failed:`, err);
          // Fall back to push-as-new on next cycle.
        }
      }
      const st = await stat(trashAbs).catch(() => null);
      manifest.files[trashRel] = {
        ...entry,
        mtime: st?.mtimeMs ?? entry.mtime,
        size: st?.size ?? entry.size,
      };
      delete manifest.files[relPath];
    }
    await this.opts.persistManifest();
  }

  /**
   * Remove a file from Drive AND from local disk. Other devices will see it
   * disappear from Drive on their next pull and soft-delete their copy
   * (so they don't lose data unexpectedly).
   */
  async hardDelete(relPath: string): Promise<void> {
    const { workspacePath, manifest, drive } = this.opts;
    const entry = manifest.files[relPath];
    const absPath = join(workspacePath, relPath);

    if (entry?.driveId) {
      try {
        await drive.deleteFile(entry.driveId);
      } catch (err) {
        console.error(`[sync] Drive delete failed for ${relPath}:`, err);
      }
    }
    try {
      await unlink(absPath);
    } catch {
      /* already gone locally */
    }
    delete manifest.files[relPath];
    await this.opts.persistManifest();
  }

  // ===== Helpers =====

  private async ensureFolderChain(dirRel: string): Promise<string> {
    const { manifest, drive } = this.opts;
    if (dirRel === "" || dirRel === ".") return manifest.folders[""]!;
    if (manifest.folders[dirRel]) return manifest.folders[dirRel];

    const parts = dirRel.split("/");
    let parentRel = "";
    let parentId = manifest.folders[""]!;
    for (const part of parts) {
      const nextRel = parentRel === "" ? part : `${parentRel}/${part}`;
      let nextId = manifest.folders[nextRel];
      if (!nextId) {
        nextId = await drive.ensureFolder(part, parentId);
        manifest.folders[nextRel] = nextId;
        await this.opts.persistManifest();
      }
      parentRel = nextRel;
      parentId = nextId;
    }
    return parentId;
  }

  private checkAborted(): void {
    if (this.opts.signal.aborted) {
      throw new DOMException("Sync cancelled", "AbortError");
    }
  }

  private lastEmitAt = 0;
  private emit(p: SyncProgress, force = false): void {
    const now = Date.now();
    // Coalesce all progress emits to ≥100ms apart — the renderer can't
    // usefully consume more, and a tight push loop over thousands of files
    // would otherwise drown the IPC channel. `force` is for must-show frames
    // (initial scan, terminal totals) where dropping the emit would leave the
    // UI showing stale state.
    if (!force && now - this.lastEmitAt < 100) return;
    this.lastEmitAt = now;
    this.opts.onProgress(p);
  }
}

function posixDirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function posixBasename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function makeConflictPath(absPath: string): string {
  const dir = dirname(absPath);
  const base = absPath.slice(dir.length + 1);
  const dot = base.lastIndexOf(".");
  const stem = dot < 0 ? base : base.slice(0, dot);
  const ext = dot < 0 ? "" : base.slice(dot);
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  return join(dir, `${stem}.conflict-${ts}${ext}`);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a Drive file/folder to its workspace-relative POSIX path by walking
 * up the parents chain. Uses the supplied folder cache (driveId → relPath),
 * filling it in as it discovers new folders so subsequent lookups are O(1).
 * Returns null when the file lives outside our sync root (e.g. a parent we
 * can't reach with our `drive.file` scope).
 */
async function resolveDriveRelPath(
  node: DriveFile,
  folderRelByDriveId: Map<string, string>,
  rootDriveId: string,
  drive: DriveAdapter,
): Promise<string | null> {
  if (node.id === rootDriveId) return "";
  const parents = node.parents;
  if (!parents || parents.length === 0) return null;
  const parentId = parents[0];

  let parentRel = folderRelByDriveId.get(parentId);
  if (parentRel === undefined) {
    if (parentId === rootDriveId) {
      parentRel = "";
      folderRelByDriveId.set(parentId, "");
    } else {
      try {
        const parentMeta = await drive.getFileMeta(parentId);
        const resolved = await resolveDriveRelPath(parentMeta, folderRelByDriveId, rootDriveId, drive);
        if (resolved === null) return null;
        parentRel = resolved;
        folderRelByDriveId.set(parentId, parentRel);
      } catch {
        return null;
      }
    }
  }
  return parentRel === "" ? node.name : `${parentRel}/${node.name}`;
}

/**
 * Drive returns 400 (`invalidPageToken`) or 410 (`gone`) when a page token is
 * older than ~30 days or otherwise invalidated. We catch those and fall back
 * to a full walk + fresh token; anything else propagates.
 */
function isInvalidPageTokenError(err: unknown): boolean {
  if (!(err instanceof DriveError)) return false;
  if (err.status === 410) return true;
  if (err.status === 400 && /pageToken|invalid/i.test(err.body ?? "")) return true;
  return false;
}
