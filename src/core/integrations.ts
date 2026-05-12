import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  getDefaultHostIntegrationsPath,
  getDefaultConfigPath,
  readMemFlowConfig,
  findTrackedProjectForPath,
} from "./config.js";
import { buildHostBootstrap } from "./host.js";
import type {
  HostInstallationResult,
  HostValidationResult,
  MemFlowHostIntegration,
} from "../types/memory.js";

export const SUPPORTED_HOSTS = ["antigravity", "chatgpt", "claude-code", "codex", "vscode"] as const;
export type SupportedHost = (typeof SUPPORTED_HOSTS)[number];

const MEMFLOW_CODEX_START = "# >>> MemFlow MCP >>>";
const MEMFLOW_CODEX_END = "# <<< MemFlow MCP <<<";
const MEMFLOW_ANTIGRAVITY_RULES_START = "<!-- MemFlow Antigravity Bridge START -->";
const MEMFLOW_ANTIGRAVITY_RULES_END = "<!-- MemFlow Antigravity Bridge END -->";
const MEMFLOW_BRAND_ICON = "cpu-currency-icon.png";
const MEMFLOW_BRAND_FULL_LOGO = "cpucoin-logo-full.png";

export function writeHostIntegration(
  host: SupportedHost,
  configPath: string = getDefaultConfigPath()
): MemFlowHostIntegration {
  const integration = buildHostIntegration(host, configPath);
  const outputPath = join(getDefaultHostIntegrationsPath(), `${host}.json`);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(integration, null, 2)}\n`, "utf8");
  writeSupplementalHostFiles(host, integration, configPath);
  return integration;
}

export function buildHostIntegration(
  host: SupportedHost,
  configPath: string = getDefaultConfigPath()
): MemFlowHostIntegration {
  const bootstrap = buildHostBootstrap(configPath);
  const nodePath = process.execPath;
  const mcpServers = {
    memflow: {
      type: "stdio",
      command: nodePath,
      args: [bootstrap.paths.mcp, "--config", bootstrap.configPath],
    },
  };

  if (host === "codex") {
    return {
      files: [join(getDefaultHostIntegrationsPath(), "codex.json")],
      generatedAt: new Date().toISOString(),
      host,
      instructions: [
        "MemFlow can install this MCP block into your Codex configuration automatically.",
        "Use MemFlow MCP tools for recall, recovery, cache, and metrics.",
        "Codex integration starts MCP-first; lifecycle automation can be layered later through the bridge command if needed.",
      ],
      mcpServers,
      monitoring: bootstrap.monitoring,
      reviewTargets: ["Codex MCP configuration"],
    };
  }

  if (host === "vscode") {
    return {
      files: [join(getDefaultHostIntegrationsPath(), "vscode.json")],
      generatedAt: new Date().toISOString(),
      host,
      instructions: [
        "MemFlow can install this MCP block into your VS Code workspace automatically.",
        "Use the workspace `.vscode/mcp.json` file so VS Code exposes MemFlow in agent chat sessions.",
        "Reload or reopen the workspace after updating the MCP file so the server is discovered.",
      ],
      mcpServers,
      monitoring: bootstrap.monitoring,
      reviewTargets: ["VS Code MCP configuration"],
    };
  }

  if (host === "chatgpt") {
    const chatgptUrl = getChatgptMcpUrl();
    const chatgptDraftPath = join(getDefaultHostIntegrationsPath(), "chatgpt.json");
    const chatgptIconPath = join(getDefaultHostIntegrationsPath(), MEMFLOW_BRAND_ICON);
    const chatgptFullLogoPath = join(getDefaultHostIntegrationsPath(), MEMFLOW_BRAND_FULL_LOGO);
    return {
      branding: {
        fullLogo: chatgptFullLogoPath,
        icon: chatgptIconPath,
      },
      files: [chatgptDraftPath, chatgptIconPath, chatgptFullLogoPath],
      generatedAt: new Date().toISOString(),
      host,
      instructions: [
        "MemFlow generated a ChatGPT developer-mode connector draft for the remote MCP endpoint.",
        chatgptUrl
          ? `Use the remote MCP URL ${chatgptUrl} in ChatGPT Developer mode or OpenAI's ChatGPT app connector flow.`
          : "Set MEMFLOW_CHATGPT_MCP_URL (or MEMFLOW_PUBLIC_MCP_URL) to the HTTPS MCP endpoint you want ChatGPT to import.",
        "Use the CPU icon for the MemFlow MCP server icon, and use the full CPUcoin logo where a full brand mark is required.",
        "After importing the connector, start a new chat and confirm MemFlow reports that it is on and connected.",
      ],
      mcpServers: {
        memflow: {
          headers: {
            "X-MemFlow-Host": "chatgpt",
          },
          type: "httpStream",
          url: chatgptUrl,
        },
      },
      monitoring: bootstrap.monitoring,
      reviewTargets: ["ChatGPT developer mode connector", "OpenAI ChatGPT / desktop code-mode surface"],
    };
  }

  const bridgeCommand = `${quote(nodePath)} ${quote(bootstrap.paths.cli)} host:bridge --host ${host} --config ${quote(bootstrap.configPath)}`;
  const prepareCommand = `${bridgeCommand} --phase prepare --stdin`;
  const finalizeCommand = `${bridgeCommand} --phase finalize --stdin`;

  return {
    files: [join(getDefaultHostIntegrationsPath(), `${host}.json`)],
    generatedAt: new Date().toISOString(),
    host,
    instructions: [
      "MemFlow generated the MCP and lifecycle commands for this host.",
      "MemFlow can auto-apply supported host config during guided setup.",
      "Point start-of-turn hooks to the prepare bridge command.",
      "Point end-of-turn or milestone hooks to the finalize bridge command.",
      "Reload or restart the host after updating its configuration.",
    ],
    mcpServers,
    monitoring: bootstrap.monitoring,
    reviewTargets:
      host === "claude-code"
        ? ["Claude Code MCP config", "Claude Code hook config"]
        : ["Antigravity MCP config", "Antigravity workflow or hook config if available"],
    runtime: {
      bridgeCommand,
      finalizeCommand,
      prepareCommand,
    },
  };
}

