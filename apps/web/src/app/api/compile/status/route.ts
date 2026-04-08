import { NextResponse } from "next/server";
import { getCompileState } from "@/lib/compile-state";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getCompileState());
}
