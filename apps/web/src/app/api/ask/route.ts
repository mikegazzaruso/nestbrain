import { NextRequest, NextResponse } from "next/server";
import { ask } from "@nestbrain/core";
import { getDataPaths } from "@/lib/config";
import { getLLM } from "@/lib/llm";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { question, save } = body;

    if (!question) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const { wikiPath } = getDataPaths();
    const llm = await getLLM();

    const result = await ask({ question, save, wikiPath, llm });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
