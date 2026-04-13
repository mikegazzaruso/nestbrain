import { readFile, readdir } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import type { SearchResult } from "@nestbrain/shared";
import { WIKI_DIRS } from "@nestbrain/shared";
import { VectorStore } from "../vectorstore";

export interface SearchOptions {
  query: string;
  limit?: number;
  wikiPath?: string;
}

// Hybrid search weights
const SEMANTIC_WEIGHT = 0.7;
const KEYWORD_WEIGHT = 0.3;

function normalizeScores(
  results: SearchResult[],
): Map<string, { result: SearchResult; normalized: number }> {
  const out = new Map<string, { result: SearchResult; normalized: number }>();
  if (results.length === 0) return out;
  const maxScore = Math.max(...results.map((r) => r.score));
  if (maxScore <= 0) return out;
  for (const r of results) {
    out.set(r.articleId, { result: r, normalized: r.score / maxScore });
  }
  return out;
}

export async function search(options: SearchOptions): Promise<SearchResult[]> {
  const wikiPath = resolve(options.wikiPath ?? "./data/wiki");
  const limit = options.limit ?? 10;

  // Fetch a wider candidate set so the final ranking can pick from more sources
  const candidateLimit = Math.max(limit * 3, 20);

  const [semanticResultsRaw, keywordResultsRaw] = await Promise.all([
    semanticSearch(options.query, wikiPath, candidateLimit),
    keywordSearch(options.query, wikiPath, candidateLimit),
  ]);

  // Normalize each score set to [0, 1] so the two channels are comparable.
  // Without normalization, keyword scores (raw count-based, can reach 10+)
  // dominate semantic cosine scores (bounded at 1.0), effectively making the
  // final ranking keyword-only.
  const semanticN = normalizeScores(semanticResultsRaw);
  const keywordN = normalizeScores(keywordResultsRaw);

  const ids = new Set<string>([...semanticN.keys(), ...keywordN.keys()]);
  const merged: SearchResult[] = [];
  for (const id of ids) {
    const s = semanticN.get(id);
    const k = keywordN.get(id);
    const result = s?.result ?? k!.result;
    const combined =
      (s?.normalized ?? 0) * SEMANTIC_WEIGHT +
      (k?.normalized ?? 0) * KEYWORD_WEIGHT;
    merged.push({ ...result, score: combined });
  }

  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, limit);
}

async function semanticSearch(query: string, wikiPath: string, limit: number): Promise<SearchResult[]> {
  try {
    const vectorStore = new VectorStore(wikiPath);
    const count = await vectorStore.count();
    if (count === 0) return [];

    const results = await vectorStore.search(query, limit);
    return results.map((r) => ({
      articleId: r.id,
      title: r.title,
      snippet: r.snippet.slice(0, 200),
      score: r.score,
      filePath: r.filePath,
    }));
  } catch {
    return [];
  }
}

async function keywordSearch(query: string, wikiPath: string, limit: number): Promise<SearchResult[]> {
  // Extract meaningful terms (drop stop words, short words)
  const stopWords = new Set(["a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might",
    "shall", "can", "need", "dare", "ought", "used", "to", "of", "in", "for", "on", "with", "at",
    "by", "from", "as", "into", "through", "during", "before", "after", "above", "below", "between",
    "out", "off", "over", "under", "again", "further", "then", "once", "here", "there", "when",
    "where", "why", "how", "all", "both", "each", "few", "more", "most", "other", "some", "such",
    "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "because",
    "but", "and", "or", "if", "while", "about", "what", "which", "who", "whom", "this", "that",
    "these", "those", "am", "it", "its", "i", "me", "my", "we", "our", "you", "your", "he", "him",
    "his", "she", "her", "they", "them", "their",
    // Italian common
    "un", "una", "il", "lo", "la", "le", "gli", "di", "del", "della", "dei", "delle", "da",
    "dal", "dalla", "in", "nel", "nella", "con", "su", "per", "tra", "fra", "che", "chi",
    "come", "cosa", "cos", "è", "sono", "era", "essere", "non", "mi", "ti", "si", "ci", "vi",
    "lo", "li", "ne", "se", "ma", "anche", "più", "molto", "questo", "quello", "suo", "mio",
    "tuo", "ad", "ed", "spiega", "spiegami", "dimmi", "parlami", "descrivi", "bambino", "anni",
  ]);

  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stopWords.has(t));

  if (queryTerms.length === 0) return [];

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
      const fileSlug = basename(file, ".md").toLowerCase();

      let score = 0;

      // Title match (high weight)
      const titleMatch = content.match(/title:\s*"([^"]+)"/);
      const title = titleMatch?.[1] ?? basename(file, ".md");
      const titleLower = title.toLowerCase();

      for (const term of queryTerms) {
        // Title match: 5 points
        if (titleLower.includes(term)) score += 5;
        // Filename match: 3 points
        if (fileSlug.includes(term)) score += 3;
        // Content match: 1 point per occurrence (capped)
        const count = (contentLower.match(new RegExp(term, "g")) || []).length;
        score += Math.min(count, 5);
      }

      if (score === 0) continue;

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
