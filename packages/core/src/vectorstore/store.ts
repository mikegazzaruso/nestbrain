import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { embed, cosineSimilarity } from "./embedder";

interface VectorEntry {
  id: string;
  title: string;
  filePath: string;
  type: string;
  content: string;     // first ~500 chars for snippet
  embedding: number[];
}

interface VectorIndex {
  entries: VectorEntry[];
  modelName: string;
  updatedAt: string;
}

const INDEX_FILE = "vector-index.json";

export class VectorStore {
  private index: VectorIndex = { entries: [], modelName: "all-MiniLM-L6-v2", updatedAt: "" };
  private indexPath: string;
  private loaded = false;

  constructor(private dataPath: string) {
    this.indexPath = join(dataPath, INDEX_FILE);
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.indexPath, "utf-8");
      this.index = JSON.parse(raw);
    } catch {
      this.index = { entries: [], modelName: "all-MiniLM-L6-v2", updatedAt: "" };
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true });
    this.index.updatedAt = new Date().toISOString();
    await writeFile(this.indexPath, JSON.stringify(this.index), "utf-8");
  }

  /** Add or update a document in the vector store */
  async upsert(id: string, title: string, filePath: string, type: string, fullContent: string): Promise<void> {
    await this.load();

    // Strip frontmatter for embedding
    const body = fullContent.replace(/^---[\s\S]*?---\n*/, "").trim();
    const snippet = body.slice(0, 500);

    // Generate embedding from title + first chunk of content
    const textToEmbed = `${title}. ${body.slice(0, 1500)}`;
    const [embedding] = await embed([textToEmbed]);

    // Remove existing entry if present
    this.index.entries = this.index.entries.filter((e) => e.id !== id);

    this.index.entries.push({ id, title, filePath, type, content: snippet, embedding });
  }

  /** Remove a document */
  async remove(id: string): Promise<void> {
    await this.load();
    this.index.entries = this.index.entries.filter((e) => e.id !== id);
  }

  /** Semantic search */
  async search(query: string, topK: number = 10): Promise<Array<{
    id: string;
    title: string;
    filePath: string;
    type: string;
    snippet: string;
    score: number;
  }>> {
    await this.load();

    if (this.index.entries.length === 0) return [];

    // Embed the query
    const [queryEmbedding] = await embed([query]);

    // Score all entries
    const scored = this.index.entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      filePath: entry.filePath,
      type: entry.type,
      snippet: entry.content,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }));

    // Sort by score descending, take top K
    scored.sort((a, b) => b.score - a.score);

    // Only return entries with a reasonable similarity (> 0.2)
    return scored.filter((s) => s.score > 0.2).slice(0, topK);
  }

  /** Check if a document is indexed */
  async has(id: string): Promise<boolean> {
    await this.load();
    return this.index.entries.some((e) => e.id === id);
  }

  /** Number of indexed documents */
  async count(): Promise<number> {
    await this.load();
    return this.index.entries.length;
  }
}
