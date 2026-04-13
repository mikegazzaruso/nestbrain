import { NextRequest, NextResponse } from "next/server";
import { getLLM } from "@/lib/llm";
import { PROMPTS } from "@nestbrain/core";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { content, language } = await request.json();

    if (!content || !language) {
      return NextResponse.json({ error: "content and language required" }, { status: 400 });
    }

    const llm = await getLLM();
    const response = await llm.ask(
      `Translate the following article to ${language}:\n\n${content}`,
      PROMPTS.translate,
    );

    return NextResponse.json({ translated: response.text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
