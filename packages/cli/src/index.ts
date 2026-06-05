#!/usr/bin/env node

import { Command } from "commander";
import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  ingest,
  ingestBulk,
  compile,
  ask,
  search,
  lint,
  createProvider,
  extractFromCommit,
  writePendingAtom,
  listPending,
  acceptAtom,
  rejectAtom,
  updatePendingAtom,
  parseAtom,
  installHook,
  uninstallHook,
  getHookStatus,
} from "@nestbrain/core";
import type { LLMProviderInterface } from "@nestbrain/core";
import { readFile } from "node:fs/promises";

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

// ---------- knowledge subcommands ----------

const knowledge = program
  .command("knowledge")
  .description("Project knowledge atom pipeline (extract from commits, review, accept/reject)");

function resolveWorkspace(opt?: string): string {
  if (opt) return resolve(opt);
  // Default: walk up from cwd looking for a .nestbrain dir.
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(dir, ".nestbrain"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // No .nestbrain found — fall back to cwd; ensureQueueDirs will create it.
  return process.cwd();
}

function detectProjectName(repoPath: string, override?: string): string {
  if (override) return override;
  try {
    const root = execFileSync("git", ["-C", repoPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
    }).trim();
    return basename(root);
  } catch {
    return basename(repoPath);
  }
}

knowledge
  .command("extract <sha>")
  .description("Extract knowledge atoms from a git commit into the pending queue")
  .option("-r, --repo <path>", "Repository path (default: current dir)", process.cwd())
  .option("-w, --workspace <path>", "NestBrain workspace path (default: auto-detect via .nestbrain)")
  .option("-p, --project <name>", "Project tag (default: git repo basename)")
  .action(async (sha, options) => {
    try {
      const repoPath = resolve(options.repo);
      const workspace = resolveWorkspace(options.workspace);
      const projectName = detectProjectName(repoPath, options.project);
      const llm = getLLM();
      console.log(`Extracting from ${sha} (project: ${projectName})…`);
      const atoms = await extractFromCommit({
        repoPath,
        commitSha: sha,
        projectName,
        llm,
      });
      if (atoms.length === 0) {
        console.log("  (no atoms proposed — commit looks mechanical)");
        return;
      }
      for (const atom of atoms) {
        const file = await writePendingAtom(workspace, atom);
        const marker = atom.score >= 7 ? "★" : atom.score >= 4 ? "·" : "○";
        console.log(`  ${marker} [score ${atom.score}] ${atom.title}`);
        console.log(`         → ${file}`);
      }
      console.log(`\n✓ ${atoms.length} atom(s) in pending queue. Run \`nestbrain knowledge review\` to triage.`);
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

knowledge
  .command("list")
  .description("List atoms in the pending queue")
  .option("-w, --workspace <path>", "NestBrain workspace path (default: auto-detect)")
  .action(async (options) => {
    try {
      const workspace = resolveWorkspace(options.workspace);
      const entries = await listPending(workspace);
      if (entries.length === 0) {
        console.log("(pending queue is empty)");
        return;
      }
      for (const e of entries) {
        const marker = e.atom.score >= 7 ? "★" : e.atom.score >= 4 ? "·" : "○";
        console.log(`  ${marker} [${e.atom.score}] ${e.atom.title}`);
        console.log(`         ${e.atom.project} · ${e.atom.created} · tags: ${e.atom.tags.join(", ")}`);
      }
      console.log(`\n${entries.length} pending.`);
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

knowledge
  .command("review")
  .description("Interactively triage pending atoms (a accept · r reject · e edit · s skip · q quit)")
  .option("-w, --workspace <path>", "NestBrain workspace path (default: auto-detect)")
  .option("--min-score <n>", "Only show atoms with score >= n", "0")
  .action(async (options) => {
    try {
      const workspace = resolveWorkspace(options.workspace);
      const minScore = Math.max(0, Math.min(10, parseInt(options.minScore, 10) || 0));
      let entries = (await listPending(workspace)).filter((e) => e.atom.score >= minScore);
      if (entries.length === 0) {
        console.log("(nothing to review)");
        return;
      }
      const rl = createInterface({ input, output });
      const reload = async () => {
        entries = (await listPending(workspace)).filter((e) => e.atom.score >= minScore);
      };
      let acceptedN = 0,
        rejectedN = 0,
        editedN = 0,
        skippedN = 0;
      try {
        let i = 0;
        while (i < entries.length) {
          const e = entries[i];
          console.log("\n" + "─".repeat(72));
          console.log(`[${i + 1}/${entries.length}]  score ${e.atom.score}  ·  ${e.atom.project}  ·  ${e.atom.created}`);
          console.log(`title: ${e.atom.title}`);
          console.log(`tags : ${e.atom.tags.join(", ") || "(none)"}`);
          console.log(`refs : ${e.atom.sourceRefs.map((r) => r.commit + (r.file ? ` (${r.file})` : "")).join(", ")}`);
          console.log("");
          console.log(e.atom.body);
          console.log("─".repeat(72));
          const choice = (await rl.question("[a]ccept · [r]eject · [e]dit · [s]kip · [q]uit · [?] help > ")).trim().toLowerCase();
          if (choice === "a" || choice === "accept") {
            const dest = await acceptAtom(workspace, e);
            console.log(`✓ accepted → ${dest}`);
            acceptedN++;
            i++;
          } else if (choice === "r" || choice === "reject") {
            const dest = await rejectAtom(workspace, e);
            console.log(`✗ rejected → ${dest}`);
            rejectedN++;
            i++;
          } else if (choice === "e" || choice === "edit") {
            const editor = process.env.EDITOR || "vi";
            const r = spawnSync(editor, [e.filePath], { stdio: "inherit" });
            if (r.status === 0) {
              // Re-read and refresh the entry so subsequent display reflects edits.
              try {
                const text = await readFile(e.filePath, "utf-8");
                const updated = parseAtom(text);
                if (updated) {
                  const nextPath = await updatePendingAtom(e.filePath, updated);
                  entries[i] = { filePath: nextPath, atom: updated };
                  editedN++;
                  console.log("✎ edited — review again or accept/reject");
                  continue; // don't advance; user re-decides
                }
              } catch {
                console.log("(couldn't re-read edited atom — moving on)");
              }
            }
            i++;
          } else if (choice === "s" || choice === "skip" || choice === "") {
            skippedN++;
            i++;
          } else if (choice === "q" || choice === "quit") {
            break;
          } else if (choice === "?" || choice === "h" || choice === "help") {
            console.log("a=accept · r=reject · e=edit ($EDITOR) · s=skip · q=quit");
          } else {
            console.log("(unknown — try ?)");
          }
        }
      } finally {
        rl.close();
      }
      console.log(`\nSummary: ${acceptedN} accepted, ${rejectedN} rejected, ${editedN} edited, ${skippedN} skipped`);
      if (acceptedN > 0) {
        console.log("Run `nestbrain compile` to fold the accepted atoms into the wiki.");
      }
      void reload;
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// ---------- project registration (post-commit hook) ----------

const projects = program
  .command("projects")
  .description("Manage projects that auto-feed the knowledge base");

function detectCliCommand(override?: string): string {
  if (override) return override;
  // Prefer a globally-installed `nestbrain` on PATH so hooks survive working-
  // tree moves / dev sources being deleted.
  try {
    execSync("command -v nestbrain", { stdio: "pipe" });
    return "nestbrain";
  } catch {
    // Dev fallback: invoke this very source file via tsx.
    const devEntry = resolve(__dirname, "../src/index.ts");
    if (existsSync(devEntry)) {
      return `npx tsx ${devEntry}`;
    }
    throw new Error(
      "No `nestbrain` on PATH and no dev source detected. Pass --cli '<command>' explicitly.",
    );
  }
}

projects
  .command("register")
  .description("Install the post-commit hook that auto-extracts knowledge atoms")
  .option("-r, --repo <path>", "Repository path (default: cwd)", process.cwd())
  .option("--cli <command>", "Command the hook should invoke (default: auto-detect)")
  .action((options) => {
    try {
      const repoPath = resolve(options.repo);
      const cliCommand = detectCliCommand(options.cli);
      const result = installHook({ repoPath, cliCommand });
      console.log(`${result.replaced ? "✓ Updated" : "✓ Installed"}: ${result.hookPath}`);
      console.log(`  CLI: ${cliCommand}`);
      console.log("  Atoms will land in <workspace>/.nestbrain/knowledge-pending/ after every commit.");
      console.log("  Run `nestbrain knowledge review` to triage.");
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

projects
  .command("unregister")
  .description("Remove the post-commit hook installed by `register`")
  .option("-r, --repo <path>", "Repository path (default: cwd)", process.cwd())
  .action((options) => {
    try {
      const repoPath = resolve(options.repo);
      const result = uninstallHook(repoPath);
      if (result.removed) {
        console.log(`✓ Removed nestbrain snippet from ${result.hookPath}`);
      } else {
        console.log(`(no nestbrain snippet found in ${result.hookPath})`);
      }
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

projects
  .command("status")
  .description("Show whether the post-commit hook is installed in this repo")
  .option("-r, --repo <path>", "Repository path (default: cwd)", process.cwd())
  .action((options) => {
    try {
      const repoPath = resolve(options.repo);
      const s = getHookStatus(repoPath);
      console.log(`Hook path: ${s.hookPath}`);
      console.log(`Exists:    ${s.exists ? "yes" : "no"}`);
      console.log(`Managed:   ${s.ours ? `yes (v${s.version})` : "no"}`);
    } catch (error) {
      console.error(`✗ ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

program.parse();
