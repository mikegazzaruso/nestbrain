import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { getDataPaths } from "@/lib/config";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path");

    const { wikiPath } = getDataPaths();

    if (path) {
      // Return a specific article
      const filePath = join(wikiPath, path);
      const content = await readFile(filePath, "utf-8");
      return NextResponse.json({ content, path });
    }

    // Return the wiki tree
    const tree = await buildWikiTree(wikiPath);
    return NextResponse.json({ tree });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface WikiNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WikiNode[];
  title?: string;
}

async function buildWikiTree(dirPath: string, prefix = ""): Promise<WikiNode[]> {
  const entries = await readdir(dirPath);
  const nodes: WikiNode[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const fullPath = join(dirPath, entry);
    const relativePath = prefix ? `${prefix}/${entry}` : entry;
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      const children = await buildWikiTree(fullPath, relativePath);
      nodes.push({
        name: entry,
        path: relativePath,
        type: "directory",
        children,
      });
    } else if (entry.endsWith(".md")) {
      // Extract title from frontmatter
      const content = await readFile(fullPath, "utf-8");
      const titleMatch = content.match(/title:\s*"([^"]+)"/);
      nodes.push({
        name: entry,
        path: relativePath,
        type: "file",
        title: titleMatch?.[1] ?? entry.replace(".md", ""),
      });
    }
  }

  return nodes;
}