export function formatHostReloadInstruction(host: SupportedHost): string {
  if (host === "codex") {
    return "Reload Codex or reopen the Codex CLI/session so the installed MemFlow MCP config is reloaded.";
  }

  if (host === "vscode") {
    return "Reload VS Code or reopen the workspace so the installed MemFlow MCP config is reloaded.";
  }

  if (host === "chatgpt") {
    return "Open a new ChatGPT chat or refresh the ChatGPT connector list so the imported MemFlow MCP connector is visible.";
  }

  if (host === "claude-code") {
    return "Reload Claude Code so the installed MemFlow MCP and hook config is reloaded.";
  }

  return "Reload Antigravity after applying the generated MCP and hook config.";
}

export function installHostIntegration(
  host: SupportedHost,
  configPath: string = getDefaultConfigPath()
): HostInstallationResult {
  const generated = writeHostIntegration(host, configPath);
  const config = readMemFlowConfig(configPath);
  const workspace = config.workspace ?? process.cwd();
  const actions: string[] = [];
  const notes: string[] = [];
  const targets = [...generated.files];
  let applied = false;
  let mode: HostInstallationResult["mode"] = "generated-only";

  if (host === "codex") {
    const codexConfigPath = getCodexConfigPath();
    const codexInstall = installCodexConfig(generated, codexConfigPath);
    actions.push(...codexInstall.actions);
    notes.push(...codexInstall.notes);
    targets.push(codexConfigPath);
    applied = codexInstall.applied;
    mode = codexInstall.applied ? "automatic" : "generated-only";
  } else if (host === "vscode") {
    const vscodeMcpPath = getVscodeMcpPath(readMemFlowConfig(configPath).workspace ?? process.cwd());
    const vscodeInstall = installVscodeConfig(generated, vscodeMcpPath);
    actions.push(...vscodeInstall.actions);
    notes.push(...vscodeInstall.notes);
    targets.push(...vscodeInstall.targets);
    applied = vscodeInstall.applied;
    mode = vscodeInstall.mode;
  } else if (host === "chatgpt") {
    const chatgptDraftPath = getChatgptDraftPath();
    const chatgptInstall = installChatgptConfig(generated, chatgptDraftPath);
    actions.push(...chatgptInstall.actions);
    notes.push(...chatgptInstall.notes);
    targets.push(...chatgptInstall.targets);
    applied = chatgptInstall.applied;
    mode = chatgptInstall.mode;
  } else if (host === "claude-code") {
    const claudeSettingsPath = getClaudeSettingsPath();
    const claudeInstall = installClaudeCodeConfig(generated, claudeSettingsPath, workspace);
    actions.push(...claudeInstall.actions);
    notes.push(...claudeInstall.notes);
    targets.push(...claudeInstall.targets);
    applied = claudeInstall.applied;
    mode = claudeInstall.mode;
  } else {
    const antigravityConfigPath = getAntigravityConfigPath();
    const antigravityInstall = installAntigravityConfig(generated, antigravityConfigPath);
    actions.push(...antigravityInstall.actions);
    notes.push(...antigravityInstall.notes);
    targets.push(...antigravityInstall.targets);
    applied = antigravityInstall.applied;
    mode = antigravityInstall.mode;
  }

  const validation = validateHostIntegration(host, configPath);

  return {
    actions,
    applied,
    generated,
    host,
    mode,
    notes,
    targets,
    validation,
  };
}

