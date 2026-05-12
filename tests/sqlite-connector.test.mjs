import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SQLiteConnector } from "../dist/connectors/sqlite.js";
import {
  MEMFLOW_EMBEDDING_VERSION_NONE,
  MEMFLOW_SCHEMA_VERSION,
  computeContentHash,
} from "../dist/index.js";

function createConnector() {
  const dir = mkdtempSync(join(tmpdir(), "memflow-sqlite-test-"));
  const dbPath = join(dir, "memflow.sqlite");
  const connector = new SQLiteConnector({ databasePath: dbPath });
  return { connector, dir };
}

function cleanup(dir) {
  rmSync(dir, { force: true, recursive: true });
}

test("SQLiteConnector stores, searches, exports, diffs, and deletes entries", async () => {
  const { connector, dir } = createConnector();

  try {
    const stored = await connector.upsert({
      key: "pattern-auth-cache",
      content: "Use namespace-aware prompt caching for repeated auth code generation.",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        scope: "project",
      },
      provenance: {
        source: "manual",
      },
      kind: "pattern",
      metadata: {
        area: "auth",
      },
      tags: ["auth", "cache"],
    });

    assert.equal(stored.key, "pattern-auth-cache");
    assert.equal(stored.title, "pattern-auth-cache");
    assert.equal(stored.namespace, "patterns");
    assert.equal(stored.projectId, "memflow");
    assert.equal(stored.source, "manual");
    assert.equal(stored.schemaVersion, MEMFLOW_SCHEMA_VERSION);
    assert.equal(stored.embeddingVersion, MEMFLOW_EMBEDDING_VERSION_NONE);
    assert.equal(stored.contentHash, computeContentHash(stored.content));
    assert.equal(stored.version, 1);

    const searched = await connector.search({
      text: "prompt caching auth",
      namespace: "patterns",
      limit: 5,
    });

    assert.equal(searched.length, 1);
    assert.equal(searched[0].entry.id, stored.id);
    assert.ok(searched[0].score > 0);

    const updated = await connector.update(stored.id, {
      content: "Use namespace-aware prompt caching for repeated auth and session code generation.",
      tags: ["auth", "cache", "session"],
    });

    assert.equal(updated.version, 2);
    assert.equal(updated.tags.includes("session"), true);
    assert.equal(updated.contentHash, computeContentHash(updated.content));

    const stats = await connector.stats();
    assert.equal(stats.entries, 1);
    assert.equal(stats.namespaces, 1);

    const bundle = await connector.export({ namespace: "patterns" });
    assert.equal(bundle.entries.length, 1);

    const diffBefore = await connector.diff({
      ...bundle,
      entries: bundle.entries.map((entry) => ({
        ...entry,
        content: `${entry.content} changed`,
      })),
    });
    assert.equal(diffBefore.changed.length, 1);

    const mergeResult = await connector.merge({
      ...bundle,
      entries: bundle.entries.map((entry) => ({
        ...entry,
        content: `${entry.content} merged`,
      })),
    });
    assert.equal(mergeResult.updated, 1);

    const deleted = await connector.delete(stored.id);
    assert.equal(deleted.deleted, true);
  } finally {
    cleanup(dir);
  }
});

test("SQLiteConnector respects namespace filtering", async () => {
  const { connector, dir } = createConnector();

  try {
    await connector.upsert({
      key: "shared-pattern",
      content: "Entry in patterns namespace",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        scope: "project",
      },
      provenance: {
        source: "manual",
      },
      kind: "pattern",
    });

    await connector.upsert({
      key: "shared-pattern",
      content: "Entry in persona namespace",
      coordinates: {
        namespace: "persona",
        project: "memflow",
        scope: "project",
      },
      provenance: {
        source: "manual",
      },
      kind: "persona",
    });

    const patternEntries = await connector.list({ namespace: "patterns" });
    const personaEntries = await connector.list({ namespace: "persona" });

    assert.equal(patternEntries.length, 1);
    assert.equal(personaEntries.length, 1);
    assert.equal(patternEntries[0].coordinates.namespace, "patterns");
    assert.equal(personaEntries[0].coordinates.namespace, "persona");
    assert.equal(patternEntries[0].namespace, "patterns");
    assert.equal(personaEntries[0].namespace, "persona");
  } finally {
    cleanup(dir);
  }
});

test("SQLiteConnector merge keeps newer local entries and reports conflicts deterministically", async () => {
  const { connector, dir } = createConnector();

  try {
    const stored = await connector.upsert({
      key: "merge-pattern",
      content: "Local content wins",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
      provenance: {
        source: "manual",
      },
      kind: "pattern",
    });

    const local = await connector.update(stored.id, {
      content: "Local content is newer",
    });

    const mergeResult = await connector.merge({
      exportedAt: new Date().toISOString(),
      formatVersion: "1",
      entries: [
        {
          ...local,
          id: "incoming-older",
          content: "Incoming older content",
          contentHash: computeContentHash("Incoming older content"),
          updatedAt: "2025-01-01T00:00:00.000Z",
          version: 1,
        },
      ],
    });

    assert.equal(mergeResult.imported, 0);
    assert.equal(mergeResult.updated, 0);
    assert.equal(mergeResult.skipped, 1);
    assert.equal(mergeResult.conflicts.length, 1);
    assert.equal(mergeResult.conflicts[0].reason, "local-newer");
    assert.equal(mergeResult.conflicts[0].resolution, "kept-existing");

    const after = await connector.get(local.id);
    assert.equal(after?.content, "Local content is newer");
    assert.equal(after?.version, local.version);
  } finally {
    cleanup(dir);
  }
});

test("SQLiteConnector merge preserves deterministic winner fields when incoming wins", async () => {
  const { connector, dir } = createConnector();

  try {
    const stored = await connector.upsert({
      key: "merge-conflict-pattern",
      content: "Alpha content",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
      provenance: {
        source: "manual",
      },
      kind: "pattern",
    });

    const beforeMerge = await connector.get(stored.id);
    assert.ok(beforeMerge);

    const mergeResult = await connector.merge({
      exportedAt: new Date().toISOString(),
      formatVersion: "1",
      entries: [
        {
          ...beforeMerge,
          id: "incoming-newer",
          content: "Zulu content",
          contentHash: computeContentHash("Zulu content"),
          updatedAt: beforeMerge.updatedAt,
          version: beforeMerge.version,
          source: "system",
        },
      ],
    });

    assert.equal(mergeResult.updated, 1);
    assert.equal(mergeResult.conflicts.length, 1);
    assert.equal(mergeResult.conflicts[0].reason, "content-conflict");
    assert.equal(mergeResult.conflicts[0].resolution, "used-incoming");

    const after = await connector.get(stored.id);
    assert.equal(after?.id, stored.id);
    assert.equal(after?.content, "Zulu content");
    assert.equal(after?.updatedAt, beforeMerge.updatedAt);
    assert.equal(after?.version, beforeMerge.version);
    assert.equal(after?.source, "system");
  } finally {
    cleanup(dir);
  }
});
