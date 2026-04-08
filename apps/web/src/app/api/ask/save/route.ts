import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getDataPaths } from "@/lib/config";

export async function POST(request: NextRequest) {
  try {
    const { question, answer, citations } = await request.json();

    if (!question || !answer) {
      return NextResponse.json({ error: "question and answer required" }, { status: 400 });
    }

    const { wikiPath } = getDataPaths();
    const outputsDir = join(resolve(wikiPath), "outputs");
    await mkdir(outputsDir, { recursive: true });

    const id = Math.random().toString(36).slice(2, 10);
    const slug = question.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const fileName = `${slug}-${id}.md`;
    const now = new Date().toISOString().split("T")[0];

    const frontmatter = [
      "---",
      `title: "${question}"`,
      `created: "${now}"`,
      `updated: "${now}"`,
      `type: "qa-output"`,
      `tags: ["qa"]`,
      `summary: "Answer to: ${question.slice(0, 100)}"`,
      "---",
    ].join("\n");

    const citationsList = (citations ?? []).map((c: string) => `- ${c}`).join("\n");
    const content = `${frontmatter}\n\n# ${question}\n\n${answer}\n\n## Sources\n\n${citationsList || "_No citations_"}\n`;

    await writeFile(join(outputsDir, fileName), content, "utf-8");

    return NextResponse.json({ savedTo: `outputs/${fileName}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
