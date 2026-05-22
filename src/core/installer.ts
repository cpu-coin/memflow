import { styleText } from "node:util";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";

import type { MemoryService } from "./memory-service.js";
import {
  createDefaultConfig,
  discoverProjects,
  mergeTrackedProjects,
  readMemFlowConfig,
  writeMemFlowConfig,
} from "./config.js";
import type {
  MemFlowConfig,
  MemFlowTrackedProject,
  MemoryEntry,
  MemorySyncPolicy,
} from "../types/memory.js";
import {
  detectLegacyRufloSetups,
  importLegacyRufloSetup,
  type LegacyRufloImportSummary,
  type LegacyRufloSetup,
} from "../migrations/memflow.js";
import {
  installShellPromptHook,
  type ShellPromptInstallResult,
} from "./shell.js";
import { writeHostBootstrap } from "./host.js";
import {
  formatHostReloadInstruction,
  installHostIntegration,
  SUPPORTED_HOSTS,
  type SupportedHost,
  writeHostIntegration,
} from "./integrations.js";

function emphasize(value: string): string {
  return process.stdout.isTTY ? styleText("bold", value) : value;
}

function divider(): string {
  return `${"-".repeat(54)}\n`;
}

function section(title: string, lines: string[] = []): string {
  return [divider(), emphasize(title), ...(lines.length > 0 ? ["", ...lines] : []), ""].join("\n");
}

function renderStartupBanner(): string {
  return [
    "CCCCCCC   PPPPPPP   UU   UU",
    "CC        PP   PP   UU   UU",
    "CC        PPPPPPP   UU   UU",
    "CC        PP        UU   UU",
    "CCCCCCC   PP         UUUUU ",
    "",
    "CCCCCCC    OOOOO    IIIII   NN   NN",
    "CC        OO   OO     I     NNN  NN",
    "CC        OO   OO     I     NN N NN",
    "CC        OO   OO     I     NN  NNN",
    "CCCCCCC    OOOOO    IIIII   NN   NN",
    "",
    "CPUcoin x MemFlow",
    "",
  ].join("\n");
}

function renderProjectList(projects: MemFlowTrackedProject[]): string {
  return projects
    .map((project, index) => {
      const state = project.enabled ? emphasize("ON") : "off";
      return `${index + 1}. [${state}] ${project.name}  ${project.path}`;
    })
    .join("\n");
}

function parseToggleInput(input: string, total: number): number[] {
  const value = input.trim().toLowerCase();
  if (!value || value === "done") {
    return [];
  }

  if (value === "all") {
    return Array.from({ length: total }, (_, index) => index);
  }

  if (value === "none") {
    return Array.from({ length: total }, (_, index) => index);
  }

  return value
    .split(",")
    .flatMap((part) => {
      const match = part.trim().match(/^(\d+)-(\d+)$/);
      if (match) {
        const start = Number(match[1]);
        const end = Number(match[2]);
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        return Array.from({ length: max - min + 1 }, (_, offset) => min + offset - 1);
      }

      const single = Number(part.trim());
      return Number.isInteger(single) ? [single - 1] : [];
    })
    .filter((index) => index >= 0 && index < total);
}

function applyToggleSelection(
  projects: MemFlowTrackedProject[],
  input: string
): MemFlowTrackedProject[] {
  const value = input.trim().toLowerCase();
  if (value === "all") {
    return projects.map((project) => ({ ...project, enabled: true }));
  }
  if (value === "none") {
    return projects.map((project) => ({ ...project, enabled: false }));
  }

  const indices = new Set(parseToggleInput(input, projects.length));
  if (indices.size === 0) {
    return projects;
  }

  return projects.map((project, index) =>
    indices.has(index) ? { ...project, enabled: !project.enabled } : project
  );
}

function renderHostList(selected: SupportedHost[]): string {
  return SUPPORTED_HOSTS
    .map((host, index) => {
      const enabled = selected.includes(host);
      const state = enabled ? emphasize("ON") : "off";
      return `${index + 1}. [${state}] ${host}`;
    })
    .join("\n");
}

