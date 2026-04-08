import { readFile, readdir } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import type { SearchResult } from "@mindnest/shared";
import { WIKI_DIRS } from "@mindnest/shared";
import { VectorStore } from "../vectorstore";

export interface SearchOptions {
  query: string;
  limit?: number;
  wikiPath?: string;
}

export async function search(options: SearchOptions): Promise<SearchResult[]> {
  const wikiPath = resolve(options.wikiPath ?? "./data/wiki");
  const limit = options.limit ?? 10;

  // Try semantic search first
  const vectorStore = new VectorStore(wikiPath);
  const count = await vectorStore.count();

  if (count > 0) {
    const semanticResults = await vectorStore.search(options.query, limit);
    return semanticResults.map((r) => ({
      articleId: r.id,
      title: r.title,
      snippet: r.snippet.slice(0, 200),
      score: r.score,
      filePath: r.filePath,
    }));
  }

  // Fallback to keyword search if no vector index exists yet
  return keywordSearch(options.query, wikiPath, limit);
}

async function keywordSearch(query: string, wikiPath: string, limit: number): Promise<SearchResult[]> {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const results: SearchResult[] = [];

  for (const dir of [WIKI_DIRS.sources, WIKI_DIRS.concepts, WIKI_DIRS.outputs]) {
    const dirPath = join(wikiPath, dir);
    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = join(dirPath, file);
      const content = await readFile(filePath, "utf-8");
      const contentLower = content.toLowerCase();

      let score = 0;
      for (const term of queryTerms) {
        score += (contentLower.match(new RegExp(term, "g")) || []).length;
      }
      if (score === 0) continue;

      const titleMatch = content.match(/title:\s*"([^"]+)"/);
      const title = titleMatch?.[1] ?? basename(file, ".md");
      const body = content.replace(/^---[\s\S]*?---\n*/, "").trim();

      results.push({
        articleId: basename(file, ".md"),
        title,
        snippet: body.slice(0, 200),
        score,
        filePath: `${dir}/${file}`,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
