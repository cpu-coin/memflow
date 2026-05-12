import type {
  MemoryCoordinates,
  MemoryEntry,
  MemorySyncPlanResult,
  MemorySyncPolicy,
  MemorySyncTarget,
  MemoryWriteInput,
} from "../types/memory.js";
import { compactDecision } from "../core/automation.js";

export type DeploymentScopeMode =
  | "org-shared"
  | "repo-shared"
  | "user-scoped"
  | "workspace-scoped";

export interface DeploymentScopeContext {
  actorId?: string;
  project?: string;
  repo?: string;
  tenant?: string;
  user?: string;
  workspace?: string;
}

export interface ScopedDeploymentConnectorConfig {
  connectorId: string;
  mode: DeploymentScopeMode;
  enforceTenant: boolean;
  enforceUser: boolean;
  requireWorkspace?: boolean;
}

export interface DeploymentScopeResolver {
  resolveCoordinates(
    coordinates: MemoryCoordinates,
    context: DeploymentScopeContext
  ): MemoryCoordinates;
}

export const DEFAULT_MEMORY_SYNC_POLICY: MemorySyncPolicy = {
  name: "memflow-default",
  defaultTarget: "shared",
  kindTargets: {
    cache: "local",
    session: "local",
  },
  scopeTargets: {
    project: "shared",
    repo: "shared",
    session: "local",
    team: "shared",
    user: "local",
    workspace: "local",
  },
};

export class DefaultDeploymentScopeResolver implements DeploymentScopeResolver {
  constructor(private readonly config: ScopedDeploymentConnectorConfig) {}

  resolveCoordinates(
    coordinates: MemoryCoordinates,
    context: DeploymentScopeContext
  ): MemoryCoordinates {
    const resolved: MemoryCoordinates = {
      ...coordinates,
      project: coordinates.project ?? context.project,
      repo: coordinates.repo ?? context.repo,
      tenant: this.config.enforceTenant ? (coordinates.tenant ?? context.tenant) : coordinates.tenant,
      user: this.config.enforceUser ? (coordinates.user ?? context.user) : coordinates.user,
      workspace: coordinates.workspace ?? context.workspace,
    };

    if (this.config.mode === "user-scoped" && !resolved.user) {
      throw new Error("Deployment-scoped connector requires a user scope");
    }

    if (this.config.requireWorkspace && !resolved.workspace) {
      throw new Error("Deployment-scoped connector requires a workspace scope");
    }

    return resolved;
  }
}

export function applyDeploymentScope(
  input: MemoryWriteInput,
  context: DeploymentScopeContext,
  resolver: DeploymentScopeResolver
): MemoryWriteInput {
  return {
    ...input,
    coordinates: resolver.resolveCoordinates(input.coordinates, context),
  };
}

export function resolveSyncTarget(
  entry: MemoryEntry,
  policy: MemorySyncPolicy = DEFAULT_MEMORY_SYNC_POLICY
): { reason: string; target: MemorySyncTarget } {
  const metadataTarget = entry.metadata.syncTarget;
  if (
    metadataTarget === "both" ||
    metadataTarget === "local" ||
    metadataTarget === "shared"
  ) {
    return {
      reason: "metadata.syncTarget override",
      target: metadataTarget,
    };
  }

  const kindTarget = policy.kindTargets?.[entry.kind];
  if (kindTarget) {
    return {
      reason: `kind:${entry.kind}`,
      target: kindTarget,
    };
  }

  const scopeTarget = policy.scopeTargets?.[entry.coordinates.scope];
  if (scopeTarget) {
    return {
      reason: `scope:${entry.coordinates.scope}`,
      target: scopeTarget,
    };
  }

  return {
    reason: "policy.defaultTarget",
    target: policy.defaultTarget,
  };
}

export function buildSyncPlan(
  entries: MemoryEntry[],
  policy: MemorySyncPolicy = DEFAULT_MEMORY_SYNC_POLICY
): MemorySyncPlanResult {
  let local = 0;
  let shared = 0;
  let both = 0;

  const decisions = entries.map((entry) => {
    const { reason, target } = resolveSyncTarget(entry, policy);
    if (target === "local") {
      local += 1;
    } else if (target === "shared") {
      shared += 1;
    } else {
      both += 1;
    }

    return compactDecision(entry, target, reason);
  });

  return {
    policy,
    total: entries.length,
    local,
    shared,
    both,
    decisions,
  };
}

export function filterEntriesForSyncTarget(
  entries: MemoryEntry[],
  target: Exclude<MemorySyncTarget, "both">,
  policy: MemorySyncPolicy = DEFAULT_MEMORY_SYNC_POLICY
): MemoryEntry[] {
  return entries.filter((entry) => {
    const decision = resolveSyncTarget(entry, policy);
    return decision.target === target || decision.target === "both";
  });
}
