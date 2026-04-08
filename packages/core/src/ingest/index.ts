import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { detectSourceType } from "./utils";
import { ingestUrl } from "./url";
import { ingestMarkdown } from "./markdown";
import { ingestPdf } from "./pdf";
import { ingestGithub } from "./github";
import { ingestArxiv } from "./arxiv";
import { ingestYoutube } from "./youtube";
import { ingestRss } from "./rss";
import type { SourceType } from "@mindnest/shared";

export interface IngestOptions {
  source: string;
  type?: SourceType;
  rawPath?: string;
  maxItems?: number; // for RSS feeds
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
      return ingestGithub(options.source, rawPath);
    case "arxiv":
      return ingestArxiv(options.source, rawPath);
    case "youtube":
      return ingestYoutube(options.source, rawPath);
    case "rss":
      // RSS returns multiple results, we return the first and the rest are also saved
      const results = await ingestRss(options.source, rawPath, options.maxItems ?? 10);
      if (results.length === 0) throw new Error("No items in RSS feed");
      return results[0];
    default:
      throw new Error(`Unknown source type: ${sourceType}`);
  }
}

/** Bulk ingest: returns results for all sources */
export async function ingestBulk(
  sources: Array<{ source: string; type?: SourceType }>,
  rawPath?: string,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const src of sources) {
    try {
      const result = await ingest({ source: src.source, type: src.type, rawPath });
      results.push(result);
    } catch (error) {
      results.push({
        filePath: "",
        title: src.source,
        sourceType: `error: ${error instanceof Error ? error.message : "unknown"}`,
      });
    }
  }
  return results;
}

// Re-export RSS for direct use
export { ingestRss } from "./rss";
