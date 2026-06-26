// Cross-machine session handoff: capture a project's working state into a
// summary another machine (or a fresh Claude Code session) can resume from.
//
//   save   — create the summary if absent, else ENRICH it with a compressed
//            delta of everything new since the last save (git-log driven).
//   resume — read the summary and produce a resumption briefing so a fresh
//            assistant continues where the last session left off.
//
// The summary lives at <project>/session-summary.md — the PROJECT ROOT, not a
// dot-dir, because the sync engines skip dot-dirs (`.nest/` never travels to
// another machine). A "Project Brief" kept current across saves, plus a
// "Session Log" of dated compressed deltas. Reads also fall back to the legacy
// .nest/ location so older summaries aren't orphaned.

import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, resolve, dirname } from "node:path";
import type { LLMProviderInterface } from "@nestbrain/core";

const SUMMARY_REL = "session-summary.md";
const LEGACY_REL = join(".nest", "session-summary.md");

/** Existing summary path: prefer the synced root file, else the legacy .nest/. */
function existingSummaryPath(dir: string): string | null {
  const root = join(dir, SUMMARY_REL);
  if (existsSync(root)) return root;
  const legacy = join(dir, LEGACY_REL);
  if (existsSync(legacy)) return legacy;
  return null;
}
const MAX_DELTA = 18000;
const MAX_TREE = 500;

interface Frontmatter {
  project: string;
  created: string;
  updated: string;
  lastCommit?: string;
  sessions: number;
}

function gitOk(dir: string): boolean {
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function git(dir: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch {
    return "";
  }
}

function nowISO(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ") + "Z";
}

/** Split YAML frontmatter from the markdown body. */
function parseSummary(text: string): { fm: Partial<Frontmatter>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };
  const fm: Partial<Frontmatter> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (k === "sessions") fm.sessions = parseInt(v) || 0;
    else (fm as Record<string, string>)[k] = v.replace(/^["']|["']$/g, "");
  }
  return { fm, body: m[2].trim() };
}

function render(fm: Frontmatter, body: string): string {
  return (
    `---\n` +
    `project: "${fm.project}"\n` +
    `created: ${fm.created}\n` +
    `updated: ${fm.updated}\n` +
    (fm.lastCommit ? `lastCommit: ${fm.lastCommit}\n` : "") +
    `sessions: ${fm.sessions}\n` +
    `---\n\n` +
    body.trim() +
    "\n"
  );
}

/** Best-effort file listing for a non-git project. */
async function listFiles(dir: string, prefix = "", out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 4 || out.length > MAX_TREE) return out;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length > MAX_TREE) break;
    if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) await listFiles(join(dir, e.name), rel, out, depth + 1);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

async function readHead(dir: string, name: string, max = 4000): Promise<string> {
  for (const f of [name, name.toUpperCase(), name.toLowerCase()]) {
    const p = join(dir, f);
    if (existsSync(p)) {
      try {
        return (await readFile(p, "utf8")).slice(0, max);
      } catch {
        /* ignore */
      }
    }
  }
  return "";
}

const SYS_SAVE =
  "You write dense, durable engineering handoff notes for resuming work on a project from another machine. " +
  "Be concrete: architecture, where things live, current state, what is in progress, decisions and their rationale, " +
  "gotchas, and the immediate next steps. No fluff, no preamble. Markdown.";

export interface SessionDeps {
  llm: LLMProviderInterface;
  log: (m: string) => void;
}

