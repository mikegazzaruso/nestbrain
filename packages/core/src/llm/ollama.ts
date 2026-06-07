import type { LLMProviderInterface, LLMResponse } from "./provider";

/**
 * Local Ollama server. Talks to the REST API exposed by `ollama serve`
 * (default http://127.0.0.1:11434). No API key — the models run on the
 * user's own machine. Override the host with the OLLAMA_HOST env var.
 */
export const OLLAMA_DEFAULT_HOST = "http://127.0.0.1:11434";

export function ollamaHost(): string {
  return (process.env.OLLAMA_HOST || OLLAMA_DEFAULT_HOST).replace(/\/$/, "");
}

export class OllamaProvider implements LLMProviderInterface {
  readonly name = "ollama" as const;
  private baseUrl: string;

  constructor(
    private model: string = "llama3",
    baseUrl?: string,
  ) {
    this.baseUrl = (baseUrl || ollamaHost()).replace(/\/$/, "");
  }

  async ask(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
    messages.push({ role: "user", content: prompt });

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, messages, stream: false }),
    });

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return {
      text: data.message?.content ?? "",
      usage:
        data.prompt_eval_count != null || data.eval_count != null
          ? {
              inputTokens: data.prompt_eval_count ?? 0,
              outputTokens: data.eval_count ?? 0,
            }
          : undefined,
    };
  }

  async askStructured<T>(
    prompt: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const messages = [
      {
        role: "system",
        content: `Respond ONLY with valid JSON matching this schema: ${JSON.stringify(schema)}`,
      },
      { role: "user", content: prompt },
    ];

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `format: "json"` constrains Ollama to emit a single JSON value.
      body: JSON.stringify({ model: this.model, messages, stream: false, format: "json" }),
    });

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return JSON.parse(data.message?.content ?? "{}") as T;
  }
}
