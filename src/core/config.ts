import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import type { MemFlowConfig, MemFlowMongoConfig, MemFlowTrackedProject } from "../types/memory.js";

const SUPPORTED_CONFIG_HOSTS = ["antigravity", "chatgpt", "claude-code", "codex", "vscode"] as const;

export interface ProjectCandidate {
  name: string;
  path: string;
  project: string;
  repo: string;
}

export function getProfileName(): string {
  return process.env.MEMFLOW_PROFILE?.trim() || "default";
}

export function getMemFlowHome(): string {
  return resolve(process.env.MEMFLOW_HOME ?? join(homedir(), ".memflow"));
}

export function getProfileConfigPath(profile: string = getProfileName()): string {
  if (profile === "default") {
    return join(getMemFlowHome(), "config.json");
  }
  return join(getMemFlowHome(), "profiles", `${profile}.json`);
}

export function getDefaultConfigPath(): string {
  return getProfileConfigPath(getProfileName());
}

export function getDefaultDatabasePath(profile: string = getProfileName()): string {
  if (profile === "default") {
    return join(getMemFlowHome(), "memflow.sqlite");
  }
  return join(getMemFlowHome(), "profiles", `${profile}.sqlite`);
}

export function getDefaultHostBootstrapPath(): string {
  return join(getMemFlowHome(), "host.json");
}

export function getDefaultHostIntegrationsPath(): string {
  return join(getMemFlowHome(), "integrations");
}

export function createDefaultConfig(): MemFlowConfig {
  return {
    version: "1",
    profile: getProfileName(),
    enabledHosts: [],
    onboarding: {},
    automation: {
      autoCompact: true,
      autoFinalize: true,
      autoPrepare: true,
      autoPromptCache: true,
      enabled: true,
      metrics: true,
    },
    connector: "sqlite",
    databasePath: getDefaultDatabasePath(),
    mongo: defaultMongoConfig(getProfileName()),
    trackedProjects: [],
    user: process.env.USER,
    workspace: process.cwd(),
    securitySweep: {
      enabled: true,
      level: "warn",
      rules: {
        privateKeys: true,
        apiKeys: true,
        databaseUris: true,
        pii: false,
      },
      trustedNamespaces: [],
    },
  };
}

function defaultMongoConfig(profile: string): MemFlowMongoConfig {
  return {
    database: `memflow_${profile}`,
  };
}

export function readMemFlowConfig(configPath: string = getDefaultConfigPath()): MemFlowConfig {
  if (!existsSync(configPath)) {
    return createDefaultConfig();
  }

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Partial<MemFlowConfig>;
  const defaults = createDefaultConfig();

  return {
    ...defaults,
    ...parsed,
    profile: parsed.profile ?? defaults.profile,
    mongo: {
      ...defaultMongoConfig(parsed.profile ?? defaults.profile ?? getProfileName()),
      ...(parsed.mongo ?? {}),
    },
    enabledHosts: Array.isArray(parsed.enabledHosts)
      ? parsed.enabledHosts.filter((host): host is (typeof SUPPORTED_CONFIG_HOSTS)[number] =>
          SUPPORTED_CONFIG_HOSTS.includes(String(host) as (typeof SUPPORTED_CONFIG_HOSTS)[number])
        )
      : defaults.enabledHosts,
    onboarding: {
      ...(defaults.onboarding ?? {}),
      ...(parsed.onboarding ?? {}),
    },
    trackedProjects: Array.isArray(parsed.trackedProjects)
      ? parsed.trackedProjects.map((project) => normalizeTrackedProject(project))
      : [],
    securitySweep: parsed.securitySweep
      ? {
          enabled: parsed.securitySweep.enabled ?? defaults.securitySweep!.enabled,
          level: parsed.securitySweep.level ?? defaults.securitySweep!.level,
          rules: {
            ...defaults.securitySweep!.rules,
            ...(parsed.securitySweep.rules ?? {}),
          },
          customPatterns: parsed.securitySweep.customPatterns ?? defaults.securitySweep!.customPatterns,
          trustedNamespaces: parsed.securitySweep.trustedNamespaces ?? defaults.securitySweep!.trustedNamespaces,
        }
      : defaults.securitySweep,
  };
}

