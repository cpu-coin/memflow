import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import {
  applyMemoryUpdate,
  computeContentHash,
  createMemoryEntry,
  normalizeMemoryEntry,
} from "../core/entry.js";
import { decideMerge, entriesEquivalent } from "../core/merge.js";
import { InvalidMemoryInputError } from "../core/errors.js";
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
import type { ConnectorHealth } from "./types.js";
import { DeferredConnector } from "./base.js";

export interface SQLiteConnectorConfig {
  databasePath: string;
  namespace?: string;
  readOnly?: boolean;
  walMode?: boolean;
}

type Row = {
  content_hash: string | null;
  confidence: number | null;
  content: string;
  coordinates: string;
  created_at: string;
  embedding: string | null;
  embedding_version: string | null;
  expires_at: string | null;
  id: string;
  key: string;
  kind: string;
  last_verified_at: string | null;
  metadata: string;
  namespace: string | null;
  project_id: string | null;
  provenance: string;
  schema_version: number | null;
  source: string | null;
  tags: string;
  title: string | null;
  updated_at: string;
  version: number;
};

export class SQLiteConnector extends DeferredConnector {
  readonly kind: ConnectorKind = "sqlite";
  readonly name: string = "sqlite";

  private readonly db: Database.Database;

  constructor(readonly config: SQLiteConnectorConfig) {
    super();

    if (config.databasePath !== ":memory:") {
      const parent = dirname(config.databasePath);
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
      }
    }

    this.db = new Database(config.databasePath, {
      readonly: config.readOnly ?? false,
    });

    if ((config.walMode ?? true) && !config.readOnly) {
      this.db.pragma("journal_mode = WAL");
    }
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("synchronous = NORMAL");

