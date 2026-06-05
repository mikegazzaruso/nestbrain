// Git post-commit hook install / detect / uninstall.
//
// The hook fires after every commit on a registered repository and runs
// the knowledge extractor in the background (commit terminal does NOT block).
// Atoms land in <workspace>/.nestbrain/knowledge-pending/ for later review.
//
// Install is append-aware: if a non-NestBrain post-commit already exists, we
// add our snippet at the end, surrounded by markers so re-install (upgrade)
// rewrites only our portion and uninstall removes only our portion.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Bumped when we change the hook body so re-register upgrades the snippet. */
const HOOK_VERSION = 1;
const BEGIN_MARKER = "# >>> nestbrain knowledge hook (managed) >>>";
const END_MARKER = "# <<< nestbrain knowledge hook (managed) <<<";

export interface InstallHookOptions {
  repoPath: string;
  /**
   * Command the hook invokes (will be exec'd in background).
   * Examples:
   *   "nestbrain"                                  ← globally installed
   *   "/abs/path/to/nestbrain"                     ← explicit binary
   *   "npx tsx /abs/path/packages/cli/src/index.ts" ← dev mode
   */
  cliCommand: string;
}

export interface HookStatus {
  hookPath: string;
  exists: boolean;
  ours: boolean;
  /** Version of our snippet if present, or null. */
  version: number | null;
}

function hooksDir(repoPath: string): string {
  // Honors core.hooksPath if configured, and falls back to .git/hooks.
  const out = execFileSync("git", ["-C", repoPath, "rev-parse", "--git-path", "hooks"], {
    encoding: "utf-8",
  }).trim();
  // git rev-parse returns the path relative to the working dir; resolve.
  if (out.startsWith("/")) return out;
  return join(repoPath, out);
}

function postCommitPath(repoPath: string): string {
  return join(hooksDir(repoPath), "post-commit");
}

export function getHookStatus(repoPath: string): HookStatus {
  const hookPath = postCommitPath(repoPath);
  if (!existsSync(hookPath)) {
    return { hookPath, exists: false, ours: false, version: null };
  }
  const contents = readFileSync(hookPath, "utf-8");
  const match = /# nestbrain-knowledge-hook:(\d+)/.exec(contents);
  return {
    hookPath,
    exists: true,
    ours: contents.includes(BEGIN_MARKER),
    version: match ? Number(match[1]) : null,
  };
}

function buildHookSnippet(cliCommand: string): string {
  // Single-quoted JS-style: escape backslashes & single quotes for shell literal.
  const safe = cliCommand.replace(/\\/g, "\\\\").replace(/'/g, "'\\''");
  return [
    BEGIN_MARKER,
    `# nestbrain-knowledge-hook:${HOOK_VERSION}`,
    "# Extracts knowledge atoms from the latest commit into <workspace>/.nestbrain/",
    "# knowledge-pending/ for later review. Runs detached — does NOT block the commit.",
    `nestbrain_cli='${safe}'`,
    "nestbrain_repo=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0",
    "nestbrain_workspace=''",
    "nestbrain_dir=\"$nestbrain_repo\"",
    "nestbrain_i=0",
    "while [ \"$nestbrain_i\" -lt 20 ]; do",
    "  if [ -d \"$nestbrain_dir/.nestbrain\" ]; then",
    "    nestbrain_workspace=\"$nestbrain_dir\"",
    "    break",
    "  fi",
    "  nestbrain_parent=$(dirname \"$nestbrain_dir\")",
    "  [ \"$nestbrain_parent\" = \"$nestbrain_dir\" ] && break",
    "  nestbrain_dir=\"$nestbrain_parent\"",
    "  nestbrain_i=$((nestbrain_i + 1))",
    "done",
    "[ -z \"$nestbrain_workspace\" ] && exit 0",
    "nestbrain_sha=$(git rev-parse HEAD)",
    "nestbrain_log_dir=\"$nestbrain_workspace/.nestbrain/knowledge-log\"",
    "mkdir -p \"$nestbrain_log_dir\"",
    "{",
    "  echo \"--- $(date -u +%Y-%m-%dT%H:%M:%SZ) commit $nestbrain_sha ---\"",
    "  eval \"$nestbrain_cli knowledge extract \\\"$nestbrain_sha\\\" --repo \\\"$nestbrain_repo\\\" --workspace \\\"$nestbrain_workspace\\\"\"",
    "} >> \"$nestbrain_log_dir/extract.log\" 2>&1 </dev/null &",
    "disown 2>/dev/null || true",
    END_MARKER,
    "",
  ].join("\n");
}

export function installHook(opts: InstallHookOptions): { hookPath: string; replaced: boolean } {
  const hookPath = postCommitPath(opts.repoPath);
  const snippet = buildHookSnippet(opts.cliCommand);
  const shebang = "#!/bin/sh\n";

  if (!existsSync(hookPath)) {
    writeFileSync(hookPath, shebang + "\n" + snippet, "utf-8");
    chmodSync(hookPath, 0o755);
    return { hookPath, replaced: false };
  }

  const current = readFileSync(hookPath, "utf-8");
  const beginIdx = current.indexOf(BEGIN_MARKER);
  if (beginIdx >= 0) {
    // Upgrade in place: replace from begin to (end + newline).
    const endIdx = current.indexOf(END_MARKER, beginIdx);
    const endOfBlock = endIdx >= 0 ? current.indexOf("\n", endIdx + END_MARKER.length) + 1 : current.length;
    const before = current.slice(0, beginIdx);
    const after = endIdx >= 0 ? current.slice(endOfBlock) : "";
    writeFileSync(hookPath, before + snippet + after, "utf-8");
    chmodSync(hookPath, 0o755);
    return { hookPath, replaced: true };
  }

  // Append to an existing foreign hook. Make sure there's a trailing newline.
  const sep = current.endsWith("\n") ? "" : "\n";
  writeFileSync(hookPath, current + sep + "\n" + snippet, "utf-8");
  chmodSync(hookPath, 0o755);
  return { hookPath, replaced: false };
}

export function uninstallHook(repoPath: string): { hookPath: string; removed: boolean } {
  const hookPath = postCommitPath(repoPath);
  if (!existsSync(hookPath)) return { hookPath, removed: false };
  const current = readFileSync(hookPath, "utf-8");
  const beginIdx = current.indexOf(BEGIN_MARKER);
  if (beginIdx < 0) return { hookPath, removed: false };
  const endIdx = current.indexOf(END_MARKER, beginIdx);
  const endOfBlock = endIdx >= 0 ? current.indexOf("\n", endIdx + END_MARKER.length) + 1 : current.length;
  const before = current.slice(0, beginIdx).replace(/\n+$/, "\n");
  const after = endIdx >= 0 ? current.slice(endOfBlock) : "";
  const next = before + after;
  // If we'd be left with just "#!/bin/sh\n" or empty, leave the file in place
  // but cleaned — don't remove the file (other tooling may still expect it).
  writeFileSync(hookPath, next, "utf-8");
  return { hookPath, removed: true };
}
