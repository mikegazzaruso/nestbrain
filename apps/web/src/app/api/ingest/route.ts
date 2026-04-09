import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ingest } from "@mindnest/core";
import { getDataPaths } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { source, type, skipDuplicateCheck } = body;

    if (!source) {
      return NextResponse.json({ error: "source is required" }, { status: 400 });
    }

    const { rawPath } = getDataPaths();

    // Check for duplicate source unless explicitly skipped
    if (!skipDuplicateCheck) {
      try {
        const files = await readdir(rawPath);
        const srcTrimmed = source.trim();
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const content = await readFile(join(rawPath, file), "utf-8");
          const sourceUrlMatch = content.match(/sourceUrl:\s*"([^"]+)"/);
          if (sourceUrlMatch?.[1] === srcTrimmed) {
            const titleMatch = content.match(/title:\s*"([^"]+)"/);
            return NextResponse.json({
              duplicate: true,
              existingTitle: titleMatch?.[1] ?? file.replace(".md", ""),
              existingFile: file,
            });
          }
        }
      } catch { /* rawPath might not exist yet */ }
    }

    const result = await ingest({ source, type, rawPath });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: list all ingested sources
export async function GET() {
  try {
    const { rawPath } = getDataPaths();
    const files = await readdir(rawPath);
    const sources: Array<{
      fileName: string;
      title: string;
      sourceType: string;
      ingestedAt: string;
    }> = [];

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await readFile(join(rawPath, file), "utf-8");
      const titleMatch = content.match(/title:\s*"([^"]+)"/);
      const typeMatch = content.match(/sourceType:\s*"([^"]+)"/);
      const dateMatch = content.match(/ingestedAt:\s*"([^"]+)"/);
      sources.push({
        fileName: file,
        title: titleMatch?.[1] ?? file.replace(".md", ""),
        sourceType: typeMatch?.[1] ?? "unknown",
        ingestedAt: dateMatch?.[1] ?? "",
      });
    }

    return NextResponse.json({ sources });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
