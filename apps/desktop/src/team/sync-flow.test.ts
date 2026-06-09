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
