// ============================================================
// NestBrain — Shared Types
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

/** NestBrain configuration (nestbrain.yaml) */
export interface NestBrainConfig {
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
  /** Projects this article is attributed to (when available). */
  projects?: string[];
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

// ============================================================
// Auth & Sync
// ============================================================

/** Identity returned by Google's userinfo endpoint. */
export interface GoogleUser {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/** Auth state pushed from desktop main → renderer. */
export type AuthState =
  | { status: "signed-out" }
  | { status: "signing-in" }
  | { status: "signed-in"; user: GoogleUser }
  | { status: "error"; error: string }
  /** Source build with placeholder OAuth credentials — Drive sync can't work;
   *  the UI shows a disabled control instead of a sign-in that would fail. */
  | { status: "unconfigured" };

/**
 * Sync preferences. Stored per-device — they describe how *this* machine
 * should behave. The vault on Drive is global to the account.
 */
export interface SyncPreferences {
  /** Master toggle. If false, the engine stays idle even when signed in. */
  enabled: boolean;
  /** Whether Projects/ is included in the sync set. */
  includeProjects: boolean;
  /** Soft limit; files larger than this are skipped with a notification. */
  maxFileSizeBytes: number;
  /** Days after which .trash/ entries auto-purge. 0 = never. */
  trashRetentionDays: number;
}

export type SyncStatus =
  | "disabled"      // sync is off (toggle off OR not signed in)
  | "idle"          // sync is on but nothing happening right now
  | "scanning"      // walking the workspace, computing diff
  | "syncing"       // actively uploading/downloading files
  | "error";        // last cycle failed; see SyncState.error

export interface SyncProgress {
  /** Files queued in the current sync cycle. */
  total: number;
  /** Files successfully processed so far. */
  done: number;
  /** Files skipped because of size, exclude rules, etc. */
  skipped: number;
  /** Filename being processed right now (relative to workspace root). */
  currentFile?: string;
  /** Bytes uploaded so far in the current file (resumable upload). */
  bytesUploaded?: number;
  /** Total bytes of the current file. */
  bytesTotal?: number;
}

/** Pushed from desktop main → renderer on every state change. */
export interface SyncState {
  status: SyncStatus;
  prefs: SyncPreferences;
  /** ms-epoch of the last successful sync, if any. */
  lastSyncAt?: number;
  /** Most recent error message; cleared on next successful sync. */
  error?: string;
  /** Populated while status is "scanning" or "syncing". */
  progress?: SyncProgress;
}

export const DEFAULT_SYNC_PREFS: SyncPreferences = {
  enabled: false,
  includeProjects: false,
  maxFileSizeBytes: 100 * 1024 * 1024, // 100 MB
  trashRetentionDays: 30,
};
