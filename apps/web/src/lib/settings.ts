import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface AppSettings {
  llm: {
    provider: "claude-cli" | "openai";
    openaiApiKey: string;
    openaiModel: string;
    claudeModel: string;
  };
  autoCompile?: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    provider: "claude-cli",
    openaiApiKey: "",
    openaiModel: "gpt-4o",
    claudeModel: "sonnet",
  },
  autoCompile: false,
};

const SETTINGS_PATH = join(process.cwd(), "../../data/settings.json");

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf-8");
    const saved = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...saved, llm: { ...DEFAULT_SETTINGS.llm, ...saved.llm }, autoCompile: saved.autoCompile ?? DEFAULT_SETTINGS.autoCompile };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}
