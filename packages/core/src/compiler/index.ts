import { readFile, writeFile, readdir, mkdir, access } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import type { CompileResult } from "@nestbrain/shared";
import { WIKI_DIRS, INDEX_FILES } from "@nestbrain/shared";
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

/**
 * Walk a directory tree and return every `.md` file. Used by the compiler so
 * it picks up both top-level ingested sources and project-scoped knowledge
 * atoms under `raw/projects/<name>/`.
 */
async function collectMarkdownRecursive(dir: string): Promise<string[]> {
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
      out.push(...(await collectMarkdownRecursive(full)));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Pull the `project` value out of a Markdown file's YAML frontmatter.
 * Looks for `project: <name>` only — projects-array form is treated below.
 * Returns undefined if the file has no frontmatter or no project tag.
 */
function extractProject(content: string): string | undefined {
  const fm = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fm) return undefined;
  const m = /^project:\s*(.+)$/m.exec(fm[1]);
  if (!m) return undefined;
  const v = m[1].trim().replace(/^["']|["']$/g, "");
  return v || undefined;
}

/**
 * Ensure the summary the LLM produced carries the source's `project` tag in
 * its frontmatter. We don't trust the model to do this reliably — we either
 * inject the field into existing frontmatter or wrap the text in one.
 */
function injectProjectIntoFrontmatter(text: string, project: string): string {
  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fmMatch) {
    const inner = fmMatch[1];
    if (/^project:/m.test(inner)) {
      // Replace existing.
      const updatedInner = inner.replace(/^project:.*$/m, `project: ${project}`);
      return text.replace(fmMatch[0], `---\n${updatedInner}\n---\n`);
    }
    return text.replace(fmMatch[0], `---\n${inner}\nproject: ${project}\n---\n`);
  }
  return `---\nproject: ${project}\n---\n\n${text}`;
}

/** Same as injectProjectIntoFrontmatter but for a multi-project list. */
function injectProjectsIntoFrontmatter(text: string, projects: string[]): string {
  if (projects.length === 0) return text;
  const list = `[${projects.join(", ")}]`;
  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (fmMatch) {
    const inner = fmMatch[1];
    if (/^projects:/m.test(inner)) {
      const updatedInner = inner.replace(/^projects:.*$/m, `projects: ${list}`);
      return text.replace(fmMatch[0], `---\n${updatedInner}\n---\n`);
    }
    return text.replace(fmMatch[0], `---\n${inner}\nprojects: ${list}\n---\n`);
  }
  return `---\nprojects: ${list}\n---\n\n${text}`;
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

  // Find raw source files — recursive so accepted knowledge atoms under
  // raw/projects/<name>/ are picked up alongside top-level ingested sources.
  const rawFiles = await collectMarkdownRecursive(rawPath);

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

  // Track which source slug came from which project so concepts derived from
  // those summaries inherit the union of contributing project tags.
  const projectBySlug = new Map<string, string>();

  // Step 1: Summarize only new/changed sources
  for (let i = 0; i < toProcess.length; i++) {
    const file = toProcess[i];
    const content = await readFile(file, "utf-8");
    const sourceFileName = basename(file);
    const project = extractProject(content);

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

    // Carry the source's project tag into the summary frontmatter so search
    // / filter / citation rendering all see it without re-reading the source.
    const summaryText = project
      ? injectProjectIntoFrontmatter(response.text, project)
      : response.text;
    await writeFile(summaryPath, summaryText, "utf-8");
    await markCompiled(file, tracker);
    if (project) projectBySlug.set(slug, project);

    // Embed into vector store
    const titleMatch = summaryText.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1] ?? basename(file, ".md");
    progress("Embedding", `${title}`);
    await vectorStore.upsert(
      slug,
      title,
      `${WIKI_DIRS.sources}/${slug}.md`,
      "source-summary",
      summaryText,
      project ? [project] : undefined,
    );
  }

  // Step 2: Extract concepts from NEW summaries only (not all 200)
  let conceptsExtracted = 0;

  // Collect only the new summaries we just wrote
  const newSummaries: string[] = [];
  for (const file of toProcess) {
    const slug = slugify(basename(file, ".md"));
    const summaryPath = join(wikiPath, WIKI_DIRS.sources, `${slug}.md`);
    try {
      const content = await readFile(summaryPath, "utf-8");
      newSummaries.push(content);
    } catch { /* skip */ }
  }

  // Get list of existing concept names (just names, not full content — cheap)
  const existingConcepts: string[] = [];
  try {
    const conceptFiles = await readdir(join(wikiPath, WIKI_DIRS.concepts));
    for (const f of conceptFiles) {
      if (!f.endsWith(".md")) continue;
      const content = await readFile(join(wikiPath, WIKI_DIRS.concepts, f), "utf-8");
      const titleMatch = content.match(/title:\s*"([^"]+)"/);
      existingConcepts.push(titleMatch?.[1] ?? basename(f, ".md"));
    }
  } catch { /* no concepts dir yet */ }

  if (newSummaries.length > 0) {
    progress("Extracting concepts", `Analyzing ${newSummaries.length} new summaries`);

    const existingList = existingConcepts.length > 0
      ? `\n\nExisting concepts in the knowledge base (DO NOT duplicate these): ${existingConcepts.join(", ")}`
      : "";

    const conceptsResponse = await options.llm.ask(
      `Here are the NEW source summaries to extract concepts from:\n\n${newSummaries.join("\n\n---\n\n")}${existingList}`,
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

    // Step 3: Write only NEW concept articles
    let conceptIdx = 0;
    for (const concept of concepts) {
      const conceptSlug = slugify(concept.name);
      const conceptPath = join(wikiPath, WIKI_DIRS.concepts, `${conceptSlug}.md`);

      // Skip if concept already exists (unless force)
      if (!options.force && (await fileExists(conceptPath))) {
        continue;
      }

      conceptIdx++;
      progress("Writing concept", `${concept.name} (${conceptIdx}/${concepts.length})`);

      // Pass only the new summaries + list of existing concepts for linking
      const conceptResponse = await options.llm.ask(
        `Write a wiki article for the concept "${concept.name}". Description: ${concept.description}. Related concepts: ${concept.relatedConcepts.join(", ")}.\n\nExisting concepts you can link to with [[wikilinks]]: ${existingConcepts.join(", ")}${concept.relatedConcepts.length > 0 ? ", " + concept.relatedConcepts.join(", ") : ""}\n\nSource material:\n\n${newSummaries.join("\n\n---\n\n")}`,
        PROMPTS.writeConcept,
      );

      if (await fileExists(conceptPath)) {
        articlesUpdated++;
      } else {
        articlesCreated++;
      }

      // Union of project tags from the summaries that fed this concept batch.
      // We don't try to attribute per-concept (the LLM extraction is a soup);
      // every concept in this batch carries the union, which over-attributes
      // somewhat but means project-scoped queries don't lose concepts.
      const contributingProjects = [...new Set(projectBySlug.values())];

      const conceptText = contributingProjects.length > 0
        ? injectProjectsIntoFrontmatter(conceptResponse.text, contributingProjects)
        : conceptResponse.text;
      await writeFile(conceptPath, conceptText, "utf-8");

      // Embed into vector store
      progress("Embedding", `${concept.name}`);
      await vectorStore.upsert(
        conceptSlug,
        concept.name,
        `${WIKI_DIRS.concepts}/${conceptSlug}.md`,
        "concept",
        conceptText,
        contributingProjects.length > 0 ? contributingProjects : undefined,
      );

      // Add to existing list so next concept in this batch can link to it
      existingConcepts.push(concept.name);
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
