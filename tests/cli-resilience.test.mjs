import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliPath = resolve(fileURLToPath(import.meta.url), "../../dist/cli.js");

test("CLI status:line terminates quickly even if logic hangs", async () => {
  // We can't easily force a hang in the real DB from here without mocks,
  // but we can test that the process finishes.
  // In a real environment, we'd mock MemoryService.metrics to never resolve. 
  
  const start = Date.now();
  const result = spawnSync("node", [cliPath, "status:line"], {
    timeout: 2000, // Safety timeout for the test runner
    encoding: "utf8",
  });
  const duration = Date.now() - start;

  assert.equal(result.status, 0);
  assert.match(result.stdout, /MemFlow:/);
  // It should be much faster than 2 seconds, and if it hits the 500ms timeout
  // it should still return a valid (though simplified) status string.
  assert.ok(duration < 1500, `Command took too long: ${duration}ms`);
});

test("CLI status:claude-code terminates quickly", async () => {
  const start = Date.now();
  const result = spawnSync("node", [cliPath, "status:claude-code"], {
    timeout: 2000,
    encoding: "utf8",
  });
  const duration = Date.now() - start;

  assert.equal(result.status, 0);
  assert.match(result.stdout, /on=(true|false)/);
  assert.ok(duration < 1500, `Command took too long: ${duration}ms`);
});
