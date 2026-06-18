// Starter API route for the dev-besidetech module. Runs inside the embedded
// Next server (same runtime as Anatomize's routes) — full Node access, the
// LLM provider via getLLM(), the workspace via getDataPaths(). Add your own
// routes alongside this one.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ pong: "dev-besidetech alive" });
}
