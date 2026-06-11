import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSync, type SyncRoot } from "./sync-flow.js";
import type { FileMap, SyncBackend } from "@nestbrain/sync";

// In-memory backend: a single versioned manifest + a content-addressed blob
// store, enough to drive runSync end-to-end without a server.
class FakeBackend {
  id = "fake";
  files: FileMap = {};
  blobs = new Map<string, Uint8Array>();
  version = 0;
  async listWorkspaces() {
    return [];
  }
  async getManifest() {
    return { version: this.version, files: { ...this.files } };
  }
  async putBlob(_ws: string, hash: string, bytes: Uint8Array) {
    this.blobs.set(hash, new Uint8Array(bytes));
  }
  async getBlob(_ws: string, hash: string) {
    return this.blobs.get(hash)!;
  }
  async commit(_ws: string, baseVersion: number, files: FileMap) {
    if (baseVersion !== this.version) {
      return { ok: false as const, conflict: true as const, manifest: { version: this.version, files: { ...this.files } } };
    }
    this.version += 1;
    this.files = { ...files };
    return { ok: true as const, manifest: { version: this.version, files: { ...this.files } } };
  }
}

function rootsFor(ws: string): SyncRoot[] {
  return [
    { dir: join(ws, "Library", "Knowledge"), prefix: "", index: true },
    { dir: join(ws, "Team"), prefix: "Team/", index: false },
  ];
}

describe("team runSync — Library/Knowledge + Team/ with server prefixes", () => {
  let a: string;
  let b: string;
  beforeEach(async () => {
    a = await mkdtemp(join(tmpdir(), "nb-teamA-"));
    b = await mkdtemp(join(tmpdir(), "nb-teamB-"));
  });
  afterEach(async () => {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  });

  it("namespaces Team/ on the server and routes it back to Team/ on a peer — never into the wiki", async () => {
    const backend = new FakeBackend() as unknown as SyncBackend & FakeBackend;

    // Client A: one wiki article + one team note.
    await mkdir(join(a, "Library", "Knowledge"), { recursive: true });
    await mkdir(join(a, "Team"), { recursive: true });
    await writeFile(join(a, "Library", "Knowledge", "flux.md"), "# Flux");
    await writeFile(join(a, "Team", "roadmap.md"), "# Roadmap");

    const up = await runSync(backend, "ws", rootsFor(a), {});
    expect(up.uploaded).toBe(2);

    // Server keys: wiki is bare, team is prefixed.
    expect(backend.files["flux.md"]).toBeDefined();
    expect(backend.files["Team/roadmap.md"]).toBeDefined();
    expect(backend.files["roadmap.md"]).toBeUndefined();

    // Client B (fresh) pulls.
    const down = await runSync(backend, "ws", rootsFor(b), {});
    expect(down.downloaded).toBe(2);

    // Each tree lands in the right place; no cross-routing.
    expect(existsSync(join(b, "Library", "Knowledge", "flux.md"))).toBe(true);
    expect(existsSync(join(b, "Team", "roadmap.md"))).toBe(true);
    expect(existsSync(join(b, "Library", "Knowledge", "Team", "roadmap.md"))).toBe(false);
    expect(existsSync(join(b, "Team", "flux.md"))).toBe(false);

    // `changed` carries prefixed paths so the manager can index only the wiki.
    expect(down.changed.sort()).toEqual(["Team/roadmap.md", "flux.md"]);
    expect(down.changed.filter((p) => !p.startsWith("Team/"))).toEqual(["flux.md"]);
  });
});

describe("Nests, reader role, Projects opt-out", () => {
  let a: string;
  let b: string;
  beforeEach(async () => {
    a = await mkdtemp(join(tmpdir(), "nb-nestA-"));
    b = await mkdtemp(join(tmpdir(), "nb-nestB-"));
  });
  afterEach(async () => {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  });

  it("global walk skips Nests/ subtrees; opted-out Projects pass through commits untouched", async () => {
    const backend = new FakeBackend() as unknown as SyncBackend & FakeBackend;
    // Remote already holds someone else's project file.
    backend.version = 1;
    backend.files = { "Projects/app/main.ts": { hash: "h-proj", size: 1, mtime: 1 } };
    backend.blobs.set("h-proj", new TextEncoder().encode("x"));

    await mkdir(join(a, "Library", "Knowledge", "Nests", "Eng"), { recursive: true });
    await mkdir(join(a, "Team"), { recursive: true });
    await writeFile(join(a, "Library", "Knowledge", "global.md"), "# g");
    await writeFile(join(a, "Library", "Knowledge", "Nests", "Eng", "secret.md"), "# s");

    const roots: SyncRoot[] = [
      { dir: join(a, "Library", "Knowledge"), prefix: "", index: true, ignore: ["Nests"] },
      { dir: join(a, "Team"), prefix: "Team/", index: false, ignore: ["Nests"] },
    ];
    const res = await runSync(backend, "ws", roots, {}, 5, false, ["Projects/"]);

    expect(res.uploaded).toBe(1); // only global.md — the Nest file never leaks into the global manifest
    expect(backend.files["global.md"]).toBeDefined();
    expect(backend.files["Nests/Eng/secret.md"]).toBeUndefined();
    // Opted-out Projects entry survived the commit and wasn't downloaded.
    expect(backend.files["Projects/app/main.ts"]).toBeDefined();
    expect(existsSync(join(a, "Library", "Knowledge", "Projects"))).toBe(false);
  });

  it("reader is pull-only: downloads arrive, local edits never reach the server", async () => {
    const backend = new FakeBackend() as unknown as SyncBackend & FakeBackend;
    backend.version = 1;
    backend.files = { "doc.md": { hash: "h-doc", size: 5, mtime: 1 } };
    backend.blobs.set("h-doc", new TextEncoder().encode("# doc"));

    await mkdir(join(b, "K"), { recursive: true });
    await writeFile(join(b, "K", "mine.md"), "# mine"); // reader's local-only edit
    const roots: SyncRoot[] = [{ dir: join(b, "K"), prefix: "", index: true }];

    const res = await runSync(backend, "ws", roots, {}, 5, true);
    expect(existsSync(join(b, "K", "doc.md"))).toBe(true); // pulled
    expect(res.uploaded).toBe(0);
    expect(backend.files["mine.md"]).toBeUndefined(); // never uploaded
    expect(backend.version).toBe(1); // no commit happened
  });
});
