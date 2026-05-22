#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { findTrackedProjectForPath, getProfileConfigPath, getProfileName, mergeTrackedProjects, readMemFlowConfig, writeMemFlowConfig, setTrackedProjectEnabled, discoverProjects, hasCompletedGuidedSetup } from "./core/config.js";
import { installHostIntegration, formatHostReloadInstruction, validateHostIntegration, } from "./core/integrations.js";
import { formatGuidedInstallSummary, runGuidedInstall } from "./core/installer.js";
import { getShellPromptStatus } from "./core/shell.js";
import { runRuntimePreflight } from "./core/startup.js";
import { createConnectorFromEnvironment, startServer } from "./mcp/server.js";
import { MemoryService } from "./core/memory-service.js";
import { importLegacyRufloSetup } from "./migrations/memflow.js";
import { formatVersion, getVersionInfo } from "./version.js";
import { SecuritySweepEngine } from "./core/security-sweep.js";
import { runDocsVerify, installPreCommitHook } from "./core/docs-autofill.js";

import { buildHostBootstrap } from "./core/host.js";
import { buildWorkflowWriteInput } from "./core/workflow-ingestion.js";
import { collectDependencySnapshot, dependencyWarningsForEntry } from "./core/dependencies.js";
import { startDashboard, killPortOwner } from "./core/dashboard.js";

type MemoryScope = any;
const DEFAULT_PROMPT_TIMEOUT_MS = 800;
async function withTimeout(promise: any, ms: number, fallback: any) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(fallback), ms));
    return Promise.race([promise, timeout]);
}
function printHelp() {
    process.stdout.write([
        "MemFlow CLI",
        "",
        "Commands:",
        "  version           Show MemFlow version information",
        "  mcp               Start the MemFlow MCP server",
        "  init              Run guided setup or seed defaults non-interactively",
        "  status            Return machine-readable MemFlow runtime status",
        "  start             Enable global MemFlow automation",
        "  stop              Disable global MemFlow automation (pause tracking and caching)",
        "  restart           Refresh MemFlow: enable automation and verify connector health",
        "  status:line       Return a compact one-line shell indicator",
        "  status:claude-code  Compact key=value status for the Claude Code status bar",
        "  env:check         Verify Node and better-sqlite3 readiness before using MemFlow",
        "  metrics           Show recent MemFlow operational metrics",
        "  savings           Estimate token and time savings from cache and compaction reuse",
        "  recall            Search stored memories for relevant prior context",
        "  checkpoint        Store a structured session checkpoint",
        "  resume            Load the latest matching session checkpoint",
        "  recover           Alias for resume",
        "  reload:prepare    Save current state before restarting a shell or host client",
        "  reload:resume     Resume the last saved reload handoff",
        "  activate          Continue the saved post-install activation and reload checklist",
        "  quickstart        One-shot setup for the current repo: env check, track, enable automation, regenerate host configs",
        "  ci:env            Print PATH/node/shim guidance for CI or non-interactive shells",
        "  compact           Compact a session into checkpoint + cache state",
        "  agent:prepare     Load automatic memory context for an agent turn",
        "  agent:finalize    Persist automatic memory state after an agent turn",
        "  embeddings:backfill  Generate local embeddings for existing records",
        "  cache:store       Store a prompt cache entry",
        "  cache:get         Resolve a prompt cache entry",
        "  cache:auto:get    Resolve prompt cache automatically from prompt text",
        "  cache:auto:store  Store prompt cache automatically from prompt text",
        "  cache:invalidate  Invalidate prompt cache entries by scope or version",
        "  promote:pattern   Promote a verified fix into shared pattern memory",
        "  doctor            Show local MemFlow config, storage, and tracking state",
        "  projects:list     List tracked projects from local config",
        "  projects:add      Add one or more projects to local tracking",
        "  projects:toggle   Enable or disable a tracked project",
        "  projects:rescan   Discover git repos under the saved projects root",
        "  shell:status      Show whether the MemFlow shell indicator is installed and loaded",
        "  memory_status    Show connector health and recent activity (same shape as MCP tool)",
        "  validate         Check current workspace dependency drift against stored memory tags",
        "  host:bootstrap    Print the host integration bootstrap contract",
        "  connect:codex     Generate and install Codex integration when supported",
        "  connect:openai    Alias for connect:codex (OpenAI Codex / IDE path)",
        "  connect:chatgpt   Generate ChatGPT / OpenAI desktop connector draft",
        "  connect:openai-desktop  Alias for connect:chatgpt",
        "  connect:claude-code  Generate and install Claude Code integration when supported",
        "  connect:claude    Alias for connect:claude-code",
        "  connect:antigravity  Generate Antigravity integration artifacts",
        "  connect:vscode     Generate and install VS Code integration when supported",
        "  connect:auto        Install + validate all supported hosts (codex, chatgpt, claude-code, antigravity, vscode)",
        "  dashboard         Start a lightweight local MemFlow dashboard (default :3000)",
        "  validate:host     Validate generated host integration artifacts",
        "  host:bridge       Translate host hook JSON into MemFlow lifecycle calls",
        "  mcp --transport httpStream --port <n>  Start a remote MCP endpoint for ChatGPT/OpenAI desktop",
        "  sync:plan         Show local/shared routing for matching entries",
        "  sync:export       Export entries routed to a sync target",
        "  ingest:workflows  Ingest markdown workflow runbooks into workflow memory",
        "  migrate:ruflo     Detect and import a prior local RuFlo setup",
        "  join               Upgrade to a shared MongoDB instance (accepts URI or invite token)",
        "  invite             Generate a shareable invite link/token for team onboarding",
        "  security:audit        Scan all stored database entries for sensitive data",
        "  docs:verify           Scan staged files and verify/autofill missing documentation blocks",
        "  hook:install          Install MemFlow's pre-commit auto-documentation hook in the repository",
        "  security:sweep        Show current security sweep settings",
        "  security:sweep:enable    Enable the security sweep",
        "  security:sweep:disable   Disable the security sweep",
        "  security:sweep:level     Set enforcement level: warn | redact | block  (--level <value>)",
        "  security:sweep:rules     Toggle detection rules: --private-keys, --api-keys, --db-uris, --pii  (on|off)",
        "  security:sweep:trusted  List current exempt namespaces from security sweeps",
        "  security:sweep:trusted:add --namespace <ns>  Exempt a namespace from security sweeps",
        "  security:sweep:trusted:remove --namespace <ns>  Remove a namespace from exemption",
        "",
        "Flags:",
        "  -v, --version     Show version",
        "  -h, --help        Show help",
        "  --config <path>   Override the MemFlow config path",
        "  --json            Output raw JSON instead of human-readable summaries",
        "  --detailed        Show detailed assumptions for savings calculations",
        "  --supplier <name> Specify LLM provider (e.g. 'claude') for prompt caching",
        "  --days <number>   Limit metrics/savings to the last N days",
        "  --path <path>     Override the legacy RuFlo project path for migration",
        "  --uri <uri>       MongoDB connection URI for join command",
        "  --migrate         Migrate existing SQLite data to MongoDB during join (merge, keeps newer)",
        "  --force-import    Override: replace existing entries during migration instead of merging",
        "  --token <token>   Base64 invite token (alternative to --uri for join)",
        "  --stdin           Read structured JSON input from stdin",
        "",
        "Usage:",
        "  memflow <command> [flags]",
        "  node dist/cli.js <command> [flags]   # local development fallback",
        "",
        "Examples:",
        "  memflow init",
        "  memflow start",
        "  memflow stop",
        "  memflow restart",
        "  memflow agent:prepare --supplier claude",
        "  memflow status",
        "  memflow savings --detailed",
        "  memflow status:line",
        "  memflow env:check",
        "  memflow reload:prepare --sessionId active --goal \"Finish auth fix\" --summary \"About to restart terminal\"",
        "  memflow reload:resume --sessionId active",
        "  memflow activate",
        "  memflow metrics --days 7",
        "  memflow savings --project memflow --repo memflow",
        "  memflow recall --text \"stale auth cache\" --project memflow --repo memflow",
        "  memflow doctor",
        "  memflow host:bootstrap",
        "  memflow connect:codex",
        "  memflow connect:openai",
        "  memflow connect:chatgpt",
        "  memflow connect:openai-desktop",
        "  memflow connect:claude-code",
        "  memflow connect:claude",
        "  memflow connect:antigravity",
        "  memflow connect:vscode",
        "  memflow mcp --transport httpStream --port 8080",
        "  memflow validate:host --host codex",
        "  memflow projects:list",
        "  memflow shell:status",
        "  memflow checkpoint --sessionId active --goal \"Fix auth flow\" --summary \"Tracing login failure\" --nextStep \"Patch handler\"",
        "  memflow resume --sessionId active",
        "  memflow agent:prepare --sessionId active --goal \"Fix auth flow\" --prompt \"Generate an auth patch\"",
        "  memflow agent:finalize --sessionId active --goal \"Fix auth flow\" --summary \"Patched auth handler\" --prompt \"Generate an auth patch\" --output \"Use the session-aware auth handler template.\"",
        "  memflow cache:store --key auth-handler-v1 --content \"Use the session-aware auth handler template.\"",
        "  memflow cache:get --key auth-handler-v1",
        "  memflow cache:auto:get --task auth-handler --prompt \"Generate a session-aware auth handler for Express\"",
        "  memflow cache:auto:store --task auth-handler --prompt \"Generate a session-aware auth handler for Express\" --content \"Use the session-aware auth handler template.\"",
        "  memflow promote:pattern --title \"Avoid stale auth cache\" --failure \"Old cache reused after schema change\" --rootCause \"Cache key ignored schema version\" --safeFix \"Invalidate cache on schema change\"",
        "  memflow migrate:ruflo --path /path/to/old/project",
        "  memflow join --uri 'mongodb://user:pass@host:27017/memflow_default'",
        "  memflow join --token <base64-token> --migrate",
        "  memflow invite",
        "",
        "Structured input:",
        "  memflow checkpoint --json '{\"sessionId\":\"active\",\"goal\":\"Fix auth flow\"}'",
        "  echo '{\"sessionId\":\"active\",\"goal\":\"Fix auth flow\"}' | memflow checkpoint --stdin",
        "",
    ].join("\n"));
}
function parseFlags(argv: string[]) {
    const flags: Record<string, any> = {};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            continue;
        }
        const key = token.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith("--")) {
            flags[key] = true;
            continue;
        }
        flags[key] = next;
        index += 1;
    }
    return flags;
}
function readStructuredInput(flags: Record<string, any>) {
    if (typeof flags.json === "string") {
        return JSON.parse(flags.json);
    }
    if (flags.stdin === true) {
        const payload = readFileSync(0, "utf8").trim();
        return payload ? JSON.parse(payload) : {};
    }
    return {};
}
function asString(source: any, key: any, fallback?: any) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    return fallback;
}
function asList(source: any, key: any) {
    const value = source[key];
    if (Array.isArray(value)) {
        return value
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean);
    }
    if (typeof value === "string") {
        return value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return undefined;
}
function asBoolean(source: any, key: any) {
    const value = source[key];
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        if (value === "true") {
            return true;
        }
        if (value === "false") {
            return false;
        }
    }
    return undefined;
}
function resolveCoordinates(source: any, namespace: any, fallbackScope = "workspace") {
    const cwd = resolve(process.cwd());
    const repo = asString(source, "repo", basename(cwd));
    const project = asString(source, "project", repo);
    const scope = (asString(source, "scope", fallbackScope) ?? fallbackScope);
    return {
        namespace,
        project,
        repo,
        scope,
        tenant: asString(source, "tenant"),
        user: asString(source, "user", process.env.USER),
        workspace: asString(source, "workspace", cwd),
    };
}
function printJson(value: any) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// ─── Human-readable CLI formatters ───────────────────────────────