export async function saveSession(projectDir: string, { llm, log }: SessionDeps): Promise<string> {
  const dir = resolve(projectDir);
  const name = basename(dir);
  const path = join(dir, SUMMARY_REL); // always write to the synced root file
  const existPath = existingSummaryPath(dir);
  const existing = existPath ? await readFile(existPath, "utf8") : null;
  const prev = existing ? parseSummary(existing) : null;

  const isGit = gitOk(dir);
  const head = isGit ? git(dir, ["rev-parse", "HEAD"]) : "";

  let body: string;
  if (!prev) {
    log(`Creating session summary for "${name}"…`);
    const tree = isGit ? git(dir, ["ls-files"]).split("\n").slice(0, MAX_TREE).join("\n") : (await listFiles(dir)).join("\n");
    const readme = await readHead(dir, "README.md");
    const recent = isGit ? git(dir, ["log", "--oneline", "-30"]) : "";
    const prompt =
      `Project: ${name}\n\n` +
      `Files:\n${tree}\n\n` +
      (readme ? `README (excerpt):\n${readme}\n\n` : "") +
      (recent ? `Recent commits:\n${recent}\n\n` : "") +
      `Write a thorough "Project Brief" to hand this project off to another machine: what it is, the architecture and where ` +
      `things live, the current state, anything in progress, key decisions, and the next steps. This becomes the durable summary ` +
      `that later sessions enrich.`;
    const brief = (await llm.ask(prompt, SYS_SAVE)).text.trim();
    body = `# Session summary — ${name}\n\n## Project Brief\n\n${brief}\n\n## Session Log\n`;
  } else {
    const last = prev.fm.lastCommit;
    const delta =
      isGit && last && head && last !== head
        ? git(dir, ["log", "--stat", "--no-color", `${last}..HEAD`]).slice(0, MAX_DELTA)
        : "";
    if (!delta && last === head) {
      log("No new commits since the last summary — refreshing timestamp only.");
    }
    log(`Enriching session summary for "${name}" (compressing changes since last save)…`);
    const prompt =
      `Existing handoff for project "${name}":\n\n${prev.body}\n\n` +
      (delta
        ? `New changes since the last summary (git log --stat ${last?.slice(0, 8)}..HEAD):\n${delta}\n\n`
        : `There are no new git commits since the last summary.\n\n`) +
      `Return the FULL updated summary in markdown with exactly these sections:\n` +
      `## Project Brief — the brief kept CURRENT (fold in anything the new changes altered).\n` +
      `## Session Log — keep the prior entries, and PREPEND one new dated entry that COMPRESSES what changed this session ` +
      `(like a /compress: the essence of the new work, decisions, and where it leaves off). Date it ${nowISO()}.\n` +
      `Be concrete and dense. Do not invent changes that aren't in the delta.`;
    body = (await llm.ask(prompt, SYS_SAVE)).text.trim();
  }

  const fm: Frontmatter = {
    project: name,
    created: prev?.fm.created ?? nowISO(),
    updated: nowISO(),
    lastCommit: head || prev?.fm.lastCommit,
    sessions: (prev?.fm.sessions ?? 0) + 1,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, render(fm, body), "utf8");
  return path;
}

const SYS_RESUME =
  "You brief an engineer (or AI assistant) about to resume a project on a different machine. From the handoff summary " +
  "(and any noted divergence between it and the local checkout), produce a tight resumption briefing: current state, what " +
  "was in progress, the exact next steps, key files to open, and gotchas — so they can continue as if they never left. " +
  "No preamble. Markdown.";

export async function resumeSession(projectDir: string, { llm }: SessionDeps): Promise<string> {
  const dir = resolve(projectDir);
  const path = existingSummaryPath(dir);
  if (!path) {
    throw new Error(
      `no ${SUMMARY_REL} in this project — run \`nestbrain session save\` on the other machine (and let it sync) first`,
    );
  }
  const { fm, body } = parseSummary(await readFile(path, "utf8"));
  const isGit = gitOk(dir);
  const head = isGit ? git(dir, ["rev-parse", "HEAD"]) : "";
  const diverged = fm.lastCommit && head && fm.lastCommit !== head;
  const localChanges = diverged ? git(dir, ["log", "--oneline", `${fm.lastCommit}..HEAD`]).slice(0, 4000) : "";

  const prompt =
    `Handoff summary for project "${fm.project}" (last saved ${fm.updated}):\n\n${body}\n\n` +
    (diverged
      ? `NOTE: this machine's checkout has moved past the summary's commit ${fm.lastCommit?.slice(0, 8)}.\n` +
        (localChanges ? `Local commits not reflected in the summary:\n${localChanges}\n\n` : `\n`)
      : `The local checkout matches the summary's commit.\n\n`) +
    `Produce the resumption briefing.`;
  return (await llm.ask(prompt, SYS_RESUME)).text.trim();
}

export function sessionSummaryPath(projectDir: string): string {
  return existingSummaryPath(resolve(projectDir)) ?? join(resolve(projectDir), SUMMARY_REL);
}
