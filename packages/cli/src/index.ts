#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "node:path";
import { ingest, ingestBulk, compile, ask, search, lint, createProvider } from "@nestbrain/core";
import type { LLMProviderInterface } from "@nestbrain/core";
import { execSync } from "node:child_process";

const program = new Command();

const DATA_RAW = resolve(process.cwd(), "data/raw");
const DATA_WIKI = resolve(process.cwd(), "data/wiki");

function getLLM(): LLMProviderInterface {
  return createProvider({
    provider: "claude-cli",
    model: process.env.NESTBRAIN_MODEL ?? "sonnet",
    maxTurns: 5,
    apiKey: process.env.OPENAI_API_KEY,
  });
}

program
  .name("nestbrain")
  .description("LLM-powered personal knowledge base")
  .version("0.2.0");

program
  .command("ingest <source>")
  .description("Ingest a URL, file, or directory into the knowledge base")
  .option("-t, --type <type>", "Source type (url, pdf, markdown, github, arxiv, rss, youtube)")
  .action(async (source, options) => {
    try {
      console.log(`Ingesting: ${source}`);
      const result = await ingest({ source, type: options.type, rawPath: DATA_RAW });
      console.log(`✓ ${result.title} (${result.sourceType}) → ${result.filePath}`);
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

program
  .command("compile")
  .description("Compile raw sources into the wiki")
  .option("-f, --force", "Recompile all sources, not just new/changed ones")
  .action(async (options) => {
    try {
      const llm = getLLM();
      console.log("Compiling wiki...");
      const result = await compile({
        force: options.force,
        rawPath: DATA_RAW,
        wikiPath: DATA_WIKI,
        llm,
        onProgress: (phase, detail) => {
          console.log(`  ${phase}: ${detail}`);
        },
      });
      console.log(`\n✓ Done in ${Math.round(result.duration / 1000)}s`);
      console.log(`  ${result.articlesCreated} created, ${result.articlesUpdated} updated, ${result.conceptsExtracted} concepts`);
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

program
  .command("ask <question>")
  .description("Ask a question against the knowledge base")
  .option("-s, --save", "Save the answer back into the wiki")
  .action(async (question, options) => {
    try {
      const llm = getLLM();
      console.log(`Searching knowledge base...\n`);
      const result = await ask({ question, save: options.save, wikiPath: DATA_WIKI, llm });
      console.log(result.answer);
      if (result.citations.length > 0) {
        console.log(`\nSources: ${result.citations.join(", ")}`);
      }
      if (result.savedTo) {
        console.log(`\nSaved to: ${result.savedTo}`);
      }
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

program
  .command("search <query>")
  .description("Search the knowledge base")
  .option("-l, --limit <n>", "Max results", "10")
  .action(async (query, options) => {
    try {
      const results = await search({ query, limit: parseInt(options.limit), wikiPath: DATA_WIKI });
      if (results.length === 0) {
        console.log("No results found.");
        return;
      }
      console.log(`${results.length} results:\n`);
      for (const r of results) {
        console.log(`  [${r.score.toFixed(2)}] ${r.title}`);
        console.log(`         ${r.filePath}`);
        console.log(`         ${r.snippet.slice(0, 100)}...\n`);
      }
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

program
  .command("lint")
  .description("Run health checks on the wiki")
  .action(async () => {
    try {
      let llm: LLMProviderInterface | undefined;
      try { llm = getLLM(); } catch { /* no LLM */ }
      console.log("Running health check...\n");
      const report = await lint({ wikiPath: DATA_WIKI, llm });
      console.log(`Articles: ${report.stats.totalArticles}`);
      console.log(`Orphans: ${report.stats.orphans}`);
      console.log(`Broken links: ${report.stats.missingBacklinks}`);
      console.log(`Suggested: ${report.stats.suggestedArticles}`);
      console.log(`Total findings: ${report.findings.length}\n`);
      for (const f of report.findings) {
        const icon = f.severity === "error" ? "✗" : f.severity === "warning" ? "⚠" : "ℹ";
        console.log(`  ${icon} ${f.message}${f.filePath ? ` (${f.filePath})` : ""}`);
      }
      if (report.findings.length === 0) {
        console.log("  ✓ No issues found!");
      }
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

program
  .command("serve")
  .description("Start the NestBrain web UI")
  .option("-p, --port <port>", "Port number", "3000")
  .action((options) => {
    console.log(`Starting NestBrain on port ${options.port}...`);
    try {
      execSync(`npx next dev -p ${options.port}`, {
        cwd: resolve(__dirname, "../../apps/web"),
        stdio: "inherit",
      });
    } catch {
      // User exited
    }
  });

program.parse();