function printHuman(value: any, formatter: (v: any) => string, useJson?: boolean) {
  if (useJson) {
    printJson(value);
  } else {
    process.stdout.write(formatter(value));
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function badge(ok: boolean): string {
  return ok ? "✅" : "❌";
}

function formatConnectorHealth(health: any): string {
  const d = health.details ?? {};
  const lines = [
    `${badge(health.ok)} Connector: ${health.kind ?? health.name}`,
    ...(d.database ? [`  Database:   ${d.database}`] : []),
    ...(d.collection ? [`  Collection: ${d.collection}`] : []),
    ...(d.entries !== undefined ? [`  Entries:    ${d.entries}`] : []),
    ...(d.pingMs !== undefined ? [`  Ping:       ${d.pingMs}ms`] : []),
    ...(d.uri ? [`  URI:        ${d.uri}`] : []),
  ];
  if (d.error) {
    lines.push(`  Error:      ${d.error}`);
  }
  return lines.join("\n");
}

function formatRestart(data: any): string {
  return [
    "",
    `${badge(data.ok)} ${data.message}`,
    "",
    formatConnectorHealth(data.connector),
    "",
    `  Automation: ${data.automation?.enabled ? "enabled" : "disabled"}`,
    "",
  ].join("\n");
}

function formatStartStop(data: any): string {
  return `${badge(data.ok)} ${data.message}\n`;
}

function formatStatus(status: any): string {
  const lines = [
    "",
    `${badge(status.on)} MemFlow ${status.on ? "Online" : "Offline"}`,
    "",
    formatConnectorHealth(status.connector),
    "",
    `  Automation: ${status.automation?.enabled ? "enabled" : "disabled"}${status.automation?.activeRecent ? " (active)" : ""}`,
    `  Hosts:      ${status.integration?.hosts?.length ? status.integration.hosts.join(", ") : "none configured"}`,
    `  Mode:       ${status.shared?.configured ? "Shared (MongoDB)" : "Local (SQLite)"}`,
    "",
    `  Tracked Projects: ${status.tracking?.total ?? 0} total, ${status.tracking?.enabled ?? 0} enabled`,
  ];
  if (status.tracking?.currentProject) {
    const p = status.tracking.currentProject;
    lines.push(`  Current:     ${p.name} (${p.enabled ? "on" : "off"})`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatDoctor(data: any): string {
  const health = data.connector ?? {};
  const stats = data.stats ?? {};
  const auto = data.automation ?? {};
  const tp = data.trackedProjects ?? {};
  const ss = data.config?.securitySweep ?? { enabled: false, level: "warn" };
  const lines = [
    "",
    "MemFlow Doctor",
    "══════════════════════════════════════",
    "",
    formatConnectorHealth(health),
    "",
    `  Storage:       ${stats.entries ?? 0} entries, ${stats.namespaces ?? 0} namespaces, ${stats.projects ?? 0} projects`,
    `  Stale entries: ${stats.staleEntries ?? 0}`,
    "",
    `  Automation:    ${auto.enabled ? "enabled" : "disabled"}`,
    `    Auto-compact:      ${auto.autoCompact ? "yes" : "no"}`,
    `    Auto-finalize:     ${auto.autoFinalize ? "yes" : "no"}`,
    `    Auto-prepare:      ${auto.autoPrepare ? "yes" : "no"}`,
    `    Auto-prompt-cache: ${auto.autoPromptCache ? "yes" : "no"}`,
    `    Metrics:           ${auto.metrics ? "yes" : "no"}`,
    "",
    `  Projects: ${tp.total ?? 0} tracked (${tp.enabled ?? 0} enabled, ${tp.disabled ?? 0} disabled)`,
    "",
    `  Security Sweep: ${ss.enabled ? "enabled" : "disabled"}`,
    `    Level:             ${ss.level ?? "warn"}`,
    `    Rules:             private keys (${ss.rules?.privateKeys !== false ? "on" : "off"}), api keys (${ss.rules?.apiKeys !== false ? "on" : "off"}), db URIs (${ss.rules?.databaseUris !== false ? "on" : "off"}), PII (${ss.rules?.pii === true ? "on" : "off"})`,
    "",
  ];
  return lines.join("\n");
}

function formatMemoryStatus(data: any): string {
  const health = data.health ?? {};
  const totals = data.totals ?? {};
  const recent = data.recentActivity ?? [];
  const lines = [
    "",
    formatConnectorHealth(health),
    "",
  ];
  const totalKeys = Object.keys(totals).filter((k) => totals[k] > 0);
  if (totalKeys.length > 0) {
    lines.push("  Recent Totals:");
    for (const key of totalKeys.sort()) {
      lines.push(`    ${key.replace(/_/g, " ")}: ${totals[key]}`);
    }
    lines.push("");
  }
  if (recent.length > 0) {
    lines.push(`  Last ${Math.min(recent.length, 5)} events:`);
    for (const event of recent.slice(0, 5)) {
      const ts = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : "?";
      lines.push(`    ${ts}  ${event.metric}${event.delta ? ` (${event.delta})` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatMetrics(data: any): string {
  const totals = data.totals ?? {};
  const recent = data.recent ?? [];
  const lines = [
    "",
    "MemFlow Metrics",
    "══════════════════════════════════════",
    "",
  ];
  const totalKeys = Object.keys(totals).filter((k) => totals[k] > 0);
  if (totalKeys.length > 0) {
    lines.push("  Event Totals:");
    const maxLen = Math.max(...totalKeys.map((k) => k.length));
    for (const key of totalKeys.sort()) {
      lines.push(`    ${key.replace(/_/g, " ").padEnd(maxLen + 2)} ${totals[key]}`);
    }
    lines.push("");
  } else {
    lines.push("  No metrics recorded yet.");
    lines.push("");
  }
  if (recent.length > 0) {
    lines.push(`  Recent Events (last ${recent.length}):`);
    for (const event of recent.slice(0, 10)) {
      const ts = event.timestamp ? new Date(event.timestamp).toLocaleString() : "?";
      const project = event.project ? ` [${event.project}]` : "";
      lines.push(`    ${ts}  ${event.metric}${event.delta ? ` ×${event.delta}` : ""}${project}`);
    }
    if (recent.length > 10) {
      lines.push(`    ... and ${recent.length - 10} more`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function formatSavingsDetailed(est: any): string {
  const lines = [
    "",
    "MemFlow Savings & ROI",
    "══════════════════════════════════════",
    "",
    "  Time Savings Breakdown:",
    `    Cache hits:       ${formatMs(est.timeMs.cacheHitSaved)} (${est.observed.cacheHits} hits)`,
    `    Compaction:       ${formatMs(est.timeMs.compactionSaved)} (${est.observed.compactedResumeHits} hits)`,
    `    Session resume:   ${formatMs(est.timeMs.sessionResumeSaved ?? 0)} (${est.observed.sessionResumeHits ?? 0} hits)`,
    `    Pattern recall:   ${formatMs(est.timeMs.patternRecallSaved ?? 0)} (${est.observed.patternRecalls ?? 0} recalls)`,
    `    Profile load:     ${formatMs(est.timeMs.profileLoadSaved ?? 0)} (${est.observed.profileLoads ?? 0} loads)`,
    `    Workflow recall:  ${formatMs(est.timeMs.workflowRecallSaved ?? 0)} (${est.observed.workflowRecalls ?? 0} recalls)`,
    `    Initial overhead: -${formatMs(est.timeMs.initialExtra)}`,
    `    ────────────────────────────`,
    `    Net time saved:   ${formatMs(est.timeMs.net)}`,
    "",
    "  Token Savings:",
    `    Cache hit saved:     ${est.tokens.cacheHitSaved}`,
    `    Compaction saved:    ${est.tokens.compactionSaved}`,
    `    Initial overhead:   -${est.tokens.initialExtra}`,
    `    Net tokens saved:    ${est.tokens.net}`,
    "",
    "  Assumptions:",
    `    Model round-trip:    ${est.assumptions.modelRoundTripMs}ms`,
    `    Cache lookup:        ${est.assumptions.cacheLookupMs}ms`,
    `    Session resume:      ${est.assumptions.sessionResumeMs ?? "n/a"}ms`,
    `    Pattern recall:      ${est.assumptions.patternRecallMs ?? "n/a"}ms`,
    "",
  ];
  if (est.projected?.additionalCollaboratorNetTimeMs > 0) {
    lines.push(`  Projected per-collaborator: ${formatMs(est.projected.additionalCollaboratorNetTimeMs)} saved, ${est.projected.additionalCollaboratorNetTokens} tokens`);
    lines.push("");
  }
  return lines.join("\n");
}

function formatPreflight(data: any): string {
  if (data.ok) {
    return `${badge(true)} Environment check passed.\n`;
  }
  const lines = [
    `${badge(false)} Environment check failed:`,
  ];
  if (data.errors) {
    for (const err of data.errors) {
      lines.push(`  • ${err}`);
    }
  }
  if (data.suggestions) {
    lines.push("");
    for (const sug of data.suggestions) {
      lines.push(`  💡 ${sug}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function formatValidate(data: any): string {
  if (data.ok) {
    return `${badge(true)} No dependency drift detected across ${data.entryCount} entries.\n`;
  }
  const lines = [
    `${badge(false)} ${data.warnings?.length ?? 0} dependency warnings found:`,
    "",
  ];
  for (const w of (data.warnings ?? []).slice(0, 15)) {
    lines.push(`  ⚠ ${w.entryKey}: ${w.message ?? w.warning ?? JSON.stringify(w)}`);
  }
  if ((data.warnings?.length ?? 0) > 15) {
    lines.push(`  ... and ${data.warnings.length - 15} more`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderHostInstall(result: any): string {
  const status = result.applied ? "Installation successful." : "Installation skipped.";
  const mode = result.mode ? ` Mode: ${result.mode}.` : "";
  const connectionState =
    result.applied && result.validation?.ok
      ? `\nMemFlow is on and connected for ${result.host === "chatgpt" ? "ChatGPT / OpenAI desktop" : "this host configuration"}.`
      : result.host === "chatgpt"
        ? "\nMemFlow generated a ChatGPT connector draft, but you still need to import the remote MCP URL into ChatGPT Developer mode."
        : "\nMemFlow is installed, but you may need to reload the IDE or shell before it is live.";
  const actions = Array.isArray(result.actions) && result.actions.length > 0
    ? `\nActions:\n- ${result.actions.join("\n- ")}`
    : "";
  const notes = Array.isArray(result.notes) && result.notes.length > 0
    ? `\nNotes:\n- ${result.notes.join("\n- ")}`
    : "";
  const targets = Array.isArray(result.targets) && result.targets.length > 0
    ? `\nTargets:\n- ${result.targets.join("\n- ")}`
    : "";
  return `${status}${mode}${connectionState}${actions}${notes}${targets}\n`;
}

function renderInitResult(result: any, input: Record<string, any>): string {
  const personaCount = Array.isArray(result.entries)
    ? result.entries.filter((entry: any) => entry.kind === "persona").length
    : 0;
  const workflowCount = Array.isArray(result.entries) ? result.entries.length - personaCount : 0;
  const policy = result.syncPolicy ?? {};
  const lines = [
    "Initialization successful.",
    `Seeded entries: ${Array.isArray(result.entries) ? result.entries.length : 0} (personas: ${personaCount}, workflows: ${workflowCount}).`,
    `Sync policy: ${policy.name ?? "memflow-default"} (defaultTarget: ${policy.defaultTarget ?? "shared"}).`,
  ];

  const coords = [
    input.project ? `project=${input.project}` : undefined,
    input.repo ? `repo=${input.repo}` : undefined,
    input.workspace ? `workspace=${input.workspace}` : undefined,
    input.user ? `user=${input.user}` : undefined,
    input.tenant ? `tenant=${input.tenant}` : undefined,
  ].filter(Boolean);
  if (coords.length > 0) {
    lines.push(`Scope: ${coords.join(", ")}.`);
  }

  lines.push("Next: MemFlow will continue into quickstart automatically in an interactive shell; if you are scripting setup, run `memflow quickstart` after init to finish repo activation.");

  return `${lines.join("\n\n")}\n`;
}

type QuickstartIntegrationSummary = {
  applied: boolean;
  host: string;
  mode: string;
  connected: boolean;
};

type QuickstartResult = {
  activationSessionId: string;
  automationEnabled: boolean;
  integrations: QuickstartIntegrationSummary[];
  message: string;
  seededEntries: number;
  seededPersonas: number;
  seededWorkflows: number;
  resume: string;
  trackedProject: string;
};

function renderQuickstartResult(result: QuickstartResult): string {
  const connectedHosts = result.integrations.filter((item) => item.connected);
  return [
    "",
    "Quickstart successful.",
    `Tracked project: ${result.trackedProject}`,
    `Seeded defaults: ${result.seededEntries} entries (${result.seededPersonas} personas, ${result.seededWorkflows} workflows).`,
    `Automation: ${result.automationEnabled ? "enabled" : "disabled"} for recovery, recall, prompt cache, compaction, and savings metrics.`,
    `Connection: ${connectedHosts.length > 0 ? `MemFlow is on and connected for ${connectedHosts.map((item) => item.host).join(", ")}. Reload the IDE or shell if the connection is not visible yet.` : "MemFlow is ready, but no host integrations reported a live connection yet."}`,
    `Integrations: ${result.integrations.length > 0 ? result.integrations.map((item) => `${item.host} (${item.mode}${item.applied ? ", applied" : ""}${item.connected ? ", connected" : ""})`).join(", ") : "none"}`,
    `Resume: ${result.resume}`,
    "Next: reload the shell and enabled hosts, then run `memflow activate` if you want the remaining reload handoff steps.",
    "",
  ].join("\n\n");
}

async function runQuickstartWorkflow(
  service: MemoryService,
  configPath: string
): Promise<QuickstartResult> {
  const cwd = resolve(process.cwd());
  const projectName = basename(cwd);
  const config = readMemFlowConfig(configPath);
  const merged = mergeTrackedProjects(config.trackedProjects, [{ path: cwd, enabled: true }]);
  const nextConfig = writeMemFlowConfig(
    {
      ...config,
      trackedProjects: merged,
    },
    configPath
  );

  await service.registerTrackedProject({
    ...(merged.find((p) => resolve(p.path) === cwd) as any),
    source: "system",
    tenant: nextConfig.tenant,
    user: nextConfig.user,
    workspace: nextConfig.workspace ?? cwd,
  } as any);

  const automationConfig = writeMemFlowConfig(
    {
      ...nextConfig,
      automation: {
        autoCompact: true,
        autoFinalize: true,
        autoPrepare: true,
        autoPromptCache: true,
        enabled: true,
        metrics: true,
      },
    },
    configPath
  );
  const seededEntries = await service.initializeDefaults({
    project: projectName,
    repo: projectName,
    tenant: automationConfig.tenant,
    user: automationConfig.user,
    workspace: cwd,
    source: "system",
  });

  const integrations = ["codex", "claude-code", "antigravity", "vscode"].map((host) =>
    installHostIntegration(host as any, configPath)
  );
  const activationSessionId = "post-quickstart-activation";
  await service.compactSession({
    sessionId: activationSessionId,
    coordinates: {
      namespace: "sessions",
      project: projectName,
      repo: projectName,
      scope: "workspace",
      tenant: automationConfig.tenant,
      user: automationConfig.user,
      workspace: cwd,
    },
    goal: "Reload shells/hosts to finish MemFlow quickstart",
    summary: "MemFlow quickstart saved this handoff so you can resume after reloading shells/clients.",
    nextStep: "Reload shell and enabled hosts, then resume this handoff.",
    source: "system",
  });
  writeMemFlowConfig(
    {
      ...automationConfig,
      activation: {
        activationSessionId,
        completedHosts: [],
        pendingHosts: ["codex", "claude-code", "antigravity", "vscode"],
        shellPending: true,
        lastUpdatedAt: new Date().toISOString(),
      },
      enabledHosts: ["codex", "claude-code", "antigravity", "vscode"],
    },
    configPath
  );

  return {
    activationSessionId,
    automationEnabled: automationConfig.automation.enabled,
    integrations: integrations.map((integration) => ({
      applied: integration.applied,
      connected: integration.validation?.ok ?? false,
      host: integration.host,
      mode: integration.mode,
    })),
    message: "Quickstart complete. Reload shell and hosts, then run `memflow activate`.",
    seededEntries: seededEntries.entries.length,
    seededPersonas: seededEntries.entries.filter((entry) => entry.kind === "persona").length,
    seededWorkflows: seededEntries.entries.filter((entry) => entry.kind === "workflow").length,
    resume: `memflow recover --sessionId ${activationSessionId}`,
    trackedProject: cwd,
  };
}

async function runActivationGuide(configPath: string) {
    const preflight = await runRuntimePreflight(configPath);
    if (!preflight.ok) {
        printJson(preflight);
        return 1;
    }
    const config = readMemFlowConfig(configPath);
    const shellStatus = getShellPromptStatus();
    const activation = config.activation ?? {
        activationSessionId: undefined,
        completedHosts: [],
        lastUpdatedAt: new Date().toISOString(),
        pendingHosts: [...(config.enabledHosts ?? [])],
        shellPending: shellStatus.installed && !shellStatus.currentShellLoaded,
    };
    if (shellStatus.currentShellLoaded && activation.shellPending) {
        activation.shellPending = false;
        activation.lastUpdatedAt = new Date().toISOString();
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        const nextConfig = writeMemFlowConfig({
            ...config,
            activation,
        }, configPath);
        printJson({
            activation: nextConfig.activation,
            shell: shellStatus,
            validations: (nextConfig.enabledHosts ?? []).map((host) => validateHostIntegration(host)),
        });
        return 0;
    }
    if (activation.shellPending) {
        writeMemFlowConfig({
            ...config,
            activation,
        }, configPath);
        process.stdout.write([
            "",
            "------------------------------------------------------",
            "MemFlow Activation",
            "",
            "The shell integration is installed but not loaded in this current terminal yet.",
            `Run: ${shellStatus.activationCommand ?? "source your shell rc file"}`,
            "Then run `memflow activate` again from the reloaded terminal to continue the remaining host reload steps.",
            activation.activationSessionId
                ? `Your saved reload handoff is ready to resume later with: memflow recover --sessionId ${activation.activationSessionId}`
                : "No saved reload handoff is currently recorded.",
            "",
        ].join("\n"));
        return 0;
    }
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    try {
        for (const host of [...activation.pendingHosts]) {
            process.stdout.write([
                "",
                "------------------------------------------------------",
                `Reload ${host}`,
                "",
                formatHostReloadInstruction(host),
                "After you have reloaded it and confirmed the MemFlow connection is available, press Enter to mark it complete.",
                "Type `skip` to leave it pending for later.",
                "",
            ].join("\n"));
            const answer = (await rl.question(`[${host}] Press Enter when complete or type skip: `))
                .trim()
                .toLowerCase();
            if (answer === "skip") {
                continue;
            }
            activation.pendingHosts = activation.pendingHosts.filter((candidate) => candidate !== host);
            if (!activation.completedHosts.includes(host)) {
                activation.completedHosts.push(host);
            }
            activation.lastUpdatedAt = new Date().toISOString();
            writeMemFlowConfig({
                ...config,
                activation,
            }, configPath);
        }
    }
    finally {
        rl.close();
    }
    const finalConfig = writeMemFlowConfig({
        ...config,
        activation,
    }, configPath);
    process.stdout.write([
        "",
        "------------------------------------------------------",
        "Activation Status",
        "",
        `Shell loaded: ${shellStatus.currentShellLoaded ? "yes" : "no"}`,
        `Completed hosts: ${finalConfig.activation?.completedHosts.length ? finalConfig.activation.completedHosts.join(", ") : "none"}`,
        `Pending hosts: ${finalConfig.activation?.pendingHosts.length ? finalConfig.activation.pendingHosts.join(", ") : "none"}`,
        finalConfig.activation?.activationSessionId
            ? `Saved reload handoff: memflow recover --sessionId ${finalConfig.activation.activationSessionId}`
            : "Saved reload handoff: none",
        "",
    ].join("\n"));
    return 0;
}
function buildClaudeHookContext(prepared: any) {
    const lines = [];
    if (prepared.cache) {
        lines.push(`Cached result available: ${prepared.cache.title ?? prepared.cache.key}`);
    }
    if (prepared.checkpoint) {
        lines.push(`Recovered prior session state: ${prepared.checkpoint.title ?? prepared.checkpoint.key}`);
    }
    if (prepared.compacted) {
        lines.push(`Loaded compacted session memory: ${prepared.compacted.title ?? prepared.compacted.key}`);
    }
    if (prepared.patterns.length > 0) {
        const top = prepared.patterns.slice(0, 3);
        const render = top
            .map((entry: any) => {
            const title = entry.title ?? entry.key;
            const snippet = (entry.content ?? "").replace(/\s+/g, " ").slice(0, 220);
            return `${title}: ${snippet}${snippet.length >= 220 ? "…" : ""}`;
        })
            .join("\n  ");
        lines.push(`Relevant prior patterns:\n  ${render}`);
    }
    if (prepared.profiles.length > 0) {
        lines.push(`Applicable profile context: ${prepared.profiles
            .slice(0, 3)
            .map((entry: any) => entry.title ?? entry.key)
            .join(", ")}`);
    }
    if (prepared.workflows?.length > 0) {
        const topWorkflows = prepared.workflows.slice(0, 3);
        const render = topWorkflows
            .map((entry: any) => {
            const title = entry.title ?? entry.key;
            const snippet = (entry.content ?? "").replace(/\s+/g, " ").slice(0, 220);
            return `${title}: ${snippet}${snippet.length >= 220 ? "…" : ""}`;
        })
            .join("\n  ");
        lines.push(`Relevant workflows:\n  ${render}`);
    }
    if (lines.length === 0) {
        return null;
    }
    return `MemFlow context:\n- ${lines.join("\n- ")}`;
}
function resolveHostBridgeInput(source: any) {
    const cwd = asString(source, "cwd", asString(source, "workspace", resolve(process.cwd())));
    const repo = asString(source, "repo", basename(cwd ?? process.cwd()));
    const project = asString(source, "project", repo);
    const prompt = asString(source, "prompt") ??
        asString(source, "userPrompt") ??
        asString(source, "input");
    const output = asString(source, "output") ??
        asString(source, "response") ??
        asString(source, "result");
    const summary = asString(source, "summary") ??
        asString(source, "message") ??
        asString(source, "description");
    return {
        coordinates: {
            namespace: asString(source, "namespace", "sessions") ?? "sessions",
            project,
            repo,
            scope: asString(source, "scope", "workspace") ?? "workspace",
            tenant: asString(source, "tenant"),
            user: asString(source, "user", process.env.USER),
            workspace: cwd,
        },
        sessionId: asString(source, "sessionId"),
        goal: asString(source, "goal", asString(source, "task", "Active coding session")),
        prompt,
        task: asString(source, "task"),
        output,
        summary,
        nextStep: asString(source, "nextStep"),
        files: asList(source, "files"),
        todos: asList(source, "todos"),
        decisions: asList(source, "decisions"),
        blockers: asList(source, "blockers"),
        transcript: asList(source, "transcript"),
    };
}
function buildStatusPayload(connector: any, config: any, cwd: string, activity?: any) {
    const currentProject = findTrackedProjectForPath(config.trackedProjects, cwd);
    return {
        on: connector.ok,
        automation: {
            ...config.automation,
            activeRecent: activity?.activeRecent ?? false,
            lastActivityAt: activity?.lastActivityAt,
        },
        connector,
        integration: {
            configured: Array.isArray(config.enabledHosts) && config.enabledHosts.length > 0,
            hosts: Array.isArray(config.enabledHosts) ? config.enabledHosts : [],
        },
        local: {
            configured: Boolean(config.databasePath),
            databasePath: config.databasePath,
        },
        shared: {
            configured: config.connector === "mongodb",
            connector: config.connector,
        },
        tracking: {
            total: config.trackedProjects.length,
            enabled: config.trackedProjects.filter((project: any) => project.enabled).length,
            disabled: config.trackedProjects.filter((project: any) => !project.enabled).length,
            currentProject: currentProject
                ? {
                    enabled: currentProject.enabled,
                    name: currentProject.name,
                    path: currentProject.path,
                    project: currentProject.project,
                    repo: currentProject.repo,
                }
                : undefined,
        },
    };
}
function formatStatusIndicator(status: any) {
    const state = status.on ? "MemFlow:On" : "MemFlow:Off";
    const connection = status.integration?.configured ? "Connected" : "Ready";
    const project = status.tracking.currentProject
        ? status.tracking.currentProject.enabled
            ? `Tracked:${status.tracking.currentProject.name}`
            : `Untracked:${status.tracking.currentProject.name}`
        : "NoProject";
    const mode = status.shared.configured ? "Shared" : "Local";
    const automation = status.automation.enabled
        ? status.automation.activeRecent
            ? "Auto:Active"
            : "Auto:Configured"
        : "Auto:Off";
    return `${state} ${connection} ${project} ${mode} ${automation}`;
}
async function readStatusState(configPath: string, cwd = process.cwd(), includeHealth = true) {
    const config = readMemFlowConfig(configPath);
    if (!includeHealth) {
        return buildStatusPayload(
            {
                kind: config.connector,
                name: config.connector,
                ok: true,
            },
            config,
            cwd,
            {
                activeRecent: false,
            }
        );
    }
    try {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const connector = await service.health();
        return buildStatusPayload(connector, config, cwd, {
            activeRecent: false,
        });
    }
    catch (error) {
        return buildStatusPayload({
            kind: config.connector,
            name: config.connector,
            ok: false,
            details: {
                error: error instanceof Error ? error.message : String(error),
            },
        }, config, cwd);
    }
}
function resolveProfile(flags: Record<string, any>) {
    return typeof flags.profile === "string" && flags.profile.trim() ? flags.profile.trim() : undefined;
}
function resolveConfigPath(flags: Record<string, any>) {
    if (typeof flags.config === "string") {
        return flags.config;
    }
    const profile = resolveProfile(flags) ?? getProfileName();
    return getProfileConfigPath(profile);
}

function resolveHostCommandAlias(host: string): "antigravity" | "chatgpt" | "claude-code" | "codex" | "vscode" | null {
  if (host === "claude") {
    return "claude-code";
  }

  if (host === "openai") {
    return "codex";
  }

  if (host === "chatgpt" || host === "openai-desktop") {
    return "chatgpt";
  }

  if (host === "antigravity" || host === "claude-code" || host === "codex" || host === "vscode") {
    return host;
  }

  return null;
}

function normalizeHostCommand(host: string, fallback: "antigravity" | "chatgpt" | "claude-code" | "codex" | "vscode"): "antigravity" | "chatgpt" | "claude-code" | "codex" | "vscode" {
  return resolveHostCommandAlias(host) ?? fallback;
}

function collectWorkflowMarkdownPaths(cwd: string): string[] {
    const root = resolve(cwd, ".agent", "workflows");
    if (!existsSync(root)) {
        return [];
    }

    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => resolve(root, entry.name))
        .sort((left, right) => left.localeCompare(right));
}
function renderTrackedProjects(projects: any[]) {
    if (projects.length === 0) {
        return "No tracked projects configured.";
    }
    return projects
        .map((project: any, index: number) => `${index + 1}. [${project.enabled ? "ON" : "off"}] ${project.name}  ${project.path}`)
        .join("\n");
}
export async function runCli(argv = process.argv.slice(2)) {
    const [command] = argv;
    const flags = parseFlags(argv.slice(1));
    const profile = resolveProfile(flags);
    if (profile) {
        process.env.MEMFLOW_PROFILE = profile;
    }
    const configPath = resolveConfigPath(flags);
    const payload = readStructuredInput(flags);
    const input = {
        ...payload,
        json: flags.json === true ? true : undefined,
        ...Object.fromEntries(Object.entries(flags).filter(([key]) => key !== "config" && key !== "json" && key !== "stdin")),
    };
    if (!command || command === "-h" || command === "--help" || command === "help") {
        printHelp();
        return 0;
    }
    if (command === "-v" || command === "--version" || command === "version") {
        const json = argv.includes("--json");
        if (json) {
            process.stdout.write(`${JSON.stringify(getVersionInfo(), null, 2)}\n`);
            return 0;
        }
        process.stdout.write(`${formatVersion()}\n`);
        return 0;
    }
    if (command === "mcp") {
        const preflight = await runRuntimePreflight(configPath);
        if (!preflight.ok) {
            printJson(preflight);
            return 1;
        }
        await startServer(argv.slice(1));
        return 0;
    }
    if (command === "env:check") {
        const preflight = await runRuntimePreflight(configPath);
        printHuman(preflight, formatPreflight, input.json);
        return 0;
    }
    if (command === "migrate:ruflo") {
        const connector = createConnectorFromEnvironment(configPath);
        const summary = await importLegacyRufloSetup(connector, asString(input, "path", process.cwd()) ?? process.cwd());
        printJson(summary);
        return 0;
    }

    if (command === "join") {
      return runJoinCommand(configPath, input, flags);
    }

    if (command === "invite") {
      return runInviteCommand(configPath);
    }

    if (command === "security:audit" || command === "security:sweep:audit") {
      return runSecurityAuditCommand(configPath, input);
    }

    if (command === "docs:verify" || command === "docs:audit") {
      const result = await runDocsVerify(process.cwd());
      if (input.json) {
        printJson(result);
        return 0;
      }
      
      const preCommitMode = argv.includes("--pre-commit");
      
      if (result.checked.length === 0) {
        if (!preCommitMode) {
          process.stdout.write("ℹ No staged JS/TS source files found to check.\n");
        }
        return 0;
      }
      
      if (result.updated.length === 0) {
        if (!preCommitMode) {
          process.stdout.write(`✅ Verified ${result.checked.length} staged file(s). All documentation meets standards.\n`);
        }
        return 0;
      }
      
      process.stdout.write(`✨ MemFlow Auto-Doc: Verified ${result.checked.length} file(s), identified lacking documentation.\n`);
      for (const item of result.details) {
        process.stdout.write(`  📝 Updated file: ${item.file}\n`);
        if (item.injectedHeader) {
          process.stdout.write(`     ↳ Injected missing file module header\n`);
        }
        for (const name of item.injectedItems) {
          process.stdout.write(`     ↳ Injected JSDoc block for function: ${name}\n`);
        }
      }
      process.stdout.write(`✅ Successfully injected and re-staged ${result.changesCount} documentation blocks!\n`);
      return 0;
    }

    if (command === "hook:install" || command === "hooks:install") {
      const success = installPreCommitHook(process.cwd());
      if (success) {
        process.stdout.write("✅ MemFlow pre-commit documentation verification hook installed successfully!\n");
        return 0;
      } else {
        process.stderr.write("❌ Failed to install hook. Make sure you are in the root directory of a git repository.\n");
        return 1;
      }
    }

    if (command === "security:sweep") {
      const config = readMemFlowConfig(configPath);
      const ss = config.securitySweep ?? { enabled: true, level: "warn", rules: { privateKeys: true, apiKeys: true, databaseUris: true, pii: false } };
      if (input.json) {
        printJson(ss);
      } else {
        process.stdout.write([
          "",
          "Security Sweep Settings",
          "══════════════════════════════════════",
          `  Status:             ${ss.enabled ? "✅ enabled" : "❌ disabled"}`,
          `  Level:              ${ss.level ?? "warn"}`,
          `  Rules:`,
          `    Private Keys:     ${ss.rules?.privateKeys !== false ? "on" : "off"}`,
          `    API Keys:         ${ss.rules?.apiKeys !== false ? "on" : "off"}`,
          `    Database URIs:    ${ss.rules?.databaseUris !== false ? "on" : "off"}`,
          `    PII:              ${ss.rules?.pii === true ? "on" : "off"}`,
          `  Custom Patterns:    ${ss.customPatterns?.length ?? 0}`,
          `  Trusted Namespaces: ${ss.trustedNamespaces?.join(", ") || "(None)"}`,
          "",
          "  Commands:",
          "    memflow security:audit",
          "    memflow security:sweep:enable",
          "    memflow security:sweep:disable",
          "    memflow security:sweep:level --level warn|redact|block",
          "    memflow security:sweep:rules --api-keys off --pii on",
          "    memflow security:sweep:trusted",
          "    memflow security:sweep:trusted:add --namespace <ns>",
          "    memflow security:sweep:trusted:remove --namespace <ns>",
          "",
        ].join("\n"));
      }
      return 0;
    }

    if (command === "security:sweep:trusted") {
      const config = readMemFlowConfig(configPath);
      const trusted = config.securitySweep?.trustedNamespaces ?? [];
      if (input.json) {
        printJson(trusted);
      } else {
        process.stdout.write([
          "",
          "Trusted Namespaces (Exempt from Security Sweeps)",
          "═══════════════════════════════════════════════════",
          ...(trusted.length > 0
            ? trusted.map((ns) => `  • ${ns}`)
            : ["  (None)"]),
          "",
          "Commands to manage:",
          "  memflow security:sweep:trusted:add --namespace <ns>",
          "  memflow security:sweep:trusted:remove --namespace <ns>",
          "",
        ].join("\n"));
      }
      return 0;
    }

    if (command === "security:sweep:trusted:add") {
      const ns = asString(input, "namespace");
      if (!ns) {
        process.stderr.write("Error: --namespace <name> is required.\n");
        return 1;
      }
      const config = readMemFlowConfig(configPath);
      const current = config.securitySweep ?? { enabled: true, level: "warn", rules: {}, trustedNamespaces: [] };
      const trusted = Array.isArray(current.trustedNamespaces) ? [...current.trustedNamespaces] : [];
      if (trusted.includes(ns)) {
        process.stdout.write(`Namespace '${ns}' is already trusted.\n`);
        return 0;
      }
      trusted.push(ns);
      writeMemFlowConfig({
        ...config,
        securitySweep: {
          ...current,
          trustedNamespaces: trusted,
        },
      }, configPath);
      process.stdout.write(`✅ Namespace '${ns}' has been added to trusted namespaces.\n`);
      return 0;
    }

    if (command === "security:sweep:trusted:remove") {
      const ns = asString(input, "namespace");
      if (!ns) {
        process.stderr.write("Error: --namespace <name> is required.\n");
        return 1;
      }
      const config = readMemFlowConfig(configPath);
      const current = config.securitySweep ?? { enabled: true, level: "warn", rules: {}, trustedNamespaces: [] };
      const trusted = Array.isArray(current.trustedNamespaces) ? [...current.trustedNamespaces] : [];
      if (!trusted.includes(ns)) {
        process.stdout.write(`Namespace '${ns}' is not in trusted namespaces.\n`);
        return 0;
      }
      const nextTrusted = trusted.filter((item) => item !== ns);
      writeMemFlowConfig({
        ...config,
        securitySweep: {
          ...current,
          trustedNamespaces: nextTrusted,
        },
      }, configPath);
      process.stdout.write(`✅ Namespace '${ns}' has been removed from trusted namespaces.\n`);
      return 0;
    }

    if (command === "security:sweep:enable") {
      const config = readMemFlowConfig(configPath);
      writeMemFlowConfig({
        ...config,
        securitySweep: { ...(config.securitySweep ?? { level: "warn", rules: {} }), enabled: true },
      }, configPath);
      process.stdout.write("✅ Security sweep enabled.\n");
      return 0;
    }

    if (command === "security:sweep:disable") {
      const config = readMemFlowConfig(configPath);
      writeMemFlowConfig({
        ...config,
        securitySweep: { ...(config.securitySweep ?? { level: "warn", rules: {} }), enabled: false },
      }, configPath);
      process.stdout.write("⚠️  Security sweep disabled. Sensitive credentials will no longer be detected.\n");
      return 0;
    }

    if (command === "security:sweep:level") {
      const level = asString(input, "level") as "warn" | "redact" | "block" | undefined;
      if (!level || !["warn", "redact", "block"].includes(level)) {
        process.stderr.write("Error: --level must be one of: warn, redact, block\n");
        process.stderr.write("  warn   — warn in tool response but allow storage (default)\n");
        process.stderr.write("  redact — auto-redact sensitive data before storage\n");
        process.stderr.write("  block  — reject any request containing sensitive data\n");
        return 1;
      }
      const config = readMemFlowConfig(configPath);
      writeMemFlowConfig({
        ...config,
        securitySweep: { ...(config.securitySweep ?? { enabled: true, rules: {} }), level },
      }, configPath);
      process.stdout.write(`✅ Security sweep level set to: ${level}\n`);
      return 0;
    }

    if (command === "security:sweep:rules") {
      const config = readMemFlowConfig(configPath);
      const existing = config.securitySweep ?? { enabled: true, level: "warn", rules: {} };
      const existingRules = existing.rules ?? {};
      const resolveToggle = (flag: string, current?: boolean): boolean => {
        const val = asString(input, flag);
        if (val === "on" || val === "true") return true;
        if (val === "off" || val === "false") return false;
        return current ?? true;
      };
      const newRules = {
        privateKeys: resolveToggle("private-keys", existingRules.privateKeys),
        apiKeys: resolveToggle("api-keys", existingRules.apiKeys),
        databaseUris: resolveToggle("db-uris", existingRules.databaseUris),
        pii: resolveToggle("pii", existingRules.pii ?? false),
      };
      writeMemFlowConfig({
        ...config,
        securitySweep: { ...existing, rules: newRules },
      }, configPath);
      process.stdout.write([
        "✅ Security sweep rules updated:",
        `  private-keys: ${newRules.privateKeys ? "on" : "off"}`,
        `  api-keys:     ${newRules.apiKeys ? "on" : "off"}`,
        `  db-uris:      ${newRules.databaseUris ? "on" : "off"}`,
        `  pii:          ${newRules.pii ? "on" : "off"}`,
        "",
      ].join("\n"));
      return 0;
    }
  if (command === "init") {
    const preflight = await runRuntimePreflight(configPath);
    if (!preflight.ok) {
      printJson(preflight);
      return 1;
        }
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
    const shouldRunGuidedSetup =
      process.stdin.isTTY &&
      flags.stdin !== true &&
      flags.json !== true &&
      Object.keys(input).length === 0;
    if (shouldRunGuidedSetup) {
      const guided = await runGuidedInstall(service, configPath);
      process.stdout.write(formatGuidedInstallSummary(guided));
      const quickstart = await runQuickstartWorkflow(service, configPath);
      process.stdout.write(renderQuickstartResult(quickstart));
      return 0;
    }
    const initResult = await service.initializeDefaults({
      actorId: asString(input, "actorId"),
      project: asString(input, "project", basename(resolve(process.cwd()))),
      repo: asString(input, "repo", basename(resolve(process.cwd()))),
      tenant: asString(input, "tenant"),
      user: asString(input, "user", process.env.USER),
      workspace: asString(input, "workspace", resolve(process.cwd())),
      source: asString(input, "source"),
    });

    if (input.json === "true" || input.json === true || !process.stdout.isTTY) {
      printJson(initResult);
    } else {
      process.stdout.write(renderInitResult(initResult, input));
    }
    if (process.stdin.isTTY && process.stdout.isTTY && input.json !== "true" && input.json !== true) {
      const quickstart = await runQuickstartWorkflow(service, configPath);
      process.stdout.write(renderQuickstartResult(quickstart));
    }
    return 0;
  }
    if (command === "activate") {
        // Auto-track current repo if missing, then run activation guide
        const cwd = resolve(process.cwd());
        const config = readMemFlowConfig(configPath);
        const already = findTrackedProjectForPath(config.trackedProjects, cwd);
        if (!already) {
            const merged = mergeTrackedProjects(config.trackedProjects, [{ path: cwd, enabled: true }]);
            const service = new MemoryService(createConnectorFromEnvironment(configPath));
            const nextConfig = writeMemFlowConfig({
                ...config,
                trackedProjects: merged,
            }, configPath);
            const tracked = merged.find((p) => resolve(p.path) === cwd);
            if (tracked) {
                await service.registerTrackedProject({
                    ...(tracked as any),
                    source: "system",
                    tenant: nextConfig.tenant,
                    user: nextConfig.user,
                    workspace: nextConfig.workspace ?? cwd,
                });
                await service.initializeDefaults({
                    project: tracked.project,
                    repo: tracked.repo,
                    tenant: nextConfig.tenant,
                    user: nextConfig.user,
                    workspace: cwd,
                    source: "system",
                });
            }
        }
        return runActivationGuide(configPath);
    }
    if (command === "ci:env") {
        const binPath = "/Users/REDACTED/.memflow/bin";
        printJson({
            node: process.execPath,
            memflowBin: binPath,
            addToPath: `export PATH="${binPath}:$PATH"`,
            shimCommands: ["memflow", "memflow-mcp"],
        });
        return 0;
    }
    if (command === "quickstart") {
        const preflight = await runRuntimePreflight(configPath);
        if (!preflight.ok) {
            printJson(preflight);
            return 1;
        }
        const cwd = resolve(process.cwd());
        const projectName = basename(cwd);
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const config = readMemFlowConfig(configPath);
        if (!hasCompletedGuidedSetup(config)) {
            if (!process.stdin.isTTY || !process.stdout.isTTY) {
                printJson({
                    ok: false,
                    error: "MemFlow has not been initialized yet. Run `memflow init` first so you can choose projects and features.",
                    nextStep: "memflow init",
                });
                return 1;
            }
            process.stdout.write("MemFlow has not been initialized yet. Starting guided setup first.\n\n");
            const guided = await runGuidedInstall(service, configPath);
            process.stdout.write(formatGuidedInstallSummary(guided));
        }
        const quickstart = await runQuickstartWorkflow(service, configPath);
        if (input.json === "true" || input.json === true || !process.stdout.isTTY) {
            printJson(quickstart);
        } else {
            process.stdout.write(renderQuickstartResult(quickstart));
        }
        return 0;
    }
    if (command === "doctor") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const config = readMemFlowConfig(configPath);
        const doctorData = {
            config,
            onboarding: {
                completed: hasCompletedGuidedSetup(config),
                completedAt: config.onboarding?.completedAt,
                lastPromptedAt: config.onboarding?.lastPromptedAt,
            },
            automation: config.automation,
            stats: await service.stats(),
            trackedProjects: {
                total: config.trackedProjects.length,
                enabled: config.trackedProjects.filter((project) => project.enabled).length,
                disabled: config.trackedProjects.filter((project) => !project.enabled).length,
            },
            connector: await service.health(),
        };
        printHuman(doctorData, formatDoctor, input.json);
        return 0;
    }
    if (command === "status") {
        const statusData = await readStatusState(configPath, process.cwd());
        printHuman(statusData, formatStatus, input.json);
        return 0;
    }
    if (command === "stop") {
        const config = readMemFlowConfig(configPath);
        writeMemFlowConfig({
            ...config,
            automation: {
                ...config.automation,
                enabled: false,
            },
        }, configPath);
        const stopResult = { ok: true, message: "MemFlow automation stopped.", automation: { enabled: false } };
        printHuman(stopResult, formatStartStop, input.json);
        return 0;
    }
    if (command === "start") {
        const config = readMemFlowConfig(configPath);
        writeMemFlowConfig({
            ...config,
            automation: {
                ...config.automation,
                enabled: true,
            },
        }, configPath);
        const startResult = { ok: true, message: "MemFlow automation started.", automation: { enabled: true } };
        printHuman(startResult, formatStartStop, input.json);
        return 0;
    }
    if (command === "restart") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const config = readMemFlowConfig(configPath);
        // Toggle and health check
        writeMemFlowConfig({
            ...config,
            automation: { ...config.automation, enabled: true },
        }, configPath);
        const health = await service.health();
        const restartResult = {
            ok: health.ok,
            message: health.ok ? "MemFlow restarted and connected." : "MemFlow restarted but connection failed.",
            connector: health,
            automation: { enabled: true },
        };
        printHuman(restartResult, formatRestart, input.json);
        return 0;
    }
    if (command === "status:line") {
        const status = await withTimeout(readStatusState(configPath, process.cwd(), false), DEFAULT_PROMPT_TIMEOUT_MS, null);
        if (!status) {
            process.stdout.write("MemFlow:Slow NoProject Shared Auto:Off\n");
            process.exit(0);
        }
        process.stdout.write(`${formatStatusIndicator(status)}\n`);
        process.exit(0);
    }
    if (command === "status:claude-code") {
        const config = readMemFlowConfig(configPath);
        try {
            const service = new MemoryService(createConnectorFromEnvironment(configPath));
            const cwd = process.cwd();
            const currentProject = findTrackedProjectForPath(config.trackedProjects, cwd);
            // Wrap the heavy metrics call in a timeout
            const metrics = await withTimeout(service.metrics({
                limit: 10,
                days: 1,
                project: currentProject?.project,
                repo: currentProject?.repo,
            }), DEFAULT_PROMPT_TIMEOUT_MS, null);
            if (!metrics) {
                process.stdout.write(`on=true tracked=${currentProject?.enabled ?? false} active=false action=timeout\n`);
                process.exit(0);
            }
            // Derive last meaningful action (skip noise metrics)
            const SKIP = new Set(["cache_miss", "embedding_backfill"]);
            const lastEntry = metrics.recent.find((r: any) => !SKIP.has(r.metric));
            const lastAction = lastEntry?.metric ?? "";
            const timeSavedMs = metrics.estimate?.timeMs?.net ?? 0;
            const resumes = (metrics.totals.session_resume_hit ?? 0) + (metrics.totals.compacted_resume_hit ?? 0);
            const compactions = metrics.totals.compaction ?? 0;
            const active = (metrics.totals.agent_prepare ?? 0) > 0 || (metrics.totals.agent_finalize ?? 0) > 0;
            const parts = [
                `on=true`,
                `tracked=${currentProject?.enabled ?? false}`,
                `active=${active}`,
            ];
            if (lastAction)
                parts.push(`action=${lastAction}`);
            if (timeSavedMs > 0)
                parts.push(`saved_ms=${timeSavedMs}`);
            if (resumes > 0)
                parts.push(`resumes=${resumes}`);
            if (compactions > 0)
                parts.push(`compact=${compactions}`);
            process.stdout.write(parts.join(" ") + "\n");
            process.exit(0);
        }
        catch {
            process.stdout.write("on=false\n");
            process.exit(0);
        }
    }
    if (command === "memory_status") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const health = await service.health();
        const metrics = await service.metrics({ days: 1, limit: 20 });
        const msData = {
            health,
            recentActivity: metrics.recent,
            totals: metrics.totals,
        };
        printHuman(msData, formatMemoryStatus, input.json);
        return 0;
    }
    if (command === "validate") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const workspace = asString(input, "workspace", resolve(process.cwd())) ?? resolve(process.cwd());
        const snapshot = collectDependencySnapshot(workspace);
        const entries = await service.list({
            workspace,
            project: asString(input, "project"),
            repo: asString(input, "repo"),
            limit: typeof input.limit === "number" ? input.limit : 500,
            includeExpired: true,
        });
        const warnings = entries.flatMap((entry) =>
            dependencyWarningsForEntry(entry, snapshot).map((warning) => ({
                ...warning,
                entryId: entry.id,
                entryKind: entry.kind,
                entryKey: entry.key,
            }))
        );
        const validateResult = {
            ok: warnings.length === 0,
            workspace,
            snapshot,
            warnings,
            entryCount: entries.length,
        };
        printHuman(validateResult, formatValidate, input.json);
        return 0;
    }
    if (command === "metrics") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const metricsData = await service.metrics({
            project: asString(input, "project"),
            repo: asString(input, "repo"),
            scope: asString(input, "scope"),
            tenant: asString(input, "tenant"),
            user: asString(input, "user"),
            workspace: asString(input, "workspace"),
            days: typeof input.days === "number" ? input.days : undefined,
            limit: typeof input.limit === "number" ? input.limit : undefined,
        });
        printHuman(metricsData, formatMetrics, input.json);
        return 0;
    }
    if (command === "ingest:workflows") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const cwd = resolve(process.cwd());
        const workspace = asString(input, "workspace", cwd) ?? cwd;
        const markdownPaths =
            asList(input, "paths") ??
            (asString(input, "path") ? [asString(input, "path") as string] : collectWorkflowMarkdownPaths(cwd));

        if (markdownPaths.length === 0) {
            printJson({
                ok: false,
                error: "No workflow markdown files found. Provide --path, --paths, or create .agent/workflows/*.md.",
            });
            return 1;
        }

        const entries = [];
        for (const sourcePath of markdownPaths) {
            if (!existsSync(sourcePath)) {
                continue;
            }
            const content = readFileSync(sourcePath, "utf8");
            const entry = await service.upsert(
                buildWorkflowWriteInput({
                    content,
                    coordinates: {
                        namespace: "workflow",
                        project: asString(input, "project", basename(cwd)),
                        repo: asString(input, "repo", basename(cwd)),
                        scope: "repo",
                        tenant: asString(input, "tenant"),
                        user: asString(input, "user", process.env.USER),
                        workspace,
                    },
                    source: "manual",
                    sourcePath,
                    title: asString(input, "title"),
                })
            );
            entries.push(entry);
        }

        printJson({
            ok: true,
            ingested: entries.length,
            files: markdownPaths,
            entries,
        });
        return 0;
    }
    if (command === "savings") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const estimate = (await service.metrics({
            project: asString(input, "project"),
            repo: asString(input, "repo"),
            scope: asString(input, "scope"),
            tenant: asString(input, "tenant"),
            user: asString(input, "user"),
            workspace: asString(input, "workspace"),
            days: typeof input.days === "number" ? input.days : undefined,
            limit: typeof input.limit === "number" ? input.limit : undefined,
        })).estimate;
        if (input.json === "true" || input.json === true) {
            printJson(estimate);
        } else if (input.detailed === "true" || input.detailed === true) {
            process.stdout.write(formatSavingsDetailed(estimate));
        } else {
            process.stdout.write(`\nTime Saved: ${formatMs(estimate.timeMs.net)}  |  Tokens Saved: ${estimate.tokens.net}\n(Use --detailed for full breakdown, or --json for raw data)\n\n`);
        }
        return 0;
    }

  if (command === "recall") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.search({
        text: asString(input, "text"),
        namespace: asString(input, "namespace"),
        project: asString(input, "project"),
        repo: asString(input, "repo"),
        scope: asString(input, "scope") as MemoryScope | undefined,
        tenant: asString(input, "tenant"),
        user: asString(input, "user"),
        workspace: asString(input, "workspace"),
        kind: asString(input, "kind") as any,
        key: asString(input, "key"),
        limit: typeof input.limit === "number" ? input.limit : 10,
        threshold: typeof input.threshold === "number" ? input.threshold : undefined,
      })
    );
    return 0;
  }

  if (command === "projects:list") {
    process.stdout.write(`${renderTrackedProjects(readMemFlowConfig(configPath).trackedProjects)}\n`);
    return 0;
  }

  if (command === "projects:add") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    const config = readMemFlowConfig(configPath);
    const addedPaths =
      asList(input, "paths") ??
      (asString(input, "path") ? [asString(input, "path") as string] : []);

    if (addedPaths.length === 0) {
      printJson({
        error: "Provide --path <repo> or --paths a,b,c",
      });
      return 1;
    }

    const merged = mergeTrackedProjects(
      config.trackedProjects,
      addedPaths.map((path) => ({
        path,
        enabled: true,
      }))
    );
    const nextConfig = writeMemFlowConfig(
      {
        ...config,
        trackedProjects: merged,
      },
      configPath
    );

    for (const project of nextConfig.trackedProjects.filter((candidate) =>
      addedPaths.map((path) => resolve(path)).includes(resolve(candidate.path))
    )) {
      await service.registerTrackedProject({
        ...project,
        source: "system",
        tenant: nextConfig.tenant,
        user: nextConfig.user,
        workspace: nextConfig.workspace,
      });
      await service.initializeDefaults({
        project: project.project,
        repo: project.repo,
        tenant: nextConfig.tenant,
        user: nextConfig.user,
        workspace: project.path,
        source: "system",
      });
    }

    printJson(nextConfig);
    return 0;
  }

  if (command === "projects:toggle") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    const config = readMemFlowConfig(configPath);
    const path = asString(input, "path");
    if (!path) {
      printJson({
        error: "Provide --path <repo> to toggle tracking",
      });
      return 1;
    }

    const existing = config.trackedProjects.find((project) => resolve(project.path) === resolve(path));
    if (!existing) {
      printJson({
        error: `Tracked project not found: ${path}`,
      });
      return 1;
    }

    const enabled =
      typeof input.enabled === "boolean"
        ? input.enabled
        : asString(input, "enabled")
          ? asString(input, "enabled") === "true"
          : !existing.enabled;

    const nextConfig = writeMemFlowConfig(
      {
        ...config,
        trackedProjects: setTrackedProjectEnabled(config.trackedProjects, path, enabled),
      },
      configPath
    );
    const project = nextConfig.trackedProjects.find((candidate) => resolve(candidate.path) === resolve(path));
    if (project) {
      await service.registerTrackedProject({
        ...project,
        source: "system",
        tenant: nextConfig.tenant,
        user: nextConfig.user,
        workspace: nextConfig.workspace,
      });
    }
    printJson(project ?? nextConfig);
    return 0;
  }

  if (command === "projects:rescan") {
    const config = readMemFlowConfig(configPath);
    const root = asString(input, "projectsRoot", config.projectsRoot ?? process.cwd()) ?? process.cwd();
    const discovered = discoverProjects(root).map((project) => ({
      ...project,
      enabled:
        config.trackedProjects.find((tracked) => resolve(tracked.path) === resolve(project.path))
          ?.enabled ?? false,
    }));
    const nextConfig = writeMemFlowConfig(
      {
        ...config,
        projectsRoot: root,
        trackedProjects: mergeTrackedProjects(config.trackedProjects, discovered),
      },
      configPath
    );
    printJson({
      projectsRoot: root,
      discovered: discovered.length,
      trackedProjects: nextConfig.trackedProjects,
    });
    return 0;
  }

  if (command === "shell:status") {
    printJson(getShellPromptStatus());
    return 0;
  }

  if (command === "host:bootstrap") {
    printJson(buildHostBootstrap(configPath));
    return 0;
  }

  if (command === "connect:codex" || command === "connect:openai") {
    const result = installHostIntegration("codex", configPath);
    if (input.json === "true" || input.json === true) {
      printJson(result);
    } else {
      process.stdout.write(renderHostInstall(result));
    }
    return 0;
  }

  if (command === "connect:chatgpt" || command === "connect:openai-desktop") {
    const result = installHostIntegration("chatgpt", configPath);
    if (input.json === "true" || input.json === true) {
      printJson(result);
    } else {
      process.stdout.write(renderHostInstall(result));
    }
    return 0;
  }

  if (command === "connect:claude-code" || command === "connect:claude") {
    const result = installHostIntegration("claude-code", configPath);
    if (input.json === "true" || input.json === true) {
      printJson(result);
    } else {
      process.stdout.write(renderHostInstall(result));
    }
    return 0;
  }

  if (command === "connect:antigravity") {
    const result = installHostIntegration("antigravity", configPath);
    if (input.json === "true" || input.json === true) {
      printJson(result);
    } else {
      process.stdout.write(renderHostInstall(result));
    }
    return 0;
  }

  if (command === "connect:vscode") {
    const result = installHostIntegration("vscode", configPath);
    if (input.json === "true" || input.json === true) {
      printJson(result);
    } else {
      process.stdout.write(renderHostInstall(result));
    }
    return 0;
  }

  if (command === "connect:auto") {
    const hosts: Array<"codex" | "chatgpt" | "claude-code" | "antigravity" | "vscode"> = [
      "codex",
      "chatgpt",
      "claude-code",
      "antigravity",
      "vscode",
    ];
    const results = hosts.map((host) => ({
      host,
      install: installHostIntegration(host, configPath),
      validate: validateHostIntegration(host, configPath),
      reload: formatHostReloadInstruction(host),
    }));
    printJson({ applied: true, results });
    return 0;
  }

  if (command === "validate:host") {
    const host = normalizeHostCommand(
      asString(input, "host", "codex") ?? "codex",
      "codex"
    );
    printJson(validateHostIntegration(host, configPath));
    return 0;
  }

  if (command === "host:bridge") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    const bridgeInput = resolveHostBridgeInput(input);
    const phase = asString(input, "phase", "prepare");
    const hookOutput = input["hook-output"] === true;
    const host = asString(input, "host");

    if (phase === "finalize") {
      const finalized = await service.finalizeAgentMemory({
          coordinates: bridgeInput.coordinates,
          sessionId: bridgeInput.sessionId,
          goal: bridgeInput.goal ?? "Active coding session",
          summary: bridgeInput.summary,
          nextStep: bridgeInput.nextStep,
          prompt: bridgeInput.prompt,
          task: bridgeInput.task,
          output: bridgeInput.output,
          files: bridgeInput.files,
          todos: bridgeInput.todos,
          decisions: bridgeInput.decisions,
          blockers: bridgeInput.blockers,
          transcript: bridgeInput.transcript,
          compact: asBoolean(input, "compact"),
          storeCache: asBoolean(input, "storeCache"),
          source: "agent",
        });
      if (!hookOutput) {
        printJson(finalized);
      }
      return 0;
    }

    const prepared = await service.prepareAgentMemory({
      coordinates: bridgeInput.coordinates,
      sessionId: bridgeInput.sessionId,
      goal: bridgeInput.goal,
      prompt: bridgeInput.prompt,
      task: bridgeInput.task,
    });
    if (hookOutput && host === "claude-code") {
      const additionalContext = buildClaudeHookContext(prepared);
      if (additionalContext) {
        printJson({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext,
          },
        });
      }
      return 0;
    }
    printJson(prepared);
    return 0;
  }

  if (command === "dashboard") {
    const port =
      typeof input.port === "number"
        ? input.port
        : Number.isInteger(Number(asString(input, "port")))
          ? Number(asString(input, "port"))
          : 3000;

    // Kill any stale dashboard already on this port, then start fresh.
    await killPortOwner(port);

    const server = startDashboard({ port, configPath });
    process.stdout.write(`MemFlow dashboard running at http://localhost:${port}\n`);
    
    // Keep the process alive until the server is closed or a signal is received
    await new Promise<void>((resolve, reject) => {
      server.on("error", (err: any) => {
        if (err.code === "EADDRINUSE") {
          process.stderr.write(`Error: Port ${port} is already in use.\n`);
        } else {
          process.stderr.write(`Dashboard error: ${err.message}\n`);
        }
        reject(err);
      });
      
      process.on("SIGINT", () => {
        server.close(() => resolve());
      });
      process.on("SIGTERM", () => {
        server.close(() => resolve());
      });
    });
    return 0;
  }
    if (command === "checkpoint") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        printJson(await service.checkpointSession({
            sessionId: asString(input, "sessionId"),
            title: asString(input, "title"),
            goal: asString(input, "goal", "Active coding session") ?? "Active coding session",
            summary: asString(input, "summary"),
            nextStep: asString(input, "nextStep"),
            status: asString(input, "status") ?? "active",
            coordinates: resolveCoordinates(input, "sessions"),
            branch: asString(input, "branch"),
            files: asList(input, "files"),
            blockers: asList(input, "blockers"),
            decisions: asList(input, "decisions"),
            todos: asList(input, "todos"),
            metadata: typeof input.metadata === "object" && input.metadata ? input.metadata : undefined,
            source: asString(input, "source"),
        }));
        return 0;
    }
    if (command === "reload:prepare") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const shellStatus = getShellPromptStatus();
        const sessionId = asString(input, "sessionId", "reload") ?? "reload";
        const coordinates = resolveCoordinates(input, "sessions");
        const compacted = await service.compactSession({
            sessionId,
            coordinates,
            goal: asString(input, "goal", "Reload current MemFlow session") ?? "Reload current MemFlow session",
            summary: asString(input, "summary", "Saved current state before reloading the shell or agent host.") ??
                "Saved current state before reloading the shell or agent host.",
            nextStep: asString(input, "nextStep", "Reload the shell or host client, then resume this reload handoff.") ??
                "Reload the shell or host client, then resume this reload handoff.",
            transcript: asList(input, "transcript"),
            decisions: asList(input, "decisions"),
            blockers: asList(input, "blockers"),
            activeFiles: asList(input, "activeFiles"),
            activeTodos: asList(input, "activeTodos"),
            invalidatedAssumptions: asList(input, "invalidatedAssumptions"),
            metadata: typeof input.metadata === "object" && input.metadata ? input.metadata : undefined,
            source: asString(input, "source", "system"),
        });
        printJson({
            activationCommand: shellStatus.activationCommand,
            checkpoint: compacted.checkpoint,
            compacted: compacted.compacted,
            resumeCommand: `memflow reload:resume --sessionId ${sessionId}`,
            shell: shellStatus,
        });
        return 0;
    }
    if (command === "resume" || command === "recover" || command === "reload:resume") {
        const service = new MemoryService(createConnectorFromEnvironment(configPath));
        const result = await service.resumeSession({
            sessionId: asString(input, "sessionId"),
            project: asString(input, "project", basename(resolve(process.cwd()))),
            repo: asString(input, "repo", basename(resolve(process.cwd()))),
            scope: asString(input, "scope", "workspace"),
            tenant: asString(input, "tenant"),
            user: asString(input, "user", process.env.USER),
            workspace: asString(input, "workspace", resolve(process.cwd())),
            limit: Number(input.limit ?? 20),
        });
        if (input.json === "true" || input.json === true) {
            printJson(result);
        }
        else {
            process.stdout.write(`Session restored: ${result.checkpoint ? result.checkpoint.title ?? result.checkpoint.key : "No checkpoint found"}\n(Use --json to view the raw recovery payload)\n`
      );
    }
    return 0;
  }

  if (command === "compact") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.compactSession({
        sessionId: asString(input, "sessionId"),
        coordinates: resolveCoordinates(input, "sessions"),
        goal: asString(input, "goal"),
        summary: asString(input, "summary"),
        transcript: asList(input, "transcript"),
        decisions: asList(input, "decisions"),
        blockers: asList(input, "blockers"),
        nextStep: asString(input, "nextStep"),
        activeFiles: asList(input, "activeFiles"),
        activeTodos: asList(input, "activeTodos"),
        invalidatedAssumptions: asList(input, "invalidatedAssumptions"),
        metadata:
          typeof input.metadata === "object" && input.metadata ? (input.metadata as Record<string, unknown>) : undefined,
        source: asString(input, "source"),
      })
    );
    return 0;
  }

  if (command === "agent:prepare") {
    const config = readMemFlowConfig(configPath);
    if (config.automation.enabled === false) {
      printJson({
        ok: false,
        error: "MemFlow automation is stopped. Run `memflow start` to enable.",
        mode: "stopped",
      });
      return 0;
    }
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.prepareAgentMemory({
        coordinates: resolveCoordinates(input, asString(input, "namespace", "sessions") ?? "sessions"),
        sessionId: asString(input, "sessionId"),
        goal: asString(input, "goal"),
        prompt: asString(input, "prompt"),
        task: asString(input, "task"),
        supplier: asString(input, "supplier") as "claude" | "openai" | "generic" | undefined,
        profileLimit: typeof input.profileLimit === "number" ? input.profileLimit : undefined,
        patternLimit: typeof input.patternLimit === "number" ? input.patternLimit : undefined,
        cacheLimit: typeof input.cacheLimit === "number" ? input.cacheLimit : undefined,
      })
    );
    return 0;
  }

  if (command === "agent:finalize") {
    const config = readMemFlowConfig(configPath);
    if (config.automation.enabled === false) {
      printJson({
        ok: false,
        error: "MemFlow automation is stopped. Run `memflow start` to enable.",
        mode: "stopped",
      });
      return 0;
    }
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.finalizeAgentMemory({
        coordinates: resolveCoordinates(input, asString(input, "namespace", "sessions") ?? "sessions"),
        sessionId: asString(input, "sessionId"),
        goal: asString(input, "goal", "Active coding session") ?? "Active coding session",
        summary: asString(input, "summary"),
        nextStep: asString(input, "nextStep"),
        status: (asString(input, "status") as "active" | "blocked" | "completed" | undefined) ?? "active",
        prompt: asString(input, "prompt"),
        task: asString(input, "task"),
        output: asString(input, "output"),
        branch: asString(input, "branch"),
        files: asList(input, "files"),
        blockers: asList(input, "blockers"),
        decisions: asList(input, "decisions"),
        todos: asList(input, "todos"),
        activeFiles: asList(input, "activeFiles"),
        activeTodos: asList(input, "activeTodos"),
        invalidatedAssumptions: asList(input, "invalidatedAssumptions"),
        transcript: asList(input, "transcript"),
        compact: typeof input.compact === "boolean" ? input.compact : undefined,
        storeCache: typeof input.storeCache === "boolean" ? input.storeCache : undefined,
        cacheMetadata:
          typeof input.cacheMetadata === "object" && input.cacheMetadata
            ? (input.cacheMetadata as Record<string, unknown>)
            : undefined,
        metadata:
          typeof input.metadata === "object" && input.metadata
            ? (input.metadata as Record<string, unknown>)
            : undefined,
        source: asString(input, "source") ?? "cli",
      })
    );
    return 0;
  }

  if (command === "cache:store") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.storePromptCache({
        key: asString(input, "key", "cache-entry") ?? "cache-entry",
        title: asString(input, "title"),
        content: asString(input, "content", "") ?? "",
        coordinates: resolveCoordinates(input, asString(input, "namespace", "cache") ?? "cache"),
        tags: asList(input, "tags"),
        metadata:
          typeof input.metadata === "object" && input.metadata ? (input.metadata as Record<string, unknown>) : undefined,
        source: asString(input, "source"),
        embeddingVersion: asString(input, "embeddingVersion"),
        schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : undefined,
        confidence: typeof input.confidence === "number" ? input.confidence : undefined,
      })
    );
    return 0;
  }

  if (command === "cache:get") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.getPromptCache({
        key: asString(input, "key"),
        text: asString(input, "text"),
        coordinates: resolveCoordinates(input, asString(input, "namespace", "cache") ?? "cache"),
        limit: typeof input.limit === "number" ? input.limit : 20,
      })
    );
    return 0;
  }

  if (command === "cache:auto:get") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.getPromptCacheAuto({
        prompt: asString(input, "prompt", "") ?? "",
        task: asString(input, "task"),
        coordinates: resolveCoordinates(input, asString(input, "namespace", "cache") ?? "cache"),
        schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : undefined,
        embeddingVersion: asString(input, "embeddingVersion"),
        limit: typeof input.limit === "number" ? input.limit : 20,
      })
    );
    return 0;
  }

  if (command === "cache:auto:store") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.storePromptCacheAuto({
        prompt: asString(input, "prompt", "") ?? "",
        task: asString(input, "task"),
        title: asString(input, "title"),
        content: asString(input, "content", "") ?? "",
        coordinates: resolveCoordinates(input, asString(input, "namespace", "cache") ?? "cache"),
        tags: asList(input, "tags"),
        metadata:
          typeof input.metadata === "object" && input.metadata ? (input.metadata as Record<string, unknown>) : undefined,
        source: asString(input, "source"),
        embeddingVersion: asString(input, "embeddingVersion"),
        schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : undefined,
        confidence: typeof input.confidence === "number" ? input.confidence : undefined,
      })
    );
    return 0;
  }

  if (command === "cache:invalidate") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.invalidatePromptCache({
        namespace: asString(input, "namespace", "cache") ?? "cache",
        project: asString(input, "project"),
        repo: asString(input, "repo"),
        scope: asString(input, "scope") as MemoryScope | undefined,
        tenant: asString(input, "tenant"),
        user: asString(input, "user"),
        workspace: asString(input, "workspace"),
        schemaVersion: typeof input.schemaVersion === "number" ? input.schemaVersion : undefined,
        embeddingVersion: asString(input, "embeddingVersion"),
      })
    );
    return 0;
  }

  if (command === "embeddings:backfill") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.backfillEmbeddings({
        namespace: asString(input, "namespace"),
        project: asString(input, "project"),
        repo: asString(input, "repo"),
        scope: asString(input, "scope") as MemoryScope | undefined,
        tenant: asString(input, "tenant"),
        user: asString(input, "user"),
        workspace: asString(input, "workspace"),
        kind: asString(input, "kind") as any,
        limit: typeof input.limit === "number" ? input.limit : 500,
      })
    );
    return 0;
  }

  if (command === "promote:pattern") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    printJson(
      await service.promotePattern({
        title: asString(input, "title", "Recovered engineering pattern") ?? "Recovered engineering pattern",
        failure: asString(input, "failure", "Unspecified failure") ?? "Unspecified failure",
        rootCause: asString(input, "rootCause", "Unspecified root cause") ?? "Unspecified root cause",
        safeFix: asString(input, "safeFix", "Document the safe recovery path") ?? "Document the safe recovery path",
        detection: asString(input, "detection"),
        coordinates: resolveCoordinates(input, "patterns", "project"),
        tags: asList(input, "tags"),
        confidence: typeof input.confidence === "number" ? input.confidence : undefined,
        lastVerifiedAt: asString(input, "lastVerifiedAt"),
        sessionId: asString(input, "sessionId"),
        metadata:
          typeof input.metadata === "object" && input.metadata ? (input.metadata as Record<string, unknown>) : undefined,
        source: asString(input, "source"),
      })
    );
    return 0;
  }

  if (command === "sync:plan") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    const query =
      typeof input.query === "object" && input.query ? (input.query as Record<string, unknown>) : input;
    const policy =
      typeof input.policy === "object" && input.policy ? input.policy : undefined;
    printJson(
      await service.syncPlan(
        {
          namespace: asString(query, "namespace"),
          project: asString(query, "project"),
          repo: asString(query, "repo"),
          scope: asString(query, "scope") as MemoryScope | undefined,
          tenant: asString(query, "tenant"),
          user: asString(query, "user"),
          workspace: asString(query, "workspace"),
          kind: asString(query, "kind") as any,
          key: asString(query, "key"),
          text: asString(query, "text"),
          limit: typeof query.limit === "number" ? query.limit : 500,
        },
        policy as any
      )
    );
    return 0;
  }

  if (command === "sync:export") {
    const service = new MemoryService(createConnectorFromEnvironment(configPath));
    const query =
      typeof input.query === "object" && input.query ? (input.query as Record<string, unknown>) : input;
    const policy =
      typeof input.policy === "object" && input.policy ? input.policy : undefined;
    printJson(
      await service.exportBySyncTarget(
        (asString(input, "target", "shared") as "local" | "shared") ?? "shared",
        {
          namespace: asString(query, "namespace"),
          project: asString(query, "project"),
          repo: asString(query, "repo"),
          scope: asString(query, "scope") as MemoryScope | undefined,
          tenant: asString(query, "tenant"),
          user: asString(query, "user"),
          workspace: asString(query, "workspace"),
          kind: asString(query, "kind") as any,
          key: asString(query, "key"),
          text: asString(query, "text"),
          limit: typeof query.limit === "number" ? query.limit : 500,
        },
        policy as any
      )
    );
    return 0;
  }

  process.stderr.write(`Unknown command: ${command}\n\n`);
  printHelp();
  return 1;
}

