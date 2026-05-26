// SyncManager — single source of truth for sync in the main process.
// Wires the @nestbrain/sync engine to the AuthManager, owns the watcher and
// the periodic-pull timer, and broadcasts state to the renderer.

import type {
  SyncPreferences,
  SyncProgress,
  SyncState,
  SyncStatus,
} from "@nestbrain/shared";
import { DEFAULT_SYNC_PREFS } from "@nestbrain/shared";
import {
  DriveAdapter,
  SyncEngine,
  WorkspaceWatcher,
  loadOrCreateManifest,
  saveManifest,
  type Manifest,
} from "@nestbrain/sync";
import type { AuthManager } from "../auth";
import { loadSyncPrefs, saveSyncPrefs } from "./prefs-store";

const PULL_INTERVAL_MS = 60_000;
const WATCHER_DEBOUNCE_MS = 3000;

type Listener = (state: SyncState) => void;

export interface SyncManagerOptions {
  authManager: AuthManager;
  /** Returns the current NestBrain workspace path, or null if not configured yet. */
  getWorkspacePath: () => string | null;
}

export class SyncManager {
  private prefs: SyncPreferences = { ...DEFAULT_SYNC_PREFS };
  private status: SyncStatus = "disabled";
  private lastSyncAt: number | undefined;
  private error: string | undefined;
  private progress: SyncProgress | undefined;
  private listeners = new Set<Listener>();
  private currentRun: AbortController | null = null;
  private watcher: WorkspaceWatcher | null = null;
  private pullTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: SyncManagerOptions) {}

  async init(): Promise<void> {
    this.prefs = await loadSyncPrefs();
    this.opts.authManager.onChange(() => {
      const before = this.status;
      this.recomputeIdleStatus();
      if (before === "disabled" && this.status === "idle" && this.prefs.enabled) {
        this.startBackgroundLoops();
        void this.syncNow();
      } else if (this.status === "disabled") {
        this.stopBackgroundLoops();
      }
    });
    this.recomputeIdleStatus();
    if (this.status === "idle") {
      this.startBackgroundLoops();
    }
  }

  getState(): SyncState {
    return {
      status: this.status,
      prefs: this.prefs,
      lastSyncAt: this.lastSyncAt,
      error: this.error,
      progress: this.progress,
    };
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async setPreferences(next: Partial<SyncPreferences>): Promise<void> {
    const prev = this.prefs;
    const merged: SyncPreferences = { ...prev, ...next };
    this.prefs = merged;
    await saveSyncPrefs(merged);

    if (!merged.enabled) {
      this.currentRun?.abort();
      this.stopBackgroundLoops();
      this.setStatus("disabled");
      return;
    }
    this.recomputeIdleStatus();

    // includeProjects flipped while watcher running → restart watcher with new excludes.
    if (
      this.watcher &&
      prev.includeProjects !== merged.includeProjects
    ) {
      void this.watcher.restart({ includeProjects: merged.includeProjects });
    }

    if (this.status === "idle") {
      this.startBackgroundLoops();
      void this.syncNow();
    }
  }

  /** Full cycle (pull + push). Called from "Sync now" or on auto-trigger. */
  async syncNow(): Promise<void> {
    await this.runCycle("full");
  }

  /** Push-only cycle triggered by the watcher. */
  private async pushOnly(): Promise<void> {
    await this.runCycle("push");
  }

  /** Pull-only cycle triggered by the periodic timer. */
  private async pullOnly(): Promise<void> {
    await this.runCycle("pull");
  }

  /** Move a file to .trash/ (both local and on Drive). */
  async softDelete(relPath: string): Promise<void> {
    const ctx = await this.openCycleContext();
    if (!ctx) throw new Error("Sync not ready.");
    try {
      await ctx.engine.softDelete(relPath);
    } finally {
      ctx.cleanup();
    }
  }

  /** Permanently delete on Drive + locally. Other devices will soft-delete on next pull. */
  async hardDelete(relPath: string): Promise<void> {
    const ctx = await this.openCycleContext();
    if (!ctx) throw new Error("Sync not ready.");
    try {
      await ctx.engine.hardDelete(relPath);
    } finally {
      ctx.cleanup();
    }
  }

  cancel(): void {
    this.currentRun?.abort();
  }

  async dispose(): Promise<void> {
    this.cancel();
    this.stopBackgroundLoops();
  }

  // ---------- internals ----------

  private async runCycle(mode: "full" | "push" | "pull"): Promise<void> {
    if (!this.prefs.enabled) {
      this.error = "Sync is disabled — turn it on first.";
      this.broadcast();
      return;
    }
    if (this.status === "scanning" || this.status === "syncing") {
      console.log(`[sync] skipping ${mode} — already ${this.status}`);
      return;
    }
    console.log(`[sync] cycle start: ${mode}`);
    const ctx = await this.openCycleContext();
    if (!ctx) {
      console.warn(`[sync] cycle ${mode} aborted: ${this.error}`);
      this.broadcast();
      return;
    }
    const { engine, manifest, workspace, cleanup } = ctx;

    this.error = undefined;
    this.setStatus("scanning");
    this.currentRun = ctx.abort;

    try {
      let result;
      if (mode === "pull") result = await engine.runPull();
      else if (mode === "push") result = await engine.runPush();
      else result = await engine.runFullCycle();

      console.log(
        `[sync] cycle ${mode} done — uploaded=${result.uploaded} downloaded=${result.downloaded} conflicts=${result.conflicts} softDeletes=${result.softDeletes} skipped=${result.skippedFiles.length} (${result.durationMs}ms)`,
      );

      this.lastSyncAt = manifest.lastSyncAt;
      this.progress = undefined;
      this.setStatus("idle");

      if (result.conflicts > 0 || result.softDeletes > 0) {
        // Surface these as a benign info message so the user notices.
        this.error = `Pull finished — ${result.conflicts} conflict file(s), ${result.softDeletes} trashed.`;
        this.broadcast();
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        console.error("[sync] cycle failed:", err);
        this.error = err instanceof Error ? err.message : String(err);
      }
      this.progress = undefined;
      this.setStatus(this.prefs.enabled ? "error" : "disabled");
    } finally {
      this.currentRun = null;
      cleanup();
      void workspace; // for the eslint-no-unused-vars rule
    }
  }

  /**
   * Build the engine + supporting infra for a single operation (cycle or
   * soft/hard delete). Returns `null` if we're not in a state where a cycle
   * can run (no workspace, not signed in, etc.) — caller checks.
   */
  private async openCycleContext(): Promise<{
    engine: SyncEngine;
    manifest: Manifest;
    workspace: string;
    abort: AbortController;
    cleanup: () => void;
  } | null> {
    const workspace = this.opts.getWorkspacePath();
    if (!workspace) {
      this.error = "No NestBrain workspace configured yet.";
      return null;
    }
    if (this.opts.authManager.getState().status !== "signed-in") {
      this.error = "Sign in with Google to sync.";
      return null;
    }
    const manifest = await loadOrCreateManifest(workspace);
    const abort = new AbortController();
    const drive = new DriveAdapter(async (force?: boolean) => {
      const t = await this.opts.authManager.getAccessToken(force);
      if (!t) throw new Error("No access token available — please sign in again.");
      return t;
    });
    const engine = new SyncEngine({
      workspacePath: workspace,
      drive,
      manifest,
      prefs: this.prefs,
      signal: abort.signal,
      persistManifest: () => saveManifest(workspace, manifest),
      onProgress: (p) => {
        if (this.status === "scanning" && p.total > 0) this.setStatus("syncing");
        this.progress = p;
        this.broadcast();
      },
    });
    return {
      engine,
      manifest,
      workspace,
      abort,
      cleanup: () => { /* nothing to dispose for now */ },
    };
  }

  private startBackgroundLoops(): void {
    this.startWatcher();
    this.startPullTimer();
  }

  private stopBackgroundLoops(): void {
    void this.stopWatcher();
    this.stopPullTimer();
  }

  private startWatcher(): void {
    if (this.watcher) return;
    const workspace = this.opts.getWorkspacePath();
    if (!workspace) return;
    this.watcher = new WorkspaceWatcher({
      workspacePath: workspace,
      includeProjects: this.prefs.includeProjects,
      debounceMs: WATCHER_DEBOUNCE_MS,
      onChanged: () => {
        // Local change settled — push it to Drive. Skip if a cycle is
        // already running; it'll catch the new state.
        if (this.status === "scanning" || this.status === "syncing") return;
        void this.pushOnly();
      },
      onError: (err) => console.error("[sync] watcher error:", err),
    });
    this.watcher.start();
  }

  private async stopWatcher(): Promise<void> {
    if (!this.watcher) return;
    const w = this.watcher;
    this.watcher = null;
    try { await w.stop(); } catch { /* ignore */ }
  }

  private startPullTimer(): void {
    if (this.pullTimer) return;
    this.pullTimer = setInterval(() => {
      if (this.status !== "idle") return;
      void this.pullOnly();
    }, PULL_INTERVAL_MS);
  }

  private stopPullTimer(): void {
    if (this.pullTimer) {
      clearInterval(this.pullTimer);
      this.pullTimer = null;
    }
  }

  private recomputeIdleStatus(): void {
    if (!this.prefs.enabled) {
      this.setStatus("disabled");
      return;
    }
    const authed = this.opts.authManager.getState().status === "signed-in";
    if (!authed) {
      this.setStatus("disabled");
      return;
    }
    if (this.status === "syncing" || this.status === "scanning") return;
    this.setStatus("idle");
  }

  private setStatus(next: SyncStatus): void {
    this.status = next;
    this.broadcast();
  }

  private broadcast(): void {
    const snapshot = this.getState();
    for (const cb of this.listeners) {
      try { cb(snapshot); } catch (err) { console.error("[sync] listener threw:", err); }
    }
  }
}
