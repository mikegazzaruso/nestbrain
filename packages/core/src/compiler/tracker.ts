import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeChecksum } from "../ingest/utils";

interface TrackerEntry {
  filePath: string;
  checksum: string;
  compiledAt: string;
}

interface TrackerData {
  sources: Record<string, TrackerEntry>;
}

const TRACKER_FILE = ".compile-tracker.json";

export async function loadTracker(wikiPath: string): Promise<TrackerData> {
  try {
    const raw = await readFile(join(wikiPath, TRACKER_FILE), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { sources: {} };
  }
}

export async function saveTracker(
  wikiPath: string,
  data: TrackerData,
): Promise<void> {
  await writeFile(
    join(wikiPath, TRACKER_FILE),
    JSON.stringify(data, null, 2),
    "utf-8",
  );
}

export async function hasChanged(
  filePath: string,
  tracker: TrackerData,
): Promise<boolean> {
  const existing = tracker.sources[filePath];
  if (!existing) return true;

  try {
    const currentChecksum = await computeChecksum(filePath);
    return currentChecksum !== existing.checksum;
  } catch {
    return true;
  }
}

export async function markCompiled(
  filePath: string,
  tracker: TrackerData,
): Promise<void> {
  const checksum = await computeChecksum(filePath);
  tracker.sources[filePath] = {
    filePath,
    checksum,
    compiledAt: new Date().toISOString(),
  };
}