interface InvitePayload {
  uri: string;
  database: string;
  collection?: string;
  maxPoolSize?: number;
  minPoolSize?: number;
  connectTimeoutMs?: number;
  socketTimeoutMS?: number;
  waitQueueTimeoutMS?: number;
  team?: string;
  createdBy?: string;
  createdAt?: string;
}

function buildInviteToken(payload: InvitePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function parseInviteToken(token: string): InvitePayload | null {
  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed.uri || !parsed.database) return null;
    return parsed as InvitePayload;
  } catch {
    return null;
  }
}

async function runJoinCommand(
  configPath: string,
  input: Record<string, any>,
  flags: Record<string, any>
): Promise<number> {
  const config = readMemFlowConfig(configPath);

  // Resolve MongoDB connection from token, URI flag, or input
  let mongoUri: string | undefined;
  let mongoDatabase: string | undefined;
  let mongoConfig: Partial<InvitePayload> = {};

  const token = asString(flags, "token") ?? asString(input, "token");
  if (token) {
    const parsed = parseInviteToken(token);
    if (!parsed) {
      process.stderr.write("Error: Invalid invite token. Get a new one from your admin with `memflow invite`.\n");
      return 1;
    }
    mongoUri = parsed.uri;
    mongoDatabase = parsed.database;
    mongoConfig = parsed;
    process.stdout.write(`Invite from: ${parsed.createdBy ?? "unknown"} (${parsed.team ?? "team"})\n`);
  } else {
    mongoUri = asString(flags, "uri") ?? asString(input, "uri");
    mongoDatabase = asString(flags, "database") ?? asString(input, "database");
  }

  if (!mongoUri) {
    process.stderr.write([
      "Usage: memflow join --uri <mongodb-uri> [--migrate]",
      "   or: memflow join --token <invite-token> [--migrate]",
      "",
      "Get an invite token from your admin: memflow invite",
      "",
    ].join("\n"));
    return 1;
  }

  if (!mongoDatabase) {
    mongoDatabase = "memflow_default";
  }

  const wasOnSqlite = config.connector === "sqlite" || config.connector === "embedded";
  const shouldMigrate = flags.migrate === true && wasOnSqlite;

  // Step 1: Export existing data if migrating
  let exportBundle: any = null;
  if (shouldMigrate) {
    process.stdout.write("Exporting existing local data...\n");
    const oldService = new MemoryService(createConnectorFromEnvironment(configPath));
    exportBundle = await oldService.export({ limit: 500 });
    process.stdout.write(`  Exported ${exportBundle.entries.length} entries from ${config.connector}.\n`);
  }

  // Step 2: Update config to MongoDB
  const newMongoConfig: any = {
    uri: mongoUri,
    database: mongoDatabase,
    ...(mongoConfig.collection ? { collection: mongoConfig.collection } : {}),
    maxPoolSize: mongoConfig.maxPoolSize ?? 100,
    minPoolSize: mongoConfig.minPoolSize ?? 10,
    connectTimeoutMs: mongoConfig.connectTimeoutMs ?? 30000,
    socketTimeoutMS: mongoConfig.socketTimeoutMS ?? 45000,
    waitQueueTimeoutMS: mongoConfig.waitQueueTimeoutMS ?? 15000,
  };

  const updatedConfig = writeMemFlowConfig({
    ...config,
    connector: "mongodb",
    mongo: newMongoConfig,
  }, configPath);

  process.stdout.write(`Config updated: connector → mongodb\n`);
  process.stdout.write(`  URI: ${mongoUri.replace(/\/\/[^@]*@/, "//***@")}\n`);
  process.stdout.write(`  Database: ${mongoDatabase}\n`);

  // Step 3: Verify connection
  try {
    const newService = new MemoryService(createConnectorFromEnvironment(configPath));
    const health = await newService.health();
    if (!health.ok) {
      process.stderr.write(`Warning: MongoDB connection check returned not-ok. Details: ${JSON.stringify(health.details)}\n`);
    } else {
      process.stdout.write(`  Connection: ✅ verified\n`);
    }

    // Step 4: Migrate data — merge by default (conservative), import if --force-import
    if (shouldMigrate && exportBundle && exportBundle.entries.length > 0) {
      const forceImport = flags["force-import"] === true;
      const mode = forceImport ? "import" : "merge";
      process.stdout.write(`Migrating ${exportBundle.entries.length} entries into MongoDB (${mode} mode)...\n`);
      const result = forceImport
        ? await newService.import(exportBundle)
        : await newService.merge(exportBundle);
      process.stdout.write(`  Complete: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped.\n`);
      if (result.conflicts.length > 0) {
        process.stdout.write(`  ${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"} resolved (${forceImport ? "incoming wins" : "newer entry kept"}).\n`);
      }
    }

    const stats = await newService.stats();
    process.stdout.write(`  Total entries in MongoDB: ${stats.entries}\n`);
  } catch (error) {
    process.stderr.write(`Error verifying MongoDB connection: ${error instanceof Error ? error.message : String(error)}\n`);
    process.stderr.write("Config was updated but connection could not be verified. Check your URI and network.\n");
    return 1;
  }

  process.stdout.write([
    "",
    "─────────────────────────────────────────",
    wasOnSqlite ? "✅ Upgrade complete! You are now on shared MongoDB." : "✅ MongoDB connection updated.",
    shouldMigrate ? "Your local data has been merged into the shared database." : wasOnSqlite ? "Run `memflow join --uri <uri> --migrate` to merge your local SQLite data (keeps newer entries on conflict)." : "",
    "",
    "Next steps:",
    "  1. Restart your MCP server: memflow mcp",
    "  2. Verify with: memflow doctor",
    "  3. Share with teammates: memflow invite",
    "",
  ].filter(Boolean).join("\n"));

  return 0;
}

