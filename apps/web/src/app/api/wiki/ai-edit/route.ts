import { NextRequest, NextResponse } from "next/server";
import { getLLM } from "@/lib/llm";
import { getWorkspacePath } from "@/lib/config";

export const maxDuration = 600;

const SYSTEM_PROMPT = `You are a knowledge-base editor. You are given the current Markdown of ONE wiki article and an instruction describing what to fix or improve. Produce a corrected version of the WHOLE article.

You may use your tools to ground the edit in reality before writing:
- Read / Grep / Glob to inspect the user's local projects in the workspace you are running in.
- WebSearch / WebFetch to consult external sources (e.g. a GitHub repository) when the instruction asks you to.
- Bash for read-only inspection (ls, cat, git log) when helpful.

Rules for the result:
- Keep the YAML frontmatter block (between --- fences) and update fields like \`updated\` and \`tags\` if appropriate, but preserve \`title\`, \`created\`, and \`source\`.
- Preserve the article's structure and [[wikilinks]] style (Obsidian-compatible Markdown).
- Fix the actual content so it is accurate and well-scoped per the instruction. Do not merely reword.
- Write in the same language as the existing article.

CRITICAL OUTPUT FORMAT — READ CAREFULLY:
- The VERY FIRST characters of your reply MUST be the \`---\` that opens the YAML frontmatter.
- Do NOT narrate your process, findings, plan, or reasoning. Never write a sentence like "Now I understand the project" or "Let me write the corrected article".
- Output NOTHING before the frontmatter and NOTHING after the article body.
- Do NOT wrap the output in code fences.
Your reply is written verbatim to the .md file, so any stray prose corrupts it.`;

/**
 * Pull the clean article out of the model reply. Agentic models tend to
 * prepend narration ("Now I understand…") before the real Markdown, so we
 * drop everything before the first line that opens the YAML frontmatter (a
 * line that is exactly ---). Also strips an accidental wrapping code fence.
 */
function extractArticle(raw: string): string {
  let t = raw.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(t);
  if (fence) t = fence[1].trim();
  const fm = /(?:^|\n)---[ \t]*\r?\n/.exec(t);
  if (fm) {
    const start = fm.index + (t[fm.index] === "\n" ? 1 : 0);
    return t.slice(start).trim();
  }
  return t;
}

export async function POST(request: NextRequest) {
  try {
    const { path, content, instruction } = await request.json();
    if (typeof content !== "string" || typeof instruction !== "string" || !instruction.trim()) {
      return NextResponse.json({ error: "content and instruction required" }, { status: 400 });
    }

    const prompt = `Wiki article path: ${path ?? "(unknown)"}

=== CURRENT ARTICLE ===
${content}
=== END CURRENT ARTICLE ===

INSTRUCTION:
${instruction.trim()}

Now output the complete corrected article.`;

    const llm = await getLLM();
    const response = llm.agent
      ? await llm.agent(prompt, { systemPrompt: SYSTEM_PROMPT, cwd: getWorkspacePath(), maxTurns: 24 })
      : await llm.ask(prompt, SYSTEM_PROMPT);

    return NextResponse.json({ content: extractArticle(response.text) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
