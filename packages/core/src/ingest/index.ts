import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { detectSourceType } from "./utils";
import { ingestUrl } from "./url";
import { ingestMarkdown } from "./markdown";
import { ingestPdf } from "./pdf";
import type { SourceType } from "@mindnest/shared";

export interface IngestOptions {
  source: string;
  type?: SourceType;
  rawPath?: string;
}

export interface IngestResult {
  filePath: string;
  title: string;
  sourceType: string;
}

export async function ingest(options: IngestOptions): Promise<IngestResult> {
  const rawPath = resolve(options.rawPath ?? "./data/raw");
  await mkdir(rawPath, { recursive: true });

  const sourceType = options.type ?? detectSourceType(options.source);

  switch (sourceType) {
    case "url":
      return ingestUrl(options.source, rawPath);

    case "markdown":
      return ingestMarkdown(options.source, rawPath);

    case "pdf":
      return ingestPdf(options.source, rawPath);

    case "github":
    case "arxiv":
    case "youtube":
    case "rss":
      // Phase 2
      throw new Error(`${sourceType} ingestion not yet implemented (Phase 2)`);

    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
}
