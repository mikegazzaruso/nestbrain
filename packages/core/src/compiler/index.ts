import { readFile, writeFile, readdir, mkdir, access } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import type { CompileResult } from "@mindnest/shared";
import { WIKI_DIRS, INDEX_FILES } from "@mindnest/shared";
import type { LLMProviderInterface } from "../llm/provider";
import { PROMPTS } from "../llm/prompts";
import { loadTracker, saveTracker, hasChanged, markCompiled } from "./tracker";
import { slugify, nowISO, buildFrontmatter } from "../ingest/utils";
import { VectorStore } from "../vectorstore";

export type ProgressCallback = (phase: string, detail: string) => void;

export interface CompileOptions {
  force?: boolean;
  rawPath?: string;
  wikiPath?: string;
  llm: LLMProviderInterface;
  onProgress?: ProgressCallback;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function compile(options: CompileOptions): Promise<CompileResult> {
  const rawPath = resolve(options.rawPath ?? "./data/raw");
  const wikiPath = resolve(options.wikiPath ?? "./data/wiki");
  const startTime = Date.now();

  // Ensure wiki directories exist
  await mkdir(join(wikiPath, WIKI_DIRS.sources), { recursive: true });
  await mkdir(join(wikiPath, WIKI_DIRS.concepts), { recursive: true });
  await mkdir(join(wikiPath, WIKI_DIRS.outputs), { recursive: true });

  // Initialize vector store
  const vectorStore = new VectorStore(wikiPath);

  // Load change tracker
  const tracker = options.force
    ? { sources: {} }
    : await loadTracker(wikiPath);

  // Find raw source files
  const rawFiles = (await readdir(rawPath))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(rawPath, f));

  // Filter to only new/changed files
  const toProcess: string[] = [];
  for (const file of rawFiles) {
    if (options.force || (await hasChanged(file, tracker))) {
      toProcess.push(file);
    }
  }

  // Nothing to do
  if (toProcess.length === 0) {
    return {
      articlesCreated: 0,
      articlesUpdated: 0,
      conceptsExtracted: 0,
      duration: Date.now() - startTime,
    };
  }

  let articlesCreated = 0;
  let articlesUpdated = 0;

  const progress = options.onProgress ?? (() => {});

  // Step 1: Summarize only new/changed sources
  for (let i = 0; i < toProcess.length; i++) {
    const file = toProcess[i];
    const content = await readFile(file, "utf-8");
    const sourceFileName = basename(file);

    progress("Summarizing", `${sourceFileName} (${i + 1}/${toProcess.length})`);

    const response = await options.llm.ask(
      `Summarize the following source document. The source file is "${sourceFileName}".\n\n${content}`,
      PROMPTS.summarize,
    );

    const slug = slugify(basename(file, ".md"));
    const summaryPath = join(wikiPath, WIKI_DIRS.sources, `${slug}.md`);

    if (await fileExists(summaryPath)) {
      articlesUpdated++;
    } else {
      articlesCreated++;
    }

    await writeFile(summaryPath, response.text, "utf-8");
    await markCompiled(file, tracker);

    // Embed into vector store
    const titleMatch = response.text.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] ?? basename(file, ".md");
    progress("Embedding", `${title}`);
    await vectorStore.upsert(slug, title, `${WIKI_DIRS.sources}/${slug}.md`, "source-summary", response.text);
  }

  // Step 2: Extract concepts — but only write NEW ones, skip existing
  let conceptsExtracted = 0;

  const allSummaryFiles = await readdir(join(wikiPath, WIKI_DIRS.sources));
  const allSummaries: string[] = [];

  for (const f of allSummaryFiles) {
    if (f.endsWith(".md")) {
      const content = await readFile(join(wikiPath, WIKI_DIRS.sources, f), "utf-8");
      allSummaries.push(content);
    }
  }

  if (allSummaries.length > 0) {
    progress("Extracting concepts", `Analyzing ${allSummaries.length} summaries`);

    const conceptsResponse = await options.llm.ask(
      `Here are the source summaries from the knowledge base:\n\n${allSummaries.join("\n\n---\n\n")}`,
      PROMPTS.extractConcepts,
    );

    let concepts: Array<{
      name: string;
      description: string;
      relatedConcepts: string[];
    }> = [];

    try {
      const jsonMatch = conceptsResponse.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        concepts = JSON.parse(jsonMatch[0]);
      }
    } catch {
      // JSON parsing failed, skip
    }

    // Step 3: Only write concept articles that don't exist yet
    let conceptIdx = 0;
    for (const concept of concepts) {
      const conceptSlug = slugify(concept.name);
      const conceptPath = join(wikiPath, WIKI_DIRS.concepts, `${conceptSlug}.md`);

      // Skip if concept article already exists (unless force)
      if (!options.force && (await fileExists(conceptPath))) {
        continue;
      }

      conceptIdx++;
      progress("Writing concept", `${concept.name} (${conceptIdx}/${concepts.length})`);

      const conceptResponse = await options.llm.ask(
        `Write a wiki article for the concept "${concept.name}". Description: ${concept.description}. Related concepts: ${concept.relatedConcepts.join(", ")}.\n\nUse information from these source summaries:\n\n${allSummaries.join("\n\n---\n\n")}`,
        PROMPTS.writeConcept,
      );

      if (await fileExists(conceptPath)) {
        articlesUpdated++;
      } else {
        articlesCreated++;
      }

      await writeFile(conceptPath, conceptResponse.text, "utf-8");

      // Embed into vector store
      progress("Embedding", `${concept.name}`);
      await vectorStore.upsert(conceptSlug, concept.name, `${WIKI_DIRS.concepts}/${conceptSlug}.md`, "concept", conceptResponse.text);

      conceptsExtracted++;
    }
  }

  // Step 4: Regenerate indexes (cheap, no LLM calls)
  progress("Indexing", "Generating master index and concept map");
  await generateMasterIndex(wikiPath);
  await generateConceptsMap(wikiPath);

  progress("Saving", "Persisting vector index");
  await vectorStore.save();

  progress("Done", "Compilation complete");
  await saveTracker(wikiPath, tracker);

  return {
    articlesCreated,
    articlesUpdated,
    conceptsExtracted,
    duration: Date.now() - startTime,
  };
}

