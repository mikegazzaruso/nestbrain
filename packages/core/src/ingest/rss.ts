import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import RSSParser from "rss-parser";
import TurndownService from "turndown";
import { generateId, slugify, buildFrontmatter, nowISO } from "./utils";
import type { IngestResult } from "./index";

export async function ingestRss(
  feedUrl: string,
  rawPath: string,
  maxItems: number = 10,
): Promise<IngestResult[]> {
  const parser = new RSSParser();
  const feed = await parser.parseURL(feedUrl);

  if (!feed.items || feed.items.length === 0) {
    throw new Error(`No items found in RSS feed: ${feedUrl}`);
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });

  const results: IngestResult[] = [];
  const items = feed.items.slice(0, maxItems);

  for (const item of items) {
    const title = item.title ?? "Untitled";
    const link = item.link ?? "";
    const pubDate = item.pubDate ?? item.isoDate ?? "";
    const contentHtml = item["content:encoded"] ?? item.content ?? item.contentSnippet ?? "";

    const markdown = contentHtml
      ? turndown.turndown(contentHtml)
      : item.contentSnippet ?? "";

    const id = generateId();
    const slug = slugify(title);
    const fileName = `${slug}-${id}.md`;
    const filePath = join(rawPath, fileName);

    const frontmatter = buildFrontmatter({
      id,
      title,
      sourceType: "rss",
      sourceUrl: link,
      feedUrl,
      feedTitle: feed.title ?? "",
      published: pubDate ? pubDate.split("T")[0] : "",
      ingestedAt: nowISO(),
      tags: (item.categories ?? []).slice(0, 5),
      checksum: "",
    });

    const content = `${frontmatter}

# ${title}

- **Source:** [${feed.title ?? feedUrl}](${link})
- **Published:** ${pubDate}

${markdown}
`;

    await writeFile(filePath, content, "utf-8");

    results.push({ filePath: fileName, title, sourceType: "rss" });
  }

  return results;
}
