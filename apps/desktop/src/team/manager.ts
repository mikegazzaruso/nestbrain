import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { RemoteWorkspace } from "@nestbrain/sync";
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
}

export class TeamManager {
  private state: TeamState = { status: "disconnected", syncing: false };
  private listeners = new Set<Listener>();
  private backend: TeamBackend | null = null;

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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "connection failed";
      this.set({ status: "error", error: msg });
      throw e;
    }
  }

  async disconnect(): Promise<void> {
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
      const lastResult = { uploaded: result.uploaded, downloaded: result.downloaded, conflicts: result.conflicts.length };
      this.set({ syncing: false, lastSync: Date.now(), lastResult });
      return lastResult;
    } catch (e) {
      this.set({ syncing: false, error: e instanceof Error ? e.message : "sync failed" });
      throw e;
    }
  }
}