async function generateMasterIndex(wikiPath: string): Promise<void> {
  const entries: string[] = [];

  for (const dir of [WIKI_DIRS.sources, WIKI_DIRS.concepts, WIKI_DIRS.outputs]) {
    const dirPath = join(wikiPath, dir);
    try {
      const files = await readdir(dirPath);
      for (const f of files) {
        if (f.endsWith(".md")) {
          const content = await readFile(join(dirPath, f), "utf-8");
          const titleMatch = content.match(/title:\s*"([^"]+)"/);
          const summaryMatch = content.match(/summary:\s*"([^"]+)"/);
          const title = titleMatch?.[1] ?? basename(f, ".md");
          const summary = summaryMatch?.[1] ?? "";
          entries.push(`- [[${dir}/${basename(f, ".md")}|${title}]] — ${summary}`);
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  const indexContent = `${buildFrontmatter({
    title: "Knowledge Base Index",
    created: nowISO(),
    updated: nowISO(),
    type: "index",
  })}

# Knowledge Base Index

This is the master index of all articles in the knowledge base.

## Sources

${entries.filter((e) => e.includes("sources/")).join("\n") || "_No sources yet._"}

## Concepts

${entries.filter((e) => e.includes("concepts/")).join("\n") || "_No concepts yet._"}

## Outputs

${entries.filter((e) => e.includes("outputs/")).join("\n") || "_No outputs yet._"}
`;

  await writeFile(join(wikiPath, INDEX_FILES.master), indexContent, "utf-8");
}

async function generateConceptsMap(wikiPath: string): Promise<void> {
  const conceptsDir = join(wikiPath, WIKI_DIRS.concepts);
  const entries: string[] = [];

  try {
    const files = await readdir(conceptsDir);
    for (const f of files) {
      if (f.endsWith(".md")) {
        const content = await readFile(join(conceptsDir, f), "utf-8");
        const titleMatch = content.match(/title:\s*"([^"]+)"/);
        const title = titleMatch?.[1] ?? basename(f, ".md");

        const links: string[] = [];
        const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
          links.push(match[1]);
        }

        entries.push(`- [[concepts/${basename(f, ".md")}|${title}]] → ${links.map((l) => `[[${l}]]`).join(", ") || "_no links_"}`);
      }
    }
  } catch {
    // No concepts yet
  }

  const mapContent = `${buildFrontmatter({
    title: "Concept Map",
    created: nowISO(),
    updated: nowISO(),
    type: "index",
  })}

# Concept Map

Overview of all concepts and their connections.

${entries.join("\n") || "_No concepts extracted yet._"}
`;

  await writeFile(join(wikiPath, INDEX_FILES.concepts), mapContent, "utf-8");
}
