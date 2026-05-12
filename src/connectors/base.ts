import { ConnectorNotReadyError } from "../core/errors.js";
import type {
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
import type { ConnectorHealth, DatabaseConnector } from "./types.js";

export abstract class DeferredConnector implements DatabaseConnector {
  abstract readonly kind: DatabaseConnector["kind"];
  abstract readonly name: string;

  protected notReady(operation: string): never {
    throw new ConnectorNotReadyError(
      `${this.name} connector is not implemented for ${operation} yet`
    );
  }

  async close(): Promise<void> {
    // Override if connector requires explicit socket/connection teardown
  }

  async delete(_id: string): Promise<MemoryDeleteResult> {
    return this.notReady("delete");
  }

  async diff(_bundle: MemoryExportBundle): Promise<MemoryDiffResult> {
    return this.notReady("diff");
  }

  async export(_query?: MemoryQuery): Promise<MemoryExportBundle> {
    return this.notReady("export");
  }

  async get(_id: string): Promise<MemoryEntry | null> {
    return this.notReady("get");
  }

  async health(): Promise<ConnectorHealth> {
    return {
      kind: this.kind,
      name: this.name,
      ok: false,
      details: {
        ready: false,
      },
    };
  }

  async import(_bundle: MemoryExportBundle): Promise<MemoryImportResult> {
    return this.notReady("import");
  }

  async list(_query?: MemoryQuery): Promise<MemoryEntry[]> {
    return this.notReady("list");
  }

  async merge(_bundle: MemoryExportBundle): Promise<MemoryImportResult> {
    return this.notReady("merge");
  }

  async search(_query: MemoryQuery): Promise<SearchResult[]> {
    return this.notReady("search");
  }

  async stats(): Promise<MemoryStats> {
    return this.notReady("stats");
  }

  async update(_id: string, _input: MemoryUpdateInput): Promise<MemoryEntry> {
    return this.notReady("update");
  }

  async upsert(_input: MemoryWriteInput): Promise<MemoryEntry> {
    return this.notReady("upsert");
  }
}
