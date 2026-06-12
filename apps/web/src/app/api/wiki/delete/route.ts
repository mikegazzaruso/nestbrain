import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { VectorStore } from "@nestbrain/core";
import { getDataPaths } from "@/lib/config";
import { ensureNativeLoadersRegistered } from "@/lib/native-loader";

ensureNativeLoadersRegistered();

// Delete a wiki article EVERYWHERE it lives: the .md file, its vector-index
// entry, and the raw source that generated it (frontmatter `source:`) — if
// the raw survived, the next compile would just resurrect the article.
// `dryRun` returns the pages that [[wikilink]] this one so the UI can offer
// the optional cascade; `cascade` deletes those referencing pages too (one
// level — no recursion: deleting a hub must not unravel the whole wiki).
// No recompile is ever needed: deletion touches no other article's content.

interface DeleteBody {
  path?: string;
  dryRun?: boolean;
  cascade?: boolean;
}

function pathId(relPath: string): string {
  return relPath
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function listWikiFiles(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listWikiFiles(join(dir, e.name), rel)));
    else if (e.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

function articleTitle(content: string, relPath: string): string {
  const fm = /^---\n[\s\S]*?title:\s*"?(.+?)"?\s*\n[\s\S]*?\n---/.exec(content);
  if (fm) return fm[1];
  const h1 = content.match(/^#\s+(.+)$/m)?.[1];
  return (h1 ?? relPath.split("/").pop()!.replace(/\.md$/i, "")).trim();
}

function referencesTitle(content: string, title: string): boolean {
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\[\\[${esc}(\\|[^\\]]*)?\\]\\]`, "i").test(content);
}

function safeRel(wikiPath: string, p: string): string {
  const abs = resolve(wikiPath, p);
  if (abs !== resolve(wikiPath) && !abs.startsWith(resolve(wikiPath) + sep)) {
    throw new Error("path escapes the wiki");
  }
  if (!abs.endsWith(".md")) throw new Error("only markdown articles can be deleted");
  return abs;
}

async function deleteOne(
  wikiPath: string,
  rawPath: string,
  store: VectorStore,
  rel: string,
): Promise<void> {
  const abs = safeRel(wikiPath, rel);
  let content = "";
  try {
    content = await readFile(abs, "utf-8");
  } catch {
    return; // already gone
  }
  // Raw provenance: `source: "raw/<file>"` (compile output) — remove it or
  // the next compile regenerates the article.
  const src = /^source:\s*"?(?:raw\/)?([^"\n]+?)"?\s*$/m.exec(content)?.[1];
  if (src && !src.includes("..") && !src.includes("/")) {
    await unlink(join(rawPath, src)).catch(() => {});
  }
  await unlink(abs).catch(() => {});
  await store.remove(pathId(rel)).catch(() => {});
}

export async function POST(request: NextRequest) {
  try {
    const { path, dryRun, cascade } = (await request.json()) as DeleteBody;
    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }
    const { wikiPath, rawPath } = getDataPaths();
    const abs = safeRel(wikiPath, path);

    const content = await readFile(abs, "utf-8");
    const title = articleTitle(content, path);

    // Pages that wikilink this article.
    const all = await listWikiFiles(wikiPath);
    const referencing: { path: string; title: string }[] = [];
    for (const rel of all) {
      if (rel === path) continue;
      try {
        const c = await readFile(join(wikiPath, rel), "utf-8");
        if (referencesTitle(c, title)) referencing.push({ path: rel, title: articleTitle(c, rel) });
      } catch {
        /* unreadable file — skip */
      }
    }

    if (dryRun) {
      return NextResponse.json({ title, references: referencing });
    }

    const store = new VectorStore(wikiPath);
    await store.load();
    await deleteOne(wikiPath, rawPath, store, path);
    if (cascade) {
      for (const ref of referencing) {
        await deleteOne(wikiPath, rawPath, store, ref.path);
      }
    }
    await store.save();

    return NextResponse.json({
      ok: true,
      deleted: 1 + (cascade ? referencing.length : 0),
      references: cascade ? [] : referencing,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
