export { DriveAdapter, DriveError } from "./drive-adapter";
export type { TokenProvider, DriveFile, UploadResult } from "./drive-adapter";
export { SyncEngine } from "./engine";
export type { EngineOptions, CycleResult, SkippedFile } from "./engine";
export { WorkspaceWatcher } from "./watcher";
export type { WatcherOptions, ChangeHint } from "./watcher";
export { loadOrCreateManifest, saveManifest, manifestPath } from "./manifest";
export type { Manifest, ManifestFileEntry, WalkEntry } from "./types";
export { buildExcludes } from "./excludes";
export { walk } from "./walker";
export { hashFile } from "./hash";
// Open-core seam: the pluggable remote-backend contract + pure reconcile
// logic. The proprietary Enterprise "Team Server" adapter implements this.
export { diffFiles } from "./backend";
export type {
  SyncBackend,
  RemoteManifest,
  RemoteFileEntry,
  RemoteWorkspace,
  FileMap,
  CommitResult,
  SyncAction,
} from "./backend";
