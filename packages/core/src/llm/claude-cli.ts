import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { LLMProviderInterface, LLMResponse } from "./provider";

function runClaude(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      cwd: tmpdir(),
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

    proc.on("error", (err) => {
      reject(err);
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

  async askStructured<T>(
    prompt: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const args = [
      "-p",
      "-",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(schema),
      "--model",
      this.model,
      "--max-turns",
      "1",
      "--no-session-persistence",
    ];

    const stdout = await runClaude(args, prompt);

    const data = JSON.parse(stdout);

    if (data.is_error) {
      throw new Error(`Claude CLI error: ${data.result}`);
    }

    return JSON.parse(data.result) as T;
  }
}