export function validateHostIntegration(
  host: SupportedHost,
  configPath: string = getDefaultConfigPath()
): HostValidationResult {
  const base = getDefaultHostIntegrationsPath();
  const checks: HostValidationResult["checks"] = [];

  const jsonPath = join(base, `${host}.json`);
  checks.push({
    message: "integration manifest exists",
    ok: existsSync(jsonPath),
    path: jsonPath,
  });

  if (host === "codex") {
    const tomlPath = join(base, "codex-mcp.toml");
    checks.push({
      message: "Codex MCP TOML snippet exists",
      ok: existsSync(tomlPath),
      path: tomlPath,
    });
  } else if (host === "vscode") {
    const vscodeMcpPath = getVscodeMcpPath(readMemFlowConfig(configPath).workspace ?? process.cwd());
    checks.push({
      message: "VS Code MCP JSON exists",
      ok: existsSync(vscodeMcpPath),
      path: vscodeMcpPath,
    });
    const current = existsSync(vscodeMcpPath)
      ? safeParseJson(readFileSync(vscodeMcpPath, "utf8"))
      : {};
    const servers =
      typeof current.servers === "object" && current.servers
        ? (current.servers as Record<string, unknown>)
        : {};
    checks.push({
      message: "VS Code memflow server is configured",
      ok: isManagedVscodeServer(servers.memflow),
      path: vscodeMcpPath,
    });
  } else if (host === "chatgpt") {
    const chatgptDraftPath = getChatgptDraftPath();
    checks.push({
      message: "ChatGPT connector draft exists",
      ok: existsSync(chatgptDraftPath),
      path: chatgptDraftPath,
    });
    const current = existsSync(chatgptDraftPath)
      ? safeParseJson(readFileSync(chatgptDraftPath, "utf8"))
      : {};
    const servers =
      typeof current.mcpServers === "object" && current.mcpServers
        ? (current.mcpServers as Record<string, unknown>)
        : {};
    checks.push({
      message: "ChatGPT memflow connector has a URL",
      ok: isManagedChatgptServer(servers.memflow),
      path: chatgptDraftPath,
    });
    const branding =
      typeof current.branding === "object" && current.branding
        ? (current.branding as Record<string, unknown>)
        : {};
    const iconPath = typeof branding.icon === "string" ? branding.icon : "";
    const fullLogoPath = typeof branding.fullLogo === "string" ? branding.fullLogo : "";
    checks.push({
      message: "ChatGPT icon asset exists",
      ok: Boolean(iconPath) && existsSync(iconPath),
      path: iconPath || chatgptDraftPath,
    });
    checks.push({
      message: "ChatGPT full logo asset exists",
      ok: Boolean(fullLogoPath) && existsSync(fullLogoPath),
      path: fullLogoPath || chatgptDraftPath,
    });
  } else {
    const preparePath = join(base, `${host}-prepare.sh`);
    const finalizePath = join(base, `${host}-finalize.sh`);
    checks.push({
      message: "prepare bridge script exists",
      ok: existsSync(preparePath),
      path: preparePath,
    });
    checks.push({
      message: "finalize bridge script exists",
      ok: existsSync(finalizePath),
      path: finalizePath,
    });
  }

  return {
    checks,
    host,
    ok: checks.every((check) => check.ok),
  };
}

function writeSupplementalHostFiles(
  host: SupportedHost,
  integration: MemFlowHostIntegration,
  configPath: string = getDefaultConfigPath()
): void {
  const base = getDefaultHostIntegrationsPath();

  if (host === "codex") {
    const tomlPath = join(base, "codex-mcp.toml");
    const args = (integration.mcpServers.memflow.args ?? []).map((arg) => `"${arg}"`).join(", ");
    writeFileSync(
      tomlPath,
      [
        "[mcp_servers.memflow]",
        `command = "${integration.mcpServers.memflow.command}"`,
        `args = [${args}]`,
        "",
      ].join("\n"),
      "utf8"
    );
    return;
  }

  if (host === "vscode") {
    const workspace = readMemFlowConfig(configPath).workspace ?? process.cwd();
    const vscodeMcpPath = getVscodeMcpPath(workspace);
    installVscodeConfig(integration, vscodeMcpPath);
    return;
  }

  if (host === "chatgpt") {
    const draftPath = getChatgptDraftPath();
    installChatgptConfig(integration, draftPath);
    return;
  }

  if (!integration.runtime) {
    return;
  }

  const prepareScript = join(base, `${host}-prepare.sh`);
  const finalizeScript = join(base, `${host}-finalize.sh`);
  writeFileSync(
    prepareScript,
    `#!/bin/sh\n${integration.runtime.prepareCommand}${host === "claude-code" ? " --hook-output" : ""}\n`,
    "utf8"
  );
  writeFileSync(
    finalizeScript,
    `#!/bin/sh\n${integration.runtime.finalizeCommand}\n`,
    "utf8"
  );
  chmodSync(prepareScript, 0o755);
  chmodSync(finalizeScript, 0o755);
}

