import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildHostIntegration,
  createDefaultConfig,
  installHostIntegration,
  validateHostIntegration,
  writeHostIntegration,
  writeMemFlowConfig,
} from "../dist/index.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "../../dist/cli.js");

test("buildHostIntegration returns MCP-only Codex config and hook-enabled Claude/Antigravity/ChatGPT configs", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-integrations-test-"));
  const configPath = join(home, "config.json");

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
      },
      configPath
    );

    const codex = buildHostIntegration("codex", configPath);
    assert.equal(codex.host, "codex");
    assert.equal(Boolean(codex.runtime), false);
    assert.equal(Boolean(codex.mcpServers.memflow), true);
    assert.match(codex.mcpServers.memflow.command, /node/);

    const claude = buildHostIntegration("claude-code", configPath);
    assert.equal(claude.host, "claude-code");
    assert.match(claude.runtime.prepareCommand, /host:bridge/);
    assert.match(claude.runtime.finalizeCommand, /--phase finalize/);

    const antigravity = buildHostIntegration("antigravity", configPath);
    assert.equal(antigravity.host, "antigravity");
    assert.match(antigravity.runtime.prepareCommand, /host:bridge/);

    const vscode = buildHostIntegration("vscode", configPath);
    assert.equal(vscode.host, "vscode");
    assert.equal(Boolean(vscode.runtime), false);
    assert.equal(Boolean(vscode.mcpServers.memflow), true);

    const chatgpt = buildHostIntegration("chatgpt", configPath);
    assert.equal(chatgpt.host, "chatgpt");
    assert.equal(Boolean(chatgpt.runtime), false);
    assert.equal(chatgpt.mcpServers.memflow.type, "httpStream");
    assert.match(chatgpt.branding.icon, /cpu-currency-icon\.png$/);
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});

test("validateHostIntegration reports generated artifacts", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-integrations-validate-test-"));
  const configPath = join(home, "config.json");
  const memflowHome = join(home, ".memflow-home");
  process.env.MEMFLOW_HOME = memflowHome;

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
      },
      configPath
    );

    writeHostIntegration("codex", configPath);
    const result = validateHostIntegration("codex");

    assert.equal(result.host, "codex");
    assert.equal(result.ok, true);
    assert.equal(result.checks.every((check) => check.ok), true);
  } finally {
    delete process.env.MEMFLOW_HOME;
    rmSync(home, { force: true, recursive: true });
  }
});

test("writeHostIntegration writes supplemental host artifacts", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-integrations-write-test-"));
  const configPath = join(home, "config.json");
  const memflowHome = join(home, ".memflow-home");
  process.env.MEMFLOW_HOME = memflowHome;

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
        workspace: home,
      },
      configPath
    );

    writeHostIntegration("codex", configPath);
    writeHostIntegration("claude-code", configPath);
    writeHostIntegration("vscode", configPath);
    writeHostIntegration("chatgpt", configPath);

    const toml = readFileSync(join(memflowHome, "integrations", "codex-mcp.toml"), "utf8");
    const prepare = readFileSync(join(memflowHome, "integrations", "claude-code-prepare.sh"), "utf8");
    const finalize = readFileSync(join(memflowHome, "integrations", "claude-code-finalize.sh"), "utf8");
    const vscode = JSON.parse(readFileSync(join(home, ".vscode", "mcp.json"), "utf8"));
    const chatgpt = JSON.parse(readFileSync(join(memflowHome, "integrations", "chatgpt.json"), "utf8"));

    assert.match(toml, /\[mcp_servers\.memflow\]/);
    assert.match(prepare, /host:bridge .*--phase prepare/);
    assert.match(finalize, /host:bridge .*--phase finalize/);
    assert.equal(vscode.servers.memflow.type, "stdio");
    assert.equal(chatgpt.mcpServers.memflow.type, "httpStream");
  } finally {
    delete process.env.MEMFLOW_HOME;
    rmSync(home, { force: true, recursive: true });
  }
});

test("installHostIntegration installs Codex config into a managed block", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-integrations-install-codex-test-"));
  const configPath = join(home, "config.json");
  const memflowHome = join(home, ".memflow-home");
  const codexConfigPath = join(home, ".codex", "config.toml");
  process.env.MEMFLOW_HOME = memflowHome;
  process.env.MEMFLOW_CODEX_CONFIG_PATH = codexConfigPath;

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
        workspace: home,
      },
      configPath
    );

    const result = installHostIntegration("codex", configPath);
    const config = readFileSync(codexConfigPath, "utf8");

    assert.equal(result.host, "codex");
    assert.equal(result.applied, true);
    assert.equal(result.mode, "automatic");
    assert.match(config, /# >>> MemFlow MCP >>>/);
    assert.match(config, /\[mcp_servers\.memflow\]/);
  } finally {
    delete process.env.MEMFLOW_HOME;
    delete process.env.MEMFLOW_CODEX_CONFIG_PATH;
    rmSync(home, { force: true, recursive: true });
  }
});