function parseHostSelection(input: string): SupportedHost[] {
  const value = input.trim().toLowerCase();
  if (!value || value === "done") {
    return [];
  }

  if (value === "all") {
    return [...SUPPORTED_HOSTS];
  }

  if (value === "none") {
    return [];
  }

  const selected = new Set<SupportedHost>();
  for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    const numeric = Number(part);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= SUPPORTED_HOSTS.length) {
      selected.add(SUPPORTED_HOSTS[numeric - 1]);
      continue;
    }

    if (SUPPORTED_HOSTS.includes(part as SupportedHost)) {
      selected.add(part as SupportedHost);
    }
  }

  return [...selected];
}

type DeveloperSurface = "ide" | "cli" | "ci";

function renderSurfaceList(selected: DeveloperSurface[]): string {
  return [
    { label: "IDE setup", value: "ide" as const },
    { label: "CLI availability", value: "cli" as const },
    { label: "CI bootstrap", value: "ci" as const },
  ]
    .map((item, index) => {
      const enabled = selected.includes(item.value);
      const state = enabled ? emphasize("ON") : "off";
      return `${index + 1}. [${state}] ${item.label}`;
    })
    .join("\n");
}

function parseSurfaceSelection(input: string): DeveloperSurface[] {
  const value = input.trim().toLowerCase();
  if (!value || value === "done") {
    return [];
  }

  if (value === "all") {
    return ["ide", "cli", "ci"];
  }

  if (value === "none") {
    return [];
  }

  const selected = new Set<DeveloperSurface>();
  for (const part of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    const numeric = Number(part);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 3) {
      selected.add(["ide", "cli", "ci"][numeric - 1] as DeveloperSurface);
      continue;
    }

    if (part === "ide" || part === "cli" || part === "ci") {
      selected.add(part);
    }
  }

  return [...selected];
}

function buildSkippedShellPromptResult(): ShellPromptInstallResult {
  return {
    installed: false,
    requiresRestart: false,
    shell: "unsupported",
  };
}

async function seedTrackedProjects(
  service: MemoryService,
  config: MemFlowConfig
): Promise<{ entries: MemoryEntry[]; syncPolicy: MemorySyncPolicy }> {
  const entries: MemoryEntry[] = [];
  let syncPolicy: MemorySyncPolicy | null = null;

  for (const project of config.trackedProjects) {
    await service.registerTrackedProject({
      ...project,
      source: "system",
      tenant: config.tenant,
      user: config.user,
      workspace: config.workspace,
    });

    if (!project.enabled) {
      continue;
    }

    const initialized = await service.initializeDefaults({
      project: project.project,
      repo: project.repo,
      tenant: config.tenant,
      user: config.user,
      workspace: project.path,
      source: "system",
    });

    entries.push(...initialized.entries);
    syncPolicy = initialized.syncPolicy;
  }

  return {
    entries,
    syncPolicy: syncPolicy ?? {
      name: "memflow-default",
      defaultTarget: "shared",
    },
  };
}