function getCodexConfigPath(): string {
  return process.env.MEMFLOW_CODEX_CONFIG_PATH ?? join(homedir(), ".codex", "config.toml");
}

function getClaudeSettingsPath(): string {
  return process.env.MEMFLOW_CLAUDE_SETTINGS_PATH ?? join(homedir(), ".claude", "settings.json");
}

function getAntigravityConfigPath(): string {
  return (
    process.env.MEMFLOW_ANTIGRAVITY_CONFIG_PATH ??
    join(homedir(), ".gemini", "antigravity", "mcp_config.json")
  );
}

function getVscodeMcpPath(workspace?: string): string {
  if (process.env.MEMFLOW_VSCODE_MCP_PATH) {
    return process.env.MEMFLOW_VSCODE_MCP_PATH;
  }

  const root = workspace ?? process.cwd();
  return join(root, ".vscode", "mcp.json");
}

function getChatgptDraftPath(): string {
  return process.env.MEMFLOW_CHATGPT_DRAFT_PATH ?? join(getDefaultHostIntegrationsPath(), "chatgpt.json");
}

function getChatgptMcpUrl(): string {
  return (
    process.env.MEMFLOW_CHATGPT_MCP_URL ??
    process.env.MEMFLOW_PUBLIC_MCP_URL ??
    process.env.MEMFLOW_PUBLIC_BASE_URL ??
    ""
  );
}

function getAntigravityRulesPath(workspace?: string): string {
  if (process.env.MEMFLOW_ANTIGRAVITY_RULES_PATH) {
    return process.env.MEMFLOW_ANTIGRAVITY_RULES_PATH;
  }

  // If we have a workspace, check if it's a tracked project or has a .gemini folder
  if (workspace) {
    if (existsSync(join(workspace, ".gemini"))) {
      return join(workspace, ".gemini", "rules.md");
    }

    const config = readMemFlowConfig();
    const project = findTrackedProjectForPath(config.trackedProjects, workspace);
    if (project) {
      return join(project.path, ".gemini", "rules.md");
    }
  }

  // Fallback to home directory
  return join(homedir(), ".gemini", "rules.md");
}

function installCodexConfig(
  integration: MemFlowHostIntegration,
  codexConfigPath: string
): {
  actions: string[];
  applied: boolean;
  notes: string[];
} {
  const actions: string[] = [];
  const notes: string[] = [];
  const args = (integration.mcpServers.memflow.args ?? []).map((arg) => `"${arg}"`).join(", ");
  const block = [
    MEMFLOW_CODEX_START,
    "[mcp_servers.memflow]",
    `command = "${integration.mcpServers.memflow.command}"`,
    `args = [${args}]`,
    MEMFLOW_CODEX_END,
    "",
  ].join("\n");

  mkdirSync(dirname(codexConfigPath), { recursive: true });
  const current = existsSync(codexConfigPath) ? readFileSync(codexConfigPath, "utf8") : "";

  if (
    current.includes("[mcp_servers.memflow]") &&
    !current.includes(MEMFLOW_CODEX_START) &&
    !current.includes(MEMFLOW_CODEX_END)
  ) {
    notes.push(
      `Skipped automatic Codex install because ${codexConfigPath} already defines [mcp_servers.memflow] outside the MemFlow managed block.`
    );
    return { actions, applied: false, notes };
  }

  const next = replaceManagedBlock(current, MEMFLOW_CODEX_START, MEMFLOW_CODEX_END, block);
  writeFileSync(codexConfigPath, next, "utf8");
  actions.push(`Installed MemFlow MCP into ${codexConfigPath}.`);
  return {
    actions,
    applied: true,
    notes,
  };
}

