import { normalizeMemoryEntry } from "./entry.js";
import type { MemoryEntry, MemoryMergeConflict } from "../types/memory.js";

export interface MergeDecision {
  action: "imported" | "skipped" | "updated";
  conflict?: MemoryMergeConflict;
  entry?: MemoryEntry;
}

function entryFingerprint(entry: MemoryEntry): string {
  return JSON.stringify({
    contentHash: entry.contentHash,
    coordinates: entry.coordinates,
    embeddingVersion: entry.embeddingVersion,
    expiresAt: entry.expiresAt,
    kind: entry.kind,
    lastVerifiedAt: entry.lastVerifiedAt,
    metadata: entry.metadata,
    schemaVersion: entry.schemaVersion,
    source: entry.source,
    tags: [...entry.tags].sort(),
    title: entry.title,
  });
}

export function entriesEquivalent(left: MemoryEntry, right: MemoryEntry): boolean {
  return entryFingerprint(left) === entryFingerprint(right);
}

function compareEntries(existing: MemoryEntry, incoming: MemoryEntry): number {
  if (incoming.version !== existing.version) {
    return incoming.version > existing.version ? 1 : -1;
  }

  const updatedAtCompare = incoming.updatedAt.localeCompare(existing.updatedAt);
  if (updatedAtCompare !== 0) {
    return updatedAtCompare > 0 ? 1 : -1;
  }

  return 1;
}

export function reconcileImportedEntry(existing: MemoryEntry, incoming: MemoryEntry): MemoryEntry {
  const winnerIsIncoming = compareEntries(existing, incoming) >= 0;
  const winner = winnerIsIncoming ? incoming : existing;

  return normalizeMemoryEntry({
    ...winner,
    id: existing.id,
    createdAt:
      existing.createdAt.localeCompare(incoming.createdAt) <= 0
        ? existing.createdAt
        : incoming.createdAt,
    updatedAt: winner.updatedAt,
    version: Math.max(existing.version, incoming.version),
  });
}

export function decideMerge(
  existing: MemoryEntry | null,
  incoming: MemoryEntry,
  mergeMode: boolean
): MergeDecision {
  if (!existing) {
    return {
      action: "imported",
      entry: normalizeMemoryEntry(incoming),
    };
  }

  if (entriesEquivalent(existing, incoming)) {
    return {
      action: "skipped",
    };
  }

  if (!mergeMode) {
    return {
      action: "updated",
      entry: reconcileImportedEntry(existing, incoming),
    };
  }

  const comparison = compareEntries(existing, incoming);
  if (comparison < 0) {
    return {
      action: "skipped",
      conflict: {
        existingId: existing.id,
        incomingId: incoming.id,
        key: existing.key,
        namespace: existing.coordinates.namespace,
        reason: "local-newer",
        resolution: "kept-existing",
      },
    };
  }

  return {
    action: "updated",
    entry: reconcileImportedEntry(existing, incoming),
    conflict: {
      existingId: existing.id,
      incomingId: incoming.id,
      key: existing.key,
      namespace: existing.coordinates.namespace,
      reason:
        existing.version === incoming.version &&
        existing.updatedAt === incoming.updatedAt
          ? "content-conflict"
          : "incoming-newer",
      resolution: "used-incoming",
    },
  };
}
