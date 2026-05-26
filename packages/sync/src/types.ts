// Sync-engine internal types.
// The user-facing SyncPreferences / SyncState / SyncProgress / SyncStatus
// types live in @nestbrain/shared because both desktop main and renderer
// consume them.

export interface ManifestFileEntry {
  /**
   * Hex-encoded MD5 of the file contents at last successful sync.
   * MD5 is used here purely because Drive exposes md5Checksum on file
   * metadata, letting us compare local vs remote without downloading.
   */
  md5: string;
  /** Drive file id (alphanumeric, ~33 chars). */
  driveId: string;
  /** Local mtime in ms-epoch at last sync. */
  mtime: number;
  /** Local size in bytes at last sync. */
  size: number;
}

export interface Manifest {
  /** Schema version; bump on breaking changes. */
  version: 1;
  /** UUID v4 generated once per machine on first sync. */
  deviceId: string;
  /** Human-readable label (os.hostname() at creation time). */
  deviceName: string;
  /** Drive folder id of the NestBrain-Sync root. */
  rootFolderDriveId?: string;
  /** Map of relative folder path → Drive folder id. Root has key "". */
  folders: Record<string, string>;
  /** Map of POSIX-style relative path → entry. */
  files: Record<string, ManifestFileEntry>;
  /** ms-epoch of last successful sync. */
  lastSyncAt?: number;
}

export interface WalkEntry {
  /** POSIX-style relative path from workspace root. */
  relPath: string;
  /** Absolute path on disk. */
  absPath: string;
  size: number;
  mtime: number;
}
