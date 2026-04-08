import type { LLMProviderInterface, LLMResponse } from "./provider";

function usesNewApi(model: string): boolean {
  // All newer OpenAI models (o-series, gpt-5+, chatgpt-*) use max_completion_tokens + developer role
  // Only legacy gpt-4* and gpt-3.5* use max_tokens + system role
  return !/^gpt-(4|3\.5)/.test(model);
}

function buildBody(model: string, messages: Array<{ role: string; content: string }>, extra?: Record<string, unknown>) {
  const body: Record<string, unknown> = { model, messages, ...extra };

  if (usesNewApi(model)) {
    body.max_completion_tokens = 16384;
  } else {
    body.max_tokens = 4096;
  }

  return body;
}

export class OpenAIProvider implements LLMProviderInterface {
  readonly name = "openai" as const;

  constructor(
    private model: string = "gpt-4o",
    private apiKey?: string,
  ) {
    if (!apiKey && !process.env.OPENAI_API_KEY) {
      throw new Error("OpenAI API key required. Set OPENAI_API_KEY env var or pass in config.");
    }
  }

  async ask(prompt: string, systemPrompt?: string): Promise<LLMResponse> {
    const key = this.apiKey ?? process.env.OPENAI_API_KEY!;

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: usesNewApi(this.model) ? "developer" : "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(buildBody(this.model, messages)),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return {
      text: data.choices[0]?.message?.content ?? "",
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }

  async askStructured<T>(
    prompt: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    const key = this.apiKey ?? process.env.OPENAI_API_KEY!;

    const messages: Array<{ role: string; content: string }> = [
      {
        role: usesNewApi(this.model) ? "developer" : "system",
        content: `Respond ONLY with valid JSON matching this schema: ${JSON.stringify(schema)}`,
      },
      { role: "user", content: prompt },
    ];

    const extra: Record<string, unknown> = {};
    if (!usesNewApi(this.model)) {
      extra.response_format = { type: "json_object" };
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(buildBody(this.model, messages, extra)),
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return JSON.parse(data.choices[0]?.message?.content ?? "{}") as T;
  }
}