export async function runGuidedInstall(
  service: MemoryService,
  configPath?: string
): Promise<{
  automationConfigured: boolean;
  config: MemFlowConfig;
  connectorHealth: Awaited<ReturnType<MemoryService["health"]>>;
  embeddingsBackfilled: number;
  entries: MemoryEntry[];
  activationResumeCommand?: string;
  hostBootstrapPath: string;
  hostInstalls: ReturnType<typeof installHostIntegration>[];
  hostIntegrations: ReturnType<typeof writeHostIntegration>[];
  legacyImports: LegacyRufloImportSummary[];
  projectsDiscovered: number;
  shellPrompt: ShellPromptInstallResult;
  syncPolicy: MemorySyncPolicy;
}> {
  const existing = readMemFlowConfig(configPath);
  const defaults = createDefaultConfig();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    process.stdout.write(
      [
        renderStartupBanner(),
        section("MemFlow Guided Setup", [
          "MemFlow stores verified project context so agents stop asking for the same setup repeatedly.",
          "The goal is simple: save tokens, save time, and reduce avoidable rework across sessions and developers.",
          `Local database: ${existing.databasePath ?? defaults.databasePath}`,
          `Config file: ${configPath ?? "default ~/.memflow/config.json"}`,
          "This setup can also enable automatic recovery, recall, prompt caching, session compaction, live savings metrics, and default pattern/persona promotion.",
        ]),
      ].join("\n")
    );

    const projectsRootAnswer = await rl.question(
      `Base folder that contains your projects [${existing.projectsRoot ?? process.cwd()}]: `
    );
    const projectsRoot = (projectsRootAnswer.trim() || existing.projectsRoot || process.cwd()).trim();
    const discoveredCandidates = discoverProjects(projectsRoot);
    const detectedLegacy = detectLegacySetups([
      process.cwd(),
      projectsRoot,
      ...discoveredCandidates.map((project) => project.path),
    ]);
    let legacyImports: LegacyRufloImportSummary[] = [];

    if (detectedLegacy.length > 0) {
      process.stdout.write(
        section("Legacy Import", [
          "Legacy RuFlo data detected.",
          `Found ${detectedLegacy.length} legacy RuFlo location${detectedLegacy.length === 1 ? "" : "s"}:`,
          ...detectedLegacy.map((setup, index) => `${index + 1}. ${setup.cwd}`),
          "MemFlow can pull the existing RuFlo memory and learned pattern records into the new local database now.",
          "This imports database data only so you can keep moving without dragging old setup metadata forward by default.",
        ])
      );

      const importAnswer = await rl.question("Import legacy RuFlo database data now? [y/N]: ");
      const shouldImport = /^(y|yes)$/i.test(importAnswer.trim());
      if (shouldImport) {
        for (const setup of detectedLegacy) {
          legacyImports.push(
            await importLegacyRufloSetup(service.getConnector(), setup.cwd, {
              includeSetupSnapshot: false,
            })
          );
        }
        const importedEntries = legacyImports.reduce(
          (total, summary) => total + summary.importedEntries,
          0
        );
        const importedPatterns = legacyImports.reduce(
          (total, summary) => total + summary.importedPatterns,
          0
        );
        process.stdout.write(
          section("Legacy Import Complete", [
            `Imported ${importedEntries} legacy memory entries and ${importedPatterns} legacy patterns from ${legacyImports.length} legacy location${legacyImports.length === 1 ? "" : "s"}.`,
          ])
        );
      }
    } else {
      process.stdout.write(
        section("Legacy Import", [
          "No new imports, or ruflo databases detected.",
          `Checked from: ${resolve(process.cwd())}`,
          `Checked from projects root: ${resolve(projectsRoot)}`,
          `Scanned candidate project folders: ${discoveredCandidates.length}`,
          "Run `node dist/cli.js migrate:ruflo --path /path/to/legacy/ruflo/project` if your old RuFlo database lives somewhere else.",
        ])
      );
    }

    let discovered = discoveredCandidates.map((project) => ({
      ...project,
      enabled:
        existing.trackedProjects.find((tracked) => tracked.path === project.path)?.enabled ?? false,
      addedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    if (discovered.length === 0) {
      process.stdout.write(
        section("Project Discovery", [
          "No git repositories were found directly under that folder. MemFlow will still save the base path, and you can add projects later.",
        ])
      );
    } else {
      process.stdout.write(
        section("Project Discovery", [
          "Select which projects MemFlow should track automatically.",
          "Tracked projects keep reusable context, compact session state, and validated patterns so the same requests do not keep coming back.",
          'Type a project number such as `1` to switch it on or off.',
          'You can also enter `1,3` or `2-5` to toggle several at once.',
          'Use `all` to switch every project on, `none` to switch every project off, or `done` to continue.',
        ])
      );

      while (true) {
        process.stdout.write(`${renderProjectList(discovered)}\n`);
        const answer = await rl.question("Toggle projects [done]: ");
        const normalized = answer.trim().toLowerCase();
        if (!normalized || normalized === "done") {
          break;
        }
        discovered = applyToggleSelection(discovered, normalized);
        process.stdout.write("\n");
      }
    }

    const config = writeMemFlowConfig(
      {
        ...existing,
        automation: {
          ...defaults.automation,
          ...existing.automation,
        },
        projectsRoot,
        connector: existing.connector ?? "sqlite",
        databasePath: existing.databasePath ?? defaults.databasePath,
        user: existing.user ?? process.env.USER,
        workspace: existing.workspace ?? process.cwd(),
        trackedProjects: mergeTrackedProjects(existing.trackedProjects, discovered),
      },
      configPath
    );

    process.stdout.write(
      section("Automation Options", [
        "MemFlow can automatically prepare prior context, recover prior state, reuse prompt cache, compact sessions, collect savings metrics, and keep the pattern/persona defaults active.",
      ])
    );
    const automationAnswer = await rl.question(
      `Enable automatic memory hooks for tracked projects? [${config.automation.enabled ? "Y/n" : "y/N"}]: `
    );
    const enableAutomation =
      automationAnswer.trim() === ""
        ? config.automation.enabled
        : /^(y|yes)$/i.test(automationAnswer.trim());

    process.stdout.write(
      section("Security and Privacy Sweep", [
        "MemFlow includes an automatic security sweep that blocks or redacts credentials (API keys, private keys, database passwords) before they are stored or leaked to external AI models.",
        "It can also detect PII (Social Security Numbers, Credit Cards, Emails). Since email scanning can sometimes flag standard code addresses, PII scanning is off by default.",
      ])
    );
    const piiDefault = existing.securitySweep?.rules?.pii ?? false;
    const piiAnswer = await rl.question(
      `Enable automatic PII (emails, SSNs, credit cards) detection? [${piiDefault ? "Y/n" : "y/N"}]: `
    );
    const enablePii =
      piiAnswer.trim() === ""
        ? piiDefault
        : /^(y|yes)$/i.test(piiAnswer.trim());

    const nextConfig = writeMemFlowConfig(
      {
        ...config,
        automation: {
          autoCompact: enableAutomation,
          autoFinalize: enableAutomation,
          autoPrepare: enableAutomation,
          autoPromptCache: enableAutomation,
          enabled: enableAutomation,
          metrics: enableAutomation,
        },
        securitySweep: {
          ...(config.securitySweep ?? { enabled: true, level: "warn" }),
          rules: {
            ...(config.securitySweep?.rules ?? { privateKeys: true, apiKeys: true, databaseUris: true }),
            pii: enablePii,
          },
        },
      },
      configPath
    );

    const seeded = await seedTrackedProjects(service, nextConfig);
    const embeddingBackfill = await service.backfillEmbeddings();
    const connectorHealth = await service.health();
    const hostBootstrap = writeHostBootstrap(configPath);
    const onboardingCompletedAt = new Date().toISOString();

    const defaultSurfaces: DeveloperSurface[] = ["ide", "cli", "ci"];
    process.stdout.write(
      section("CPUcoin / MemFlow Startup", [
        "This guided startup is the comprehensive path for developers joining a CPUcoin / MemFlow workspace.",
        "It steps through project discovery, automation, IDE setup, CLI availability, and CI bootstrap so the install is not silently skipped.",
        "Use `all`, `none`, `1,2,3`, or `done` when selecting developer surfaces.",
      ])
    );
    process.stdout.write(`${renderSurfaceList(defaultSurfaces)}\n`);
    const surfaceAnswer = await rl.question("Prepare developer surfaces [all]: ");
    const selectedSurfaces: DeveloperSurface[] = surfaceAnswer.trim()
      ? parseSurfaceSelection(surfaceAnswer)
      : defaultSurfaces;
    const shouldPrepareIde = selectedSurfaces.includes("ide");
    const shouldPrepareCli = selectedSurfaces.includes("cli");
    const shouldPrepareCi = selectedSurfaces.includes("ci");

    let selectedHosts: SupportedHost[] = [...(existing.enabledHosts ?? [])];
    let hostInstalls: ReturnType<typeof installHostIntegration>[] = [];
    let hostIntegrations: ReturnType<typeof writeHostIntegration>[] = [];

    if (shouldPrepareIde) {
      process.stdout.write(
        section("IDE Integrations", [
          "MemFlow can generate and install integrations for the supported IDE and agent clients, including ChatGPT / OpenAI desktop connector drafts when a remote MCP URL is available.",
          "Choose which clients to prepare now. Type numbers like `1` or names like `codex`.",
          "Use `all`, `none`, or `done` to continue.",
        ])
      );
      const hostDefaultSelection = selectedHosts.length > 0 ? selectedHosts : [...SUPPORTED_HOSTS];
      process.stdout.write(`${renderHostList(hostDefaultSelection)}\n`);
      const hostAnswer = await rl.question("Enable IDE/client integrations [all]: ");
      selectedHosts = hostAnswer.trim() ? parseHostSelection(hostAnswer) : [...SUPPORTED_HOSTS];
      hostInstalls = selectedHosts.map((host) => installHostIntegration(host, configPath));
      hostIntegrations = hostInstalls.map((item) => item.generated);

      if (hostInstalls.length > 0) {
        process.stdout.write(
          section(
            "IDE Integration Results",
            hostInstalls.flatMap((result) => {
              const headline =
                result.mode === "automatic"
                  ? `${result.host}: installed automatically`
                  : result.mode === "partial"
                    ? `${result.host}: partially installed`
                    : `${result.host}: generated for review`;
              const details = [...result.actions, ...result.notes].map((line) => `- ${line}`);
              return [headline, ...(details.length > 0 ? details : ["- no additional details"])];
            })
          )
        );
      }
    }

    const shellPrompt = shouldPrepareCli ? installShellPromptHook() : buildSkippedShellPromptResult();
    const activationResumeCommand =
      shellPrompt.requiresRestart || hostInstalls.some((install) => install.applied)
        ? `memflow recover --sessionId post-install-activation`
        : undefined;

    if (shouldPrepareCli) {
      process.stdout.write(
        section("CLI Availability", [
          "MemFlow can make the `memflow` command available everywhere on the machine by linking the package globally.",
          "Use `npm link`, `pnpm link --global`, or `yarn link` after build if you want a system-wide binary.",
          "If you prefer not to link globally, keep using `npx memflow ...` or `npm exec memflow -- ...`.",
        ])
      );
    } else {
      process.stdout.write(
        section("CLI Availability", [
          "CLI shell hooks were skipped during startup.",
          "You can enable them later with `memflow init` or by rerunning the guided setup.",
        ])
      );
    }

    if (shouldPrepareCi) {
      process.stdout.write(
        section("CI Bootstrap", [
          "MemFlow writes a host bootstrap contract that CI and non-interactive shells can consume.",
          "Run `memflow ci:env` to print the PATH and shim guidance for pipelines or other machines.",
          "If you are shipping a shared workspace, reuse the same connector settings and config profile in CI.",
        ])
      );
    } else {
      process.stdout.write(
        section("CI Bootstrap", [
          "CI bootstrap was skipped during this pass.",
          "MemFlow can still generate the shared bootstrap contract later from `memflow host:bootstrap`.",
        ])
      );
    }

    const finalConfig = writeMemFlowConfig(
      {
        ...nextConfig,
        onboarding: {
          ...(nextConfig.onboarding ?? {}),
          completedAt: onboardingCompletedAt,
          lastPromptedAt: onboardingCompletedAt,
        },
        activation: {
          activationSessionId: activationResumeCommand ? "post-install-activation" : undefined,
          completedHosts: [...selectedHosts],
          lastUpdatedAt: new Date().toISOString(),
          pendingHosts: hostInstalls.filter((install) => !install.applied).map((install) => install.host),
          shellPending: shellPrompt.requiresRestart,
        },
        enabledHosts: shouldPrepareIde ? [...selectedHosts] : [...(nextConfig.enabledHosts ?? [])],
      },
      configPath
    );

    if (activationResumeCommand) {
      await service.compactSession({
        sessionId: "post-install-activation",
        coordinates: {
          namespace: "sessions",
          project: nextConfig.trackedProjects.find((project) => project.enabled)?.project ?? "memflow",
          repo: nextConfig.trackedProjects.find((project) => project.enabled)?.repo ?? "memflow",
          scope: "workspace",
          tenant: nextConfig.tenant,
          user: nextConfig.user,
          workspace: nextConfig.workspace ?? process.cwd(),
        },
        goal: "Finish MemFlow activation after reload",
        summary:
          "MemFlow installation finished and saved a reload handoff so the current working context is not lost during shell or client restarts.",
        nextStep:
          "Reload the terminal and enabled clients, then resume the saved post-install activation state.",
        activeFiles: [],
        activeTodos: [
          "Reload the active shell or terminal window",
          "Reload enabled agent clients",
          "Confirm MemFlow status is visible",
        ],
        source: "system",
      });
    }

    process.stdout.write(
      section("Post-Install Checks", [
        `Local connector: ${connectorHealth.ok ? "ready" : "not ready"} (${connectorHealth.name})`,
        `Tracked projects configured: ${finalConfig.trackedProjects.filter((project) => project.enabled).length}`,
        `Host bootstrap written: ${hostBootstrap.paths.hostBootstrap}`,
        activationResumeCommand
          ? `Reload handoff saved: ${activationResumeCommand}`
          : "Reload handoff saved: not needed",
      ])
    );

    return {
      automationConfigured: enableAutomation,
      config: finalConfig,
      connectorHealth,
      embeddingsBackfilled: embeddingBackfill.updated,
      entries: seeded.entries,
      activationResumeCommand,
      hostBootstrapPath: hostBootstrap.paths.hostBootstrap,
      hostInstalls,
      hostIntegrations,
      legacyImports,
      projectsDiscovered: discovered.length,
      shellPrompt,
      syncPolicy: seeded.syncPolicy,
    };
  } finally {
    rl.close();
  }
}

function detectLegacySetups(paths: string[]): LegacyRufloSetup[] {
  return detectLegacyRufloSetups(paths.map((path) => resolve(path)));
}

export function formatGuidedInstallSummary(result: {
  automationConfigured: boolean;
  config: MemFlowConfig;
  connectorHealth: Awaited<ReturnType<MemoryService["health"]>>;
  embeddingsBackfilled: number;
  entries: MemoryEntry[];
  activationResumeCommand?: string;
  hostBootstrapPath: string;
  hostInstalls: ReturnType<typeof installHostIntegration>[];
  hostIntegrations: ReturnType<typeof writeHostIntegration>[];
  legacyImports: LegacyRufloImportSummary[];
  projectsDiscovered: number;
  shellPrompt: ShellPromptInstallResult;
  syncPolicy: MemorySyncPolicy;
}): string {
  const enabledProjects = result.config.trackedProjects.filter((project) => project.enabled);
  const disabledProjects = result.config.trackedProjects.filter((project) => !project.enabled);
  const importedEntries = result.legacyImports.reduce(
    (total, summary) => total + summary.importedEntries,
    0
  );
  const importedPatterns = result.legacyImports.reduce(
    (total, summary) => total + summary.importedPatterns,
    0
  );

  return [
    "",
    divider(),
    emphasize("Installation Complete"),
    "",
    "MemFlow finished the guided setup and wrote the local configuration, storage, memory defaults, and client integration artifacts.",
    "",
    "Installed and configured:",
    `- Projects root: ${result.config.projectsRoot ?? "(not set)"}`,
    `- Local database: ${result.config.databasePath}`,
    `- Local connector health: ${result.connectorHealth.ok ? "ready" : "not ready"} (${result.connectorHealth.name})`,
    `- Tracked projects: ${enabledProjects.length} enabled, ${disabledProjects.length} disabled`,
    `- Seeded records: ${result.entries.length}`,
    `- Vector-ready records refreshed: ${result.embeddingsBackfilled}`,
    `- Automatic recovery/recall/cache: ${result.automationConfigured ? "enabled" : "not enabled"}`,
    `- Host bootstrap: ${result.hostBootstrapPath}`,
    `- Enabled clients: ${result.hostIntegrations.length > 0 ? result.hostIntegrations.map((item) => item.host).join(", ") : "none"}`,
    result.shellPrompt.installed && result.shellPrompt.rcPath
      ? `- Shell indicator: installed in ${result.shellPrompt.rcPath}`
      : "- Shell indicator: not installed automatically",
    result.legacyImports.length > 0
      ? `- Legacy RuFlo import: ${importedEntries} memory entries, ${importedPatterns} patterns from ${result.legacyImports.length} location${result.legacyImports.length === 1 ? "" : "s"}`
      : "- Legacy RuFlo import: not run",
    "",
    "Enabled projects:",
    enabledProjects.length > 0
      ? enabledProjects.map((project) => `- ${project.name}  ${project.path}`).join("\n")
      : "- none",
    "",
    "Client installation results:",
    result.hostInstalls.length > 0
      ? result.hostInstalls
          .map(
            (install) =>
              `- ${install.host}: ${install.mode}${install.targets.length > 0 ? ` (${install.targets.join(", ")})` : ""}`
          )
          .join("\n")
      : "- none",
    "",
    "What happens next:",
    "1. MemFlow is ready locally. Config, local storage, tracked projects, embeddings, and selected client artifacts are already in place.",
    "2. Reload each active terminal or agent session so shell and client config changes can begin taking effect and the `memflow` shell command becomes available.",
    result.automationConfigured
      ? "3. Once your host reloads, MemFlow can prepare prior context, recover prior state, reuse prompt cache, compact sessions, promote repeat-fix patterns, and track savings automatically."
      : "3. Automation hooks were not enabled. You can still use `recover`, `recall`, `metrics`, `savings`, `checkpoint`, `resume`, and `promote:pattern` manually.",
    result.shellPrompt.installed && result.shellPrompt.requiresRestart
      ? `4. For this terminal, run ${emphasize(`\`${result.shellPrompt.activationCommand ?? "source your shell rc file"}\``)} and then press Enter. The prompt should start showing \`MemFlow:On ...\`.`
      : "4. Shell indicator install was skipped; run `node dist/cli.js status:line` manually if needed.",
    result.hostInstalls.length > 0
      ? [
          "5. Reload the enabled clients so their new MemFlow configuration is picked up:",
          ...result.hostInstalls.map(
            (install) => `   ${install.host}: ${formatHostReloadInstruction(install.host as SupportedHost)}`
          ),
        ].join("\n")
      : "5. Generate a host integration later with `connect:codex`, `connect:openai`, `connect:chatgpt`, `connect:openai-desktop`, `connect:claude-code`, `connect:claude`, `connect:antigravity`, or `connect:vscode`.",
    result.activationResumeCommand
      ? `6. After reloading, resume the saved handoff with \`${result.activationResumeCommand}\` so the current installation context is restored.`
      : "6. No reload handoff was needed for this install.",
    "7. Use `memflow doctor`, `memflow status`, `memflow metrics`, and `memflow savings` if you want a quick operational check.",
    "",
  ].join("\n");
}
