import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SQLiteConnector } from "../dist/connectors/sqlite.js";
import { MemoryService } from "../dist/core/memory-service.js";
import { computeContentHash } from "../dist/index.js";

function createService() {
  const dir = mkdtempSync(join(tmpdir(), "memflow-snippet-test-"));
  const connector = new SQLiteConnector({
    databasePath: join(dir, "memflow.sqlite"),
  });
  return { dir, service: new MemoryService(connector) };
}

test("snippet kind normalizes to rag on upsert", async () => {
  const { service, dir } = createService();

  try {
    const entry = await service.upsert({
      key: "snippet-button-component",
      content: '<button class="primary">Save</button>',
      coordinates: {
        namespace: "code",
        project: "test",
        scope: "project",
      },
      provenance: { source: "manual" },
      kind: "snippet",
    });

    assert.equal(entry.kind, "rag");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("snippet entries persist as rag and are retrievable", async () => {
  const { service, dir } = createService();

  try {
    const stored = await service.upsert({
      key: "snippet-auth-middleware",
      content: "export function authMiddleware(req, res, next) { /* ... */ }",
      coordinates: {
        namespace: "code",
        project: "test",
        scope: "project",
      },
      provenance: { source: "manual" },
      kind: "snippet",
    });

    const fetched = await service.get(stored.id);
    assert.ok(fetched);
    assert.equal(fetched.kind, "rag");
    assert.equal(fetched.content, stored.content);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("snippet entries are searchable by text", async () => {
  const { service, dir } = createService();

  try {
    await service.upsert({
      key: "snippet-react-hook",
      content: "export function useAuth() { return useContext(AuthContext); }",
      coordinates: {
        namespace: "code",
        project: "test",
        scope: "project",
      },
      provenance: { source: "manual" },
      kind: "snippet",
    });

    const results = await service.search({
      namespace: "code",
      project: "test",
      text: "authentication hook react context",
      limit: 5,
    });

    assert.equal(results.length >= 1, true);
    assert.equal(results[0].entry.kind, "rag");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("snippet search with kind=snippet queries rag entries", async () => {
  const { service, dir } = createService();

  try {
    await service.upsert({
      key: "snippet-css-card",
      content: ".card { border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }",
      coordinates: {
        namespace: "code",
        project: "test",
        scope: "project",
      },
      provenance: { source: "manual" },
      kind: "snippet",
    });

    const results = await service.search({
      namespace: "code",
      project: "test",
      kind: "snippet",
      limit: 5,
    });

    assert.equal(results.length >= 1, true);
    assert.equal(results[0].entry.kind, "rag");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("snippet entries round-trip through export and import", async () => {
  const { service, dir } = createService();

  try {
    const stored = await service.upsert({
      key: "snippet-export-test",
      content: "const config = { debug: false };",
      coordinates: {
        namespace: "code",
        project: "test",
        scope: "project",
      },
      provenance: { source: "manual" },
      kind: "snippet",
    });

    const bundle = await service.export({
      namespace: "code",
      project: "test",
    });

    assert.equal(bundle.entries.length >= 1, true);
    const exported = bundle.entries.find((e) => e.id === stored.id);
    assert.ok(exported);
    assert.equal(exported.kind, "rag");

    // Create fresh service and import
    const dir2 = mkdtempSync(join(tmpdir(), "memflow-snippet-import-"));
    const connector2 = new SQLiteConnector({
      databasePath: join(dir2, "memflow.sqlite"),
    });
    const service2 = new MemoryService(connector2);

    try {
      const importResult = await service2.import(bundle);
      assert.equal(importResult.imported >= 1, true);

      const reimported = await service2.get(stored.id);
      assert.ok(reimported);
      assert.equal(reimported.kind, "rag");
      assert.equal(reimported.content, stored.content);
      assert.equal(reimported.contentHash, computeContentHash(stored.content));
    } finally {
      rmSync(dir2, { force: true, recursive: true });
    }
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("snippet entries get auto-embedded", async () => {
  const { service, dir } = createService();

  try {
    const entry = await service.upsert({
      key: "snippet-with-embedding",
      content: "function calculateTotal(items) { return items.reduce((sum, i) => sum + i.price, 0); }",
      coordinates: {
        namespace: "code",
        project: "test",
        scope: "project",
      },
      provenance: { source: "manual" },
      kind: "snippet",
    });

    assert.ok(entry.embedding);
    assert.equal(entry.embedding.dimensions > 0, true);
    assert.equal(entry.embeddingVersion, "memflow-local-v1");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
