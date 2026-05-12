import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildHostBootstrap,
  createDefaultConfig,
  mergeTrackedProjects,
  writeHostBootstrap,
  writeMemFlowConfig,
} from "../dist/index.js";

test("host bootstrap reflects config and writes a machine-readable contract", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-host-test-"));
  const configPath = join(home, "config.json");
  const hostPath = join(home, "host.json");

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        automation: {
          autoCompact: true,
          autoFinalize: true,
          autoPrepare: true,
          autoPromptCache: true,
          enabled: true,
          metrics: true,
        },
        databasePath: join(home, "memflow.sqlite"),
        trackedProjects: mergeTrackedProjects([], [
          {
            path: join(home, "projects", "alpha"),
            enabled: true,
          },
        ]),
      },
      configPath
    );

    const bootstrap = buildHostBootstrap(configPath);
    assert.equal(bootstrap.automation.enabled, true);
    assert.equal(bootstrap.trackedProjects.length, 1);
    assert.match(bootstrap.lifecycle.prepareCommand, /agent:prepare/);
    assert.match(bootstrap.lifecycle.finalizeCommand, /agent:finalize/);
    assert.match(bootstrap.monitoring.statusCommand, /status/);

    const written = writeHostBootstrap(configPath, hostPath);
    const parsed = JSON.parse(readFileSync(hostPath, "utf8"));

    assert.equal(parsed.paths.hostBootstrap, written.paths.hostBootstrap);
    assert.equal(parsed.databasePath, join(home, "memflow.sqlite"));
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});
