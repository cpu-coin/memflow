import type { MemoryService } from "../core/memory-service.js";
import type { MemoryCoordinates, MemoryKind, MemoryWriteInput } from "../types/memory.js";

export interface IngestionPluginContext {
  service: MemoryService;
}

export interface IngestionPluginResult {
  entryId: string;
  plugin: string;
}

export interface IngestionPlugin<Input = unknown> {
  readonly id: string;
  ingest(input: Input, context: IngestionPluginContext): Promise<IngestionPluginResult>;
}

export interface IngestionMemoryTarget {
  coordinates: MemoryCoordinates;
  key: string;
  kind?: MemoryKind;
  metadata?: Record<string, unknown>;
  tags?: string[];
}

export type PluginPreparedWrite = MemoryWriteInput;
