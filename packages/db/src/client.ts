import { ChromaClient } from "chromadb";

let client: ChromaClient | null = null;

export function getChromaClient(path?: string): ChromaClient {
  if (!client) {
    client = new ChromaClient({
      path: path ?? "http://localhost:8000",
    });
  }
  return client;
}

export async function getOrCreateCollection(name: string = "nestbrain") {
  const chroma = getChromaClient();
  return chroma.getOrCreateCollection({ name });
}
