// Filesystem watcher driven by chokidar.
//
// Emits a single debounced "changed" callback once edits have settled. It
// does NOT identify which files changed — the engine's mtime/size fast-path
// makes a full walk cheap, and tracking per-file event types correctly
// across rename/atomic-write/macOS-aliases edge cases is more complexity
// than the gain warrants right now.

import chokidar, { type FSWatcher } from "chokidar";
import { buildExcludes } from "./excludes";

export interface WatcherOptions {
  workspacePath: string;
  includeProjects: boolean;
  /** Milliseconds of inactivity required before "changed" fires. */
  debounceMs?: number;
  onChanged: () => void;
  onError?: (err: unknown) => void;
}

export class WorkspaceWatcher {
  private fsw: FSWatcher | null = null;
  private fireTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly isExcluded: (relPath: string) => boolean;

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

    const onEvent = () => this.scheduleFire();
    this.fsw
      .on("add", onEvent)
      .on("change", onEvent)
      .on("unlink", onEvent)
      .on("addDir", onEvent)
      .on("unlinkDir", onEvent)
      .on("error", (err) => this.opts.onError?.(err));
  }

  async stop(): Promise<void> {
    if (this.fireTimer) {
      clearTimeout(this.fireTimer);
      this.fireTimer = null;
    }
    if (this.fsw) {
      await this.fsw.close();
      this.fsw = null;
    }
  }

  /** Re-init with new prefs (e.g. user toggled includeProjects). */
  async restart(opts: Pick<WatcherOptions, "includeProjects">): Promise<void> {
    await this.stop();
    (this as unknown as { isExcluded: (relPath: string) => boolean }).isExcluded =
      buildExcludes({ includeProjects: opts.includeProjects });
    this.start();
  }

  // ---------- internals ----------

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
      try {
        this.opts.onChanged();
      } catch (err) {
        this.opts.onError?.(err);
      }
    }, this.debounceMs);
  }
}
