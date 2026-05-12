import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { SQLiteConnector } from "../dist/connectors/sqlite.js";
import {
  detectLegacyRufloSetup,
  detectLegacyRufloSetups,
  importLegacyRufloSetup,
} from "../dist/migrations/memflow.js";

function setupLegacyFixture() {
  const dir = mkdtempSync(join(tmpdir(), "memflow-ruflo-import-"));
  const swarmDir = join(dir, ".swarm");
  const claudeFlowDir = join(dir, ".claude-flow");
  mkdirSync(swarmDir, { recursive: true });
  mkdirSync(claudeFlowDir, { recursive: true });
  writeFileSync(join(claudeFlowDir, "daemon-state.json"), JSON.stringify({ ok: true }));

  const dbPath = join(swarmDir, "memory.db");
  execFileSync("sqlite3", [
    dbPath,
    `
    CREATE TABLE memory_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      namespace TEXT DEFAULT 'default',
      content TEXT NOT NULL,
      type TEXT DEFAULT 'semantic',
      embedding TEXT,
      embedding_model TEXT,
      embedding_dimensions INTEGER,
      tags TEXT,
      metadata TEXT,
      owner_id TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      expires_at INTEGER,
      last_accessed_at INTEGER,
      access_count INTEGER,
      status TEXT
    );
    CREATE TABLE patterns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pattern_type TEXT NOT NULL,
      condition TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT,
      confidence REAL,
      success_count INTEGER,
      failure_count INTEGER,
      decay_rate REAL,
      half_life_days INTEGER,
      embedding TEXT,
      embedding_dimensions INTEGER,
      version INTEGER,
      parent_id TEXT,
      tags TEXT,
      metadata TEXT,
      source TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      last_matched_at INTEGER,
      last_success_at INTEGER,
      last_failure_at INTEGER,
      status TEXT
    );
    INSERT INTO memory_entries (id, key, namespace, content, type, tags, metadata, created_at, updated_at)
    VALUES ('legacy-entry-1', 'auth-pattern', 'patterns', 'Legacy auth memory', 'pattern', '["auth"]', '{"origin":"legacy"}', 1, 2);
    INSERT INTO patterns (id, name, pattern_type, condition, action, description, confidence, tags, metadata, created_at, updated_at)
    VALUES ('legacy-pattern-1', 'retry-flow', 'workflow', 'if failure', 'retry step', 'Retry failing step', 0.8, '["retry"]', '{"source":"legacy"}', 3, 4);
    `,
  ]);

  return { dbPath, dir };
}

test("detectLegacyRufloSetup finds legacy footprint", async () => {
  const { dir } = setupLegacyFixture();

  try {
    const detected = detectLegacyRufloSetup(dir);
    assert.equal(detected.detected, true);
    assert.ok(detected.swarmMemoryDb);
    assert.ok(detected.claudeFlowDir);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("detectLegacyRufloSetup walks upward from a nested working directory", async () => {
  const { dir } = setupLegacyFixture();
  const nested = join(dir, "memflow", "nested");
  mkdirSync(nested, { recursive: true });

  try {
    const detected = detectLegacyRufloSetup(nested);
    assert.equal(detected.detected, true);
    assert.equal(detected.cwd, dir);
    assert.ok(detected.swarmMemoryDb);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("detectLegacyRufloSetups scans multiple candidate roots", async () => {
  const { dir } = setupLegacyFixture();
  const other = mkdtempSync(join(tmpdir(), "memflow-ruflo-none-"));

  try {
    const detected = detectLegacyRufloSetups([other, join(dir, "nested"), dir]);
    assert.equal(detected.length, 1);
    assert.equal(detected[0].cwd, dir);
    assert.ok(detected[0].swarmMemoryDb);
  } finally {
    rmSync(dir, { force: true, recursive: true });
    rmSync(other, { force: true, recursive: true });
  }
});

test("importLegacyRufloSetup imports legacy memory and setup snapshot", async () => {
  const { dir } = setupLegacyFixture();
  const connector = new SQLiteConnector({
    databasePath: join(dir, "memflow.sqlite"),
  });

  try {
    const summary = await importLegacyRufloSetup(connector, dir);
    assert.equal(summary.importedEntries, 1);
    assert.equal(summary.importedPatterns, 1);
    assert.equal(summary.importedSetupSnapshot, true);

    const importedPatterns = await connector.list({ namespace: "patterns" });
    const legacyPatterns = await connector.list({ namespace: "legacy.patterns" });
    const setupEntries = await connector.list({ namespace: "legacy.setup" });

    assert.equal(importedPatterns.length, 1);
    assert.equal(legacyPatterns.length, 1);
    assert.equal(setupEntries.length, 1);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("importLegacyRufloSetup can import only database data without setup snapshot", async () => {
  const { dir } = setupLegacyFixture();
  const connector = new SQLiteConnector({
    databasePath: join(dir, "memflow-no-snapshot.sqlite"),
  });

  try {
    const summary = await importLegacyRufloSetup(connector, dir, {
      includeSetupSnapshot: false,
    });
    assert.equal(summary.importedEntries, 1);
    assert.equal(summary.importedPatterns, 1);
    assert.equal(summary.importedSetupSnapshot, false);

    const importedPatterns = await connector.list({ namespace: "patterns" });
    const legacyPatterns = await connector.list({ namespace: "legacy.patterns" });
    const setupEntries = await connector.list({ namespace: "legacy.setup" });

    assert.equal(importedPatterns.length, 1);
    assert.equal(legacyPatterns.length, 1);
    assert.equal(setupEntries.length, 0);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
