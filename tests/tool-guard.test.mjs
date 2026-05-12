import { test } from "node:test";
import assert from "node:assert/strict";

import { ToolGuard } from "../dist/mcp/guard.js";

test("ToolGuard rejects oversized memory content", async () => {
  const guard = new ToolGuard({
    maxBundleEntries: 100,
    maxContentBytes: 8,
    maxPayloadBytes: 1024,
    maxRequestsPerMinute: 10,
  });

  await assert.rejects(
    guard.run(
      "memory_store",
      { content: "this is too large" },
      async () => "ok"
    ),
    /Memory content exceeds/
  );
});

test("ToolGuard rejects oversized import bundle", async () => {
  const guard = new ToolGuard({
    maxBundleEntries: 1,
    maxContentBytes: 1024,
    maxPayloadBytes: 1024 * 1024,
    maxRequestsPerMinute: 10,
  });

  await assert.rejects(
    guard.run(
      "memory_import",
      { bundle: { entries: [{ id: "a" }, { id: "b" }] } },
      async () => "ok"
    ),
    /Bundle exceeds/
  );
});
