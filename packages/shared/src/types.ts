// ============================================================
// MindNest — Shared Types
// ============================================================

/** Supported raw source types */
export type SourceType =
  | "url"
  | "pdf"
  | "markdown"
  | "github"
  | "arxiv"
  | "rss"
  | "youtube";

/** YAML frontmatter for raw ingested sources */
export interface RawSourceMeta {
  id: string;
  title: string;
  sourceType: SourceType;
  sourceUrl?: string;
  filePath: string;
  ingestedAt: string;
  tags: string[];
  checksum: string;
}

/** YAML frontmatter for compiled wiki articles */
export interface WikiArticleMeta {
  id: string;
  title: string;
  created: string;
  updated: string;
  source?: string;
  type: "concept" | "source-summary" | "qa-output" | "lint-report";
  tags: string[];
  backlinks: string[];
  summary: string;
}

/** LLM provider configuration */
export type LLMProvider = "claude-cli" | "openai" | "ollama";

/** MindNest configuration (mindnest.yaml) */
export interface MindNestConfig {
  wiki: {
    name: string;
    path: string;
    rawPath: string;
  };
  llm: {
    provider: LLMProvider;
    model: string;
    maxTurns: number;
    apiKey?: string;
  };
  embeddings: {
    model: string;
    chunkSize: number;
    chunkOverlap: number;
  };
  search: {
    semanticTopK: number;
    fulltextEnabled: boolean;
  };
  server: {
    port: number;
    host: string;
  };
}

/** Search result */
export interface SearchResult {
  articleId: string;
  title: string;
  snippet: string;
  score: number;
  filePath: string;
}

/** Q&A response */
export interface QAResponse {
  answer: string;
  citations: string[];
  savedTo?: string;
}

/** Lint finding */
export interface LintFinding {
  severity: "info" | "warning" | "error";
  category: "inconsistency" | "orphan" | "gap" | "missing-data";
  message: string;
  filePath?: string;
}

/** Compilation result */
export interface CompileResult {
  articlesCreated: number;
  articlesUpdated: number;
  conceptsExtracted: number;
  duration: number;
}
