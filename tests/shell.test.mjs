import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildShellPromptBlock,
  getShellPromptStatus,
  replaceManagedBlock,
} from "../dist/index.js";

test("replaceManagedBlock appends a managed shell block once and updates idempotently", async () => {
  const block = buildShellPromptBlock("zsh");
  const first = replaceManagedBlock("# existing\n", block);
  const second = replaceManagedBlock(first, block);

  assert.match(first, /memflow shell indicator/);
  assert.match(first, /memflow\(\)/);
  assert.match(first, /memflow-mcp\(\)/);
  assert.match(first, /export PATH=".*\.memflow\/bin:\$PATH"/);
  assert.match(first, /"\S*node\S*" ".*dist\/cli\.js"/);
  assert.match(first, /typeset -g MEMFLOW_ORIG_PROMPT/);
  assert.match(first, /PROMPT="\$\{memflow_status\}\\n\$\{MEMFLOW_ORIG_PROMPT\}"/);
  assert.doesNotMatch(first, /RPROMPT=/);
  assert.equal(second, first);
});

test("getShellPromptStatus reports installed and loaded shell state", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-shell-test-"));
  const originalHome = process.env.HOME;
  const originalHook = process.env.MEMFLOW_SHELL_HOOK;
  process.env.HOME = home;
  process.env.MEMFLOW_SHELL_HOOK = "1";

  try {
    writeFileSync(join(home, ".zshrc"), `${buildShellPromptBlock("zsh")}\n`, "utf8");
    const status = getShellPromptStatus("/bin/zsh");

    assert.equal(status.shell, "zsh");
    assert.equal(status.installed, true);
    assert.equal(status.currentShellLoaded, true);
    assert.match(String(status.commandPath), /\.memflow\/bin\/memflow$/);
    assert.match(readFileSync(join(home, ".zshrc"), "utf8"), /MEMFLOW_SHELL_HOOK=1/);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalHook === undefined) {
      delete process.env.MEMFLOW_SHELL_HOOK;
    } else {
      process.env.MEMFLOW_SHELL_HOOK = originalHook;
    }
    rmSync(home, { force: true, recursive: true });
  }
});
