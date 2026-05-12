import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { applyMemoryUpdate, createMemoryEntry, normalizeMemoryEntry } from "../core/entry.js";
import { decideMerge, entriesEquivalent } from "../core/merge.js";
import { ConnectorNotReadyError, InvalidMemoryInputError } from "../core/errors.js";
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

type MongoModule = {
  MongoClient: new (uri: string, options?: Record<string, unknown>) => {
    close(): Promise<void>;
    connect(): Promise<void>;
    db(name: string): {
      collection(name: string): {
        createIndex(index: Record<string, 1 | -1>, options?: Record<string, unknown>): Promise<string>;
        deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>;
        find(filter?: Record<string, unknown>): MongoCursor;
        findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
        replaceOne(
          filter: Record<string, unknown>,
          replacement: Record<string, unknown>,
          options?: Record<string, unknown>
        ): Promise<void>;
        countDocuments(filter?: Record<string, unknown>): Promise<number>;
      };
      command(command: Record<string, unknown>): Promise<Record<string, unknown>>;
    };
  };
};

type MongoCursor = {
  limit(n: number): MongoCursor;
  skip(n: number): MongoCursor;
  sort(spec: Record<string, 1 | -1>): MongoCursor;
  toArray(): Promise<Record<string, unknown>[]>;
};

export interface MongoDBConnectorConfig {
  collection?: string;
  connectTimeoutMs?: number;
  database: string;
  maxPoolSize?: number;
  minPoolSize?: number;
  moduleSearchPaths?: string[];
  socketTimeoutMS?: number;
  uri: string;
  waitQueueTimeoutMS?: number;
}

export class MongoDBConnector extends DeferredConnector {
  readonly kind: ConnectorKind = "mongodb";
  readonly name: string = "mongodb";

  private client: InstanceType<MongoModule["MongoClient"]> | null = null;
  private collectionPromise:
    | Promise<ReturnType<ReturnType<InstanceType<MongoModule["MongoClient"]>["db"]>["collection"]>>
    | null = null;
  private modulePromise: Promise<MongoModule> | null = null;

  constructor(readonly config: MongoDBConnectorConfig) {
    super();
  }

