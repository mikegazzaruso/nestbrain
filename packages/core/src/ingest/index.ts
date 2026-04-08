export interface IngestOptions {
  source: string;
  type?: string;
}

export interface IngestResult {
  filePath: string;
  title: string;
  sourceType: string;
}

export async function ingest(_options: IngestOptions): Promise<IngestResult> {
  // TODO: Phase 1 implementation
  throw new Error("Not implemented");
}
