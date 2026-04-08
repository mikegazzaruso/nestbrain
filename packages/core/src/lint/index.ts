import type { LintFinding } from "@mindnest/shared";

export interface LintOptions {
  fix?: boolean;
}

export async function lint(_options?: LintOptions): Promise<LintFinding[]> {
  // TODO: Phase 2 implementation
  throw new Error("Not implemented");
}
