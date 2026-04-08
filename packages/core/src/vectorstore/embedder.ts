let pipeline: unknown = null;

async function getEmbedder() {
  if (!pipeline) {
    const { pipeline: createPipeline } = await import("@huggingface/transformers");
    pipeline = await createPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: "fp32",
    });
  }
  return pipeline as (text: string, opts: Record<string, unknown>) => Promise<{ tolist: () => number[][] }>;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbedder();
  const results: number[][] = [];

  for (const text of texts) {
    // Truncate to ~500 chars to stay within model's token limit
    const truncated = text.slice(0, 2000);
    const output = await embedder(truncated, { pooling: "mean", normalize: true });
    results.push(output.tolist()[0]);
  }

  return results;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
