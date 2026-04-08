import type { LLMProvider } from "@mindnest/shared";

export interface LLMResponse {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMProviderInterface {
  readonly name: LLMProvider;
  ask(prompt: string, systemPrompt?: string): Promise<LLMResponse>;
  askStructured<T>(prompt: string, schema: Record<string, unknown>): Promise<T>;
}
