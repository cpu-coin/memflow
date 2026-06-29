import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createDefaultConfig,
  discoverProjects,
  findTrackedProjectForPath,
  mergeTrackedProjects,
  readMemFlowConfig,
  setTrackedProjectEnabled,
  writeMemFlowConfig,
} from "../dist/index.js";

function createTempDir(prefix = "memflow-config-test-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("discoverProjects finds direct child git repositories", async () => {
  const root = createTempDir();

  try {
    mkdirSync(join(root, "repo-a", ".git"), { recursive: true });
    mkdirSync(join(root, "repo-b", ".git"), { recursive: true });
    mkdirSync(join(root, "not-a-repo"), { recursive: true });

    const discovered = discoverProjects(root);

    assert.deepEqual(
      discovered.map((project) => project.name),
      ["repo-a", "repo-b"]
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("MemFlow config persists tracked projects and toggles", async () => {
  const home = createTempDir();
  const configPath = join(home, "config.json");

  try {
    const base = createDefaultConfig();
    assert.equal(base.automation.enabled, true);
    assert.equal(base.automation.autoPrepare, true);

    const written = writeMemFlowConfig(
      {
        ...base,
        automation: {
          ...base.automation,
          autoPromptCache: false,
        },
        databasePath: join(home, "memflow.sqlite"),
        projectsRoot: join(home, "projects"),
        trackedProjects: mergeTrackedProjects([], [
          {
            path: join(home, "projects", "alpha"),
            enabled: true,
          },
          {
            path: join(home, "projects", "beta"),
            enabled: false,
          },
        ]),
      },
      configPath
    );

    assert.equal(written.trackedProjects.length, 2);

    const toggled = writeMemFlowConfig(
      {
        ...written,
        trackedProjects: setTrackedProjectEnabled(
          written.trackedProjects,
          join(home, "projects", "beta"),
          true
        ),
      },
      configPath
    );

    const reloaded = readMemFlowConfig(configPath);
    assert.equal(toggled.trackedProjects[1].enabled, true);
    assert.equal(reloaded.trackedProjects.every((project) => project.enabled), true);
    assert.equal(reloaded.automation.autoPromptCache, false);
    assert.equal(reloaded.automation.enabled, true);
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});

test("MemFlow config persists enabled hosts and activation state", async () => {
  const home = createTempDir();
  const configPath = join(home, "config.json");

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
        onboarding: {
          completedAt: "2026-05-01T00:00:00.000Z",
          lastPromptedAt: "2026-05-01T00:00:00.000Z",
        },
        enabledHosts: ["codex", "antigravity"],
        activation: {
          activationSessionId: "post-install-activation",
          completedHosts: ["codex"],
          lastUpdatedAt: new Date().toISOString(),
          pendingHosts: ["antigravity"],
          shellPending: true,
        },
        trackedProjects: [],
      },
      configPath
    );

    const reloaded = readMemFlowConfig(configPath);
    assert.deepEqual(reloaded.enabledHosts, ["antigravity", "codex"]);
    assert.equal(reloaded.activation?.shellPending, true);
    assert.deepEqual(reloaded.activation?.pendingHosts, ["antigravity"]);
    assert.deepEqual(reloaded.activation?.completedHosts, ["codex"]);
    assert.equal(reloaded.onboarding?.completedAt, "2026-05-01T00:00:00.000Z");
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});

test("MemFlow config keeps missing automation features default-on", async () => {
  const home = createTempDir();
  const configPath = join(home, "config.json");

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        automation: {
          enabled: true,
        },
        databasePath: join(home, "memflow.sqlite"),
        trackedProjects: [],
      },
      configPath
    );

    const reloaded = readMemFlowConfig(configPath);
    assert.equal(reloaded.automation.enabled, true);
    assert.equal(reloaded.automation.autoCompact, true);
    assert.equal(reloaded.automation.autoFinalize, true);
    assert.equal(reloaded.automation.autoPrepare, true);
    assert.equal(reloaded.automation.autoPromptCache, true);
    assert.equal(reloaded.automation.metrics, true);
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});

test("findTrackedProjectForPath returns the nearest tracked repo", async () => {
  const tracked = mergeTrackedProjects([], [
    {
      path: "/tmp/projects",
      enabled: false,
      name: "projects",
      project: "projects",
      repo: "projects",
    },
    {
      path: "/tmp/projects/memflow",
      enabled: true,
      name: "memflow",
      project: "memflow",
      repo: "memflow",
    },
  ]);

  const matched = findTrackedProjectForPath(
    tracked,
    "/tmp/projects/memflow/src/core"
  );

  assert.equal(matched?.name, "memflow");
  assert.equal(matched?.enabled, true);
});
