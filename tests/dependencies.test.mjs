import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  collectDependencySnapshot,
  dependencyTags,
  dependencyMetadata,
  dependencyWarningsForEntry,
} from "../dist/core/dependencies.js";

function createWorkspace(manifest) {
  const dir = mkdtempSync(join(tmpdir(), "memflow-deps-test-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

test("collectDependencySnapshot extracts major versions from package.json", () => {
  const dir = createWorkspace({
    name: "test",
    dependencies: { react: "^18.2.0", typescript: "~5.3.0" },
    devDependencies: { vitest: "^4.0.0" },
  });

  try {
    const snapshot = collectDependencySnapshot(dir);
    assert.ok(snapshot);
    assert.equal(snapshot.dependencies.length, 3);

    const react = snapshot.dependencies.find((d) => d.name === "react");
    assert.ok(react);
    assert.equal(react.major, "18");
    assert.equal(react.rawVersion, "^18.2.0");

    const vitest = snapshot.dependencies.find((d) => d.name === "vitest");
    assert.ok(vitest);
    assert.equal(vitest.major, "4");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("collectDependencySnapshot returns null for empty workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "memflow-deps-empty-"));

  try {
    const snapshot = collectDependencySnapshot(dir);
    assert.equal(snapshot, null);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("collectDependencySnapshot deduplicates same package across sections", () => {
  const dir = createWorkspace({
    name: "test",
    dependencies: { typescript: "^5.3.0" },
    devDependencies: { typescript: "^5.3.0" },
  });

  try {
    const snapshot = collectDependencySnapshot(dir);
    assert.ok(snapshot);
    assert.equal(snapshot.dependencies.length, 1);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("dependencyTags generates correct tag format", () => {
  const snapshot = {
    collectedAt: new Date().toISOString(),
    workspace: "/tmp/test",
    dependencies: [
      { name: "react", major: "18", rawVersion: "^18.2.0", source: "package.json" },
      { name: "@types/node", major: "20", rawVersion: "^20.0.0", source: "package.json" },
    ],
  };

  const tags = dependencyTags(snapshot);
  assert.ok(tags.includes("dependency:react:18.x"));
  assert.ok(tags.includes("dependency:types-node:20.x"));
});

test("dependencyTags returns empty array for null snapshot", () => {
  assert.deepEqual(dependencyTags(null), []);
  assert.deepEqual(dependencyTags(undefined), []);
});

test("dependencyMetadata includes structured dependency data", () => {
  const snapshot = {
    collectedAt: "2026-05-10T00:00:00Z",
    workspace: "/tmp/test",
    dependencies: [
      { name: "react", major: "18", rawVersion: "^18.2.0", source: "/tmp/package.json" },
    ],
  };

  const metadata = dependencyMetadata(snapshot);
  assert.ok(Array.isArray(metadata.dependencies));
  assert.equal(metadata.dependencies.length, 1);
  assert.equal(metadata.dependencies[0].name, "react");
  assert.equal(metadata.dependencyCollectedAt, "2026-05-10T00:00:00Z");
  assert.equal(metadata.dependencyWorkspace, "/tmp/test");
});

test("dependencyWarningsForEntry detects major version mismatch", () => {
  const entry = {
    id: "test-entry",
    key: "test",
    content: "Use React 18 layout.",
    metadata: {
      dependencies: [
        { name: "react", major: "18", source: "/old/package.json" },
      ],
    },
    tags: ["dependency:react:18.x"],
    source: "manual",
  };

  const currentSnapshot = {
    collectedAt: new Date().toISOString(),
    workspace: "/tmp/current",
    dependencies: [
      { name: "react", major: "19", rawVersion: "^19.0.0", source: "/current/package.json" },
    ],
  };

  const warnings = dependencyWarningsForEntry(entry, currentSnapshot);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].name, "react");
  assert.equal(warnings[0].expectedMajor, "18");
  assert.equal(warnings[0].major, "19");
  assert.ok(warnings[0].warning.includes("18.x"));
  assert.ok(warnings[0].warning.includes("19.x"));
});

test("dependencyWarningsForEntry returns empty when versions match", () => {
  const entry = {
    id: "test-entry",
    key: "test",
    content: "Use React 18 layout.",
    metadata: {
      dependencies: [
        { name: "react", major: "18", source: "/old/package.json" },
      ],
    },
    tags: [],
    source: "manual",
  };

  const snapshot = {
    collectedAt: new Date().toISOString(),
    workspace: "/tmp/current",
    dependencies: [
      { name: "react", major: "18", rawVersion: "^18.3.0", source: "/current/package.json" },
    ],
  };

  const warnings = dependencyWarningsForEntry(entry, snapshot);
  assert.equal(warnings.length, 0);
});

test("dependencyWarningsForEntry returns empty for entries without dependencies", () => {
  const entry = {
    id: "test-entry",
    key: "test",
    content: "Generic pattern.",
    metadata: {},
    tags: [],
    source: "manual",
  };

  const warnings = dependencyWarningsForEntry(entry, {
    collectedAt: new Date().toISOString(),
    workspace: "/tmp",
    dependencies: [{ name: "react", major: "19", rawVersion: "^19.0.0", source: "pkg.json" }],
  });

  assert.equal(warnings.length, 0);
});

test("collectDependencySnapshot handles scoped packages correctly", () => {
  const dir = createWorkspace({
    name: "test",
    dependencies: {
      "@angular/core": "^17.0.0",
      "@types/express": "^4.17.0",
    },
  });

  try {
    const snapshot = collectDependencySnapshot(dir);
    assert.ok(snapshot);
    assert.equal(snapshot.dependencies.length, 2);

    const angular = snapshot.dependencies.find((d) => d.name === "@angular/core");
    assert.ok(angular);
    assert.equal(angular.major, "17");

    const express = snapshot.dependencies.find((d) => d.name === "@types/express");
    assert.ok(express);
    assert.equal(express.major, "4");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
