import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SyncEngine } from "./engine";
import type { DriveAdapter, DriveFile } from "./drive-adapter";
import type { Manifest } from "./types";
import type { SyncPreferences } from "@nestbrain/shared";

// Remote Drive tree: a Knowledge file (always part of the sync set) and a
// Projects file (only when the device opted into project sync).
const REMOTE: Array<{ relPath: string; file: DriveFile; content: string }> = [
  {
    relPath: "Knowledge/note.md",
    file: { id: "id-note", name: "note.md", mimeType: "text/markdown" },
    content: "# note",
  },
  {
    relPath: "Projects/app/secret.ts",
    file: { id: "id-secret", name: "secret.ts", mimeType: "text/plain" },
    content: "const apiKey = 1;",
  },
];

function makePrefs(includeProjects: boolean): SyncPreferences {
  return { enabled: true, includeProjects, maxFileSizeBytes: 10_000_000, trashRetentionDays: 0 };
}

function makeManifest(): Manifest {
  return {
    version: 1,
    deviceId: "dev",
    deviceName: "test",
    rootFolderDriveId: "root",
    folders: { "": "root" },
    files: {},
  };
}

/** Minimal DriveAdapter stand-in covering only what the pull path calls. */
function makeFakeDrive(downloads: string[]): DriveAdapter {
  const byId = new Map(REMOTE.map((r) => [r.file.id, r]));
  const fake = {
    async getStartPageToken(): Promise<string> {
      return "tok-0";
    },
    async *walkFiles(): AsyncGenerator<{ relPath: string; file: DriveFile }> {
      for (const r of REMOTE) yield { relPath: r.relPath, file: r.file };
    },
    async downloadFile(driveId: string, localPath: string): Promise<void> {
      downloads.push(driveId);
      const r = byId.get(driveId)!;
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, r.content);
    },
  };
  return fake as unknown as DriveAdapter;
}

function makeEngine(ws: string, includeProjects: boolean, downloads: string[], manifest: Manifest) {
  return new SyncEngine({
    workspacePath: ws,
    drive: makeFakeDrive(downloads),
    manifest,
    prefs: makePrefs(includeProjects),
    onProgress: () => {},
    persistManifest: async () => {},
    signal: new AbortController().signal,
  });
}

describe("SyncEngine pull respects includeProjects", () => {
  let ws: string;
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), "nb-sync-"));
  });
  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
  });

  it("does NOT pull Projects/ when project sync is off", async () => {
    const downloads: string[] = [];
    const manifest = makeManifest();
    const res = await makeEngine(ws, false, downloads, manifest).runPull();

    // Knowledge file came down; Projects file did NOT.
    expect(existsSync(join(ws, "Knowledge", "note.md"))).toBe(true);
    expect(existsSync(join(ws, "Projects", "app", "secret.ts"))).toBe(false);

    // The Projects blob was never even downloaded from Drive.
    expect(downloads).toEqual(["id-note"]);

    // Manifest only tracks the Knowledge file.
    expect(manifest.files["Knowledge/note.md"]).toBeDefined();
    expect(manifest.files["Projects/app/secret.ts"]).toBeUndefined();

    expect(res.downloaded).toBe(1);
  });

  it("DOES pull Projects/ when project sync is on", async () => {
    const downloads: string[] = [];
    const manifest = makeManifest();
    const res = await makeEngine(ws, true, downloads, manifest).runPull();

    expect(existsSync(join(ws, "Knowledge", "note.md"))).toBe(true);
    expect(existsSync(join(ws, "Projects", "app", "secret.ts"))).toBe(true);
    expect(downloads.sort()).toEqual(["id-note", "id-secret"]);
    expect(res.downloaded).toBe(2);
  });
});
