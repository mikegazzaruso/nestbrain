import { NextRequest, NextResponse } from "next/server";
import { compile } from "@mindnest/core";
import { getDataPaths } from "@/lib/config";
import { getLLM } from "@/lib/llm";
import { getCompileState, setCompileState } from "@/lib/compile-state";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const current = getCompileState();

  if (current.status === "compiling") {
    return NextResponse.json({
      error: "Compilation already in progress",
      ...current,
    }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const { force } = body;
  const { rawPath, wikiPath } = getDataPaths();
  const llm = await getLLM();

  setCompileState({
    status: "compiling",
    message: "Starting...",
    phase: "Initializing",
    startedAt: Date.now(),
    finishedAt: null,
  });

  compile({
    force,
    rawPath,
    wikiPath,
    llm,
    onProgress: (phase, detail) => {
      setCompileState({
        phase: `${phase}: ${detail}`,
        message: `${phase}: ${detail}`,
      });
    },
  })
    .then((result) => {
      setCompileState({
        status: "success",
        phase: "Done",
        message: `${result.articlesCreated} created, ${result.articlesUpdated} updated, ${result.conceptsExtracted} concepts (${Math.round(result.duration / 1000)}s)`,
        finishedAt: Date.now(),
      });
    })
    .catch((err) => {
      setCompileState({
        status: "error",
        phase: "Error",
        message: err instanceof Error ? err.message : "Unknown error",
        finishedAt: Date.now(),
      });
    });

  return NextResponse.json({ started: true });
}
