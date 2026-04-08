import type { SearchResult } from "@mindnest/shared";

export interface SearchOptions {
  query: string;
  limit?: number;
}

export async function search(_options: SearchOptions): Promise<SearchResult[]> {
  // TODO: Phase 1 implementation
  throw new Error("Not implemented");
}
