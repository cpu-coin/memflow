import { createHash, randomUUID } from "node:crypto";

import {
  MEMFLOW_EMBEDDING_VERSION_NONE,
  MEMFLOW_SCHEMA_VERSION,
  type MemoryCoordinates,
  type MemoryEmbedding,
  type MemoryEntry,
  type MemoryProvenance,
  type MemoryUpdateInput,
  type MemoryWriteInput,
} from "../types/memory.js";

type PartialMemoryEntry = Partial<MemoryEntry> &
  Pick<MemoryWriteInput, "content" | "coordinates" | "key" | "provenance">;

function normalizeMemoryKind(
  kind: MemoryWriteInput["kind"] | MemoryEntry["kind"] | undefined
): MemoryEntry["kind"] {
  if (kind === "snippet") {
    return "rag";
  }

  return kind ?? "knowledge";
}

function deriveTitle(key: string, title?: string): string {
  return title?.trim() || key.trim();
}

function deriveSource(
  source: string | undefined,
  provenance: MemoryProvenance
): string {
  return (
    source?.trim() ||
    provenance.importedFrom?.trim() ||
    provenance.connector?.trim() ||
    provenance.source
  );
}

function deriveEmbeddingVersion(
  embeddingVersion: string | undefined | null,
  embedding: MemoryEmbedding | undefined
): string {
  return (
    embeddingVersion?.trim() ||
    embedding?.model?.trim() ||
    MEMFLOW_EMBEDDING_VERSION_NONE
  );
}

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function normalizeMemoryEntry(entry: PartialMemoryEntry): MemoryEntry {
  const createdAt = entry.createdAt ?? new Date().toISOString();
  const updatedAt = entry.updatedAt ?? createdAt;
  const title = deriveTitle(entry.key, entry.title);
  const namespace = entry.namespace?.trim() || entry.coordinates.namespace;
  const projectId = entry.projectId ?? entry.coordinates.project;
  const embeddingVersion = deriveEmbeddingVersion(
    entry.embeddingVersion,
    entry.embedding
  );
  const computedContentHash = computeContentHash(entry.content);

  return {
    id: entry.id ?? randomUUID(),
    key: entry.key.trim(),
    title,
    content: entry.content,
    namespace,
    projectId,
    coordinates: normalizeCoordinates(entry.coordinates),
    kind: normalizeMemoryKind(entry.kind),
    tags: entry.tags ?? [],
    metadata: entry.metadata ?? {},
    source: deriveSource(entry.source, entry.provenance),
    provenance: entry.provenance,
    confidence: entry.confidence,
    embedding: entry.embedding,
    schemaVersion: entry.schemaVersion ?? MEMFLOW_SCHEMA_VERSION,
    embeddingVersion,
    contentHash:
      entry.contentHash && entry.contentHash === computedContentHash
        ? entry.contentHash
        : computedContentHash,
    createdAt,
    updatedAt,
    expiresAt: entry.expiresAt,
    lastVerifiedAt: entry.lastVerifiedAt,
    version: entry.version ?? 1,
  };
}

export function createMemoryEntry(
  input: MemoryWriteInput,
  existing?: MemoryEntry
): MemoryEntry {
  const now = new Date().toISOString();
  const partial = input as Partial<MemoryEntry> & MemoryWriteInput;
  const contentChanged = partial.content !== existing?.content;

  return normalizeMemoryEntry({
    ...existing,
    ...partial,
    id: existing?.id ?? partial.id,
    createdAt: existing?.createdAt ?? partial.createdAt ?? now,
    contentHash: contentChanged ? undefined : (partial.contentHash ?? existing?.contentHash),
    updatedAt: now,
    version: existing ? existing.version + 1 : (partial.version ?? 1),
  });
}

export function applyMemoryUpdate(
  current: MemoryEntry,
  input: MemoryUpdateInput
): MemoryEntry {
  return normalizeMemoryEntry({
    ...current,
    title: input.title ?? current.title,
    content: input.content ?? current.content,
    contentHash: input.content === undefined ? current.contentHash : undefined,
    source: input.source ?? current.source,
    confidence: input.confidence ?? current.confidence,
    embedding: input.embedding ?? current.embedding,
    embeddingVersion:
      input.embeddingVersion === null
        ? MEMFLOW_EMBEDDING_VERSION_NONE
        : (input.embeddingVersion ?? current.embeddingVersion),
    expiresAt:
      input.expiresAt === null ? undefined : (input.expiresAt ?? current.expiresAt),
    lastVerifiedAt:
      input.lastVerifiedAt === null
        ? undefined
        : (input.lastVerifiedAt ?? current.lastVerifiedAt),
    metadata: input.metadata
      ? { ...current.metadata, ...input.metadata }
      : current.metadata,
    tags: input.tags ?? current.tags,
    updatedAt: new Date().toISOString(),
    version: current.version + 1,
  });
}

function normalizeCoordinates(coordinates: MemoryCoordinates): MemoryCoordinates {
  return {
    ...coordinates,
    namespace: coordinates.namespace.trim(),
    project: coordinates.project?.trim() || undefined,
    repo: coordinates.repo?.trim() || undefined,
    tenant: coordinates.tenant?.trim() || undefined,
    user: coordinates.user?.trim() || undefined,
    workspace: coordinates.workspace?.trim() || undefined,
  };
}
