import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { WorkspaceWatcher, type RemoteWorkspace } from "@nestbrain/sync";
import {
  TeamBackend,
  TeamError,
  teamHealth,
  teamLogin,
  type TeamUser,
  type TeamLicense,
  type TeamMember,
} from "./backend.js";
import { runSync } from "./sync-flow.js";
import { loadConfig, saveConfig, loadToken, saveToken, clearToken } from "./store.js";

export interface TeamState {
  status: "disconnected" | "connecting" | "connected" | "error";
  serverUrl?: string;
  user?: TeamUser;
  license?: TeamLicense;
  workspaceId?: string;
  workspaces?: RemoteWorkspace[];
  syncing: boolean;
  lastSync?: number;
  lastResult?: { uploaded: number; downloaded: number; conflicts: number };
  error?: string;
}

type Listener = (state: TeamState) => void;

export interface TeamManagerOptions {
  /** Returns the NestBrain workspace root (the folder containing Library/). */
  getWorkspacePath: () => string | null;
  /** Base URL of the embedded Next server, for indexing synced articles. */
  getServerUrl: () => string | null;
}

export class TeamManager {
  private state: TeamState = { status: "disconnected", syncing: false };
  private listeners = new Set<Listener>();
  private backend: TeamBackend | null = null;

  // Auto-sync: a debounced filesystem watcher pushes local edits, a poll timer
  // pulls teammates' changes. `suppressUntil` ignores the watcher echo from the
  // files a sync itself just wrote.
  private watcher: WorkspaceWatcher | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private suppressUntil = 0;

  constructor(private opts: TeamManagerOptions) {}

  getState(): TeamState {
    return this.state;
  }
  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  private set(patch: Partial<TeamState>): void {
    this.state = { ...this.state, ...patch };
    for (const cb of this.listeners) cb(this.state);
  }

  /** Restore a persisted session (token in keychain) on startup. */
  async init(): Promise<void> {
    const [token, config] = await Promise.all([loadToken(), loadConfig()]);
    if (!token || !config.serverUrl) return;
    this.backend = new TeamBackend(config.serverUrl, token);
    this.set({ status: "connected", serverUrl: config.serverUrl, workspaceId: config.workspaceId });
    // Best-effort hydrate (license + workspaces); don't fail init if offline.
    try {
      const [h, ws] = await Promise.all([teamHealth(config.serverUrl), this.backend.listWorkspaces()]);
      this.set({
        license: h.license,
        workspaces: ws,
        workspaceId: config.workspaceId ?? ws[0]?.id,
      });
    } catch {
      /* offline — stay connected, hydrate on demand */
    }
    this.startAutoSync();
    void this.scheduleSync("poll");
  }

