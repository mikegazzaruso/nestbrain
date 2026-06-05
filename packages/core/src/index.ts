export { ingest, ingestBulk, ingestRss } from "./ingest";
export type { IngestOptions, IngestResult } from "./ingest";

export { compile } from "./compiler";
export type { CompileOptions, ProgressCallback } from "./compiler";

export { ask } from "./qa";
export type { AskOptions } from "./qa";

export { lint } from "./lint";
export type { LintOptions } from "./lint";

export { search } from "./search";
export type { SearchOptions } from "./search";

export type { LLMProviderInterface, LLMResponse } from "./llm";
export { createProvider } from "./llm";
export { PROMPTS } from "./llm";

export { VectorStore } from "./vectorstore";

export type {
  KnowledgeAtom,
  SourceRef,
  ExtractOptions,
  ExtractedCandidate,
  QueuePaths,
  PendingEntry,
  InstallHookOptions,
  HookStatus,
} from "./knowledge";
export {
  slugify,
  atomFilename,
  serializeAtom,
  parseAtom,
  extractFromCommit,
  readCommit,
  ensureQueueDirs,
  queuePaths,
  writePendingAtom,
  listPending,
  acceptAtom,
  rejectAtom,
  updatePendingAtom,
  installHook,
  uninstallHook,
  getHookStatus,
} from "./knowledge";

// Runtime loaders that must be registered by the consumer app.
// The app uses createRequire + /* turbopackIgnore */ to load these packages
// without Turbopack touching them (Turbopack's bundled externals break on
// ESM↔CJS interop for onnxruntime-common and pdfjs-dist).
export { registerTransformersLoader } from "./vectorstore/embedder";
export { registerPdfParseLoader } from "./ingest/pdf";
