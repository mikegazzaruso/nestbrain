// Sync engine — one-cycle orchestrator (push, pull, soft-delete, hard-delete).
//
// The engine is Electron-free: only `fetch` + `node:fs`. It can move into a
// utility process later without changing its API.

import { unlink, mkdir, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SYNC_DRIVE_FOLDER_NAME } from "@nestbrain/shared";
import type { SyncPreferences, SyncProgress } from "@nestbrain/shared";
import type { DriveAdapter, DriveFile } from "./drive-adapter";
import type { Manifest, ManifestFileEntry, WalkEntry } from "./types";
import { buildExcludes } from "./excludes";
import { walk } from "./walker";
import { hashFile } from "./hash";

const TRASH_PREFIX = ".trash";

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
    await this.ensureRoot();
    const { downloaded, conflicts, softDeletes } = await this.pull();
    this.opts.manifest.lastSyncAt = Date.now();
    await this.opts.persistManifest();
    return {
      uploaded: 0,
      downloaded,
      conflicts,
      softDeletes,
      skippedFiles: [],
      durationMs: Date.now() - start,
    };
  }

  /** Push-only cycle. Used by the watcher and by the "Sync now" button. */
  async runPush(): Promise<CycleResult> {
    const start = Date.now();
    await this.ensureRoot();
    const { uploaded, skippedFiles } = await this.push();
    this.opts.manifest.lastSyncAt = Date.now();
    await this.opts.persistManifest();
    return {
      uploaded,
      downloaded: 0,
      conflicts: 0,
      softDeletes: 0,
      skippedFiles,
      durationMs: Date.now() - start,
    };
  }

  /** Pull then push — the canonical "sync everything" cycle. */
  async runFullCycle(): Promise<CycleResult> {
    const start = Date.now();
    await this.ensureRoot();
    const pullRes = await this.pull();
    this.checkAborted();
    const pushRes = await this.push();
    this.opts.manifest.lastSyncAt = Date.now();
    await this.opts.persistManifest();
    return {
      uploaded: pushRes.uploaded,
      downloaded: pullRes.downloaded,
      conflicts: pullRes.conflicts,
      softDeletes: pullRes.softDeletes,
      skippedFiles: pushRes.skippedFiles,
      durationMs: Date.now() - start,
    };
  }

  // ---------- internals ----------

  private async ensureRoot(): Promise<void> {
    const { manifest, drive } = this.opts;
    if (!manifest.rootFolderDriveId) {
      manifest.rootFolderDriveId = await drive.ensureFolder(SYNC_DRIVE_FOLDER_NAME, "root");
      manifest.folders[""] = manifest.rootFolderDriveId;
      await this.opts.persistManifest();
    }
    this.checkAborted();
  }

  // ===== PUSH =====

  private async push(): Promise<{ uploaded: number; skippedFiles: SkippedFile[] }> {
    const { workspacePath, prefs } = this.opts;
    const isExcluded = buildExcludes({ includeProjects: prefs.includeProjects });

    this.emit({ total: 0, done: 0, skipped: 0, currentFile: "Scanning workspace…" });
    const candidates: WalkEntry[] = [];
    for await (const entry of walk(workspacePath, isExcluded)) {
      candidates.push(entry);
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
    this.emit({ total: toProcess.length, done, skipped: skippedFiles.length });

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
    await this.opts.persistManifest();
    return true;
  }

  // ===== PULL =====

  private async pull(): Promise<{ downloaded: number; conflicts: number; softDeletes: number }> {
    const { manifest, drive, workspacePath } = this.opts;

    // Walk Drive: build a map relPath → DriveFile, and populate folders cache.
    const remoteFiles = new Map<string, DriveFile>();
    const folderCache = new Map<string, string>(Object.entries(manifest.folders));
    if (!manifest.rootFolderDriveId) return { downloaded: 0, conflicts: 0, softDeletes: 0 };
    for await (const { relPath, file } of drive.walkFiles(manifest.rootFolderDriveId, folderCache)) {
      remoteFiles.set(relPath, file);
      this.checkAborted();
    }
    // Merge newly discovered folders into manifest.
    for (const [k, v] of folderCache) manifest.folders[k] = v;

    let downloaded = 0;
    let conflicts = 0;
    let softDeletes = 0;

    // Phase 1: pull remote files that are new or changed.
    let i = 0;
    const remoteEntries = [...remoteFiles.entries()];
    for (const [relPath, remote] of remoteEntries) {
      this.checkAborted();
      i += 1;
      this.emit({
        total: remoteEntries.length,
        done: i,
        skipped: 0,
        currentFile: `↓ ${relPath}`,
      });

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
        downloaded += 1;
        await this.opts.persistManifest();
        continue;
      }

      // Compute the local md5. Use the manifest's cached value if the file's
      // mtime + size haven't drifted; otherwise rehash to be sure.
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
          await this.opts.persistManifest();
        }
        continue;
      }

      // Case C: local has not changed since last sync, only remote did → overwrite local.
      if (localEntry?.md5 && localEntry.md5 === localMd5) {
        await drive.downloadFile(remote.id, localAbsPath);
        const st = await stat(localAbsPath);
        manifest.files[relPath] = {
          md5: remoteMd5,
          driveId: remote.id,
          mtime: st.mtimeMs,
          size: st.size,
        };
        downloaded += 1;
        await this.opts.persistManifest();
        continue;
      }

      // Case D: both sides have changed (or we have no record of last-synced state)
      // → keep-both. Local stays as-is; remote arrives as a sibling .conflict file.
      const conflictPath = makeConflictPath(localAbsPath);
      await drive.downloadFile(remote.id, conflictPath);
      conflicts += 1;
      await this.opts.persistManifest();
    }

    // Phase 2: detect Drive-side hard-deletes (file in manifest but not in Drive).
    // Propagate as a soft-delete locally — move to .trash/ so the user has a
    // recovery window. The "never delete on other devices without explicit
    // action" guarantee is preserved: the file lives in .trash/ until purged.
    for (const [relPath, entry] of Object.entries(manifest.files)) {
      if (relPath.startsWith(TRASH_PREFIX + "/")) continue; // already in trash
      if (remoteFiles.has(relPath)) continue;
      if (!entry.driveId) continue;
      // The file is in our manifest but no longer on Drive.
      this.checkAborted();
      const localAbsPath = join(workspacePath, relPath);
      if (!(await pathExists(localAbsPath))) {
        // Already gone locally — just clean the manifest.
        delete manifest.files[relPath];
        continue;
      }
      const trashRel = `${TRASH_PREFIX}/${relPath}`;
      const trashAbs = join(workspacePath, trashRel);
      await mkdir(dirname(trashAbs), { recursive: true });
      try {
        await rename(localAbsPath, trashAbs);
      } catch (err) {
        console.error(`[sync] failed to move ${relPath} to local trash:`, err);
        continue;
      }
      const st = await stat(trashAbs).catch(() => null);
      manifest.files[trashRel] = {
        md5: entry.md5,
        driveId: "", // we'll re-sync if it gets re-uploaded
        mtime: st?.mtimeMs ?? Date.now(),
        size: st?.size ?? entry.size,
      };
      delete manifest.files[relPath];
      softDeletes += 1;
      await this.opts.persistManifest();
    }

    return { downloaded, conflicts, softDeletes };
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
  private emit(p: SyncProgress): void {
    const now = Date.now();
    if (now - this.lastEmitAt < 80 && p.bytesUploaded !== undefined) return;
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
