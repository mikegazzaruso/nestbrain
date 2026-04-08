import { createProvider } from "@mindnest/core";
import type { LLMProviderInterface } from "@mindnest/core";
import { loadSettings } from "./settings";

let cachedProvider: LLMProviderInterface | null = null;
let cachedConfig: string = "";

export async function getLLM(): Promise<LLMProviderInterface> {
  const settings = await loadSettings();
  const configKey = JSON.stringify(settings.llm);

  // Recreate provider if settings changed
  if (cachedProvider && cachedConfig === configKey) {
    return cachedProvider;
  }

  cachedProvider = createProvider({
    provider: settings.llm.provider,
    model: settings.llm.provider === "claude-cli"
      ? settings.llm.claudeModel
      : settings.llm.openaiModel,
    maxTurns: 5,
    apiKey: settings.llm.provider === "openai" ? settings.llm.openaiApiKey : undefined,
  });

  cachedConfig = configKey;
  return cachedProvider;
}
