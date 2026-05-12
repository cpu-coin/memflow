import type { MemoryEmbedding, MemoryKind } from "../types/memory.js";

export const MEMFLOW_EMBEDDING_VERSION_LOCAL = "memflow-local-v1";
const DEFAULT_DIMENSIONS = 64;

export interface EmbeddingProvider {
  readonly name: string;
  embedText(text: string): MemoryEmbedding;
  supports(kind: MemoryKind): boolean;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = MEMFLOW_EMBEDDING_VERSION_LOCAL;

  embedText(text: string): MemoryEmbedding {
    const values = new Array<number>(DEFAULT_DIMENSIONS).fill(0);
    const tokens = tokenize(text);

    for (const token of tokens) {
      const index = hashToken(token) % DEFAULT_DIMENSIONS;
      values[index] += 1;
    }

    const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
    const normalized =
      magnitude > 0 ? values.map((value) => Number((value / magnitude).toFixed(6))) : values;

    return {
      dimensions: DEFAULT_DIMENSIONS,
      model: this.name,
      values: normalized,
    };
  }

  supports(kind: MemoryKind): boolean {
    return kind !== "session";
  }
}

export function cosineSimilarity(
  left?: MemoryEmbedding,
  right?: MemoryEmbedding
): number {
  if (!left || !right || left.values.length === 0 || right.values.length === 0) {
    return 0;
  }

  const length = Math.min(left.values.length, right.values.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < length; index += 1) {
    const leftValue = left.values[index] ?? 0;
    const rightValue = right.values[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function shouldAutoEmbed(kind: MemoryKind): boolean {
  return kind !== "session";
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function hashToken(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
