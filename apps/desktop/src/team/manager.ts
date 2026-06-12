import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
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
  /** Per-device: Projects/ included in the team's global workspace. */
  includeProjects?: boolean;
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
    this.set({
      status: "connected",
      serverUrl: config.serverUrl,
      workspaceId: config.workspaceId,
      user: config.user,
      includeProjects: config.includeProjects === true,
    });
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
      // Team/ is a Team-Server concept — scaffolded here on first connect,
      // not at workspace creation (source/$29 installs never get it).
      const root = this.opts.getWorkspacePath();
      if (root) {
        await mkdir(join(root, "Team"), { recursive: true });
        await mkdir(join(root, "Library", "Knowledge"), { recursive: true });
      }
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

  /**
   * Guided server switch — the safe ordering, enforced in one place:
   *  1. Validate the DESTINATION credentials first (bad password → nothing
   *     is touched, you stay connected to the current server).
   *  2. Stop the watchers BEFORE any local deletion, so removals can never
   *     propagate to the old server as delete-remote.
   *  3. Forget the old session/bases, wipe the team-synced trees locally
   *     (Library/Knowledge + Team/ — never Projects/).
   *  4. Connect to the new server and pull its knowledge.
   */
  async switchServer(serverUrl: string, email: string, password: string): Promise<void> {
    const url = serverUrl.replace(/\/$/, "");
    await teamLogin(url, email, password); // step 1 — throws before any damage

    this.stopAutoSync(); // step 2
    await clearToken();
    await saveConfig({});
    this.backend = null;
    this.orgLicense = undefined;
    this.lastVersion.clear();
    this.localDirty = false;

    const root = this.opts.getWorkspacePath(); // step 3
    if (root) {
      for (const dir of [join(root, "Library", "Knowledge"), join(root, "Team")]) {
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
      }
      // Also reset the local knowledge queue: wiping the wiki kills its
      // compile tracker, so every accepted atom would re-flag as "to compile"
      // against the NEW team's knowledge — stale noise from the old life.
      for (const rel of [
        join(".nestbrain", "knowledge-pending"),
        join(".nestbrain", "knowledge-rejected"),
        join(".nestbrain", "raw", "projects"),
      ]) {
        await rm(join(root, rel), { recursive: true, force: true });
      }
    }

    await this.connect(url, email, password); // step 4 (starts auto-sync)
    void this.syncNow().catch(() => { /* background pull; errors surface in state */ });
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

  // Enterprise entitlement: the org license token from the Team Server
  // (verification-only — signed payload). Cached with a 10-minute TTL so
  // central changes (e.g. a module purchase propagated via the rolling token)
  // reach a running app within one refresh, not at next launch.
  private orgLicense: string | null | undefined;
  private orgLicenseAt = 0;
  async getOrgLicense(): Promise<string | null> {
    if (this.state.status !== "connected" || !this.backend) return null;
    if (this.orgLicense !== undefined && Date.now() - this.orgLicenseAt < 10 * 60 * 1000) {
      return this.orgLicense;
    }
    try {
      this.orgLicense = await this.backend.getOrgLicense();
    } catch {
      if (this.orgLicense === undefined) this.orgLicense = null;
    }
    this.orgLicenseAt = Date.now();
    return this.orgLicense;
  }
  // Anatomize profiles — fetched from the Team Server (module-gated there)
  // and cached on disk for the embedded Next server's assessment engine.
  // TTL'd like the org license so profile updates reach running apps.
  private profilesAt = 0;
  async syncAnatomizeProfiles(): Promise<void> {
    if (this.state.status !== "connected" || !this.backend) return;
    if (Date.now() - this.profilesAt < 10 * 60 * 1000) return;
    this.profilesAt = Date.now();
    const root = this.opts.getWorkspacePath();
    if (!root) return;
    try {
      const profiles = await this.backend.getAnatomizeProfiles();
      if (profiles.length > 0) {
        const dir = join(root, ".nestbrain", "anatomize");
        await mkdir(dir, { recursive: true });
        await import("node:fs/promises").then((fs) =>
          fs.writeFile(join(dir, "profiles.json"), JSON.stringify({ fetchedAt: Date.now(), profiles }, null, 2), "utf-8"),
        );
      }
    } catch {
      /* server may predate the module or license may lack it — engine reports it */
    }
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

  /** Filesystem-safe folder name for a Nest. */
  private static safeName(name: string): string {
    return name.replace(/[/\\:*?"<>|]/g, "-").trim() || "Nest";
  }

  /**
   * The trees a workspace syncs.
   * Global workspace: Library/Knowledge (indexed) + Team/ notes — both
   * excluding the Nests/ subtrees, which belong to other manifests — plus,
   * when the per-device switch is on, the Projects/ folder.
   * Nest: its own Library/Knowledge/Nests/<Name> + Team/Nests/<Name>.
   */
  private syncRoots(root: string, ws: RemoteWorkspace, includeProjects: boolean): SyncRoot[] {
    if (ws.isGlobal === false) {
      const safe = TeamManager.safeName(ws.name);
      return [
        { dir: join(root, "Library", "Knowledge", "Nests", safe), prefix: "", index: true },
        { dir: join(root, "Team", "Nests", safe), prefix: "Team/", index: false },
      ];
    }
    const roots: SyncRoot[] = [
      { dir: join(root, "Library", "Knowledge"), prefix: "", index: true, ignore: ["Nests"] },
      { dir: join(root, "Team"), prefix: "Team/", index: false, ignore: ["Nests"] },
    ];
    if (includeProjects) {
      roots.push({ dir: join(root, "Projects"), prefix: "Projects/", index: false });
    }
    return roots;
  }

  /** Sync every workspace the member is entitled to (global + their Nests). */
  async syncNow(): Promise<TeamState["lastResult"]> {
    const backend = this.require();
    const root = this.opts.getWorkspacePath();
    if (!root) throw new Error("no NestBrain workspace open");

    // Pre-1.1 servers don't send isGlobal/role: keep the old single-workspace
    // behavior against the selected id.
    const all = this.state.workspaces ?? [];
    const legacy = all.length > 0 && all[0].isGlobal === undefined;
    const targets = legacy ? all.filter((w) => w.id === this.state.workspaceId) : all;
    if (targets.length === 0) throw new Error("no workspace available");

    this.set({ syncing: true, error: undefined });
    try {
      const cfg = await loadConfig();
      const includeProjects = cfg.includeProjects === true;
      let uploaded = 0;
      let downloaded = 0;
      let conflicts = 0;
      const wikiRels: string[] = [];

      for (const ws of targets) {
        const roots = this.syncRoots(root, ws, includeProjects);
        for (const r of roots) await mkdir(r.dir, { recursive: true });
        const base = cfg.bases?.[ws.id] ?? {};
        // The Projects/ subtree only syncs when this device opted in — without
        // the root, its server entries must pass through untouched.
        const skipPrefixes = ws.isGlobal !== false && !includeProjects ? ["Projects/"] : [];
        const result = await runSync(backend, ws.id, roots, base, 5, ws.role === "reader", skipPrefixes);
        cfg.bases = { ...(cfg.bases ?? {}), [ws.id]: result.base };
        uploaded += result.uploaded;
        downloaded += result.downloaded;
        conflicts += result.conflicts.length;
        this.lastVersion.set(ws.id, result.version);
        // Map changed knowledge paths to wiki-relative for local indexing.
        for (const p of result.changed) {
          if (p.startsWith("Team/") || p.startsWith("Projects/")) continue;
          wikiRels.push(ws.isGlobal === false ? `Nests/${TeamManager.safeName(ws.name)}/${p}` : p);
        }
      }

      await saveConfig(cfg);
      await this.indexArticles(wikiRels);
      const lastResult = { uploaded, downloaded, conflicts };
      this.localDirty = false;
      this.suppressUntil = Date.now() + 8000; // ignore the watcher echo from files we just wrote
      this.set({ syncing: false, lastSync: Date.now(), lastResult });
      return lastResult;
    } catch (e) {
      this.set({ syncing: false, error: e instanceof Error ? e.message : "sync failed" });
      throw e;
    }
  }

  /** Per-device switch: include Projects/ in the team's global workspace. */
  async setIncludeProjects(v: boolean): Promise<void> {
    const cfg = await loadConfig();
    cfg.includeProjects = v;
    await saveConfig(cfg);
    this.set({ includeProjects: v });
    if (this.state.status === "connected") {
      this.startAutoSync(); // re-create watchers with/without the Projects tree
      void this.scheduleSync("local");
    }
  }

  // ── Auto-sync ──────────────────────────────────────────────────────
  private startAutoSync(): void {
    this.stopAutoSync();
    const root = this.opts.getWorkspacePath();
    if (!root) return;
    // Watch the shared trees. Library/Knowledge and Team/ recursively cover
    // the Nests/ subtrees too; Projects/ gets its own watcher when opted in.
    const dirs = [join(root, "Library", "Knowledge"), join(root, "Team")];
    if (this.state.includeProjects) dirs.push(join(root, "Projects"));
    for (const dir of dirs) {
      const r = { dir };
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
    if (this.state.status !== "connected" || !this.backend) return;
    if (this.state.syncing) return;
    const wss = this.state.workspaces ?? [];
    if (wss.length === 0) return;

    // Idle poll: cheap head-version checks first — sync only if any entitled
    // workspace moved or we have pending local edits. (Mirrors the Drive
    // engine's delta fast-path.)
    if (reason === "poll" && !this.localDirty) {
      try {
        let moved = false;
        for (const ws of wss) {
          const v = await this.backend.getVersion(ws.id);
          if (v !== this.lastVersion.get(ws.id)) { moved = true; break; }
        }
        if (!moved) return;
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