  override async delete(id: string): Promise<MemoryDeleteResult> {
    const collection = await this.getCollection();
    const result = await collection.deleteOne({ id: id.trim() });
    return {
      deleted: Boolean(result.deletedCount),
      id: result.deletedCount ? id : undefined,
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
    const collection = await this.getCollection();
    const doc = await collection.findOne({ id: id.trim() });
    return doc ? this.toEntry(doc) : null;
  }

  override async health(): Promise<ConnectorHealth> {
    try {
      const collection = await this.getCollection();
      const db = await this.getDb();
      const start = Date.now();
      await db.command({ ping: 1 });
      const pingMs = Date.now() - start;
      const count = await collection.countDocuments();

      return {
        kind: this.kind,
        name: this.name,
        ok: true,
        details: {
          collection: this.config.collection ?? "memories",
          database: this.config.database,
          entries: count,
          pingMs,
          options: {
            maxPoolSize: this.config.maxPoolSize ?? 20,
            connectTimeoutMs: this.config.connectTimeoutMs ?? 5_000,
            socketTimeoutMS: this.config.socketTimeoutMS,
          },
          uri: this.redactUri(this.config.uri),
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
    const collection = await this.getCollection();
    const filter = this.buildFilter(query, false);
    const cursor = collection
      .find(filter)
      .sort({ updatedAt: -1, key: 1 })
      .skip(query?.offset ?? 0)
      .limit(query?.limit ?? 100);
    const docs = await cursor.toArray();
    return docs.map((doc: Record<string, unknown>) => this.toEntry(doc));
  }

  override async merge(bundle: MemoryExportBundle): Promise<MemoryImportResult> {
    return this.applyBundle(bundle, true);
  }

  override async search(query: MemoryQuery): Promise<SearchResult[]> {
    const collection = await this.getCollection();
    const docs = await collection
      .find(this.buildFilter(query, true))
      .limit(query.limit ?? 100)
      .toArray();

    return docs
      .map((doc: Record<string, unknown>) => this.toEntry(doc))
      .map((entry: MemoryEntry) => ({
        entry,
        score: this.scoreEntry(entry, query),
      }))
      .filter((result: SearchResult) => result.score > 0)
      .sort((left: SearchResult, right: SearchResult) => right.score - left.score)
      .slice(0, query.limit ?? 10);
  }

  override async stats(): Promise<MemoryStats> {
    const entries = await this.list();
    const namespaces = new Set(entries.map((entry) => entry.coordinates.namespace));
    const projects = new Set(
      entries.map((entry) => entry.coordinates.project).filter((value): value is string => Boolean(value))
    );
    const staleEntries = entries.filter((entry) => !entry.lastVerifiedAt).length;

    return {
      connector: this.name,
      entries: entries.length,
      namespaces: namespaces.size,
      projects: projects.size,
      staleEntries,
    };
  }

  override async update(id: string, input: MemoryUpdateInput): Promise<MemoryEntry> {
    const current = await this.get(id);
    if (!current) {
      throw new InvalidMemoryInputError(`Memory entry not found: ${id}`);
    }

    const updated = applyMemoryUpdate(current, input);
    await this.writeEntry(updated);
    return updated;
  }

  override async upsert(input: MemoryWriteInput): Promise<MemoryEntry> {
    const existing = await this.findByCompositeKey(input.coordinates.namespace, input.key);
    const entry = createMemoryEntry(input, existing ?? undefined);

    await this.writeEntry(entry);
    return entry;
  }

  override async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.collectionPromise = null;
    }
  }

  private async applyBundle(
    bundle: MemoryExportBundle,
    mergeMode: boolean
  ): Promise<MemoryImportResult> {
    let imported = 0;
    let skipped = 0;
    let updated = 0;
    const conflicts: MemoryImportResult["conflicts"] = [];

    for (const incoming of bundle.entries) {
      const entry = normalizeMemoryEntry(incoming);
      const existing = await this.findByCompositeKey(entry.coordinates.namespace, entry.key);
      const decision = decideMerge(existing, entry, mergeMode);
      if (decision.conflict) {
        conflicts.push(decision.conflict);
      }

      if (decision.action === "imported" && decision.entry) {
        await this.writeEntry(decision.entry);
        imported += 1;
        continue;
      }

      if (decision.action === "updated" && decision.entry) {
        await this.writeEntry(decision.entry);
        updated += 1;
        continue;
      }

      skipped += 1;
    }

    return { conflicts, imported, skipped, updated };
  }

  private buildFilter(query?: MemoryQuery, forSearch?: boolean): Record<string, unknown> {
    const filter: Record<string, unknown> = {};

    if (!query?.includeExpired) {
      filter.$or = [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date().toISOString() } }];
    }

    if (query?.namespace) filter["coordinates.namespace"] = query.namespace;
    if (query?.project) filter["coordinates.project"] = query.project;
    if (query?.repo) filter["coordinates.repo"] = query.repo;
    if (query?.scope) filter["coordinates.scope"] = query.scope;
    if (query?.tenant) filter["coordinates.tenant"] = query.tenant;
    if (query?.user) filter["coordinates.user"] = query.user;
    if (query?.workspace) filter["coordinates.workspace"] = query.workspace;
    if (query?.kind) filter.kind = query.kind;
    if (query?.key) filter.key = query.key;
    if (query?.tags?.length) filter.tags = { $all: query.tags };

    if (query?.text && !forSearch) {
      filter.$or = [
        { ...(filter.$or ? { $and: [{ $or: filter.$or }] } : {}) },
        { content: { $regex: query.text, $options: "i" } },
        { key: { $regex: query.text, $options: "i" } },
      ];
    }

    return filter;
  }

  private async findByCompositeKey(namespace: string, key: string): Promise<MemoryEntry | null> {
    const collection = await this.getCollection();
    const doc = await collection.findOne({
      "coordinates.namespace": namespace,
      key,
    });
    return doc ? this.toEntry(doc) : null;
  }