test("installHostIntegration installs VS Code MCP config into the workspace file", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-integrations-install-vscode-test-"));
  const configPath = join(home, "config.json");
  const memflowHome = join(home, ".memflow-home");
  const vscodeMcpPath = join(home, ".vscode", "mcp.json");
  process.env.MEMFLOW_HOME = memflowHome;

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
        workspace: home,
      },
      configPath
    );

    const result = installHostIntegration("vscode", configPath);
    const config = JSON.parse(readFileSync(vscodeMcpPath, "utf8"));
    const validation = validateHostIntegration("vscode", configPath);

    assert.equal(result.host, "vscode");
    assert.equal(result.applied, true);
    assert.equal(result.mode, "automatic");
    assert.equal(config.servers.memflow.type, "stdio");
    assert.equal(Array.isArray(config.servers.memflow.args), true);
    assert.equal(validation.ok, true);
  } finally {
    delete process.env.MEMFLOW_HOME;
    rmSync(home, { force: true, recursive: true });
  }
});

test("installHostIntegration configures Claude settings even when Claude CLI is unavailable", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-integrations-install-claude-test-"));
  const configPath = join(home, "config.json");
  const memflowHome = join(home, ".memflow-home");
  const claudeSettingsPath = join(home, ".claude", "settings.json");
  const claudeMcpPath = join(home, ".mcp.json");
  process.env.MEMFLOW_HOME = memflowHome;
  process.env.MEMFLOW_CLAUDE_SETTINGS_PATH = claudeSettingsPath;
  process.env.MEMFLOW_CLAUDE_COMMAND = join(home, "missing-claude");

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
      },
      configPath
    );

    const result = installHostIntegration("claude-code", configPath);
    const settings = JSON.parse(readFileSync(claudeSettingsPath, "utf8"));
    const mcp = JSON.parse(readFileSync(claudeMcpPath, "utf8"));

    assert.equal(result.host, "claude-code");
    assert.equal(result.applied, true);
    assert.equal(result.mode, "automatic");
    assert.ok(Array.isArray(settings.hooks.UserPromptSubmit));
    assert.ok(Array.isArray(settings.hooks.PostToolUse));
    assert.ok(Array.isArray(settings.hooks.SessionEnd));
    assert.equal(typeof mcp.mcpServers.memflow.command, "string");
  } finally {
    delete process.env.MEMFLOW_HOME;
    delete process.env.MEMFLOW_CLAUDE_SETTINGS_PATH;
    delete process.env.MEMFLOW_CLAUDE_COMMAND;
    rmSync(home, { force: true, recursive: true });
  }
});

test("installHostIntegration installs Antigravity MCP config when safe", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-integrations-install-antigravity-test-"));
  const configPath = join(home, "config.json");
  const memflowHome = join(home, ".memflow-home");
  const antigravityConfigPath = join(home, ".gemini", "antigravity", "mcp_config.json");
  const antigravityRulesPath = join(home, ".gemini", "rules.md");
  process.env.MEMFLOW_HOME = memflowHome;
  process.env.MEMFLOW_ANTIGRAVITY_CONFIG_PATH = antigravityConfigPath;
  process.env.MEMFLOW_ANTIGRAVITY_RULES_PATH = antigravityRulesPath;

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
      },
      configPath
    );

    const result = installHostIntegration("antigravity", configPath);
    const config = JSON.parse(readFileSync(antigravityConfigPath, "utf8"));
    const rules = readFileSync(antigravityRulesPath, "utf8");

    assert.equal(result.host, "antigravity");
    assert.equal(result.applied, true);
    assert.equal(result.mode, "automatic");
    assert.equal(typeof config.mcpServers.memflow.command, "string");
    assert.equal(Array.isArray(config.mcpServers.memflow.args), true);
    assert.match(rules, /MemFlow System Lifecycle Bridge/);
    assert.match(rules, /mcp_memflow_memory_agent_prepare/);
    assert.match(rules, /mcp_memflow_memory_agent_finalize/);
  } finally {
    delete process.env.MEMFLOW_HOME;
    delete process.env.MEMFLOW_ANTIGRAVITY_CONFIG_PATH;
    delete process.env.MEMFLOW_ANTIGRAVITY_RULES_PATH;
    rmSync(home, { force: true, recursive: true });
  }
});

