import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { getDataPaths } from "@/lib/config";

export async function GET() {
  try {
    const { wikiPath, rawPath } = getDataPaths();
    const stats = { sources: 0, concepts: 0, outputs: 0, rawFiles: 0, totalWords: 0, recentArticles: [] as Array<{ title: string; path: string; updated: string; type: string }> };

    // Count raw files
    try {
      const rawFiles = await readdir(rawPath);
      stats.rawFiles = rawFiles.filter((f) => f.endsWith(".md")).length;
    } catch { /* */ }

    // Count wiki articles and gather recent
    const allArticles: Array<{ title: string; path: string; updated: string; type: string; mtime: number }> = [];

    for (const dir of ["sources", "concepts", "outputs"]) {
      const dirPath = join(wikiPath, dir);
      let files: string[];
      try { files = await readdir(dirPath); } catch { continue; }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        if (dir === "sources") stats.sources++;
        else if (dir === "concepts") stats.concepts++;
        else stats.outputs++;

        const fp = join(dirPath, file);
        const content = await readFile(fp, "utf-8");
        const titleMatch = content.match(/title:\s*"([^"]+)"/);
        const typeMatch = content.match(/type:\s*"([^"]+)"/);
        const fstat = await stat(fp);
        stats.totalWords += content.split(/\s+/).length;

        allArticles.push({
          title: titleMatch?.[1] ?? file.replace(".md", ""),
          path: `${dir}/${file}`,
          updated: fstat.mtime.toISOString().split("T")[0],
          type: typeMatch?.[1] ?? dir,
          mtime: fstat.mtime.getTime(),
        });
      }
    }

    allArticles.sort((a, b) => b.mtime - a.mtime);
    stats.recentArticles = allArticles.slice(0, 8).map(({ mtime, ...rest }) => rest);

    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
