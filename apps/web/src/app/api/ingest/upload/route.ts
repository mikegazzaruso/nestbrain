import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ingest } from "@mindnest/core";
import type { SourceType } from "@mindnest/shared";
import { getDataPaths } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const { rawPath } = getDataPaths();

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
