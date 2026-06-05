// Filesystem watcher driven by chokidar.
//
// Accumulates the set of paths that fired add/change events during the
// debounce window and hands them to onChanged when activity settles. The
// engine uses that hint to skip the full workspace walk and only inspect the
// paths chokidar saw — orders of magnitude cheaper on large workspaces.
//
// Events we don't track (unlink, addDir, unlinkDir) are ignored: external
// deletes are intentionally not propagated to Drive (see docs/SYNC.md), and
// dir-level events are covered by the per-file events chokidar emits for the
// directory's contents.

import chokidar, { type FSWatcher } from "chokidar";
import { buildExcludes } from "./excludes";

export interface ChangeHint {
  /**
   * POSIX-relative paths that fired add/change events. Empty/undefined means
   * the caller should do a full reconciliation walk (used by manual "Sync now"
   * and the initial cycle after sign-in — never emitted by this watcher).
   */
  paths?: string[];
}

export interface WatcherOptions {
  workspacePath: string;
  includeProjects: boolean;
  /** Milliseconds of inactivity required before "changed" fires. */
  debounceMs?: number;
  onChanged: (hint: ChangeHint) => void;
  onError?: (err: unknown) => void;
}

export class WorkspaceWatcher {
  private fsw: FSWatcher | null = null;
  private fireTimer: ReturnType<typeof setTimeout> | null = null;
  private buffer = new Set<string>();
  private readonly debounceMs: number;
  private isExcluded: (relPath: string) => boolean;

  constructor(private readonly opts: WatcherOptions) {
    this.debounceMs = opts.debounceMs ?? 3000;
    this.isExcluded = buildExcludes({ includeProjects: opts.includeProjects });
  }

  start(): void {
    if (this.fsw) return;

    this.fsw = chokidar.watch(this.opts.workspacePath, {
      // Don't fire add events for everything that exists at startup.
      ignoreInitial: true,
      followSymlinks: false,
      // chokidar's `ignored` runs per absolute path; convert to relative
      // before delegating to our excludes matcher.
      ignored: (absPath: string) => this.relIsExcluded(absPath),
      // awaitWriteFinish helps with editors that save via rename / multi-step
      // writes — wait until the file size is stable for 200ms before firing.
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    const onFileEvent = (absPath: string) => this.recordPath(absPath);
    this.fsw
      .on("add", onFileEvent)
      .on("change", onFileEvent)
      .on("error", (err) => this.opts.onError?.(err));
  }

  async stop(): Promise<void> {
    if (this.fireTimer) {
      clearTimeout(this.fireTimer);
      this.fireTimer = null;
    }
    this.buffer.clear();
    if (this.fsw) {
      await this.fsw.close();
      this.fsw = null;
    }
  }

  /** Re-init with new prefs (e.g. user toggled includeProjects). */
  async restart(opts: Pick<WatcherOptions, "includeProjects">): Promise<void> {
    await this.stop();
    this.isExcluded = buildExcludes({ includeProjects: opts.includeProjects });
    this.start();
  }

  // ---------- internals ----------

  private recordPath(absPath: string): void {
    const rel = this.toRel(absPath);
    if (rel === null) return;
    this.buffer.add(rel);
    this.scheduleFire();
  }

  private toRel(absPath: string): string | null {
    const root = this.opts.workspacePath;
    if (!absPath.startsWith(root)) return null;
    const rel = absPath.slice(root.length + 1).split(/[/\\]/).join("/");
    if (rel === "") return null;
    return rel;
  }

  private relIsExcluded(absPath: string): boolean {
    const root = this.opts.workspacePath;
    if (absPath === root) return false;
    if (!absPath.startsWith(root)) return false;
    const rel = absPath.slice(root.length + 1).split(/[/\\]/).join("/");
    if (rel === "") return false;
    return this.isExcluded(rel);
  }

  private scheduleFire(): void {
    if (this.fireTimer) clearTimeout(this.fireTimer);
    this.fireTimer = setTimeout(() => {
      this.fireTimer = null;
      const paths = [...this.buffer];
      this.buffer.clear();
      if (paths.length === 0) return;
      try {
        this.opts.onChanged({ paths });
      } catch (err) {
        this.opts.onError?.(err);
      }
    }, this.debounceMs);
  }
}
