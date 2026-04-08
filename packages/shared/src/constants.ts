// ============================================================
// MindNest — Constants
// ============================================================

export const DEFAULT_CONFIG = {
  wiki: {
    name: "My Knowledge Base",
    path: "./data/wiki",
    rawPath: "./data/raw",
  },
  llm: {
    provider: "claude-cli" as const,
    model: "sonnet",
    maxTurns: 5,
  },
  embeddings: {
    model: "Xenova/all-MiniLM-L6-v2",
    chunkSize: 512,
    chunkOverlap: 50,
  },
  search: {
    semanticTopK: 10,
    fulltextEnabled: true,
  },
  server: {
    port: 3000,
    host: "localhost",
  },
} as const;

export const WIKI_DIRS = {
  sources: "sources",
  concepts: "concepts",
  outputs: "outputs",
} as const;

export const INDEX_FILES = {
  master: "_index.md",
  concepts: "_concepts.md",
} as const;
