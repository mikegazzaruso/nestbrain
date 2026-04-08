#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("mindnest")
  .description("LLM-powered personal knowledge base")
  .version("0.1.0");

program
  .command("ingest <source>")
  .description("Ingest a URL, file, or directory into the knowledge base")
  .option("-t, --type <type>", "Source type (url, pdf, markdown, github, arxiv, rss, youtube)")
  .action((_source, _options) => {
    console.log("mindnest ingest — not yet implemented (Phase 1)");
  });

program
  .command("compile")
  .description("Compile raw sources into the wiki")
  .option("-f, --force", "Recompile all sources, not just new/changed ones")
  .action((_options) => {
    console.log("mindnest compile — not yet implemented (Phase 1)");
  });

program
  .command("ask <question>")
  .description("Ask a question against the knowledge base")
  .option("-s, --save", "Save the answer back into the wiki")
  .option("--format <format>", "Output format (markdown, slides)", "markdown")
  .action((_question, _options) => {
    console.log("mindnest ask — not yet implemented (Phase 1)");
  });

program
  .command("search <query>")
  .description("Search the knowledge base")
  .option("-l, --limit <n>", "Max results", "10")
  .action((_query, _options) => {
    console.log("mindnest search — not yet implemented (Phase 1)");
  });

program
  .command("lint")
  .description("Run health checks on the wiki")
  .option("--fix", "Attempt to auto-fix issues")
  .action((_options) => {
    console.log("mindnest lint — not yet implemented (Phase 2)");
  });

program
  .command("serve")
  .description("Start the MindNest web UI")
  .option("-p, --port <port>", "Port number", "3000")
  .action((_options) => {
    console.log("mindnest serve — not yet implemented (Phase 1)");
  });

program.parse();
