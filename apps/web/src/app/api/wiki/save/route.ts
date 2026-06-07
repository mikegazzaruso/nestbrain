import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getDataPaths } from "@/lib/config";

/**
 * Persist hand- or AI-edited markdown back to a wiki article. The path is
 * confined to the wiki directory and must be a `.md` file so a crafted path
 * can't escape the vault.
 */
export async function POST(request: NextRequest) {
  try {
    const { path, content } = await request.json();
    if (typeof path !== "string" || typeof content !== "string") {
      return NextResponse.json({ error: "path and content required" }, { status: 400 });
    }

    const { wikiPath } = getDataPaths();
    const root = resolve(wikiPath);
    const target = resolve(root, path);
    if (target !== root && !target.startsWith(root + sep)) {
      return NextResponse.json({ error: "Path outside wiki directory" }, { status: 400 });
    }
    if (!target.endsWith(".md")) {
      return NextResponse.json({ error: "Only .md files can be saved" }, { status: 400 });
    }

    await writeFile(target, content, "utf-8");
    return NextResponse.json({ ok: true, path });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
