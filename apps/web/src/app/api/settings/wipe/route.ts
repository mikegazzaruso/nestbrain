import { NextRequest, NextResponse } from "next/server";
import { readdir, unlink, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getDataPaths } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    const { confirm } = await request.json();

    if (confirm !== "DELETE_EVERYTHING") {
      return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
    }

    const { rawPath, wikiPath } = getDataPaths();

    // Delete all files in raw/
    await clearDir(resolve(rawPath));
    await clearDir(join(resolve(rawPath), "assets"));
    await clearDir(join(resolve(rawPath), "_uploads"));

    // Delete all files in wiki/
    for (const dir of ["sources", "concepts", "outputs"]) {
      await clearDir(join(resolve(wikiPath), dir));
    }

    // Delete index files and tracker
    const rootFiles = ["_index.md", "_concepts.md", ".compile-tracker.json", "vector-index.json"];
    for (const f of rootFiles) {
      try { await unlink(join(resolve(wikiPath), f)); } catch { /* */ }
    }

    return NextResponse.json({ ok: true, message: "All data wiped" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function clearDir(dirPath: string) {
  try {
    const files = await readdir(dirPath);
    for (const file of files) {
      if (file === ".gitkeep") continue;
      try { await unlink(join(dirPath, file)); } catch { /* */ }
    }
  } catch { /* dir doesn't exist */ }
}
