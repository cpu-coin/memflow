import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createConnectorFromEnvironment, createMemFlowServer } from "../dist/mcp/server.js";
import { SQLiteConnector } from "../dist/connectors/sqlite.js";

test("MemFlow MCP defaults to a local SQLite connector", async () => {
  const memflowHome = mkdtempSync(join(tmpdir(), "memflow-home-"));
  const previous = {
    connector: process.env.MEMFLOW_CONNECTOR,
    home: process.env.MEMFLOW_HOME,
    sqlitePath: process.env.MEMFLOW_SQLITE_PATH,
  };

  delete process.env.MEMFLOW_CONNECTOR;
  delete process.env.MEMFLOW_SQLITE_PATH;
  process.env.MEMFLOW_HOME = memflowHome;

  try {
    const connector = createConnectorFromEnvironment();
    assert.equal(connector instanceof SQLiteConnector, true);

    const server = createMemFlowServer({ connector, version: "0.1.0" });
    assert.ok(server);
  } finally {
    if (previous.connector === undefined) {
      delete process.env.MEMFLOW_CONNECTOR;
    } else {
      process.env.MEMFLOW_CONNECTOR = previous.connector;
    }

    if (previous.home === undefined) {
      delete process.env.MEMFLOW_HOME;
    } else {
      process.env.MEMFLOW_HOME = previous.home;
    }

    if (previous.sqlitePath === undefined) {
      delete process.env.MEMFLOW_SQLITE_PATH;
    } else {
      process.env.MEMFLOW_SQLITE_PATH = previous.sqlitePath;
    }

    rmSync(memflowHome, { force: true, recursive: true });
  }
});
