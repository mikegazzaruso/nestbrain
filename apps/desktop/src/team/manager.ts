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
import { runSync, type SyncRoot } from "./sync-flow.js";
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
  private watchers: WorkspaceWatcher[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private suppressUntil = 0;
  private localDirty = false;
  private readonly lastVersion = new Map<string, number>();

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
    this.set({ status: "connected", serverUrl: config.serverUrl, workspaceId: config.workspaceId, user: config.user });
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

  /** True if the server is fresh and needs its first admin provisioned. */
  async needsSetup(serverUrl: string): Promise<boolean> {
    try {
      const res = await fetch(serverUrl.replace(/\/$/, "") + "/setup/status");
      if (!res.ok) return false;
      return ((await res.json()) as { needsSetup?: boolean }).needsSetup === true;
    } catch {
      return false;
    }
  }

  /** Provision the first admin on a fresh server, then connect. */
  async setup(serverUrl: string, token: string, email: string, password: string, name?: string): Promise<void> {
    const url = serverUrl.replace(/\/$/, "");
    const res = await fetch(url + "/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email, password, name }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error ?? `setup failed (${res.status})`);
    }
    await this.connect(url, email, password);
  }

  async connect(serverUrl: string, email: string, password: string): Promise<void> {
    const url = serverUrl.replace(/\/$/, "");
    if (await this.needsSetup(url)) {
      throw new Error("NEEDS_SETUP");
    }
    this.set({ status: "connecting", error: undefined });
    try {
      const { token, user } = await teamLogin(url, email, password);
      await saveToken(token);
      this.backend = new TeamBackend(url, token);
      const cfg = await loadConfig();
      cfg.serverUrl = url;
      // Persist the identity (incl. role): init() restores it on app launch so
      // an admin keeps the member-management UI without re-logging in.
      cfg.user = { email: user.email, name: user.name, role: user.role };
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

  /**
   * The two trees the team shares, in one workspace:
   *  - Library/Knowledge → the compiled wiki (prefix "", indexed for search)
   *  - Team/             → shared team notes (prefix "Team/", NOT indexed)
   * Team notes sync like any file but never enter the knowledge vector store.
   */
  private syncRoots(root: string): SyncRoot[] {
    return [
      { dir: join(root, "Library", "Knowledge"), prefix: "", index: true },
      { dir: join(root, "Team"), prefix: "Team/", index: false },
    ];
  }

  /** Sync Library/Knowledge + Team/ ↔ the selected team workspace. */
  async syncNow(): Promise<TeamState["lastResult"]> {
    const backend = this.require();
    const wsId = this.state.workspaceId;
    if (!wsId) throw new Error("no workspace selected");
    const root = this.opts.getWorkspacePath();
    if (!root) throw new Error("no NestBrain workspace open");
    const roots = this.syncRoots(root);
    for (const r of roots) await mkdir(r.dir, { recursive: true });

    this.set({ syncing: true, error: undefined });
    try {
      const cfg = await loadConfig();
      const base = cfg.bases?.[wsId] ?? {};
      const result = await runSync(backend, wsId, roots, base);
      cfg.bases = { ...(cfg.bases ?? {}), [wsId]: result.base };
      await saveConfig(cfg);
      // Re-index articles that arrived from teammates so they become
      // searchable in this device's local vector store.
      await this.indexArticles(result.changed);
      const lastResult = { uploaded: result.uploaded, downloaded: result.downloaded, conflicts: result.conflicts.length };
      this.lastVersion.set(wsId, result.version);
      this.localDirty = false;
      this.suppressUntil = Date.now() + 8000; // ignore the watcher echo from files we just wrote
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
    // One watcher per shared tree (Library/Knowledge + Team/).
    for (const r of this.syncRoots(root)) {
      if (!existsSync(r.dir)) mkdirSync(r.dir, { recursive: true });
      const w = new WorkspaceWatcher({
        workspacePath: r.dir,
        includeProjects: true,
        debounceMs: 4000,
        onChanged: () => {
          // Ignore the echo from files a sync itself just wrote.
          if (Date.now() < this.suppressUntil) return;
          this.localDirty = true;
          void this.scheduleSync("local");
        },
        onError: (e) => console.error("[team] watcher:", e),
      });
      w.start();
      this.watchers.push(w);
    }
    // Periodic pull so teammates' changes arrive without a local edit.
    this.pollTimer = setInterval(() => void this.scheduleSync("poll"), 60_000);
  }

  private stopAutoSync(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    for (const w of this.watchers) void w.stop();
    this.watchers = [];
  }

  /**
   * Tear down for app quit: AWAIT every watcher's close so chokidar's fsevents
   * backend (macOS) is gone before Node frees the N-API threadsafe function —
   * otherwise it fires into freed memory and aborts (SIGABRT). Harmless and
   * correct on every platform.
   */
  async dispose(): Promise<void> {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    const ws = this.watchers;
    this.watchers = [];
    await Promise.allSettled(ws.map((w) => w.stop()));
  }

  /** Background sync trigger (watcher or poll); non-fatal, never overlapping. */
  private async scheduleSync(reason: "local" | "poll"): Promise<void> {
    if (this.state.status !== "connected" || !this.state.workspaceId || !this.backend) return;
    if (this.state.syncing) return;
    const wsId = this.state.workspaceId;

    // Idle poll: do a tiny version check first. If the remote head hasn't moved
    // and we have no pending local edits, there's nothing to do — exit in ms,
    // no walk, no full manifest. (Mirrors the Drive engine's delta fast-path.)
    if (reason === "poll" && !this.localDirty) {
      try {
        const v = await this.backend.getVersion(wsId);
        if (v === this.lastVersion.get(wsId)) return;
      } catch {
        return; // offline — skip this tick
      }
    }
    try { await this.syncNow(); } catch { /* background sync errors are non-fatal */ }
  }

  /** Ask the embedded web server to embed synced articles into the local index. */
  private async indexArticles(paths: string[]): Promise<void> {
    // Team/ notes sync but are never embedded into the knowledge vector store —
    // only the wiki (prefix "") is indexed.
    const wiki = paths.filter((p) => !p.startsWith("Team/"));
    if (wiki.length === 0) return;
    const server = this.opts.getServerUrl();
    if (!server) return;
    // Index relative to the wiki dir (Library/Knowledge), matching the server's wikiPath.
    const rel = wiki.map((p) => p.replace(/^Library\/Knowledge\//, ""));
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