export function writeMemFlowConfig(
  config: MemFlowConfig,
  configPath: string = getDefaultConfigPath()
 ): MemFlowConfig {
  const profile = config.profile ?? getProfileName();
  const normalized: MemFlowConfig = {
    ...createDefaultConfig(),
    ...config,
    profile,
    enabledHosts: [...(config.enabledHosts ?? [])].sort(),
    onboarding: {
      ...createDefaultConfig().onboarding,
      ...(config.onboarding ?? {}),
    },
    trackedProjects: [...config.trackedProjects]
      .map((project) => normalizeTrackedProject(project))
      .sort((left, right) => left.name.localeCompare(right.name)),
    securitySweep: config.securitySweep
      ? {
          enabled: config.securitySweep.enabled,
          level: config.securitySweep.level,
          rules: config.securitySweep.rules,
          customPatterns: config.securitySweep.customPatterns,
          trustedNamespaces: config.securitySweep.trustedNamespaces,
        }
      : undefined,
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function hasCompletedGuidedSetup(config: MemFlowConfig): boolean {
  return Boolean(config.onboarding?.completedAt);
}

export function discoverProjects(projectsRoot: string): ProjectCandidate[] {
  const root = canonicalizePath(projectsRoot);
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => resolve(root, entry.name))
    .filter((path) => existsSync(join(path, ".git")))
    .map((path) => {
      const name = basename(path);
      return {
        name,
        path,
        project: name,
        repo: name,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function normalizeTrackedProject(
  project: Partial<MemFlowTrackedProject> & Pick<MemFlowTrackedProject, "path">
): MemFlowTrackedProject {
  const name = project.name?.trim() || basename(project.path);
  const now = new Date().toISOString();
  const path = canonicalizePath(project.path);

  return {
    enabled: project.enabled ?? true,
    name,
    path,
    project: project.project?.trim() || name,
    repo: project.repo?.trim() || name,
    addedAt: project.addedAt ?? now,
    updatedAt: project.updatedAt ?? now,
  };
}

export function mergeTrackedProjects(
  current: MemFlowTrackedProject[],
  incoming: Array<Partial<MemFlowTrackedProject> & Pick<MemFlowTrackedProject, "path">>
): MemFlowTrackedProject[] {
  const index = new Map(current.map((project) => [canonicalizePath(project.path), project]));

  for (const candidate of incoming) {
    const normalized = normalizeTrackedProject(candidate);
    const existing = index.get(normalized.path);
    index.set(normalized.path, existing ? { ...existing, ...normalized, updatedAt: new Date().toISOString() } : normalized);
  }

  return [...index.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function setTrackedProjectEnabled(
  current: MemFlowTrackedProject[],
  projectPath: string,
  enabled: boolean
): MemFlowTrackedProject[] {
  const normalizedPath = resolve(projectPath);
  const canonicalPath = canonicalizePath(normalizedPath);

  return current.map((project) =>
    canonicalizePath(project.path) === canonicalPath
      ? {
          ...project,
          enabled,
          updatedAt: new Date().toISOString(),
        }
      : project
  );
}

export function findTrackedProjectForPath(
  trackedProjects: MemFlowTrackedProject[],
  path: string
): MemFlowTrackedProject | null {
  const resolved = canonicalizePath(path);
  const isMac = process.platform === "darwin";

  const matches = trackedProjects
    .filter((project) => {
      const projectPath = canonicalizePath(project.path);
      if (isMac) {
        const lowerResolved = resolved.toLowerCase();
        const lowerProjectPath = projectPath.toLowerCase();
        return lowerResolved === lowerProjectPath || lowerResolved.startsWith(`${lowerProjectPath}/`);
      }
      return resolved === projectPath || resolved.startsWith(`${projectPath}/`);
    })
    .sort((left, right) => right.path.length - left.path.length);

  return matches[0] ?? null;
}

function canonicalizePath(path: string): string {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    return resolved;
  }

  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function listProfileConfigs(): Array<{ profile: string; path: string }> {
  const configs: Array<{ profile: string; path: string }> = [];
  const home = getMemFlowHome();
  const defaultPath = join(home, "config.json");
  if (existsSync(defaultPath)) {
    configs.push({ profile: "default", path: defaultPath });
  }
  const profilesDir = join(home, "profiles");
  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        const profile = entry.name.replace(/\\.json$/, "");
        configs.push({ profile, path: join(profilesDir, entry.name) });
      }
    }
  }
  return configs;
}

export function effectiveConnectorDescriptor(
  config: MemFlowConfig,
  profile: string = getProfileName()
): { connector: "embedded"; target: string } | { connector: "sqlite"; target: string } | { connector: "mongodb"; target: string } {
  const connector = normalizeConnectorChoice(
    process.env.MEMFLOW_CONNECTOR ?? config.connector ?? "sqlite"
  );

  if (connector === "embedded") {
    return { connector: "embedded", target: `memory::${profile}` };
  }

  if (connector === "mongodb") {
    const mongoConfig: MemFlowMongoConfig = {
      ...defaultMongoConfig(profile),
      ...(config.mongo ?? {}),
    };
    const uri =
      process.env.MEMFLOW_MONGODB_URI ??
      process.env.MEMFLOW_MONGO_URI ??
      mongoConfig.uri ??
      "mongodb://127.0.0.1:27017";
    const database =
      process.env.MEMFLOW_MONGODB_DATABASE ??
      process.env.MEMFLOW_MONGO_DATABASE ??
      mongoConfig.database ??
      `memflow_${profile}`;
    return { connector: "mongodb", target: `${uri}::${database}` };
  }

  const databasePath =
    process.env.MEMFLOW_SQLITE_PATH ?? config.databasePath ?? getDefaultDatabasePath(profile);
  return { connector: "sqlite", target: canonicalizePath(databasePath) };
}

export function normalizeConnectorChoice(value: string): "embedded" | "sqlite" | "mongodb" {
  const normalized = value.toLowerCase().trim();
  if (normalized === "in-memory" || normalized === "memory") {
    return "embedded";
  }
  if (normalized === "embedded" || normalized === "mongodb" || normalized === "sqlite") {
    return normalized;
  }
  return "sqlite";
}

export function detectProfileCollisions(
  currentConfig: MemFlowConfig,
  currentProfile: string,
  currentConfigPath: string = getDefaultConfigPath()
): string[] {
  const collisions: string[] = [];
  const currentDescriptor = effectiveConnectorDescriptor(currentConfig, currentProfile);

  for (const candidate of listProfileConfigs()) {
    if (canonicalizePath(candidate.path) === canonicalizePath(currentConfigPath)) {
      continue;
    }
    const candidateConfig = readMemFlowConfig(candidate.path);
    const candidateDescriptor = effectiveConnectorDescriptor(candidateConfig, candidate.profile);
    if (
      candidateDescriptor.connector === currentDescriptor.connector &&
      candidateDescriptor.target === currentDescriptor.target
    ) {
      collisions.push(
        `Profile '${currentProfile}' shares ${currentDescriptor.connector} storage with profile '${candidate.profile}' at ${currentDescriptor.target}. Configure separate storage or change MEMFLOW_PROFILE.`
      );
    }
  }

  return collisions;
}