async function runSecurityAuditCommand(configPath: string, input: Record<string, any>): Promise<number> {
  const service = new MemoryService(createConnectorFromEnvironment(configPath));
  const entries = await service.list({ limit: 10000 });
  const config = readMemFlowConfig(configPath);
  const sweepConfig = {
    ...(config.securitySweep ?? { level: "warn", rules: { privateKeys: true, apiKeys: true, databaseUris: true, pii: false } }),
    enabled: true, // Force enabled for audit command
  };
  const sweepEngine = new SecuritySweepEngine(sweepConfig);

  const findings: Array<{
    id: string;
    key: string;
    namespace: string;
    kind: string;
    matches: Array<{ type: string; text: string }>;
  }> = [];

  for (const entry of entries) {
    const titleRes = sweepEngine.sweep(entry.title);
    const contentRes = sweepEngine.sweep(entry.content);

    const matchesMap = new Map<string, string>();
    if (titleRes.hasMatches) {
      for (const m of titleRes.matches) {
        matchesMap.set(m.type + ":" + m.text, m.text);
      }
    }
    if (contentRes.hasMatches) {
      for (const m of contentRes.matches) {
        matchesMap.set(m.type + ":" + m.text, m.text);
      }
    }

    if (matchesMap.size > 0) {
      const entryMatches = Array.from(matchesMap.entries()).map(([key, text]) => {
        const type = key.split(":")[0];
        return { type, text };
      });

      findings.push({
        id: entry.id,
        key: entry.key,
        namespace: entry.namespace,
        kind: entry.kind,
        matches: entryMatches,
      });
    }
  }

  if (input.json === "true" || input.json === true || !process.stdout.isTTY) {
    printJson({
      scannedCount: entries.length,
      findingsCount: findings.length,
      findings,
    });
  } else {
    process.stdout.write([
      "",
      "MemFlow Security Audit Summary",
      "══════════════════════════════════════",
      `  Total Entries Scanned: ${entries.length}`,
      `  Sensitive Entries Found: ${findings.length}`,
      "",
    ].join("\n"));

    if (findings.length > 0) {
      process.stdout.write("Findings Details:\n");
      for (const f of findings) {
        process.stdout.write([
          `  • Entry Key: ${f.key} (ID: ${f.id})`,
          `    Namespace: ${f.namespace} | Kind: ${f.kind}`,
          `    Detected Secrets:`,
          ...f.matches.map((m) => `      - [${m.type}]: ${m.text}`),
          "",
        ].join("\n"));
      }
      process.stdout.write([
        "⚠️  WARNING: The above secrets/sensitive data were found in your local database.",
        "Consider deleting or redacting these entries, or whitelisting their namespaces.",
        "",
      ].join("\n"));
    } else {
      process.stdout.write("✅ No secrets or sensitive data found in stored memories.\n\n");
    }
  }

  return findings.length > 0 ? 1 : 0;
}

