import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { getDataPaths } from "@/lib/config";

interface GraphNode {
  id: string;
  label: string;
  type: "concept" | "source" | "output";
  path: string;
  connections: number;
}

interface GraphLink {
  source: string;
  target: string;
}

export async function GET() {
  try {
    const { wikiPath } = getDataPaths();
    const nodes: GraphNode[] = [];
    const rawLinks: GraphLink[] = [];
    const nodeIds = new Set<string>();

    const dirs = [
      { dir: "concepts", type: "concept" as const },
      { dir: "sources", type: "source" as const },
      { dir: "outputs", type: "output" as const },
    ];

    // Build nodes and extract wikilinks
    for (const { dir, type } of dirs) {
      const dirPath = join(wikiPath, dir);
      let files: string[];
      try {
        files = await readdir(dirPath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;

        const content = await readFile(join(dirPath, file), "utf-8");
        const titleMatch = content.match(/title:\s*"([^"]+)"/);
        const id = basename(file, ".md");
        const label = titleMatch?.[1] ?? id;

        nodes.push({ id, label, type, path: `${dir}/${file}`, connections: 0 });
        nodeIds.add(id);

        // Extract wikilinks
        const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
          const target = match[1].trim();
          const targetSlug = target
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          const cleanTarget = targetSlug.includes("/")
            ? targetSlug.split("/").pop()!
            : targetSlug;
          rawLinks.push({ source: id, target: cleanTarget });
        }
      }
    }

    // Resolve links: exact match first, then fuzzy
    const resolvedLinks: GraphLink[] = [];
    for (const link of rawLinks) {
      if (link.source === link.target) continue;

      let targetId: string | null = null;

      // Exact match
      if (nodeIds.has(link.target)) {
        targetId = link.target;
      } else {
        // Fuzzy: find node whose id contains target or vice versa
        for (const nid of nodeIds) {
          if (nid.includes(link.target) || link.target.includes(nid)) {
            targetId = nid;
            break;
          }
        }
      }

      if (targetId && targetId !== link.source) {
        resolvedLinks.push({ source: link.source, target: targetId });
      }
    }

    // Deduplicate: treat A→B and B→A as same, keep only one
    const seen = new Set<string>();
    const uniqueLinks: GraphLink[] = [];
    for (const link of resolvedLinks) {
      const key = [link.source, link.target].sort().join("↔");
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueLinks.push(link);
    }

    // Count connections per node
    const connectionCount = new Map<string, number>();
    for (const link of uniqueLinks) {
      connectionCount.set(link.source, (connectionCount.get(link.source) ?? 0) + 1);
      connectionCount.set(link.target, (connectionCount.get(link.target) ?? 0) + 1);
    }

    // Update node connection counts
    for (const node of nodes) {
      node.connections = connectionCount.get(node.id) ?? 0;
    }

    return NextResponse.json({
      nodes,
      links: uniqueLinks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
