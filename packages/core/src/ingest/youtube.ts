import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateId, slugify, buildFrontmatter, nowISO } from "./utils";
import type { IngestResult } from "./index";

function extractVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/,
    /youtu\.be\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export async function ingestYoutube(
  youtubeUrl: string,
  rawPath: string,
): Promise<IngestResult> {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) throw new Error(`Invalid YouTube URL: ${youtubeUrl}`);

  // Fetch video metadata via oembed
  let title = `YouTube: ${videoId}`;
  let author = "";
  try {
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (oembedRes.ok) {
      const data = await oembedRes.json();
      title = data.title ?? title;
      author = data.author_name ?? "";
    }
  } catch {
    // skip
  }

  // Fetch transcript
  let transcript = "";
  try {
    const { YoutubeTranscript } = await import("youtube-transcript");
    const items = await YoutubeTranscript.fetchTranscript(videoId);
    transcript = items.map((i: { text: string }) => i.text).join(" ");
  } catch {
    // Transcript not available
  }

  if (!transcript) {
    throw new Error(`No transcript available for YouTube video: ${videoId}. The video may not have captions.`);
  }

  const id = generateId();
  const slug = slugify(title);
  const fileName = `${slug}-${id}.md`;
  const filePath = join(rawPath, fileName);

  const frontmatter = buildFrontmatter({
    id,
    title,
    sourceType: "youtube",
    sourceUrl: youtubeUrl,
    videoId,
    author,
    ingestedAt: nowISO(),
    tags: ["video"],
    checksum: "",
  });

  const content = `${frontmatter}

# ${title}

- **Author:** ${author}
- **Video:** [Watch on YouTube](${youtubeUrl})
- **Video ID:** ${videoId}

## Transcript

${transcript}
`;

  await writeFile(filePath, content, "utf-8");

  return { filePath: fileName, title, sourceType: "youtube" };
}
