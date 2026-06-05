import { resolve } from "node:path";

/**
 * Reject any filePath that doesn't resolve into the workspace's
 * .nestbrain/knowledge-pending/ directory. Defends the accept/reject/update
 * routes against path-traversal where a malicious client could otherwise
 * point them at arbitrary files on disk.
 */
export function assertSafePendingPath(workspacePath: string, filePath: string): void {
  const pendingRoot = resolve(workspacePath, ".nestbrain", "knowledge-pending");
  const resolved = resolve(filePath);
  if (resolved !== pendingRoot && !resolved.startsWith(pendingRoot + "/")) {
    throw new Error("filePath must be inside .nestbrain/knowledge-pending/");
  }
}
