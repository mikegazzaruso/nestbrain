import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { getDataPaths } from "@/lib/config";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name");

    if (!name) {
      return NextResponse.json({ error: "name parameter required" }, { status: 400 });
    }

    const { wikiPath } = getDataPaths();

    // Handle paths like "concepts/something" — strip the directory prefix
    const cleanName = name.includes("/") ? name.split("/").pop()! : name;
    const slug = slugify(cleanName);

    // Also prepare a title-based match (for [[Large Language Model]] style links)
    const titleLower = cleanName.toLowerCase().trim();

    // Search in all wiki dirs, collect candidates with match quality
    const candidates: Array<{ path: string; score: number }> = [];

    for (const dir of ["concepts", "sources", "outputs"]) {
      const dirPath = join(wikiPath, dir);
      let files: string[];
      try {
        files = await readdir(dirPath);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const fileSlug = basename(file, ".md").toLowerCase();
        const filePath = `${dir}/${file}`;

        // Exact slug match
        if (fileSlug === slug) {
          return NextResponse.json({ path: filePath });
        }

        // Check title match from frontmatter
        const content = await readFile(join(dirPath, file), "utf-8");
        const titleMatch = content.match(/title:\s*"([^"]+)"/);
        const fileTitle = titleMatch?.[1]?.toLowerCase() ?? "";

        // Exact title match
        if (fileTitle === titleLower) {
          return NextResponse.json({ path: filePath });
        }

        // Slug starts with search slug (e.g. "large-language-model" matches "large-language-model-llm")
        if (fileSlug.startsWith(slug) && slug.length > 3) {
          candidates.push({ path: filePath, score: 10 });
        }

        // Title contains search term
        if (fileTitle.includes(titleLower) && titleLower.length > 3) {
          candidates.push({ path: filePath, score: 8 });
        }

        // Slug contains search slug
        if (fileSlug.includes(slug) && slug.length > 5) {
          candidates.push({ path: filePath, score: 5 });
        }
      }
    }

    // Return best candidate
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      return NextResponse.json({ path: candidates[0].path });
    }

    return NextResponse.json({ path: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
