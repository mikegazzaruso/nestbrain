import { describe, it, expect } from "vitest";
import { DEFAULT_CONFIG, WIKI_DIRS, INDEX_FILES } from "../src/constants";

describe("constants", () => {
  it("DEFAULT_CONFIG has required fields", () => {
    expect(DEFAULT_CONFIG.wiki.path).toBe("./data/wiki");
    expect(DEFAULT_CONFIG.llm.provider).toBe("claude-cli");
    expect(DEFAULT_CONFIG.server.port).toBe(3000);
  });

  it("WIKI_DIRS has expected directories", () => {
    expect(WIKI_DIRS.sources).toBe("sources");
    expect(WIKI_DIRS.concepts).toBe("concepts");
    expect(WIKI_DIRS.outputs).toBe("outputs");
  });

  it("INDEX_FILES has expected filenames", () => {
    expect(INDEX_FILES.master).toBe("_index.md");
    expect(INDEX_FILES.concepts).toBe("_concepts.md");
  });
});