test("installHostIntegration installs ChatGPT connector draft when a remote URL is configured", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-integrations-install-chatgpt-test-"));
  const configPath = join(home, "config.json");
  const memflowHome = join(home, ".memflow-home");
  const chatgptDraftPath = join(memflowHome, "integrations", "chatgpt.json");
  const env = {
    ...process.env,
    MEMFLOW_HOME: memflowHome,
    MEMFLOW_CHATGPT_MCP_URL: "https://mcp.example.com/mcp",
  };

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
      },
      configPath
    );

    const previousUrl = process.env.MEMFLOW_CHATGPT_MCP_URL;
    process.env.MEMFLOW_CHATGPT_MCP_URL = env.MEMFLOW_CHATGPT_MCP_URL;
    const result = installHostIntegration("chatgpt", configPath);
    const draft = JSON.parse(readFileSync(chatgptDraftPath, "utf8"));

    assert.equal(result.host, "chatgpt");
    assert.equal(result.applied, true);
    assert.equal(result.mode, "automatic");
    assert.equal(draft.mcpServers.memflow.type, "httpStream");
    assert.equal(draft.mcpServers.memflow.url, "https://mcp.example.com/mcp");
    assert.match(draft.branding.icon, /cpu-currency-icon\.png$/);
    assert.match(draft.branding.fullLogo, /cpucoin-logo-full\.png$/);
    if (previousUrl === undefined) {
      delete process.env.MEMFLOW_CHATGPT_MCP_URL;
    } else {
      process.env.MEMFLOW_CHATGPT_MCP_URL = previousUrl;
    }
  } finally {
    delete process.env.MEMFLOW_HOME;
    delete process.env.MEMFLOW_CHATGPT_MCP_URL;
    rmSync(home, { force: true, recursive: true });
  }
});

test("CLI aliases install OpenAI Codex, ChatGPT, and Claude Code integrations", async () => {
  const home = mkdtempSync(join(tmpdir(), "memflow-integrations-cli-alias-test-"));
  const configPath = join(home, "config.json");
  const memflowHome = join(home, ".memflow-home");
  const codexConfigPath = join(home, ".codex", "config.toml");
  const claudeSettingsPath = join(home, ".claude", "settings.json");
  const chatgptDraftPath = join(memflowHome, "integrations", "chatgpt.json");
  const env = {
    ...process.env,
    MEMFLOW_HOME: memflowHome,
    MEMFLOW_CODEX_CONFIG_PATH: codexConfigPath,
    MEMFLOW_CLAUDE_SETTINGS_PATH: claudeSettingsPath,
    MEMFLOW_CLAUDE_COMMAND: join(home, "missing-claude"),
    MEMFLOW_CHATGPT_MCP_URL: "https://mcp.example.com/mcp",
  };

  try {
    writeMemFlowConfig(
      {
        ...createDefaultConfig(),
        databasePath: join(home, "memflow.sqlite"),
        workspace: home,
      },
      configPath
    );

    const openai = spawnSync("node", [cliPath, "connect:openai", "--config", configPath], {
      encoding: "utf8",
      env,
    });
    assert.equal(openai.status, 0);
    assert.match(openai.stdout, /MemFlow is on and connected/);

    const chatgpt = spawnSync("node", [cliPath, "connect:chatgpt", "--config", configPath], {
      encoding: "utf8",
      env,
    });
    assert.equal(chatgpt.status, 0);
    assert.match(chatgpt.stdout, /MemFlow is on and connected for ChatGPT \/ OpenAI desktop/);
    assert.equal(JSON.parse(readFileSync(chatgptDraftPath, "utf8")).mcpServers.memflow.url, "https://mcp.example.com/mcp");

    const openaiDesktop = spawnSync("node", [cliPath, "validate:host", "--host", "openai-desktop", "--config", configPath], {
      encoding: "utf8",
      env,
    });
    assert.equal(openaiDesktop.status, 0);
    assert.match(openaiDesktop.stdout, /"host":\s*"chatgpt"/);

    const validateOpenAI = spawnSync("node", [cliPath, "validate:host", "--host", "openai", "--config", configPath], {
      encoding: "utf8",
      env,
    });
    assert.equal(validateOpenAI.status, 0);
    assert.match(validateOpenAI.stdout, /"host":\s*"codex"/);

    const claude = spawnSync("node", [cliPath, "connect:claude", "--config", configPath], {
      encoding: "utf8",
      env,
    });
    assert.equal(claude.status, 0);
    assert.match(claude.stdout, /MemFlow is on and connected/);

    const validateClaude = spawnSync("node", [cliPath, "validate:host", "--host", "claude", "--config", configPath], {
      encoding: "utf8",
      env,
    });
    assert.equal(validateClaude.status, 0);
    assert.match(validateClaude.stdout, /"host":\s*"claude-code"/);
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
});
