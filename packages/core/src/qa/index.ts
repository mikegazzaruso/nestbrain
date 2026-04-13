import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { QAResponse } from "@nestbrain/shared";
import { WIKI_DIRS } from "@nestbrain/shared";
import type { LLMProviderInterface } from "../llm/provider";
import { PROMPTS } from "../llm/prompts";
import { search } from "../search";
import { slugify, nowISO, buildFrontmatter, generateId } from "../ingest/utils";

export interface AskOptions {
  question: string;
  save?: boolean;
  wikiPath?: string;
  llm: LLMProviderInterface;
  topK?: number;
}

export async function ask(options: AskOptions): Promise<QAResponse> {
  const wikiPath = resolve(options.wikiPath ?? "./data/wiki");
  const topK = options.topK ?? 8;

  // Semantic search for relevant articles
  const results = await search({ query: options.question, limit: topK, wikiPath });

  // Load article contents
  const articles: string[] = [];
  const citations: string[] = [];

  for (const result of results) {
    try {
      const content = await readFile(join(wikiPath, result.filePath), "utf-8");
      // Strip frontmatter, keep body
      const body = content.replace(/^---[\s\S]*?---\n*/, "").trim();
      articles.push(`--- ${result.title} (score: ${result.score.toFixed(2)}) ---\n${body}`);
      citations.push(`[[${result.filePath.replace(".md", "")}|${result.title}]]`);
    } catch {
      // skip
    }
  }

  const context = articles.length > 0
    ? `Here are ${articles.length} relevant articles from the knowledge base (ranked by semantic relevance):\n\n${articles.join("\n\n")}`
    : "No relevant articles found in the knowledge base for this question.";

  const response = await options.llm.ask(
    `${context}\n\nQuestion: ${options.question}`,
    PROMPTS.answerQuestion,
  );

  // Filter citations to only those actually referenced in the answer
  const answerLower = response.text.toLowerCase();
  const usedCitations = citations.filter((c) => {
    // Extract title from [[path|title]]
    const inner = c.replace(/^\[\[|\]\]$/g, "");
    const title = (inner.split("|")[1] ?? inner.split("/").pop() ?? "").toLowerCase();
    // Check if the title (or significant words from it) appear in the answer
    const words = title.split(/\s+/).filter((w) => w.length > 3);
    return words.some((w) => answerLower.includes(w));
  });

  let savedTo: string | undefined;

  if (options.save) {
    const outputsDir = join(wikiPath, WIKI_DIRS.outputs);
    await mkdir(outputsDir, { recursive: true });

    const id = generateId();
    const slug = slugify(options.question.slice(0, 60));
    const fileName = `${slug}-${id}.md`;
    const filePath = join(outputsDir, fileName);

    const frontmatter = buildFrontmatter({
      title: options.question,
      created: nowISO(),
      updated: nowISO(),
      type: "qa-output",
      tags: ["qa"],
      backlinks: citations,
      summary: `Answer to: ${options.question.slice(0, 100)}`,
    });

    const content = `${frontmatter}\n\n# ${options.question}\n\n${response.text}\n\n## Sources\n\n${citations.map((c) => `- ${c}`).join("\n")}\n`;
    await writeFile(filePath, content, "utf-8");
    savedTo = `${WIKI_DIRS.outputs}/${fileName}`;
  }

  return { answer: response.text, citations: usedCitations.length > 0 ? usedCitations : citations.slice(0, 3), savedTo };
}
