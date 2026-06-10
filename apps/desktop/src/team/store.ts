import { app, safeStorage } from "electron";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FileMap } from "@nestbrain/sync";

// The team-server session token is sensitive → encrypted at rest in the OS
// keychain via Electron safeStorage (same approach as the Google auth token),
// NOT in renderer localStorage. Non-sensitive config (server URL, selected
// workspace, last-synced base manifests) lives in a plain JSON.

function tokenPath(): string {
  return join(app.getPath("userData"), "team-token.enc");
}
function configPath(): string {
  return join(app.getPath("userData"), "team.json");
}

export async function saveToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level encryption is not available; refusing to persist the team token.");
  }
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(tokenPath(), safeStorage.encryptString(token));
}

export async function loadToken(): Promise<string | null> {
  try {
    const buf = await readFile(tokenPath());
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try { await unlink(tokenPath()); } catch { /* already gone */ }
}

export interface TeamConfig {
  serverUrl?: string;
  workspaceId?: string;
  /** Signed-in identity (incl. role) — restored on app launch so the UI knows
   *  the user is an admin without forcing a re-login. Not sensitive. */
  user?: { email: string; name: string; role: string };
  /** Last-synced manifest per workspace, used as the 3-way reconcile base. */
  bases?: Record<string, FileMap>;
}

export async function loadConfig(): Promise<TeamConfig> {
  try { return JSON.parse(await readFile(configPath(), "utf8")); } catch { return {}; }
}

export async function saveConfig(c: TeamConfig): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(configPath(), JSON.stringify(c, null, 2));
}
