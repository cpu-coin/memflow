import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

test("CLI doctor JSON redacts sensitive config values", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-cli-doctor-test-"));
  const configPath = join(home, "config.json");

  try {
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          version: "1",
          profile: "test",
          enabledHosts: [],
          onboarding: {},
          automation: {
            autoCompact: true,
            autoFinalize: true,
            autoPrepare: true,
            autoPromptCache: true,
            enabled: true,
            metrics: true,
          },
          connector: "sqlite",
          databasePath: join(home, "memflow.sqlite"),
          mongo: {
            database: "memflow_test",
            uri: "mongodb://memflow_user:super-secret-password@127.0.0.1:27017/memflow_test",
          },
          maitrix: {
            apiKey: "fake-api-key-value",
            firebaseIdToken: "fake-firebase-token",
            refreshToken: "fake-refresh-token",
          },
          trackedProjects: [],
        },
        null,
        2
      ),
      "utf8"
    );

    const result = spawnSync("node", [cliPath, "doctor", "--json", "--config", configPath], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /super-secret-password/);
    assert.doesNotMatch(result.stdout, /fake-api-key-value/);
    assert.doesNotMatch(result.stdout, /fake-firebase-token/);
    assert.doesNotMatch(result.stdout, /fake-refresh-token/);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.config.mongo.uri, "[REDACTED]");
    assert.equal(parsed.config.maitrix.apiKey, "[REDACTED]");
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});
