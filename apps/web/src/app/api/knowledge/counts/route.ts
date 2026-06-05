import { NextResponse } from "next/server";
import { countAcceptedUncompiled, listPending } from "@nestbrain/core";
import { getDataPaths, getWorkspacePath } from "@/lib/config";

export async function GET() {
  try {
    const workspace = getWorkspacePath();
    const { wikiPath } = getDataPaths();
    const [pending, acceptedUncompiled] = await Promise.all([
      listPending(workspace).then((e) => e.length),
      countAcceptedUncompiled(workspace, wikiPath),
    ]);
    return NextResponse.json({ pending, acceptedUncompiled });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
