// Per-device sync preferences. Kept separate from the LLM settings.json so
// account state doesn't leak between machines if a user copies the workspace.

import { app } from "electron";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { DEFAULT_SYNC_PREFS } from "@nestbrain/shared";
import type { SyncPreferences } from "@nestbrain/shared";

function prefsPath(): string {
  return join(app.getPath("userData"), "sync-prefs.json");
}

export async function loadSyncPrefs(): Promise<SyncPreferences> {
  try {
    const raw = await readFile(prefsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<SyncPreferences>;
    return { ...DEFAULT_SYNC_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_SYNC_PREFS };
  }
}

export async function saveSyncPrefs(prefs: SyncPreferences): Promise<void> {
  const path = prefsPath();
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(prefs, null, 2), "utf-8");
}
