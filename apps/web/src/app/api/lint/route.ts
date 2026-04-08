import { NextResponse } from "next/server";
import { lint } from "@mindnest/core";
import { getDataPaths } from "@/lib/config";
import { getLLM } from "@/lib/llm";

export const maxDuration = 300;

export async function POST() {
  try {
    const { wikiPath } = getDataPaths();
    let llm;
    try { llm = await getLLM(); } catch { /* no LLM available */ }
    const report = await lint({ wikiPath, llm });
    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
