import { test } from "node:test";
import assert from "node:assert/strict";

import { runCli } from "../dist/cli.js";
import { formatVersion, getVersionInfo } from "../dist/version.js";

test("version info reads package version 1.0.0", async () => {
  const info = getVersionInfo();
  assert.equal(info.version, "1.0.0");
  assert.match(formatVersion(info), /memflow 1\.0\.0/);
});

test("CLI version command returns success", async () => {
  const result = await runCli(["version"]);
  assert.equal(result, 0);
});
