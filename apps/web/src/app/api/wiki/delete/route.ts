import { NextRequest, NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getDataPaths } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    const { path } = await request.json();

    if (!path || !path.startsWith("outputs/")) {
      return NextResponse.json({ error: "Can only delete output files" }, { status: 400 });
    }

    const { wikiPath } = getDataPaths();
    await unlink(join(resolve(wikiPath), path));

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
