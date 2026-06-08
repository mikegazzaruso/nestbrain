import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { VectorStore } from "@nestbrain/core";
import { getDataPaths } from "@/lib/config";
import { ensureNativeLoadersRegistered } from "@/lib/native-loader";

// Index team-synced wiki articles into the LOCAL vector store so hybrid search
// + Ask find them. Team sync drops structured articles straight into the wiki
// folder (bypassing compile, which builds the wiki from raw sources); this
// closes that gap. The index is per-device and never synced.
export const maxDuration = 600;

/** Stable id from a relative path: lowercase, non-alphanumerics → '-'. */
function pathId(relPath: string): string {
  return relPath
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function extractMeta(content: string, relPath: string): { title: string; type: string; projects?: string[] } {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  let title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  let projects: string[] | undefined;
  if (fm) {
    const inner = fm[1];
    title = title ?? inner.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1];
    const single = inner.match(/^project:\s*(.+)$/m)?.[1]?.trim();
    const multi = inner.match(/^projects:\s*\[(.*?)\]/m)?.[1];
    if (single) projects = [single];
    else if (multi) projects = multi.split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean);
  }
  const top = relPath.split("/")[0];
  const type = top === "concepts" || top === "sources" || top === "outputs" ? top.replace(/s$/, "") : "article";
  return { title: title ?? relPath.replace(/\.md$/i, ""), type, projects };
}

export async function POST(request: NextRequest) {
  try {
    ensureNativeLoadersRegistered();
    const { paths } = await request.json();
    if (!Array.isArray(paths)) {
      return NextResponse.json({ error: "paths array required" }, { status: 400 });
    }

    const { wikiPath } = getDataPaths();
    const root = resolve(wikiPath);
    const store = new VectorStore(wikiPath);
    await store.load();

    let indexed = 0;
    const errors: string[] = [];
    for (const rel of paths as string[]) {
      if (typeof rel !== "string" || !rel.endsWith(".md") || rel.endsWith("vector-index.json")) continue;
      const full = resolve(root, rel);
      if (full !== root && !full.startsWith(root + sep)) continue; // confine to wiki dir
      try {
        const content = await readFile(full, "utf-8");
        const { title, type, projects } = extractMeta(content, rel);
        await store.upsert(pathId(rel), title, rel, type, content, projects);
        indexed++;
      } catch (e) {
        errors.push(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (indexed > 0) await store.save();

    return NextResponse.json({ indexed, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
