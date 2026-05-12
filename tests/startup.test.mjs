import { test } from "node:test";
import assert from "node:assert/strict";

import { formatStartupError, runRuntimePreflight } from "../dist/index.js";

test("formatStartupError returns a friendly Node ABI remediation message for better-sqlite3 mismatches", async () => {
  const message = formatStartupError(
    new Error(
      "The module '/tmp/better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 115."
    )
  );

  assert.match(message, /better-sqlite3/);
  assert.match(message, /Use Node 22 or newer/);
  assert.match(message, /npm rebuild better-sqlite3/);
});

test("runRuntimePreflight reports current runtime readiness", async () => {
  const result = await runRuntimePreflight();

  assert.equal(typeof result.currentNode, "string");
  assert.equal(Array.isArray(result.checks), true);
  assert.equal(result.supportedNode, true);
  assert.equal(result.betterSqlite3.ok, true);
  assert.equal(result.ok, true);
});