function installClaudeCodeConfig(
  integration: MemFlowHostIntegration,
  claudeSettingsPath: string,
  workspace: string
): {
  actions: string[];
  applied: boolean;
  mode: HostInstallationResult["mode"];
  notes: string[];
  targets: string[];
} {
  const actions: string[] = [];
  const notes: string[] = [];
  const targets = [claudeSettingsPath];
  let mcpApplied = false;
  let settingsApplied = false;

  const mcpResult = installClaudeMcp(integration, workspace);
  actions.push(...mcpResult.actions);
  notes.push(...mcpResult.notes);
  mcpApplied = mcpResult.applied;

  const settingsResult = installClaudeSettings(integration, claudeSettingsPath, workspace);
  actions.push(...settingsResult.actions);
  notes.push(...settingsResult.notes);
  settingsApplied = settingsResult.applied;

  return {
    actions,
    applied: mcpApplied || settingsApplied,
    mode:
      mcpApplied && settingsApplied
        ? "automatic"
        : mcpApplied || settingsApplied
          ? "partial"
          : "generated-only",
    notes,
    targets,
  };
}

function installClaudeMcp(
  integration: MemFlowHostIntegration,
  workspace: string
): {
  actions: string[];
  applied: boolean;
  notes: string[];
} {
  const actions: string[] = [];
  const notes: string[] = [];
  const claudeCommand = process.env.MEMFLOW_CLAUDE_COMMAND ?? "claude";
  const payload = JSON.stringify({
    type: "stdio",
    command: integration.mcpServers.memflow.command ?? "",
    args: integration.mcpServers.memflow.args ?? [],
  });
  const result = spawnSync(
    claudeCommand,
    ["mcp", "add-json", "--scope", "user", "memflow", payload],
    {
      encoding: "utf8",
    }
  );

  if (result.error) {
    notes.push(
      `Claude Code CLI was not available for automatic MCP registration (${result.error.message}).`
    );
  } else if (result.status !== 0) {
    notes.push(
      `Claude Code MCP registration returned exit code ${result.status}. ${[
        result.stderr?.trim(),
        result.stdout?.trim(),
      ]
        .filter(Boolean)
        .join(" ")}`
    );
  } else {
    actions.push("Registered MemFlow MCP with Claude Code in user scope.");
    return { actions, applied: true, notes };
  }

  const fallback = installClaudeProjectMcp(integration, getClaudeProjectMcpPath(workspace));
  actions.push(...fallback.actions);
  notes.push(...fallback.notes);
  return {
    actions,
    applied: fallback.applied,
    notes,
  };
}

