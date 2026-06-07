import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { AgentOptions, LLMProviderInterface, LLMResponse } from "./provider";

/**
 * Pull a JSON object/array out of a model reply that may contain a fenced
 * code block, prose preamble, or trailing chatter. We try strict parse first,
 * then look for the largest balanced { … } or [ … ] block.
 */
function parseJsonReply<T>(text: string): T {
  const t = text.trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    /* fall through */
  }
  // Strip a single fenced code block if the whole reply is wrapped in one.
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(t);
  if (fence) {
    try {
      return JSON.parse(fence[1]) as T;
    } catch {
      /* fall through */
    }
  }
  // Find the first { or [ and try to balance-match to its closer. Naive
  // (ignores strings) but works for typical model replies.
  const start = t.search(/[{[]/);
  if (start >= 0) {
    const open = t[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const slice = t.slice(start, i + 1);
          return JSON.parse(slice) as T;
        }
      }
    }
  }
  throw new Error(`No parseable JSON in model reply: ${t.slice(0, 200)}…`);
}

function runClaude(args: string[], stdin?: string, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd: cwd ?? tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 600_000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(`claude exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            'Claude CLI is not installed or not in your PATH.\n\n' +
            'To fix this:\n' +
            '  1. Install Claude Code: npm install -g @anthropic-ai/claude-code\n' +
            '  2. Authenticate: claude auth login\n' +
            '  3. Restart NestBrain\n\n' +
            'Alternatively, switch to the OpenAI provider in Settings.',
          ),
        );
      } else {
        reject(err);
      }
    });

    if (stdin) {
      proc.stdin.write(stdin);
    }
    proc.stdin.end();
  });
}

export class ClaudeCLIProvider implements LLMProviderInterface {
  readonly name = "claude-cli" as const;

  constructor(
    private model: string = "sonnet",
    private maxTurns: number = 5,
  ) {}

  async ask(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    // Pass prompt via stdin to avoid argument length limits
    const args = [
      "-p",
      "-",
      "--output-format",
      "json",
      "--model",
      this.model,
      "--max-turns",
      "1",
      "--no-session-persistence",
      // We want a single-turn text completion — no tool calls. Without
      // these the user's global ~/.claude (skills, agents, settings) leaks
      // in and the CLI tries to use Bash/Read on startup (e.g. orphan-
      // session checks from a project's CLAUDE.md), burning the single
      // turn before we get an answer.
      "--disable-slash-commands",
      "--tools",
      "",
      "--setting-sources",
      "",
    ];

    if (systemPrompt) {
      args.push("--system-prompt", systemPrompt);
    }

    const stdout = await runClaude(args, prompt);

    const data = JSON.parse(stdout);

    if (data.is_error) {
      throw new Error(`Claude CLI error: ${data.result}`);
    }

    return {
      text: data.result ?? "",
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens ?? 0,
            outputTokens: data.usage.output_tokens ?? 0,
          }
        : undefined,
    };
  }

  /**
   * Agentic completion. Unlike `ask`, this lets the CLI use tools across
   * multiple turns — so the model can read the user's local projects, search
   * and fetch the web, or run commands to verify facts before answering.
   * Used by the wiki AI-edit flow ("analyze this project and fix the page").
   */
  async agent(prompt: string, opts: AgentOptions = {}): Promise<LLMResponse> {
    const args = [
      "-p",
      "-",
      "--output-format",
      "json",
      "--model",
      this.model,
      "--max-turns",
      String(opts.maxTurns ?? 24),
      "--no-session-persistence",
      "--disable-slash-commands",
      // Enable a capable but read-leaning toolset so the agent can inspect
      // local code and the web. `--tools` limits what's available (no
      // Edit/Write — we persist the result ourselves), and `--allowedTools`
      // pre-approves them so they run without a prompt in headless (-p) mode,
      // where an approval request would otherwise be auto-denied. Keep
      // --setting-sources empty so the user's global skills / project
      // CLAUDE.md don't hijack the run.
      "--tools",
      "Read,Grep,Glob,WebFetch,WebSearch,Bash",
      "--allowedTools",
      "Read,Grep,Glob,WebFetch,WebSearch,Bash",
      "--setting-sources",
      "",
    ];

    if (opts.systemPrompt) {
      args.push("--system-prompt", opts.systemPrompt);
    }

    const stdout = await runClaude(args, prompt, opts.cwd);
    const data = JSON.parse(stdout);
    if (data.is_error) {
      throw new Error(`Claude CLI error: ${data.result}`);
    }
    return {
      text: data.result ?? "",
      usage: data.usage
        ? {
            inputTokens: data.usage.input_tokens ?? 0,
            outputTokens: data.usage.output_tokens ?? 0,
          }
        : undefined,
    };
  }

  async askStructured<T>(
    prompt: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const args = [
      "-p",
      "-",
      "--output-format",
      "json",
      "--model",
      this.model,
      "--max-turns",
      "1",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--tools",
      "",
      "--setting-sources",
      "",
    ];

    // --json-schema in the current Claude CLI is a soft hint that triggers
    // tool-use mode (StructuredOutput tool), which doesn't compose well with
    // --tools "". We instead inline the schema in the prompt and require the
    // model to reply with JSON-only — then extract.
    const inlined =
      `${prompt}\n\n--\nReply with ONLY a single JSON value matching this JSON Schema. No prose, no code fences, no preamble.\n\nSchema:\n${JSON.stringify(schema)}`;
    const stdout = await runClaude(args, inlined);

    const data = JSON.parse(stdout);
    if (data.is_error) {
      throw new Error(`Claude CLI error: ${data.result}`);
    }

    return parseJsonReply<T>(data.result ?? "");
  }
}
