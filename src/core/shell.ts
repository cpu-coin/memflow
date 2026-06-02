import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ShellPromptInstallResult {
  activationCommand?: string;
  installed: boolean;
  rcPath?: string;
  requiresRestart: boolean;
  shell: "bash" | "unsupported" | "zsh";
}

const BLOCK_START = "# >>> memflow shell indicator >>>";
const BLOCK_END = "# <<< memflow shell indicator <<<";

export function installShellPromptHook(shellPath: string = process.env.SHELL ?? ""): ShellPromptInstallResult {
  const shell = detectShell(shellPath);
  if (shell === "unsupported") {
    return {
      installed: false,
      requiresRestart: false,
      shell,
    };
  }

  const rcPath = shell === "zsh" ? join(homedir(), ".zshrc") : join(homedir(), ".bashrc");
  writeShellCommandShims();
  const block = buildShellPromptBlock(shell);
  const existing = existsSync(rcPath) ? readFileSync(rcPath, "utf8") : "";
  const next = replaceManagedBlock(existing, block);

  if (next !== existing) {
    writeFileSync(rcPath, next, "utf8");
  }

  return {
    activationCommand: buildShellActivationCommand(shell, rcPath),
    installed: true,
    rcPath,
    requiresRestart: true,
    shell,
  };
}

export function buildShellPromptBlock(shell: "bash" | "zsh"): string {
  const cliPath = resolveCliPath();
  const shellBinPath = resolveShellBinPath();
  const mcpPath = resolve(dirname(cliPath), "mcp", "server.js");
  const nodePath = process.execPath;

  if (shell === "zsh") {
    return [
      BLOCK_START,
      "export MEMFLOW_SHELL_HOOK=1",
      "RPROMPT=\"\"                          # clear any legacy MemFlow RPROMPT",
      "unset MEMFLOW_ORIG_RPROMPT 2>/dev/null",
      `export PATH="${shellBinPath}:$PATH"`,
      "memflow() {",
      `  "${nodePath}" "${cliPath}" "$@"`,
      "}",
      "memflow-mcp() {",
      `  "${nodePath}" "${mcpPath}" "$@"`,
      "}",
      // Print status as a standalone line above the prompt — never touches $PROMPT
      // so it works with any theme (Oh My Zsh, Starship, Powerlevel10k, etc.)
      "memflow_precmd() {",
      `  local _mf_status="$("${nodePath}" "${cliPath}" status:line 2>/dev/null)"`,
      '  [[ -n "$_mf_status" ]] && print -P "%F{246}${_mf_status}%f"',
      "}",
      "autoload -Uz add-zsh-hook",
      "add-zsh-hook precmd memflow_precmd",
      BLOCK_END,
      "",
    ].join("\n");
  }

  return [
    BLOCK_START,
    "export MEMFLOW_SHELL_HOOK=1",
    `export PATH="${shellBinPath}:$PATH"`,
    "memflow() {",
    `  "${nodePath}" "${cliPath}" "$@"`,
    "}",
    "memflow-mcp() {",
    `  "${nodePath}" "${mcpPath}" "$@"`,
    "}",
    // Print status as a standalone line above the prompt — never touches $PS1
    'MEMFLOW_ORIG_PROMPT_COMMAND="${MEMFLOW_ORIG_PROMPT_COMMAND:-$PROMPT_COMMAND}"',
    "memflow_prompt_command() {",
    '  if [ -n "$MEMFLOW_ORIG_PROMPT_COMMAND" ]; then eval "$MEMFLOW_ORIG_PROMPT_COMMAND"; fi',
    `  local _mf_status="$("${nodePath}" "${cliPath}" status:line 2>/dev/null)"`,
    '  [ -n "$_mf_status" ] && printf "\\033[2m%s\\033[0m\\n" "$_mf_status"',
    "}",
    "PROMPT_COMMAND=memflow_prompt_command",
    BLOCK_END,
    "",
  ].join("\n");
}

export function buildShellActivationCommand(
  shell: "bash" | "zsh",
  rcPath: string
): string {
  return shell === "zsh" ? `source "${rcPath}"` : `source "${rcPath}"`;
}

export function getShellPromptStatus(shellPath: string = process.env.SHELL ?? ""): {
  activationCommand?: string;
  commandPath?: string;
  currentShellLoaded: boolean;
  installed: boolean;
  rcPath?: string;
  shell: "bash" | "unsupported" | "zsh";
} {
  const shell = detectShell(shellPath);
  if (shell === "unsupported") {
    return {
      commandPath: undefined,
      currentShellLoaded: false,
      installed: false,
      shell,
    };
  }

  const rcPath = shell === "zsh" ? join(homedir(), ".zshrc") : join(homedir(), ".bashrc");
  const installed =
    existsSync(rcPath) &&
    readFileSync(rcPath, "utf8").includes(BLOCK_START) &&
    readFileSync(rcPath, "utf8").includes(BLOCK_END);

  return {
    activationCommand: buildShellActivationCommand(shell, rcPath),
    commandPath: resolveShellCommandPath("memflow"),
    currentShellLoaded: process.env.MEMFLOW_SHELL_HOOK === "1",
    installed,
    rcPath,
    shell,
  };
}

export function replaceManagedBlock(existing: string, block: string): string {
  const trimmedExisting = existing.trimEnd();
  const normalized = trimmedExisting ? `${trimmedExisting}\n` : "";
  const pattern = new RegExp(
    `${escapeRegex(BLOCK_START)}[\\s\\S]*?${escapeRegex(BLOCK_END)}\\n?`,
    "g"
  );

  if (pattern.test(normalized)) {
    return normalized.replace(pattern, block);
  }

  return `${normalized}${normalized ? "\n" : ""}${block}`;
}

function detectShell(shellPath: string): "bash" | "unsupported" | "zsh" {
  const name = basename(shellPath);
  if (name.includes("zsh")) {
    return "zsh";
  }
  if (name.includes("bash")) {
    return "bash";
  }
  return "unsupported";
}

function resolveCliPath(): string {
  const current = fileURLToPath(import.meta.url);
  return resolve(dirname(dirname(dirname(current))), "dist", "cli.js");
}

function resolveShellBinPath(): string {
  return join(homedir(), ".memflow", "bin");
}

function resolveShellCommandPath(command: "memflow" | "memflow-mcp"): string {
  return join(resolveShellBinPath(), command);
}

function writeShellCommandShims(): void {
  const binPath = resolveShellBinPath();
  const cliPath = resolveCliPath();
  const mcpPath = resolve(dirname(cliPath), "mcp", "server.js");
  mkdirSync(binPath, { recursive: true });
  writeShellCommandShim(resolveShellCommandPath("memflow"), cliPath);
  writeShellCommandShim(resolveShellCommandPath("memflow-mcp"), mcpPath);
}

function writeShellCommandShim(targetPath: string, scriptPath: string): void {
  const content = `#!/bin/sh\n"${process.execPath}" "${scriptPath}" "$@"\n`;
  writeFileSync(targetPath, content, "utf8");
  chmodSync(targetPath, 0o755);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