  async connect(serverUrl: string, email: string, password: string): Promise<void> {
    const url = serverUrl.replace(/\/$/, "");
    this.set({ status: "connecting", error: undefined });
    try {
      const { token, user } = await teamLogin(url, email, password);
      await saveToken(token);
      this.backend = new TeamBackend(url, token);
      const cfg = await loadConfig();
      cfg.serverUrl = url;
      const [h, ws] = await Promise.all([teamHealth(url), this.backend.listWorkspaces()]);
      const workspaceId = cfg.workspaceId && ws.some((w) => w.id === cfg.workspaceId) ? cfg.workspaceId : ws[0]?.id;
      cfg.workspaceId = workspaceId;
      await saveConfig(cfg);
      this.set({ status: "connected", serverUrl: url, user, license: h.license, workspaces: ws, workspaceId, error: undefined });
      this.startAutoSync();
      void this.scheduleSync("poll");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "connection failed";
      this.set({ status: "error", error: msg });
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    this.stopAutoSync();
    await clearToken();
    await saveConfig({}); // forget server + selected workspace + bases
    this.backend = null;
    this.set({ status: "disconnected", serverUrl: undefined, user: undefined, license: undefined, workspaces: undefined, workspaceId: undefined, lastResult: undefined, error: undefined });
  }

  private require(): TeamBackend {
    if (!this.backend) throw new TeamError(401, "not connected to a Team Server");
    return this.backend;
  }

  listMembers(): Promise<TeamMember[]> {
    return this.require().listMembers();
  }
  addMember(m: { email: string; name: string; password: string; role: string }): Promise<unknown> {
    return this.require().addMember(m);
  }
  removeMember(id: string): Promise<unknown> {
    return this.require().removeMember(id);
  }

  async selectWorkspace(id: string): Promise<void> {
    const cfg = await loadConfig();
    cfg.workspaceId = id;
    await saveConfig(cfg);
    this.set({ workspaceId: id });
  }

  /** Sync Library/Knowledge ↔ the selected team workspace. */
  async syncNow(): Promise<TeamState["lastResult"]> {
    const backend = this.require();
    const wsId = this.state.workspaceId;
    if (!wsId) throw new Error("no workspace selected");
    const root = this.opts.getWorkspacePath();
    if (!root) throw new Error("no NestBrain workspace open");
    const dir = join(root, "Library", "Knowledge");
    await mkdir(dir, { recursive: true });

    this.set({ syncing: true, error: undefined });
    try {
      const cfg = await loadConfig();
      const base = cfg.bases?.[wsId] ?? {};
      const result = await runSync(backend, wsId, dir, base);
      cfg.bases = { ...(cfg.bases ?? {}), [wsId]: result.base };
      await saveConfig(cfg);
      // Re-index articles that arrived from teammates so they become
      // searchable in this device's local vector store.
      await this.indexArticles(result.changed);
      const lastResult = { uploaded: result.uploaded, downloaded: result.downloaded, conflicts: result.conflicts.length };
      this.suppressUntil = Date.now() + 6000; // ignore the watcher echo from files we just wrote
      this.set({ syncing: false, lastSync: Date.now(), lastResult });
      return lastResult;
    } catch (e) {
      this.set({ syncing: false, error: e instanceof Error ? e.message : "sync failed" });
      throw e;
    }
  }

  // ── Auto-sync ──────────────────────────────────────────────────────
  private startAutoSync(): void {
    this.stopAutoSync();
    const root = this.opts.getWorkspacePath();
    if (!root) return;
    const dir = join(root, "Library", "Knowledge");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.watcher = new WorkspaceWatcher({
      workspacePath: dir,
      includeProjects: true,
      debounceMs: 4000,
      onChanged: () => void this.scheduleSync("local"),
      onError: (e) => console.error("[team] watcher:", e),
    });
    this.watcher.start();
    // Periodic pull so teammates' changes arrive without a local edit.
    this.pollTimer = setInterval(() => void this.scheduleSync("poll"), 60_000);
  }

  private stopAutoSync(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.watcher) { void this.watcher.stop(); this.watcher = null; }
  }

  /** Background sync trigger (watcher or poll); non-fatal, never overlapping. */
  private async scheduleSync(reason: "local" | "poll"): Promise<void> {
    if (this.state.status !== "connected" || !this.state.workspaceId) return;
    if (this.state.syncing) return;
    // A local change right after a sync is almost always the echo of the files
    // the sync just wrote — ignore it (the poll still catches real edits).
    if (reason === "local" && Date.now() < this.suppressUntil) return;
    try { await this.syncNow(); } catch { /* background sync errors are non-fatal */ }
  }

  /** Ask the embedded web server to embed synced articles into the local index. */
  private async indexArticles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const server = this.opts.getServerUrl();
    if (!server) return;
    // Index relative to the wiki dir (Library/Knowledge), matching the server's wikiPath.
    const rel = paths.map((p) => p.replace(/^Library\/Knowledge\//, ""));
    try {
      await fetch(`${server.replace(/\/$/, "")}/api/wiki/index`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: rel }),
      });
    } catch {
      /* indexing is best-effort; the articles are on disk regardless */
    }
  }
}
