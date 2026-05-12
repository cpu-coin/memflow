import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

import type { DatabaseConnector } from "../connectors/types.js";
import type { MemoryWriteInput } from "../types/memory.js";

export interface LegacyRufloSetup {
  claudeFlowDir?: string;
  claudeMemoryDb?: string;
  cwd: string;
  detected: boolean;
  swarmMemoryDb?: string;
}

export interface LegacyRufloImportSummary {
  importedEntries: number;
  importedPatterns: number;
  importedSetupSnapshot: boolean;
  source: LegacyRufloSetup;
}

export interface LegacyRufloImportOptions {
  includeSetupSnapshot?: boolean;
}

type LegacyMemoryRow = {
  content: string;
  created_at: number | null;
  embedding: string | null;
  id: string;
  key: string;
  metadata: string | null;
  namespace: string | null;
  tags: string | null;
  type: string | null;
  updated_at: number | null;
};

type LegacyPatternRow = {
  action: string;
  confidence: number | null;
  condition: string;
  created_at: number | null;
  description: string | null;
  id: string;
  metadata: string | null;
  name: string;
  pattern_type: string;
  source: string | null;
  tags: string | null;
  updated_at: number | null;
};

export function detectLegacyRufloSetup(cwd: string): LegacyRufloSetup {
  let current = resolve(cwd);

  while (true) {
    const detected = detectLegacyRufloSetupInDirectory(current);
    if (detected.detected) {
      return detected;
    }

    const parent = dirname(current);
    if (parent === current) {
      return detected;
    }

    current = parent;
  }
}

export function detectLegacyRufloSetups(paths: string[]): LegacyRufloSetup[] {
  const seen = new Set<string>();
  const detected: LegacyRufloSetup[] = [];

  for (const path of paths) {
    const candidate = detectLegacyRufloSetup(path);
    if (!candidate.detected) {
      continue;
    }

    if (seen.has(candidate.cwd)) {
      continue;
    }

    seen.add(candidate.cwd);
    detected.push(candidate);
  }

  return detected.sort((left, right) => left.cwd.localeCompare(right.cwd));
}

function detectLegacyRufloSetupInDirectory(root: string): LegacyRufloSetup {
  const swarmMemoryDb = resolve(root, ".swarm/memory.db");
  const claudeMemoryDb = resolve(root, ".claude/memory.db");
  const claudeFlowDir = resolve(root, ".claude-flow");

  const detectedSetup: LegacyRufloSetup = {
    cwd: root,
    detected: false,
  };

  if (existsSync(swarmMemoryDb)) {
    detectedSetup.swarmMemoryDb = swarmMemoryDb;
    detectedSetup.detected = true;
  }

  if (existsSync(claudeMemoryDb)) {
    detectedSetup.claudeMemoryDb = claudeMemoryDb;
    detectedSetup.detected = true;
  }

  if (existsSync(claudeFlowDir)) {
    detectedSetup.claudeFlowDir = claudeFlowDir;
    detectedSetup.detected = true;
  }

  return detectedSetup;
}

export async function importLegacyRufloSetup(
  connector: DatabaseConnector,
  cwd: string,
  options: LegacyRufloImportOptions = {}
): Promise<LegacyRufloImportSummary> {
  const source = detectLegacyRufloSetup(cwd);
  if (!source.detected) {
    return {
      importedEntries: 0,
      importedPatterns: 0,
      importedSetupSnapshot: false,
      source,
    };
  }

  let importedEntries = 0;
  let importedPatterns = 0;
  let importedSetupSnapshot = false;

  const memoryDbPath = source.swarmMemoryDb ?? source.claudeMemoryDb;
  if (memoryDbPath) {
    const db = new Database(memoryDbPath, { readonly: true });
    try {
      const tables = new Set(
        (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
          .map((row) => row.name)
      );

      if (tables.has("memory_entries")) {
        const rows = db.prepare("SELECT * FROM memory_entries").all() as LegacyMemoryRow[];
        for (const row of rows) {
          await connector.upsert(toMemoryWriteInput(row));
          importedEntries += 1;
        }
      }

      if (tables.has("patterns")) {
        const rows = db.prepare("SELECT * FROM patterns").all() as LegacyPatternRow[];
        for (const row of rows) {
          await connector.upsert(toPatternWriteInput(row));
          importedPatterns += 1;
        }
      }
    } finally {
      db.close();
    }
  }

  if ((options.includeSetupSnapshot ?? true) && source.claudeFlowDir) {
    const files = readdirSync(source.claudeFlowDir).sort();
    await connector.upsert({
      key: "legacy-ruflo-setup",
      content:
        "Detected a prior RuFlo setup. This snapshot records legacy operational files and import source paths for migration traceability.",
      coordinates: {
        namespace: "legacy.setup",
        scope: "project",
        project: "memflow",
      },
      kind: "knowledge",
      metadata: {
        claudeFlowDir: source.claudeFlowDir,
        claudeMemoryDb: source.claudeMemoryDb,
        files,
        swarmMemoryDb: source.swarmMemoryDb,
      },
      provenance: {
        source: "system",
      },
      tags: ["legacy", "ruflo", "setup"],
    });
    importedSetupSnapshot = true;
  }

  return {
    importedEntries,
    importedPatterns,
    importedSetupSnapshot,
    source,
  };
}

function parseJsonObject(input: string | null): Record<string, unknown> {
  if (!input) {
    return {};
  }

  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(input: string | null): string[] {
  if (!input) {
    return [];
  }

  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function timestampToIso(value: number | null): string | undefined {
  if (!value || Number.isNaN(value)) {
    return undefined;
  }

  return new Date(value).toISOString();
}

function toMemoryWriteInput(row: LegacyMemoryRow): MemoryWriteInput {
  return {
    key: row.key,
    content: row.content,
    coordinates: {
      namespace: row.namespace ?? "default",
      scope: "project",
      project: "memflow",
    },
    kind: row.type === "pattern" ? "pattern" : "knowledge",
    metadata: {
      legacyId: row.id,
      legacyMetadata: parseJsonObject(row.metadata),
      legacyType: row.type,
    },
    provenance: {
      source: "bundle-import",
      importedFrom: "ruflo-memory-db",
    },
    tags: parseJsonArray(row.tags),
    embedding: row.embedding
      ? {
          dimensions: 0,
          values: [],
        }
      : undefined,
    lastVerifiedAt: timestampToIso(row.updated_at),
  };
}

function toPatternWriteInput(row: LegacyPatternRow): MemoryWriteInput {
  return {
    key: row.name,
    content: [row.description, row.condition, row.action].filter(Boolean).join("\n\n"),
    coordinates: {
      namespace: "legacy.patterns",
      scope: "project",
      project: "memflow",
    },
    kind: "pattern",
    confidence: row.confidence ?? undefined,
    metadata: {
      legacyId: row.id,
      legacyMetadata: parseJsonObject(row.metadata),
      legacySource: row.source,
      legacyType: row.pattern_type,
    },
    provenance: {
      source: "bundle-import",
      importedFrom: "ruflo-patterns-db",
    },
    tags: parseJsonArray(row.tags),
    lastVerifiedAt: timestampToIso(row.updated_at) ?? timestampToIso(row.created_at),
  };
}
