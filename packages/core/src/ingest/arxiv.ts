import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateId, slugify, buildFrontmatter, nowISO } from "./utils";
import type { IngestResult } from "./index";

export async function ingestArxiv(
  arxivUrl: string,
  rawPath: string,
): Promise<IngestResult> {
  // Extract paper ID from URL (supports arxiv.org/abs/XXXX, arxiv.org/pdf/XXXX)
  const match = arxivUrl.match(/arxiv\.org\/(?:abs|pdf)\/([0-9.]+)/);
  if (!match) throw new Error(`Invalid arXiv URL: ${arxivUrl}`);

  const paperId = match[1];

  // Fetch metadata via arXiv Atom API
  const apiUrl = `https://export.arxiv.org/api/query?id_list=${paperId}`;
  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`arXiv API error: ${res.status}`);
  const xml = await res.text();

  // Parse basic metadata from XML
  const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/g);
  const title = titleMatch && titleMatch.length > 1
    ? titleMatch[1].replace(/<\/?title>/g, "").trim().replace(/\s+/g, " ")
    : `arXiv:${paperId}`;

  const summaryMatch = xml.match(/<summary>([\s\S]*?)<\/summary>/);
  const summary = summaryMatch
    ? summaryMatch[1].trim().replace(/\s+/g, " ")
    : "";

  const authors: string[] = [];
  const authorRegex = /<name>([\s\S]*?)<\/name>/g;
  let authorMatch;
  while ((authorMatch = authorRegex.exec(xml)) !== null) {
    authors.push(authorMatch[1].trim());
  }

  const publishedMatch = xml.match(/<published>([\s\S]*?)<\/published>/);
  const published = publishedMatch ? publishedMatch[1].trim().split("T")[0] : "";

  const categoryMatch = xml.match(/term="([^"]+)"/);
  const category = categoryMatch ? categoryMatch[1] : "";

  // Download PDF and extract text
  let pdfText = "";
  try {
    const pdfUrl = `https://arxiv.org/pdf/${paperId}.pdf`;
    const pdfRes = await fetch(pdfUrl);
    if (pdfRes.ok) {
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse(buffer);
      const result = await parser.getText();
      pdfText = result.text.replace(/\n{3,}/g, "\n\n").trim();
    }
  } catch {
    // PDF extraction failed, use abstract only
  }

  const id = generateId();
  const slug = slugify(title);
  const fileName = `${slug}-${id}.md`;
  const filePath = join(rawPath, fileName);

  const frontmatter = buildFrontmatter({
    id,
    title,
    sourceType: "arxiv",
    sourceUrl: arxivUrl,
    arxivId: paperId,
    published,
    authors: authors.slice(0, 5).join(", "),
    category,
    ingestedAt: nowISO(),
    tags: [category].filter(Boolean),
    checksum: "",
  });

  const content = `${frontmatter}

# ${title}

- **Authors:** ${authors.join(", ")}
- **Published:** ${published}
- **Category:** ${category}
- **arXiv:** [${paperId}](https://arxiv.org/abs/${paperId})

## Abstract

${summary}

${pdfText ? `## Full Text\n\n${pdfText.slice(0, 50000)}` : ""}
`;

  await writeFile(filePath, content, "utf-8");

  return { filePath: fileName, title, sourceType: "arxiv" };
}
