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

// The realistic path after the first sync: Drive returns a change-log delta
// (manifest has a driveChangesPageToken) → pullIncremental(), not the full walk.
function makeIncrementalManifest(): Manifest {
  return {
    version: 1,
    deviceId: "dev",
    deviceName: "test",
    rootFolderDriveId: "root",
    folders: { "": "root", Knowledge: "fld-k", Projects: "fld-p" },
    files: {},
    driveChangesPageToken: "tok-1",
  };
}

function makeFakeDriveIncremental(downloads: string[]): DriveAdapter {
  const byId = new Map<string, { content: string; file: DriveFile }>([
    ["id-note", { content: "# note", file: { id: "id-note", name: "note.md", mimeType: "text/markdown", parents: ["fld-k"] } }],
    ["id-secret", { content: "secret", file: { id: "id-secret", name: "secret.ts", mimeType: "text/plain", parents: ["fld-p"] } }],
  ]);
  const fake = {
    async getStartPageToken(): Promise<string> {
      return "tok-1";
    },
    async listChanges(): Promise<{ changes: Array<{ fileId: string; removed: boolean; file: DriveFile }>; newStartPageToken: string }> {
      return {
        changes: [
          { fileId: "id-note", removed: false, file: byId.get("id-note")!.file },
          { fileId: "id-secret", removed: false, file: byId.get("id-secret")!.file },
        ],
        newStartPageToken: "tok-2",
      };
    },
    async downloadFile(driveId: string, localPath: string): Promise<void> {
      downloads.push(driveId);
      await mkdir(dirname(localPath), { recursive: true });
      await writeFile(localPath, byId.get(driveId)!.content);
    },
  };
  return fake as unknown as DriveAdapter;
}

describe("SyncEngine incremental pull respects includeProjects", () => {
  let ws: string;
  beforeEach(async () => {
    ws = await mkdtemp(join(tmpdir(), "nb-sync-inc-"));
  });
  afterEach(async () => {
    await rm(ws, { recursive: true, force: true });
  });

  it("does NOT pull Projects/ via the change-log delta when project sync is off", async () => {
    const downloads: string[] = [];
    const manifest = makeIncrementalManifest();
    const engine = new SyncEngine({
      workspacePath: ws,
      drive: makeFakeDriveIncremental(downloads),
      manifest,
      prefs: makePrefs(false),
      onProgress: () => {},
      persistManifest: async () => {},
      signal: new AbortController().signal,
    });
    const res = await engine.runPull();

    expect(existsSync(join(ws, "Knowledge", "note.md"))).toBe(true);
    expect(existsSync(join(ws, "Projects", "secret.ts"))).toBe(false);
    expect(downloads).toEqual(["id-note"]);
    expect(manifest.files["Projects/secret.ts"]).toBeUndefined();
    expect(res.downloaded).toBe(1);
  });

  it("DOES pull Projects/ via the change-log delta when project sync is on", async () => {
    const downloads: string[] = [];
    const manifest = makeIncrementalManifest();
    const engine = new SyncEngine({
      workspacePath: ws,
      drive: makeFakeDriveIncremental(downloads),
      manifest,
      prefs: makePrefs(true),
      onProgress: () => {},
      persistManifest: async () => {},
      signal: new AbortController().signal,
    });
    const res = await engine.runPull();

    expect(existsSync(join(ws, "Projects", "secret.ts"))).toBe(true);
    expect(downloads.sort()).toEqual(["id-note", "id-secret"]);
    expect(res.downloaded).toBe(2);
  });
});