  private async getCollection() {
    if (!this.collectionPromise) {
      this.collectionPromise = this.createCollection();
    }
    return this.collectionPromise;
  }

  private async getDb() {
    const module = await this.loadMongoModule();

    if (!this.client) {
      this.client = new module.MongoClient(this.config.uri, {
        ignoreUndefined: true,
        maxPoolSize: this.config.maxPoolSize ?? 20,
        minPoolSize: this.config.minPoolSize,
        socketTimeoutMS: this.config.socketTimeoutMS,
        waitQueueTimeoutMS: this.config.waitQueueTimeoutMS,
        serverSelectionTimeoutMS: this.config.connectTimeoutMs ?? 5_000,
      });
      await this.client.connect();
    }

    return this.client.db(this.config.database);
  }

  private identityKey(entry: MemoryEntry): string {
    return `${entry.coordinates.namespace}::${entry.key}`;
  }

  private async createCollection() {
    const db = await this.getDb();
    const collection = db.collection(this.config.collection ?? "memories");
    await collection.createIndex({ "coordinates.namespace": 1, key: 1 }, { unique: true });
    await collection.createIndex({ updatedAt: -1 });
    await collection.createIndex({ kind: 1 });
    return collection;
  }

  private async loadMongoModule(): Promise<MongoModule> {
    if (!this.modulePromise) {
      this.modulePromise = (async () => {
        try {
          const require = createRequire(import.meta.url);
          const resolved = require.resolve("mongodb", {
            paths: this.config.moduleSearchPaths,
          });
          return (await import(pathToFileURL(resolved).href)) as MongoModule;
        } catch (error) {
          throw new ConnectorNotReadyError(
            `mongodb package is not available for MemFlow: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      })();
    }

    return this.modulePromise;
  }

  private redactUri(uri: string): string {
    try {
      const parsed = new URL(uri);
      if (parsed.password) parsed.password = "********";
      return parsed.toString();
    } catch {
      return uri;
    }
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

  private toEntry(doc: Record<string, unknown>): MemoryEntry {
    return {
      ...normalizeMemoryEntry({
        id: String(doc.id),
        key: String(doc.key),
        title: typeof doc.title === "string" ? doc.title : undefined,
        content: String(doc.content),
        namespace: typeof doc.namespace === "string" ? doc.namespace : undefined,
        projectId: typeof doc.projectId === "string" ? doc.projectId : undefined,
        coordinates: doc.coordinates as MemoryEntry["coordinates"],
        kind: doc.kind as MemoryEntry["kind"],
        tags: Array.isArray(doc.tags) ? (doc.tags as string[]) : [],
        metadata: (doc.metadata as Record<string, unknown>) ?? {},
        source: typeof doc.source === "string" ? doc.source : undefined,
        provenance: doc.provenance as MemoryEntry["provenance"],
        confidence: typeof doc.confidence === "number" ? doc.confidence : undefined,
        embedding: doc.embedding as MemoryEntry["embedding"] | undefined,
        schemaVersion:
          typeof doc.schemaVersion === "number" ? doc.schemaVersion : undefined,
        embeddingVersion:
          typeof doc.embeddingVersion === "string"
            ? doc.embeddingVersion
            : undefined,
        contentHash:
          typeof doc.contentHash === "string" ? doc.contentHash : undefined,
        createdAt: String(doc.createdAt),
        updatedAt: String(doc.updatedAt),
        expiresAt: typeof doc.expiresAt === "string" ? doc.expiresAt : undefined,
        lastVerifiedAt:
          typeof doc.lastVerifiedAt === "string" ? doc.lastVerifiedAt : undefined,
        version: Number(doc.version),
      }),
    };
  }

  private async writeEntry(entry: MemoryEntry): Promise<void> {
    const collection = await this.getCollection();
    await collection.replaceOne(
      { id: entry.id },
      entry as unknown as Record<string, unknown>,
      { upsert: true }
    );
  }
}
