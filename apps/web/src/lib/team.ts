// Client for the NestBrain Enterprise "Team Server". The UI lives in the GPL
// app, but it's inert without a licensed Team Server to connect to — the value
// (server + licensing + E2E) stays proprietary. Talks to the server directly
// from the renderer (the server enables CORS); the session token is kept in
// localStorage for the MVP (OS keychain later).

const LS_URL = "nb.team.url";
const LS_TOKEN = "nb.team.token";

export interface TeamWorkspace { id: string; name: string }
export interface TeamMember { id: string; email: string; name: string; role: string; created_at?: string }
export interface TeamLicense { org: string; seats: number; exp: number | null; dev: boolean }

export class TeamError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function teamUrl(): string {
  try { return localStorage.getItem(LS_URL) ?? ""; } catch { return ""; }
}
export function setServerUrl(url: string): void {
  localStorage.setItem(LS_URL, url.replace(/\/$/, ""));
}
function token(): string | null {
  try { return localStorage.getItem(LS_TOKEN); } catch { return null; }
}
export function isLoggedIn(): boolean {
  return !!token() && !!teamUrl();
}
export function logout(): void {
  try { localStorage.removeItem(LS_TOKEN); } catch { /* ignore */ }
}

async function req(path: string, opts: RequestInit = {}): Promise<any> {
  const t = token();
  const res = await fetch(teamUrl() + path, {
    ...opts,
    headers: { ...(opts.headers ?? {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* non-json */ }
    throw new TeamError(res.status, msg);
  }
  return res.status === 204 ? null : res.json();
}

/** Probe a server URL (no auth) and read its license info. */
export async function health(url: string): Promise<{ ok: boolean; license: TeamLicense }> {
  const res = await fetch(url.replace(/\/$/, "") + "/healthz");
  if (!res.ok) throw new TeamError(res.status, "server not reachable");
  return res.json();
}

export async function login(email: string, password: string): Promise<{ user: { email: string; name: string; role: string } }> {
  const res = await fetch(teamUrl() + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new TeamError(res.status, "invalid credentials");
  const d = await res.json();
  localStorage.setItem(LS_TOKEN, d.token);
  return { user: d.user };
}

export const listWorkspaces = (): Promise<TeamWorkspace[]> => req("/ws").then((d) => d.workspaces);
export const listMembers = (): Promise<TeamMember[]> => req("/members").then((d) => d.members);
export const addMember = (m: { email: string; name: string; password: string; role: string }): Promise<{ member: TeamMember }> =>
  req("/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(m) });
export const removeMember = (id: string): Promise<unknown> => req(`/members/${id}`, { method: "DELETE" });
