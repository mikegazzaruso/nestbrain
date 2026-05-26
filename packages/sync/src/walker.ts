// Async generator that yields every file under a root directory, skipping
// anything matched by the supplied predicate. Yields POSIX-style relative
// paths so the manifest is portable across mac/windows.

import { readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { WalkEntry } from "./types";

export async function* walk(
  rootPath: string,
  isExcluded: (relPath: string) => boolean,
): AsyncGenerator<WalkEntry> {
  yield* walkInner(rootPath, rootPath, isExcluded);
}

async function* walkInner(
  rootPath: string,
  dirPath: string,
  isExcluded: (relPath: string) => boolean,
): AsyncGenerator<WalkEntry> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    // Unreadable directory — skip silently.
    return;
  }

  for (const ent of entries) {
    const absPath = join(dirPath, ent.name);
    const rel = absPath.slice(rootPath.length + 1).split(sep).join("/");
    if (isExcluded(rel)) continue;

    if (ent.isDirectory()) {
      yield* walkInner(rootPath, absPath, isExcluded);
    } else if (ent.isFile()) {
      try {
        const s = await stat(absPath);
        yield {
          relPath: rel,
          absPath,
          size: s.size,
          mtime: s.mtimeMs,
        };
      } catch {
        // Unreadable file — skip.
      }
    }
  }
}
