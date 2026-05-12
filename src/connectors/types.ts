import type {
  ConnectorKind,
  MemoryDeleteResult,
  MemoryDiffResult,
  MemoryEntry,
  MemoryExportBundle,
  MemoryImportResult,
  MemoryQuery,
  MemoryStats,
  MemoryUpdateInput,
  MemoryWriteInput,
  SearchResult,
} from "../types/memory.js";

export interface ConnectorHealth {
  kind: ConnectorKind;
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
}

export interface DatabaseConnector {
  readonly kind: ConnectorKind;
  readonly name: string;
  close(): Promise<void>;
  delete(id: string): Promise<MemoryDeleteResult>;
  diff(bundle: MemoryExportBundle): Promise<MemoryDiffResult>;
  export(query?: MemoryQuery): Promise<MemoryExportBundle>;
  get(id: string): Promise<MemoryEntry | null>;
  health(): Promise<ConnectorHealth>;
  import(bundle: MemoryExportBundle): Promise<MemoryImportResult>;
  list(query?: MemoryQuery): Promise<MemoryEntry[]>;
  merge(bundle: MemoryExportBundle): Promise<MemoryImportResult>;
  search(query: MemoryQuery): Promise<SearchResult[]>;
  stats(): Promise<MemoryStats>;
  update(id: string, input: MemoryUpdateInput): Promise<MemoryEntry>;
  upsert(input: MemoryWriteInput): Promise<MemoryEntry>;
}
