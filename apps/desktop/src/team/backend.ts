import type { SyncBackend, RemoteManifest, RemoteWorkspace, FileMap, CommitResult } from "@nestbrain/sync";

// Client adapter for the NestBrain Enterprise Team Server. Implements the
// GPL `SyncBackend` over HTTP; lives in the GPL app (the value is the
// proprietary server + license, not this client). Runs in the Electron main
// process where `fetch` is a Node global.

export interface TeamUser { email: string; name: string; role: string }
export interface TeamLicense { org: string; seats: number; exp: number | null; dev: boolean }
export interface TeamMember { id: string; email: string; name: string; role: string; created_at?: string }

export class TeamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function strip(url: string): string {
  return url.replace(/\/$/, "");
}

export async function teamHealth(baseUrl: string): Promise<{ ok: boolean; license: TeamLicense }> {
  const res = await fetch(strip(baseUrl) + "/healthz");
  if (!res.ok) throw new TeamError(res.status, "server not reachable");
  return res.json();
}

export async function teamLogin(baseUrl: string, email: string, password: string): Promise<{ token: string; user: TeamUser }> {
  const res = await fetch(strip(baseUrl) + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new TeamError(res.status, "invalid credentials");
  return res.json();
}

export class TeamBackend implements SyncBackend {
  readonly id = "team-server";
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly token: string) {
    this.baseUrl = strip(baseUrl);
  }

  private h(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra };
  }

  private async json(path: string, opts: RequestInit = {}): Promise<any> {
    const res = await fetch(this.baseUrl + path, { ...opts, headers: { ...(opts.headers ?? {}), ...this.h() } });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error ?? msg; } catch { /* non-json */ }
      throw new TeamError(res.status, msg);
    }
    return res.status === 204 ? null : res.json();
  }

  listWorkspaces(): Promise<RemoteWorkspace[]> {
    return this.json("/ws").then((d) => d.workspaces);
  }
  getManifest(workspaceId: string): Promise<RemoteManifest> {
    return this.json(`/ws/${workspaceId}/manifest`);
  }

  async putBlob(workspaceId: string, hash: string, bytes: Uint8Array): Promise<void> {
    const res = await fetch(`${this.baseUrl}/ws/${workspaceId}/blob/${hash}`, {
      method: "PUT",
      headers: this.h({ "Content-Type": "application/octet-stream" }),
      // Buffer view of the bytes — avoids the TS 5.7 generic-typed-array
      // BodyInit overload mismatch on Uint8Array<ArrayBufferLike>.
      body: Buffer.from(bytes) as unknown as BodyInit,
    });
    if (!res.ok) throw new TeamError(res.status, `putBlob ${hash}: ${res.status}`);
  }

  async getBlob(workspaceId: string, hash: string): Promise<Uint8Array> {
    const res = await fetch(`${this.baseUrl}/ws/${workspaceId}/blob/${hash}`, { headers: this.h() });
    if (!res.ok) throw new TeamError(res.status, `getBlob ${hash}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async commit(workspaceId: string, baseVersion: number, files: FileMap): Promise<CommitResult> {
    const res = await fetch(`${this.baseUrl}/ws/${workspaceId}/commit`, {
      method: "POST",
      headers: this.h({ "Content-Type": "application/json" }),
      body: JSON.stringify({ baseVersion, files }),
    });
    if (res.status === 409) {
      const d = await res.json();
      return { ok: false, conflict: true, manifest: { version: d.version, files: d.files } };
    }
    if (!res.ok) throw new TeamError(res.status, `commit: ${res.status}`);
    const d = await res.json();
    return { ok: true, manifest: { version: d.version, files: d.files } };
  }

  // --- member management (not part of the SyncBackend contract) ---
  listMembers(): Promise<TeamMember[]> {
    return this.json("/members").then((d) => d.members);
  }
  addMember(m: { email: string; name: string; password: string; role: string }): Promise<unknown> {
    return this.json("/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(m) });
  }
  removeMember(id: string): Promise<unknown> {
    return this.json(`/members/${id}`, { method: "DELETE" });
  }
}
