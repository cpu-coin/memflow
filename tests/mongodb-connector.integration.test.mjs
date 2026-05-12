import { test } from "node:test";
import assert from "node:assert/strict";

import { MongoDBConnector } from "../dist/connectors/mongodb.js";

const uri = process.env.MEMFLOW_TEST_MONGODB_URI;
const database = process.env.MEMFLOW_TEST_MONGODB_DATABASE ?? "memflow_test";
const collection = process.env.MEMFLOW_TEST_MONGODB_COLLECTION ?? "memories";
const modulePath = process.env.MEMFLOW_TEST_MONGODB_MODULE_PATH;

test("MongoDBConnector can run CRUD flow against a live MongoDB", {
  skip: !uri || !modulePath,
}, async () => {
  const connector = new MongoDBConnector({
    uri,
    database,
    collection,
    moduleSearchPaths: [modulePath],
  });

  try {
    const stored = await connector.upsert({
      key: "pattern-mongodb-integration",
      content: "MongoDB integration test entry for MemFlow.",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        scope: "project",
      },
      provenance: {
        source: "manual",
      },
      kind: "pattern",
      tags: ["mongo", "integration"],
      metadata: {
        suite: "integration",
      },
    });

    const found = await connector.search({
      text: "mongodb integration memflow",
      namespace: "patterns",
      limit: 5,
    });

    assert.ok(found.length >= 1);
    assert.equal(found[0].entry.id, stored.id);

    const deleted = await connector.delete(stored.id);
    assert.equal(deleted.deleted, true);
  } finally {
    await connector.close();
  }
});
