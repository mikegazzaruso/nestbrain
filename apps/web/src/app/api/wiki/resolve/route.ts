import { NextRequest, NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { getDataPaths } from "@/lib/config";

// Resolve a wikilink name to its actual file path
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json({ error: "name parameter required" }, { status: 400 });
    }

    const { wikiPath } = getDataPaths();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // Search in all wiki dirs
    for (const dir of ["sources", "concepts", "outputs"]) {
      const dirPath = join(wikiPath, dir);
      try {
        const files = await readdir(dirPath);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const fileSlug = basename(file, ".md").toLowerCase();
          if (fileSlug === slug || fileSlug.startsWith(slug) || fileSlug.includes(slug)) {
            return NextResponse.json({ path: `${dir}/${file}` });
          }
        }
      } catch {
        continue;
      }
    }

    // Also check root level files
    const rootFiles = await readdir(wikiPath);
    for (const file of rootFiles) {
      if (!file.endsWith(".md")) continue;
      const fileSlug = basename(file, ".md").toLowerCase();
      if (fileSlug === slug || fileSlug.includes(slug)) {
        return NextResponse.json({ path: file });
      }
    }

    return NextResponse.json({ path: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