function installClaudeProjectMcp(
  integration: MemFlowHostIntegration,
  claudeMcpPath: string
): {
  actions: string[];
  applied: boolean;
  notes: string[];
} {
  const actions: string[] = [];
  const notes: string[] = [];
  mkdirSync(dirname(claudeMcpPath), { recursive: true });

  const current = existsSync(claudeMcpPath) ? safeParseJson(readFileSync(claudeMcpPath, "utf8")) : {};
  const config: Record<string, unknown> = typeof current === "object" && current ? { ...current } : {};
  const mcpServers =
    typeof config.mcpServers === "object" && config.mcpServers
      ? { ...(config.mcpServers as Record<string, unknown>) }
      : {};
  const existing = mcpServers.memflow;
  if (existing && !isManagedClaudeProjectServer(existing, integration)) {
    notes.push(
      `Skipped Claude project MCP fallback because ${claudeMcpPath} already defines a non-MemFlow \`memflow\` server entry.`
    );
    return { actions, applied: false, notes };
  }

  mcpServers.memflow = {
    type: "stdio",
    command: integration.mcpServers.memflow.command ?? "",
    args: integration.mcpServers.memflow.args ?? [],
  };
  config.mcpServers = mcpServers;
  writeFileSync(claudeMcpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  actions.push(`Installed MemFlow Claude Code MCP into ${claudeMcpPath}.`);
  notes.push(
    "Claude Code project MCP fallback was installed automatically because the user-scope CLI registration was unavailable."
  );
  return { actions, applied: true, notes };
}

function installClaudeSettings(
  integration: MemFlowHostIntegration,
  claudeSettingsPath: string,
  workspace: string
): {
  actions: string[];
  applied: boolean;
  notes: string[];
} {
  const actions: string[] = [];
  const notes: string[] = [];
  const runtime = integration.runtime;
  if (!runtime?.prepareCommand || !runtime.finalizeCommand) {
    notes.push("Claude Code integration runtime commands were not available.");
    return { actions, applied: false, notes };
  }

  const attempts = [
    { path: claudeSettingsPath, label: "user settings" },
    { path: getClaudeProjectSettingsPath(workspace), label: "project settings" },
  ];

  for (const attempt of attempts) {
    try {
      mkdirSync(dirname(attempt.path), { recursive: true });
      const current = existsSync(attempt.path)
        ? safeParseJson(readFileSync(attempt.path, "utf8"))
        : {};
      const settings: Record<string, unknown> =
        typeof current === "object" && current ? { ...current } : {};

      const hooks: Record<string, Array<Record<string, unknown>>> =
        typeof settings.hooks === "object" && settings.hooks
          ? { ...(settings.hooks as Record<string, Array<Record<string, unknown>>>) }
          : {};
      hooks.UserPromptSubmit = upsertClaudeHook(
        Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [],
        {
          hooks: [
            {
              type: "command",
              command: `${runtime.prepareCommand} --hook-output`,
            },
          ],
        }
      );
      hooks.PostToolUse = upsertClaudeHook(
        Array.isArray(hooks.PostToolUse) ? hooks.PostToolUse : [],
        {
          matcher: "Bash|Edit|MultiEdit|Write",
          hooks: [
            {
              type: "command",
              command: runtime.finalizeCommand,
            },
          ],
        }
      );
      hooks.SessionEnd = upsertClaudeHook(
        Array.isArray(hooks.SessionEnd) ? hooks.SessionEnd : [],
        {
          hooks: [
            {
              type: "command",
              command: runtime.finalizeCommand,
            },
          ],
        }
      );
      settings.hooks = hooks;

      if (!settings.statusLine) {
        settings.statusLine = {
          type: "command",
          command: `${runtime.bridgeCommand?.replace("host:bridge", "status:line") ?? ""}`.trim(),
        };
        actions.push("Configured Claude Code status line to show MemFlow state.");
      } else {
        notes.push(`Left existing Claude Code statusLine unchanged in ${attempt.path}.`);
      }

      writeFileSync(attempt.path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
      actions.push(`Installed MemFlow Claude Code hooks into ${attempt.path}.`);
      if (attempt.path !== claudeSettingsPath) {
        notes.push(
          "Claude Code project settings fallback was installed automatically because the user settings path was unavailable."
        );
      }
      return { actions, applied: true, notes };
    } catch (error) {
      notes.push(
        `Claude Code settings write failed for ${attempt.path}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return { actions, applied: false, notes };
}

function installVscodeConfig(
  integration: MemFlowHostIntegration,
  vscodeMcpPath: string
): {
  actions: string[];
  applied: boolean;
  mode: HostInstallationResult["mode"];
  notes: string[];
  targets: string[];
} {
  const actions: string[] = [];
  const notes: string[] = [];
  const targets = [vscodeMcpPath];
  mkdirSync(dirname(vscodeMcpPath), { recursive: true });

  const current = existsSync(vscodeMcpPath) ? safeParseJson(readFileSync(vscodeMcpPath, "utf8")) : {};
  const config: Record<string, unknown> = typeof current === "object" && current ? { ...current } : {};
  const servers =
    typeof config.servers === "object" && config.servers
      ? { ...(config.servers as Record<string, unknown>) }
      : {};
  const existing = servers.memflow;

  if (existing && !isManagedVscodeServer(existing)) {
    notes.push(
      `Skipped automatic VS Code MCP install because ${vscodeMcpPath} already defines a non-MemFlow \`memflow\` server entry.`
    );
    return {
      actions,
      applied: false,
      mode: "generated-only",
      notes,
      targets,
    };
  }

  servers.memflow = {
    type: "stdio",
    command: integration.mcpServers.memflow.command ?? "",
    args: integration.mcpServers.memflow.args ?? [],
  };
  config.servers = servers;
  writeFileSync(vscodeMcpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  actions.push(`Installed MemFlow MCP into ${vscodeMcpPath}.`);
  notes.push(
    "VS Code MCP config was installed automatically. Reload the workspace so the MCP server is discovered."
  );

  return {
    actions,
    applied: true,
    mode: "automatic",
    notes,
    targets,
  };
}

function installChatgptConfig(
  integration: MemFlowHostIntegration,
  chatgptDraftPath: string
): {
  actions: string[];
  applied: boolean;
  mode: HostInstallationResult["mode"];
  notes: string[];
  targets: string[];
} {
  const actions: string[] = [];
  const notes: string[] = [];
  const targets = [chatgptDraftPath];
  mkdirSync(dirname(chatgptDraftPath), { recursive: true });

  const current = existsSync(chatgptDraftPath) ? safeParseJson(readFileSync(chatgptDraftPath, "utf8")) : {};
  const config: Record<string, unknown> = typeof current === "object" && current ? { ...current } : {};
  const mcpServers =
    typeof config.mcpServers === "object" && config.mcpServers
      ? { ...(config.mcpServers as Record<string, unknown>) }
      : {};
  const existing = mcpServers.memflow;

  if (existing && !isManagedChatgptServer(existing)) {
    notes.push(
      `Skipped automatic ChatGPT connector draft install because ${chatgptDraftPath} already defines a non-MemFlow \`memflow\` entry.`
    );
    return {
      actions,
      applied: false,
      mode: "generated-only",
      notes,
      targets,
    };
  }

  const url = integration.mcpServers.memflow.url ?? getChatgptMcpUrl();
  const iconPath = join(dirname(chatgptDraftPath), MEMFLOW_BRAND_ICON);
  const fullLogoPath = join(dirname(chatgptDraftPath), MEMFLOW_BRAND_FULL_LOGO);
  ensureBrandAsset(MEMFLOW_BRAND_ICON, iconPath);
  ensureBrandAsset(MEMFLOW_BRAND_FULL_LOGO, fullLogoPath);
  targets.push(iconPath, fullLogoPath);

  mcpServers.memflow = {
    headers: {
      "X-MemFlow-Host": "chatgpt",
    },
    icon: iconPath,
    type: "httpStream",
    url,
  };
  config.branding = {
    fullLogo: fullLogoPath,
    icon: iconPath,
  };
  config.instructions = integration.instructions;
  config.mcpServers = mcpServers;
  config.reviewTargets = integration.reviewTargets;
  writeFileSync(chatgptDraftPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  actions.push(`Installed MemFlow ChatGPT connector draft into ${chatgptDraftPath}.`);

  if (url) {
    notes.push("ChatGPT connector draft was generated with a remote MCP URL.");
  } else {
    notes.push(
      "ChatGPT connector draft was generated without a remote URL. Set MEMFLOW_CHATGPT_MCP_URL or MEMFLOW_PUBLIC_MCP_URL before importing it."
    );
  }

  notes.push(
    "Use the CPU icon for the server icon and the full CPUcoin logo for any full-brand surface in ChatGPT or OpenAI desktop."
  );

  return {
    actions,
    applied: Boolean(url),
    mode: url ? "automatic" : "generated-only",
    notes,
    targets,
  };
}

function installAntigravityConfig(
  integration: MemFlowHostIntegration,
  antigravityConfigPath: string
): {
  actions: string[];
  applied: boolean;
  mode: HostInstallationResult["mode"];
  notes: string[];
  targets: string[];
} {
  const actions: string[] = [];
  const notes: string[] = [];
  const targets = [antigravityConfigPath];
  mkdirSync(dirname(antigravityConfigPath), { recursive: true });

  const current = existsSync(antigravityConfigPath)
    ? safeParseJson(readFileSync(antigravityConfigPath, "utf8"))
    : {};
  const config: Record<string, unknown> =
    typeof current === "object" && current ? { ...current } : {};
  const mcpServers =
    typeof config.mcpServers === "object" && config.mcpServers
      ? { ...(config.mcpServers as Record<string, unknown>) }
      : {};
  const existing = mcpServers.memflow;
  if (existing && !isManagedAntigravityServer(existing)) {
    notes.push(
      `Skipped automatic Antigravity MCP install because ${antigravityConfigPath} already defines a non-MemFlow \`memflow\` server entry.`
    );
    return {
      actions,
      applied: false,
      mode: "generated-only",
      notes,
      targets,
    };
  }

  mcpServers.memflow = {
    command: integration.mcpServers.memflow.command ?? "",
    args: integration.mcpServers.memflow.args ?? [],
    env: {},
  };
  config.mcpServers = mcpServers;
  writeFileSync(antigravityConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  actions.push(`Installed MemFlow MCP into ${antigravityConfigPath}.`);
  notes.push(
    "Antigravity MCP config was installed automatically. Lifecycle hooks remain generated-only until a stable hook surface is confirmed."
  );

  const rulesPath = getAntigravityRulesPath(process.cwd());
  const rulesResult = installAntigravityRules(rulesPath);
  actions.push(...rulesResult.actions);
  notes.push(...rulesResult.notes);
  targets.push(rulesPath);
  return {
    actions,
    applied: true,
    mode: "automatic",
    notes,
    targets,
  };
}

function installAntigravityRules(rulesPath: string): { actions: string[]; applied: boolean; notes: string[] } {
  const actions: string[] = [];
  const notes: string[] = [];
  mkdirSync(dirname(rulesPath), { recursive: true });

  const block = [
    MEMFLOW_ANTIGRAVITY_RULES_START,
    "# MemFlow System Lifecycle Bridge (Stopgap)",
    "",
    "Antigravity currently lacks native lifecycle hooks. You must run MemFlow MCP lifecycle calls yourself on every objective.",
    "",
    "MANDATORY:",
    "1. As your first action on any new objective, immediately call `mcp_memflow_memory_agent_prepare`.",
    "2. As your final action when wrapping an objective or summary, call `mcp_memflow_memory_agent_finalize`.",
    "3. If a fix took multiple attempts, capture it with `mcp_memflow_memory_pattern_promote` so the failure and safe fix are reusable.",
    "",
    "These calls compact long sessions, checkpoint state, and keep prompt cache entries updated.",
    MEMFLOW_ANTIGRAVITY_RULES_END,
    "",
  ].join("\n");

  const current = existsSync(rulesPath) ? readFileSync(rulesPath, "utf8") : "";
  const next = replaceManagedBlock(current, MEMFLOW_ANTIGRAVITY_RULES_START, MEMFLOW_ANTIGRAVITY_RULES_END, `${block}\n`);
  writeFileSync(rulesPath, next.trimEnd() + "\n", "utf8");

  const changed = next !== current;
  actions.push(`Installed MemFlow Antigravity system rules into ${rulesPath}.`);
  if (!changed) {
    notes.push("Existing MemFlow Antigravity rule block was left unchanged.");
  }

  notes.push(
    "This stopgap relies on the Antigravity agent following the system rule; it can still forget if the context window truncates."
  );

  return { actions, applied: changed, notes };
}

function safeParseJson(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function upsertClaudeHook(
  current: Array<Record<string, unknown>>,
  nextHook: Record<string, unknown>
): Array<Record<string, unknown>> {
  const normalized = current.filter((entry) => !isMemFlowClaudeHook(entry));
  normalized.push(nextHook);
  return normalized;
}

function isMemFlowClaudeHook(entry: Record<string, unknown>): boolean {
  const hooks = Array.isArray(entry.hooks) ? entry.hooks : [];
  return hooks.some((hook) => {
    if (!hook || typeof hook !== "object") {
      return false;
    }
    const command = typeof hook.command === "string" ? hook.command : "";
    return command.includes("host:bridge --host claude-code");
  });
}

function getClaudeProjectSettingsPath(workspace: string): string {
  return join(workspace, ".claude", "settings.json");
}

function getClaudeProjectMcpPath(workspace: string): string {
  return join(workspace, ".mcp.json");
}

function isManagedClaudeProjectServer(entry: unknown, integration: MemFlowHostIntegration): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const candidate = entry as Record<string, unknown>;
  const command = typeof candidate.command === "string" ? candidate.command : "";
  const args = Array.isArray(candidate.args)
    ? candidate.args.filter((value): value is string => typeof value === "string")
    : [];

  return command === integration.mcpServers.memflow.command && arraysEqual(args, integration.mcpServers.memflow.args ?? []);
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function isManagedAntigravityServer(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const candidate = entry as Record<string, unknown>;
  const command = typeof candidate.command === "string" ? candidate.command : "";
  const args = Array.isArray(candidate.args)
    ? candidate.args.filter((value): value is string => typeof value === "string")
    : [];

  return Boolean(command) && args.some((value) => value.includes("dist/mcp/server.js"));
}

function isManagedVscodeServer(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const candidate = entry as Record<string, unknown>;
  const command = typeof candidate.command === "string" ? candidate.command : "";
  const args = Array.isArray(candidate.args)
    ? candidate.args.filter((value): value is string => typeof value === "string")
    : [];

  return Boolean(command) && args.some((value) => value.includes("dist/mcp/server.js"));
}

function isManagedChatgptServer(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  const candidate = entry as Record<string, unknown>;
  const type = typeof candidate.type === "string" ? candidate.type : "";
  const url = typeof candidate.url === "string" ? candidate.url : "";

  return type === "httpStream" && Boolean(url);
}

function ensureBrandAsset(sourceName: string, destinationPath: string): void {
  const sourcePath = getBrandAssetPath(sourceName);
  if (!existsSync(sourcePath)) {
    return;
  }

  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
}

function getBrandAssetPath(assetName: string): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../assets/branding", assetName);
}

function quote(value: string): string {
  return `"${value}"`;
}

function replaceManagedBlock(
  current: string,
  startMarker: string,
  endMarker: string,
  block: string
): string {
  if (current.includes(startMarker) && current.includes(endMarker)) {
    const pattern = new RegExp(`${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n?`, "m");
    return current.replace(pattern, block);
  }

  const trimmed = current.trimEnd();
  if (!trimmed) {
    return block;
  }

  return `${trimmed}\n\n${block}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
