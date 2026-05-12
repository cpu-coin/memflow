import type { MemoryEntry } from "../types/memory.js";

/**
 * Interface for vector index adapters.
 * Allows MemFlow to attach a shared vector index (e.g., Pinecone, Qdrant)
 * alongside the canonical structured storage.
 */
export interface MemFlowVectorAdapter {
  /**
   * Generates or fetches embeddings for a structured text input
   */
  encode(text: string): Promise<number[]>;

  /**
   * Upserts the vector representation of a Memory Entry into the index
   */
  upsertVector(entry: MemoryEntry, vector: number[]): Promise<void>;

  /**
   * Hybrid retrieval boundary matching semantic proximity alongside structured metadata filters
   */
  hybridSearch(queryVector: number[], filter: Record<string, any>, limit: number): Promise<string[]>;

  /**
   * Invalidates or deletes vector entries from the index
   */
  deleteVectors(entryIds: string[]): Promise<void>;
}
