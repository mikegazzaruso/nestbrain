export interface EmbeddingResult {
  id: string;
  embedding: number[];
  metadata: Record<string, string>;
}

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  readonly modelName: string;
}

// Local embedding provider using ChromaDB's default embedding function
// Uses Xenova/all-MiniLM-L6-v2 via transformers.js under the hood
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = "Xenova/all-MiniLM-L6-v2";

  async embed(texts: string[]): Promise<number[][]> {
    // ChromaDB handles embedding internally via chromadb-default-embed
    // This method is for standalone embedding use
    const { DefaultEmbeddingFunction } = await import("chromadb");
    const embedder = new DefaultEmbeddingFunction();
    return embedder.generate(texts);
  }
}
