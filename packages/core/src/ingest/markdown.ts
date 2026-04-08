import { readFile, writeFile, copyFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { generateId, slugify, buildFrontmatter, nowISO, computeChecksum } from "./utils";
import type { IngestResult } from "./index";

export async function ingestMarkdown(
  sourcePath: string,
  rawPath: string,
): Promise<IngestResult> {
  const content = await readFile(sourcePath, "utf-8");

  // Extract title from first heading or filename
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1] ?? basename(sourcePath, ".md");

  const id = generateId();
  const slug = slugify(title);
  const fileName = `${slug}-${id}.md`;
  const filePath = join(rawPath, fileName);

  // Check if content already has frontmatter
  const hasFrontmatter = content.startsWith("---");

  let finalContent: string;
  if (hasFrontmatter) {
    // Copy as-is, we'll update the frontmatter
    finalContent = content;
  } else {
    const checksum = await computeChecksum(sourcePath);
    const frontmatter = buildFrontmatter({
      id,
      title,
      sourceType: "markdown",
      sourcePath: sourcePath,
      ingestedAt: nowISO(),
      tags: [],
      checksum,
    });
    finalContent = `${frontmatter}\n\n${content}`;
  }

  await writeFile(filePath, finalContent, "utf-8");

  return {
    filePath: fileName,
    title,
    sourceType: "markdown",
  };
}
