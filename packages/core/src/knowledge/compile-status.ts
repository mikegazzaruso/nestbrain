// Compile-status helpers for the knowledge UI.
//
// The sidebar surfaces a "ready for compile" badge — the count of accepted
// atoms (under .nestbrain/raw/projects/**/) that the compile tracker has
// either never seen or whose content has drifted since the last compile.
// We reuse the existing tracker so this stays consistent with what the
// next `compile` invocation will actually pick up.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { computeChecksum } from "../ingest/utils";
import { hasChanged, loadTracker } from "../compiler/tracker";
import { queuePaths } from "./queue";

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walkMarkdown(full)));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Count accepted atoms (markdown files under `.nestbrain/raw/projects/`) that
 * haven't been compiled yet, or whose content drifted since the last compile.
 * `wikiPath` is where `.compile-tracker.json` lives — same value the compile
 * call uses.
 */
export async function countAcceptedUncompiled(
  workspacePath: string,
  wikiPath: string,
): Promise<number> {
  const { acceptedRoot } = queuePaths(workspacePath);
  const tracker = await loadTracker(wikiPath);
  const files = await walkMarkdown(acceptedRoot);
  let n = 0;
  for (const f of files) {
    if (await hasChanged(f, tracker)) n++;
  }
  return n;
}

export { computeChecksum };