async function runInviteCommand(configPath: string): Promise<number> {
  const config = readMemFlowConfig(configPath);

  if (config.connector !== "mongodb" || !config.mongo?.uri) {
    process.stderr.write([
      "Error: You must be on a MongoDB connector to generate an invite.",
      "First upgrade yourself: memflow join --uri <mongodb-uri>",
      "",
    ].join("\n"));
    return 1;
  }

  const payload: InvitePayload = {
    uri: config.mongo.uri,
    database: config.mongo.database ?? "memflow_default",
    collection: config.mongo.collection,
    maxPoolSize: config.mongo.maxPoolSize,
    minPoolSize: config.mongo.minPoolSize,
    connectTimeoutMs: config.mongo.connectTimeoutMs,
    socketTimeoutMS: config.mongo.socketTimeoutMS,
    waitQueueTimeoutMS: config.mongo.waitQueueTimeoutMS,
    team: config.tenant ?? "cpucoin",
    createdBy: config.user ?? process.env.USER ?? "admin",
    createdAt: new Date().toISOString(),
  };

  const token = buildInviteToken(payload);
  const maskedUri = config.mongo.uri.replace(/\/\/[^@]*@/, "//***@");

  process.stdout.write([
    "",
    "═══════════════════════════════════════════════════",
    "  MemFlow Team Invite",
    "═══════════════════════════════════════════════════",
    "",
    `Team:     ${payload.team}`,
    `Database: ${payload.database}`,
    `Server:   ${maskedUri}`,
    `Created:  ${payload.createdBy} at ${payload.createdAt}`,
    "",
    "───────────────────────────────────────────────────",
    "  INVITE TOKEN (share this with your team):",
    "───────────────────────────────────────────────────",
    "",
    token,
    "",
    "───────────────────────────────────────────────────",
    "  SETUP INSTRUCTIONS FOR NEW ENGINEERS:",
    "───────────────────────────────────────────────────",
    "",
    "1. Install MemFlow (if not already):",
    "   npm install -g memflow",
    "",
    "2. Join the shared database (one command):",
    `   memflow join --token ${token} --migrate`,
    "",
    "3. Restart MCP server and verify:",
    "   memflow mcp",
    "   memflow doctor",
    "",
    "Or use the raw MongoDB URI directly:",
    `   memflow join --uri '${config.mongo.uri}' --migrate`,
    "",
    "The --migrate flag exports your existing local SQLite data",
    "and imports it into the shared MongoDB instance.",
    "",
    "═══════════════════════════════════════════════════",
    "",
  ].join("\n"));

  return 0;
}

runCli()
  .then((code) => {
    process.exit(code ?? 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