    this.initializeSchema();
  }

  override async close(): Promise<void> {
    this.db.close();
  }

  override async delete(id: string): Promise<MemoryDeleteResult> {
    const result = this.db
      .prepare("DELETE FROM memory_entries WHERE id = ?")
      .run(id.trim());

    return {
      deleted: result.changes > 0,
      id: result.changes > 0 ? id : undefined,
    };
  }

  override async diff(bundle: MemoryExportBundle): Promise<MemoryDiffResult> {
    const localIndex = new Map<string, MemoryEntry>();
    for (const entry of await this.list()) {
      localIndex.set(this.identityKey(entry), entry);
    }

    const incomingIndex = new Map<string, MemoryEntry>();
    for (const entry of bundle.entries) {
      const normalized = normalizeMemoryEntry(entry);
      incomingIndex.set(this.identityKey(normalized), normalized);
    }

    const added: string[] = [];
    const changed: string[] = [];
    const removed: string[] = [];

    for (const [identity, entry] of incomingIndex) {
      const local = localIndex.get(identity);
      if (!local) {
        added.push(entry.id);
        continue;
      }
      if (!entriesEquivalent(local, entry)) {
        changed.push(entry.id);
      }
    }

    for (const [identity, entry] of localIndex) {
      if (!incomingIndex.has(identity)) {
        removed.push(entry.id);
      }
    }

    return {
      added: added.sort(),
      changed: changed.sort(),
      removed: removed.sort(),
    };
  }

  override async export(query?: MemoryQuery): Promise<MemoryExportBundle> {
    const entries = await this.list(query);
    return {
      exportedAt: new Date().toISOString(),
      formatVersion: "1",
      entries,
    };
  }

  override async get(id: string): Promise<MemoryEntry | null> {
    const row = this.db
      .prepare("SELECT * FROM memory_entries WHERE id = ?")
      .get(id.trim()) as Row | undefined;

    return row ? this.toEntry(row) : null;
  }

  override async health(): Promise<ConnectorHealth> {
    try {
      const row = this.db.prepare("SELECT 1 AS ok").get() as { ok: number };
      return {
        kind: this.kind,
        name: this.name,
        ok: row.ok === 1,
        details: {
          databasePath: this.config.databasePath,
          readOnly: this.config.readOnly ?? false,
        },
      };
    } catch (error) {
      return {
        kind: this.kind,
        name: this.name,
        ok: false,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  override async import(bundle: MemoryExportBundle): Promise<MemoryImportResult> {
    return this.applyBundle(bundle, false);
  }

  override async list(query?: MemoryQuery): Promise<MemoryEntry[]> {
    const compiled = this.compileQuery(query, false);
    const rows = this.db.prepare(compiled.sql).all(...compiled.params) as Row[];
    return rows.map((row) => this.toEntry(row));
  }

  override async merge(bundle: MemoryExportBundle): Promise<MemoryImportResult> {
    return this.applyBundle(bundle, true);
  }

  override async search(query: MemoryQuery): Promise<SearchResult[]> {
    const normalized = {
      ...query,
      text: query.text?.trim(),
    };

    const compiled = this.compileQuery(normalized, true);
    const rows = this.db.prepare(compiled.sql).all(...compiled.params) as Row[];
    const entries = rows.map((row) => this.toEntry(row));
    const results = entries
      .map((entry) => ({
        entry,
        score: this.scoreEntry(entry, normalized),
      }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score);

    const limit = normalized.limit ?? 10;
    return results.slice(0, limit);
  }

  override async stats(): Promise<MemoryStats> {
    const counts = this.db
      .prepare(`
        SELECT
          COUNT(*) AS entries,
          COUNT(DISTINCT namespace) AS namespaces,
          COUNT(DISTINCT COALESCE(project_id, '')) AS projects
        FROM memory_entries
      `)
      .get() as { entries: number; namespaces: number; projects: number };

    const stale = this.db
      .prepare(`
        SELECT COUNT(*) AS total
        FROM memory_entries
        WHERE last_verified_at IS NULL
      `)
      .get() as { total: number };

    return {
      connector: this.name,
      entries: counts.entries,
      namespaces: counts.namespaces,
      projects: counts.projects,
      staleEntries: stale.total,
    };
  }

  override async update(id: string, input: MemoryUpdateInput): Promise<MemoryEntry> {
    const current = await this.get(id);
    if (!current) {
      throw new InvalidMemoryInputError(`Memory entry not found: ${id}`);
    }

    const updated = applyMemoryUpdate(current, input);
    this.writeEntry(updated);
    return updated;
  }

  override async upsert(input: MemoryWriteInput): Promise<MemoryEntry> {
    const existing = this.findByCompositeKey(input.coordinates.namespace, input.key);
    const entry = createMemoryEntry(input, existing ?? undefined);

    this.writeEntry(entry);
    return entry;
  }

  private applyBundle(
    bundle: MemoryExportBundle,
    mergeMode: boolean
  ): MemoryImportResult {
    let imported = 0;
    let skipped = 0;
    let updated = 0;
    const conflicts: MemoryImportResult["conflicts"] = [];

    const transaction = this.db.transaction((entries: MemoryEntry[]) => {
      for (const incoming of entries) {
        const entry = normalizeMemoryEntry(incoming);
        const existing = this.findByCompositeKey(entry.coordinates.namespace, entry.key);
        const decision = decideMerge(existing, entry, mergeMode);
        if (decision.conflict) {
          conflicts.push(decision.conflict);
        }

        if (decision.action === "imported" && decision.entry) {
          this.writeEntry(decision.entry);
          imported += 1;
          continue;
        }

        if (decision.action === "updated" && decision.entry) {
          this.writeEntry(decision.entry);
          updated += 1;
          continue;
        }

        skipped += 1;
      }
    });

    transaction(bundle.entries);

    return { conflicts, imported, skipped, updated };
  }

  private compileQuery(query?: MemoryQuery, forSearch?: boolean): {
    params: unknown[];
    sql: string;
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (!query?.includeExpired) {
      clauses.push("(expires_at IS NULL OR expires_at > ?)");
      params.push(new Date().toISOString());
    }

    if (query?.namespace) {
      clauses.push("json_extract(coordinates, '$.namespace') = ?");
      params.push(query.namespace);
    }
    if (query?.project) {
      clauses.push("json_extract(coordinates, '$.project') = ?");
      params.push(query.project);
    }
    if (query?.repo) {
      clauses.push("json_extract(coordinates, '$.repo') = ?");
      params.push(query.repo);
    }
    if (query?.scope) {
      clauses.push("json_extract(coordinates, '$.scope') = ?");
      params.push(query.scope);
    }
    if (query?.tenant) {
      clauses.push("json_extract(coordinates, '$.tenant') = ?");
      params.push(query.tenant);
    }
    if (query?.user) {
      clauses.push("json_extract(coordinates, '$.user') = ?");
      params.push(query.user);
    }
    if (query?.workspace) {
      clauses.push("json_extract(coordinates, '$.workspace') = ?");
      params.push(query.workspace);
    }
    if (query?.kind) {
      clauses.push("kind = ?");
      params.push(query.kind);
    }
    if (query?.key) {
      clauses.push("key = ?");
      params.push(query.key);
    }
    if (query?.tags?.length) {
      for (const tag of query.tags) {
        clauses.push("tags LIKE ?");
        params.push(`%${JSON.stringify(tag).slice(1, -1)}%`);
      }
    }
    if (query?.text && !forSearch) {
      clauses.push("(content LIKE ? OR key LIKE ? OR metadata LIKE ?)");
      params.push(`%${query.text}%`, `%${query.text}%`, `%${query.text}%`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = query?.limit ?? 100;
    const offset = query?.offset ?? 0;

    return {
      sql: `
        SELECT *
        FROM memory_entries
        ${where}
        ORDER BY updated_at DESC, key ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `,
      params,
    };
  }

  private findByCompositeKey(namespace: string, key: string): MemoryEntry | null {
    const row = this.db
      .prepare(`
        SELECT *
        FROM memory_entries
        WHERE json_extract(coordinates, '$.namespace') = ? AND key = ?
        LIMIT 1
      `)
      .get(namespace, key) as Row | undefined;

    return row ? this.toEntry(row) : null;
  }

  private identityKey(entry: MemoryEntry): string {
    return `${entry.coordinates.namespace}::${entry.key}`;
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        namespace TEXT NOT NULL,
        project_id TEXT,
        coordinates TEXT NOT NULL,
        kind TEXT NOT NULL,
        tags TEXT NOT NULL,
        metadata TEXT NOT NULL,
        source TEXT NOT NULL,
        provenance TEXT NOT NULL,
        confidence REAL,
        embedding TEXT,
        schema_version INTEGER NOT NULL,
        embedding_version TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        last_verified_at TEXT,
        version INTEGER NOT NULL
      );
    `);

    this.ensureColumn("title", "TEXT");
    this.ensureColumn("namespace", "TEXT");
    this.ensureColumn("project_id", "TEXT");
    this.ensureColumn("source", "TEXT");
    this.ensureColumn("schema_version", "INTEGER");
    this.ensureColumn("embedding_version", "TEXT");
    this.ensureColumn("content_hash", "TEXT");

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_namespace_key
        ON memory_entries (json_extract(coordinates, '$.namespace'), key);
      CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory_entries (kind);
      CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_entries (namespace);
      CREATE INDEX IF NOT EXISTS idx_memory_updated_at ON memory_entries (updated_at);
    `);

    this.backfillSchemaColumns();
  }

  private scoreEntry(entry: MemoryEntry, query: MemoryQuery): number {
    if (!query.text) {
      return 1;
    }

    const haystack = [
      entry.key,
      entry.content,
      entry.coordinates.namespace,
      ...entry.tags,
      JSON.stringify(entry.metadata),
    ]
      .join(" ")
      .toLowerCase();

    const terms = query.text
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) {
      return 1;
    }

    let hits = 0;
    for (const term of terms) {
      if (haystack.includes(term)) {
        hits += 1;
      }
    }

    const score = hits / terms.length;
    const threshold = query.threshold ?? 0;
    return score >= threshold ? score : 0;
  }

  private toEntry(row: Row): MemoryEntry {
    return {
      id: row.id,
      key: row.key,
      title: row.title ?? row.key,
      content: row.content,
      namespace: row.namespace ?? JSON.parse(row.coordinates).namespace,
      projectId: row.project_id ?? JSON.parse(row.coordinates).project ?? undefined,
      coordinates: JSON.parse(row.coordinates),
      kind: row.kind as MemoryEntry["kind"],
      tags: JSON.parse(row.tags),
      metadata: JSON.parse(row.metadata),
      source:
        row.source ??
        JSON.parse(row.provenance).importedFrom ??
        JSON.parse(row.provenance).connector ??
        JSON.parse(row.provenance).source,
      provenance: JSON.parse(row.provenance),
      confidence: row.confidence ?? undefined,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      schemaVersion: row.schema_version ?? 1,
      embeddingVersion:
        row.embedding_version ??
        (row.embedding ? (JSON.parse(row.embedding).model ?? "custom") : "none"),
      contentHash: row.content_hash ?? computeContentHash(row.content),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at ?? undefined,
      lastVerifiedAt: row.last_verified_at ?? undefined,
      version: row.version,
    };
  }

  private writeEntry(entry: MemoryEntry): void {
    this.db
      .prepare(`
        INSERT INTO memory_entries (
          id, key, title, content, namespace, project_id, coordinates, kind, tags, metadata, source,
          provenance, confidence, embedding, schema_version, embedding_version, content_hash,
          created_at, updated_at, expires_at, last_verified_at, version
        ) VALUES (
          @id, @key, @title, @content, @namespace, @project_id, @coordinates, @kind, @tags, @metadata, @source,
          @provenance, @confidence, @embedding, @schema_version, @embedding_version, @content_hash,
          @created_at, @updated_at, @expires_at, @last_verified_at, @version
        )
        ON CONFLICT(id) DO UPDATE SET
          key = excluded.key,
          title = excluded.title,
          content = excluded.content,
          namespace = excluded.namespace,
          project_id = excluded.project_id,
          coordinates = excluded.coordinates,
          kind = excluded.kind,
          tags = excluded.tags,
          metadata = excluded.metadata,
          source = excluded.source,
          provenance = excluded.provenance,
          confidence = excluded.confidence,
          embedding = excluded.embedding,
          schema_version = excluded.schema_version,
          embedding_version = excluded.embedding_version,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          last_verified_at = excluded.last_verified_at,
          version = excluded.version
      `)
      .run({
        id: entry.id,
        key: entry.key,
        title: entry.title,
        content: entry.content,
        namespace: entry.namespace,
        project_id: entry.projectId ?? null,
        coordinates: JSON.stringify(entry.coordinates),
        kind: entry.kind,
        tags: JSON.stringify(entry.tags),
        metadata: JSON.stringify(entry.metadata),
        source: entry.source,
        provenance: JSON.stringify(entry.provenance),
        confidence: entry.confidence ?? null,
        embedding: entry.embedding ? JSON.stringify(entry.embedding) : null,
        schema_version: entry.schemaVersion,
        embedding_version: entry.embeddingVersion,
        content_hash: entry.contentHash,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
        expires_at: entry.expiresAt ?? null,
        last_verified_at: entry.lastVerifiedAt ?? null,
        version: entry.version,
      });
  }

  private backfillSchemaColumns(): void {
    const rows = this.db.prepare("SELECT * FROM memory_entries").all() as Row[];
    for (const row of rows) {
      this.writeEntry(normalizeMemoryEntry(this.toEntry(row)));
    }
  }

  private ensureColumn(name: string, definition: string): void {
    const columns = this.db
      .prepare("PRAGMA table_info(memory_entries)")
      .all() as Array<{ name: string }>;

    if (!columns.some((column) => column.name === name)) {
      this.db.exec(`ALTER TABLE memory_entries ADD COLUMN ${name} ${definition}`);
    }
  }
}
