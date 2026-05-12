import { test } from "node:test";
import assert from "node:assert/strict";

import { MongoDBConnector } from "../dist/connectors/mongodb.js";

test("MongoDBConnector reports a clear driver error when mongodb is unavailable", async () => {
  const connector = new MongoDBConnector({
    database: "memflow",
    moduleSearchPaths: ["/definitely-not-a-real-node-modules-path"],
    uri: "mongodb://127.0.0.1:27017/memflow",
  });

  const health = await connector.health();
  assert.equal(health.ok, false);
  assert.match(String(health.details?.error ?? ""), /mongodb package is not available/i);
});
