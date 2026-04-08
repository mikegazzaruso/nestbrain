import { writeFile, mkdir } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import TurndownService from "turndown";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { generateId, slugify, buildFrontmatter, nowISO } from "./utils";
import type { IngestResult } from "./index";

export async function ingestUrl(
  url: string,
  rawPath: string,
): Promise<IngestResult> {
  // Fetch the page
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const html = await response.text();

  // Parse with Readability
  const { document } = parseHTML(html);
  const reader = new Readability(document as unknown as Document);
  const article = reader.parse();

  if (!article || !article.content) {
    throw new Error(`Could not parse article from ${url}`);
  }

  // Convert to markdown
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  let markdown = turndown.turndown(article.content);

  // Download images
  const assetsDir = join(rawPath, "assets");
  await mkdir(assetsDir, { recursive: true });

  const imgRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  const imageDownloads: Promise<void>[] = [];

  while ((match = imgRegex.exec(markdown)) !== null) {
    const [fullMatch, alt, imgUrl] = match;
    const ext = extname(new URL(imgUrl).pathname) || ".png";
    const imgName = `${generateId()}${ext}`;
    const localPath = join(assetsDir, imgName);

    imageDownloads.push(
      fetch(imgUrl)
        .then((r) => r.arrayBuffer())
        .then((buf) => writeFile(localPath, Buffer.from(buf)))
        .then(() => {
          markdown = markdown.replace(fullMatch, `![${alt}](assets/${imgName})`);
        })
        .catch(() => {
          // Keep original URL if download fails
        }),
    );
  }

  await Promise.all(imageDownloads);

  // Build the final document
  const id = generateId();
  const title = article.title || "Untitled";
  const slug = slugify(title);
  const fileName = `${slug}-${id}.md`;
  const filePath = join(rawPath, fileName);

  const frontmatter = buildFrontmatter({
    id,
    title,
    sourceType: "url",
    sourceUrl: url,
    ingestedAt: nowISO(),
    tags: [],
    checksum: "",
  });

  const fullContent = `${frontmatter}\n\n# ${title}\n\n${markdown}\n`;
  await writeFile(filePath, fullContent, "utf-8");

  return {
    filePath: fileName,
    title,
    sourceType: "url",
  };
}
