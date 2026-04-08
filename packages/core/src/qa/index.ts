import type { QAResponse } from "@mindnest/shared";

export interface AskOptions {
  question: string;
  save?: boolean;
}

export async function ask(_options: AskOptions): Promise<QAResponse> {
  // TODO: Phase 1 implementation
  throw new Error("Not implemented");
}
