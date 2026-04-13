import { NextRequest, NextResponse } from "next/server";
import { search } from "@nestbrain/core";
import { getDataPaths } from "@/lib/config";
import { ensureNativeLoadersRegistered } from "@/lib/native-loader";

ensureNativeLoadersRegistered();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const limit = parseInt(searchParams.get("limit") ?? "10");

    if (!query) {
      return NextResponse.json({ error: "q parameter is required" }, { status: 400 });
    }

    const { wikiPath } = getDataPaths();
    const results = await search({ query, limit, wikiPath });

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
