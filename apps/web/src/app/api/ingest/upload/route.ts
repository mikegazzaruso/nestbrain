import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ingest } from "@mindnest/core";
import type { SourceType } from "@mindnest/shared";
import { getDataPaths } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const skipDuplicateCheck = formData.get("skipDuplicateCheck") === "true";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const { rawPath } = getDataPaths();

    // Check for duplicate by filename
    if (!skipDuplicateCheck) {
      try {
        const files = await readdir(rawPath);
        for (const f of files) {
          if (!f.endsWith(".md")) continue;
          const content = await readFile(join(rawPath, f), "utf-8");
          const sourceUrlMatch = content.match(/sourceUrl:\s*"([^"]+)"/);
          const srcValue = sourceUrlMatch?.[1] ?? "";
          if (srcValue.endsWith(file.name)) {
            const titleMatch = content.match(/title:\s*"([^"]+)"/);
            return NextResponse.json({
              duplicate: true,
              existingTitle: titleMatch?.[1] ?? f.replace(".md", ""),
              existingFile: f,
            });
          }
        }
      } catch { /* rawPath might not exist yet */ }
    }

    // Save uploaded file to a temp location, then ingest it
    const uploadsDir = join(rawPath, "_uploads");
    await mkdir(uploadsDir, { recursive: true });

    const tempPath = join(uploadsDir, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempPath, buffer);

    // Determine type from extension
    let type: SourceType | undefined;
    if (file.name.endsWith(".pdf")) type = "pdf";
    else if (file.name.endsWith(".md") || file.name.endsWith(".markdown")) type = "markdown";

    const result = await ingest({ source: tempPath, type, rawPath });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
