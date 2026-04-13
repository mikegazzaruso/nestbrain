import type { LLMProvider } from "@nestbrain/shared";

export interface LLMResponse {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMProviderInterface {
  readonly name: LLMProvider;
  ask(prompt: string, systemPrompt?: string): Promise<LLMResponse>;
  askStructured<T>(prompt: string, schema: Record<string, unknown>): Promise<T>;
}

export function createProvider(config: {
  provider: LLMProvider;
  model: string;
  maxTurns: number;
  apiKey?: string;
}): LLMProviderInterface {
  switch (config.provider) {
    case "claude-cli":
      // Lazy import to avoid circular deps
      return new (require("./claude-cli").ClaudeCLIProvider)(config.model, config.maxTurns);
    case "openai":
      return new (require("./openai").OpenAIProvider)(config.model, config.apiKey);
    case "ollama":
      throw new Error("Ollama provider not yet implemented");
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
