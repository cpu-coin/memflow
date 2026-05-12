import { randomUUID } from "node:crypto";

import {
  buildCheckpointContent,
  buildCompactionContent,
  buildInitEntryTemplates,
  buildOperationalMetricKey,
  buildPatternContent,
  buildPatternKey,
  buildPromptCacheKey,
  buildTrackedProjectKey,
  buildProfileKey,
  buildSessionKey,
  byUpdatedAtDesc,
  CACHE_NAMESPACE,
  METRICS_NAMESPACE,
  PATTERN_NAMESPACE,
  PROFILE_NAMESPACE,
  PROJECTS_NAMESPACE,
  SESSION_NAMESPACE,
  WORKFLOW_NAMESPACE,
} from "./automation.js";
import { InvalidMemoryInputError } from "./errors.js";
import { createMemoryEntry } from "./entry.js";
import {
  buildSyncPlan,
  DEFAULT_MEMORY_SYNC_POLICY,
  filterEntriesForSyncTarget,
} from "../connectors/deployment.js";
import {
  cosineSimilarity,
  LocalEmbeddingProvider,
  shouldAutoEmbed,
  type EmbeddingProvider,
} from "./embedding.js";
import {
  collectDependencySnapshot,
  dependencyMetadata,
  dependencyTags,
  dependencyWarningsForEntry,
} from "./dependencies.js";
import { buildOperationalSavingsEstimate } from "./savings.js";
import type { DatabaseConnector } from "../connectors/types.js";
import { MEMFLOW_EMBEDDING_VERSION_NONE } from "../types/memory.js";
import type {
  AgentMemoryFinalizeInput,
  AgentMemoryFinalizeResult,
  AgentMemoryPrepareInput,
  AgentMemoryPrepareResult,
  EmbeddingBackfillResult,
  MemoryDeleteResult,
  MemoryDiffResult,
  MemoryCoordinates,
  MemoryEntry,
  MemoryExportBundle,
  MemoryImportResult,
  MemFlowInitInput,
  MemFlowInitResult,
  MemoryQuery,
  PromptCacheAutoGetInput,
  PromptCacheAutoStoreInput,
  PromptCacheInvalidateInput,
  PromptCacheInvalidateResult,
  PromptCacheQuery,
  PromptCacheStoreInput,
  MemorySyncPlanResult,
  MemorySyncPolicy,
  MemorySyncTarget,
  MemoryStats,
  OperationalMetricsQuery,
  OperationalMetricsSnapshot,
  MemoryUpdateInput,
  MemoryWriteInput,
  MemFlowTrackedProject,
  PatternPromotionInput,
  ProfileBlockInput,
  ProfileQuery,
  SearchResult,
  SessionCheckpointInput,
  SessionCompactionInput,
  SessionCompactionResult,
  SessionResumeQuery,
  SessionResumeResult,
} from "../types/memory.js";

export class MemoryService {
  constructor(
    private readonly connector: DatabaseConnector,
    private readonly embeddingProvider: EmbeddingProvider = new LocalEmbeddingProvider()
  ) {}

  getConnector(): DatabaseConnector {
    return this.connector;
  }

  async close(): Promise<void> {
    await this.connector.close();
  }

  async delete(id: string): Promise<MemoryDeleteResult> {
    this.assertId(id);
    return this.connector.delete(id);
  }

  async diff(bundle: MemoryExportBundle): Promise<MemoryDiffResult> {
    this.assertBundle(bundle);
    return this.connector.diff(bundle);
  }

  async export(query?: MemoryQuery): Promise<MemoryExportBundle> {
    return this.connector.export(query);
  }

  async get(id: string): Promise<MemoryEntry | null> {
    this.assertId(id);
    const entry = await this.connector.get(id);
    return entry ? this.decorateEntry(entry) : null;
  }

  async health() {
    return this.connector.health();
  }

  async import(bundle: MemoryExportBundle): Promise<MemoryImportResult> {
    this.assertBundle(bundle);
    return this.connector.import(bundle);
  }

  async list(query?: MemoryQuery): Promise<MemoryEntry[]> {
    const normalized = this.normalizeQuery(query);
    const entries = await this.connector.list(normalized);
    return entries.map((entry) => this.decorateEntry(entry, normalized?.workspace));
  }

  async merge(bundle: MemoryExportBundle): Promise<MemoryImportResult> {
    this.assertBundle(bundle);
    return this.connector.merge(bundle);
  }

  async search(query: MemoryQuery): Promise<SearchResult[]> {
    const normalized = this.normalizeQuery(query) ?? {};
    const lexical = (await this.connector.search(normalized)).map((result) => ({
      entry: this.decorateEntry(result.entry, normalized.workspace),
      score: result.score,
    }));

    if (!normalized.text?.trim()) {
      return lexical;
    }

    const semantic = await this.semanticSearch(normalized);
    return mergeSearchResults(lexical, semantic, normalized.limit ?? 10);
  }

  async stats(): Promise<MemoryStats> {
    return this.connector.stats();
  }

  async metrics(query: OperationalMetricsQuery = {}): Promise<OperationalMetricsSnapshot> {
    const entries = await this.list({
      namespace: METRICS_NAMESPACE,
      project: query.project,
      repo: query.repo,
      scope: query.scope,
      tenant: query.tenant,
      user: query.user,
      workspace: query.workspace,
      kind: "knowledge",
      limit: query.limit ?? 200,
      includeExpired: true,
    });

    const cutoff = Date.now() - (query.days ?? 7) * 24 * 60 * 60 * 1000;
    const recentEntries = entries.filter((entry) => Date.parse(entry.updatedAt) >= cutoff);
    const totals: Record<string, number> = {};

    for (const entry of recentEntries) {
      const metric =
        typeof entry.metadata.metric === "string" ? entry.metadata.metric : entry.key;
      const count = Number(entry.metadata.count ?? 0);
      totals[metric] = (totals[metric] ?? 0) + count;
    }

    const cacheEntries = (await this.list({
      namespace: CACHE_NAMESPACE,
      project: query.project,
      repo: query.repo,
      scope: query.scope,
      tenant: query.tenant,
      user: query.user,
      workspace: query.workspace,
      kind: "cache",
      limit: query.limit ?? 500,
      includeExpired: true,
    }))
      .filter((entry) => entry.tags.includes("prompt-cache"))
      .filter((entry) => Date.parse(entry.updatedAt) >= cutoff);

    const compactedEntries = (await this.list({
      namespace: CACHE_NAMESPACE,
      project: query.project,
      repo: query.repo,
      scope: query.scope,
      tenant: query.tenant,
      user: query.user,
      workspace: query.workspace,
      kind: "cache",
      limit: query.limit ?? 500,
      includeExpired: true,
    }))
      .filter((entry) => entry.tags.includes("compacted"))
      .filter((entry) => Date.parse(entry.updatedAt) >= cutoff);

    const sharedReusableEntries = (await this.list({
      project: query.project,
      repo: query.repo,
      tenant: query.tenant,
      kind: undefined,
      limit: query.limit ?? 500,
      includeExpired: true,
    }))
      .filter((entry) =>
        ["knowledge", "pattern", "persona", "workflow"].includes(entry.kind) &&
        ["project", "repo", "team"].includes(entry.coordinates.scope)
      )
      .filter((entry) => Date.parse(entry.updatedAt) >= cutoff).length;

    return {
      estimate: buildOperationalSavingsEstimate({
        cacheEntries,
        compactedEntries,
        sharedReusableEntries,
        totals,
      }),
      generatedAt: new Date().toISOString(),
      recent: recentEntries
        .sort(byUpdatedAtDesc)
        .slice(0, query.limit ?? 50)
        .map((entry) => ({
          count: Number(entry.metadata.count ?? 0),
          key: entry.key,
          metric: String(entry.metadata.metric ?? entry.key),
          project: entry.coordinates.project,
          repo: entry.coordinates.repo,
          scope: entry.coordinates.scope,
          updatedAt: entry.updatedAt,
          user: entry.coordinates.user,
        })),
      totals,
    };
  }

  async backfillEmbeddings(query?: MemoryQuery): Promise<EmbeddingBackfillResult> {
    const entries = await this.list({
      ...(query ?? {}),
      limit: query?.limit ?? 500,
      includeExpired: true,
    });

    let updated = 0;

    for (const entry of entries) {
      const ensured = this.ensureEmbedding(entry);
      if (!ensured || sameEmbedding(entry, ensured)) {
        continue;
      }

      await this.update(entry.id, {
        embedding: ensured.embedding,
        embeddingVersion: ensured.embeddingVersion,
      });
      updated += 1;
    }

    if (updated > 0) {
      await this.recordOperationalMetric({
        coordinates: resolveMetricsCoordinatesFromQuery(query),
        metric: "embedding_backfill",
        delta: updated,
      });
    }

    return {
      scanned: entries.length,
      updated,
    };
  }

  async storePromptCache(input: PromptCacheStoreInput): Promise<MemoryEntry> {
    this.assertCoordinates(input.coordinates);

    return this.upsert({
      key: input.key,
      title: input.title ?? input.key,
      content: input.content,
      coordinates: {
        ...input.coordinates,
        namespace: input.coordinates.namespace,
      },
      kind: "cache",
      tags: Array.from(new Set(["cache", ...(input.tags ?? [])])),
      metadata: {
        cache: true,
        schemaVersion: input.schemaVersion,
        ...input.metadata,
      },
      source: input.source,
      provenance: {
        source: input.source === "system" ? "system" : "manual",
      },
      confidence: input.confidence,
      embeddingVersion: input.embeddingVersion,
    });
  }

  async getPromptCache(query: PromptCacheQuery): Promise<MemoryEntry | null> {
    const entries = await this.list({
      namespace: query.coordinates.namespace,
      project: query.coordinates.project,
      repo: query.coordinates.repo,
      scope: query.coordinates.scope,
      tenant: query.coordinates.tenant,
      user: query.coordinates.user,
      workspace: query.coordinates.workspace,
      kind: "cache",
      key: query.key,
      limit: query.limit ?? 20,
    });

    if (query.key) {
      return entries.find((entry) => entry.key === query.key) ?? null;
    }

    if (!query.text?.trim()) {
      return entries[0] ?? null;
    }

    const matches = await this.search({
      namespace: query.coordinates.namespace,
      project: query.coordinates.project,
      repo: query.coordinates.repo,
      scope: query.coordinates.scope,
      tenant: query.coordinates.tenant,
      user: query.coordinates.user,
      workspace: query.coordinates.workspace,
      kind: "cache",
      text: query.text,
      limit: query.limit ?? 10,
    });

    return matches[0]?.entry ?? null;
  }

  async getPromptCacheAuto(query: PromptCacheAutoGetInput): Promise<MemoryEntry | null> {
    if (query.coordinates.scope) {
      const key = buildPromptCacheKey(query);
      const exact = await this.getPromptCache({
        key,
        coordinates: {
          ...query.coordinates,
          namespace: query.coordinates.namespace,
          scope: query.coordinates.scope,
        },
        limit: query.limit,
      });

      if (exact) {
        return exact;
      }
    }

    const entries = await this.list({
      namespace: query.coordinates.namespace,
      project: query.coordinates.project,
      repo: query.coordinates.repo,
      scope: query.coordinates.scope,
      tenant: query.coordinates.tenant,
      user: query.coordinates.user,
      workspace: query.coordinates.workspace,
      kind: "cache",
      limit: query.limit ?? 50,
    });

    const scored = entries
      .map((entry) => ({
        entry,
        score: this.scorePromptCacheAutoCandidate(query.prompt, entry),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);

    return scored[0]?.entry ?? null;
  }

  async storePromptCacheAuto(input: PromptCacheAutoStoreInput): Promise<MemoryEntry> {
    const key = buildPromptCacheKey(input);
    const prompt = input.prompt.trim();
    const coordinates: MemoryCoordinates = {
      ...input.coordinates,
      namespace: input.coordinates.namespace,
      scope: input.coordinates.scope ?? "workspace",
    };

    return this.storePromptCache({
      key,
      title: input.title ?? input.task ?? key,
      content: input.content,
      coordinates,
      tags: Array.from(new Set(["automatic", "prompt-cache", ...(input.tags ?? [])])),
      metadata: {
        prompt,
        promptChars: prompt.length,
        task: input.task,
        ...input.metadata,
      },
      source: input.source,
      embeddingVersion: input.embeddingVersion,
      schemaVersion: input.schemaVersion,
      confidence: input.confidence,
    });
  }

  async invalidatePromptCache(
    input: PromptCacheInvalidateInput
  ): Promise<PromptCacheInvalidateResult> {
    const entries = await this.list({
      namespace: input.namespace,
      project: input.project,
      repo: input.repo,
      scope: input.scope,
      tenant: input.tenant,
      user: input.user,
      workspace: input.workspace,
      kind: "cache",
      limit: 500,
      includeExpired: true,
    });

    const filtered = entries.filter((entry) => {
      if (
        input.schemaVersion !== undefined &&
        Number(entry.metadata.schemaVersion ?? entry.schemaVersion) !== input.schemaVersion
      ) {
        return false;
      }

      if (
        input.embeddingVersion !== undefined &&
        entry.embeddingVersion !== input.embeddingVersion
      ) {
        return false;
      }

      return true;
    });

    for (const entry of filtered) {
      await this.delete(entry.id);
    }

    return {
      deleted: filtered.length,
      ids: filtered.map((entry) => entry.id),
    };
  }

  async upsertProfile(input: ProfileBlockInput): Promise<MemoryEntry> {
    this.assertCoordinates(input.coordinates);

    return this.upsert({
      key: buildProfileKey(input),
      title: input.title ?? input.name,
      content: input.content,
      coordinates: {
        ...input.coordinates,
        namespace: PROFILE_NAMESPACE,
      },
      kind: "persona",
      tags: input.tags ?? [],
      metadata: {
        profileName: input.name,
        ...input.metadata,
      },
      source: input.source,
      provenance: {
        source: input.source === "system" ? "system" : "manual",
      },
      confidence: input.confidence,
      lastVerifiedAt: input.lastVerifiedAt,
    });
  }

  async loadProfiles(query: ProfileQuery = {}): Promise<MemoryEntry[]> {
    return this.list({
      namespace: PROFILE_NAMESPACE,
      kind: "persona",
      project: query.project,
      repo: query.repo,
      scope: query.scope,
      tenant: query.tenant,
      user: query.user,
      workspace: query.workspace,
      limit: query.limit ?? 100,
    });
  }

  async initializeDefaults(input: MemFlowInitInput): Promise<MemFlowInitResult> {
    const entries: MemoryEntry[] = [];
    const source = input.source ?? "system";

    for (const template of buildInitEntryTemplates(input)) {
      if (template.kind === "persona") {
        entries.push(
          await this.upsertProfile({
            name: template.name,
            content: template.content,
            coordinates: template.coordinates,
            metadata: {
              initializedBy: input.actorId ?? "memflow",
              seeded: true,
            },
            source,
            tags: template.tags,
          })
        );
        continue;
      }

      entries.push(
        await this.upsert({
          key: buildProfileKey({
            name: template.name,
            content: template.content,
            coordinates: template.coordinates,
          }),
          title: template.name,
          content: template.content,
          coordinates: template.coordinates,
          kind: "workflow",
          tags: template.tags,
          metadata: {
            initializedBy: input.actorId ?? "memflow",
            seeded: true,
          },
          source,
          provenance: {
            actorId: input.actorId,
            source: "system",
          },
        })
      );
    }

    return {
      entries,
      syncPolicy: DEFAULT_MEMORY_SYNC_POLICY,
    };
  }

  async registerTrackedProject(input: MemFlowTrackedProject & {
    source?: string;
    tenant?: string;
    user?: string;
    workspace?: string;
  }): Promise<MemoryEntry> {
    return this.upsert({
      key: buildTrackedProjectKey(input),
      title: `${input.name} tracking`,
      content: input.enabled
        ? `Track ${input.name} automatically so MemFlow can preserve project context, reduce repeated requests, and recover agent session state.`
        : `Project ${input.name} is currently disabled for automatic tracking.`,
      coordinates: {
        namespace: PROJECTS_NAMESPACE,
        project: input.project,
        repo: input.repo,
        scope: "repo",
        tenant: input.tenant,
        user: input.user,
        workspace: input.workspace,
      },
      kind: "knowledge",
      tags: ["project", "tracking", input.enabled ? "enabled" : "disabled"],
      metadata: {
        enabled: input.enabled,
        path: input.path,
        trackedProject: true,
      },
      source: input.source,
      provenance: {
        source: input.source === "system" ? "system" : "manual",
      },
    });
  }

  async listTrackedProjects(query: {
    project?: string;
    repo?: string;
    tenant?: string;
    user?: string;
    workspace?: string;
  } = {}): Promise<MemoryEntry[]> {
    return this.list({
      namespace: PROJECTS_NAMESPACE,
      kind: "knowledge",
      project: query.project,
      repo: query.repo,
      tenant: query.tenant,
      user: query.user,
      workspace: query.workspace,
      limit: 500,
    });
  }

  async checkpointSession(input: SessionCheckpointInput): Promise<MemoryEntry> {
    this.assertCoordinates(input.coordinates);
    if (!input.goal.trim()) {
      throw new InvalidMemoryInputError("Session checkpoint goal is required");
    }

    const checkpoint = await this.upsert({
      key: buildSessionKey(input.coordinates, input.sessionId),
      title: input.title ?? input.goal,
      content: buildCheckpointContent(input),
      coordinates: {
        ...input.coordinates,
        namespace: SESSION_NAMESPACE,
      },
      kind: "session",
      tags: ["checkpoint", input.status ?? "active"],
      metadata: {
        blockers: input.blockers ?? [],
        branch: input.branch,
        decisions: input.decisions ?? [],
        files: input.files ?? [],
        goal: input.goal,
        nextStep: input.nextStep,
        sessionId: input.sessionId ?? "active",
        status: input.status ?? "active",
        summary: input.summary,
        todos: input.todos ?? [],
        ...input.metadata,
      },
      source: input.source,
      provenance: {
        sessionId: input.sessionId,
        source: input.source === "system" ? "system" : "manual",
      },
      lastVerifiedAt: new Date().toISOString(),
    });

    await this.recordOperationalMetric({
      coordinates: input.coordinates,
      metric: "checkpoint",
    });

    return checkpoint;
  }

  async resumeSession(query: SessionResumeQuery): Promise<SessionResumeResult> {
    const checkpoint = await this.findLatestSessionEntry(query);
    if (!checkpoint) {
      return {
        checkpoint: null,
        compacted: null,
      };
    }

    const compacted = await this.findCompactedSessionEntry(
      checkpoint.coordinates,
      String(checkpoint.metadata.sessionId ?? query.sessionId ?? "active")
    );

    return {
      checkpoint,
      compacted,
    };
  }

  async compactSession(input: SessionCompactionInput): Promise<SessionCompactionResult> {
    this.assertCoordinates(input.coordinates);

    const checkpoint = await this.checkpointSession({
      coordinates: input.coordinates,
      goal: input.goal?.trim() || input.summary?.trim() || "Session compaction",
      metadata: {
        compacted: true,
        ...input.metadata,
      },
      nextStep: input.nextStep,
      sessionId: input.sessionId,
      status: "active",
      summary: input.summary,
      blockers: input.blockers,
      decisions: input.decisions,
      files: input.activeFiles,
      todos: input.activeTodos,
      source: input.source,
      title: "Compacted session state",
    });

    const compacted = await this.upsert({
      key: buildSessionKey(input.coordinates, input.sessionId, "compact"),
      title: `Compacted ${input.sessionId ?? "active"} session`,
      content: buildCompactionContent(input),
      coordinates: {
        ...input.coordinates,
        namespace: CACHE_NAMESPACE,
      },
      kind: "cache",
      tags: ["compacted", "session"],
      metadata: {
        activeFiles: input.activeFiles ?? [],
        activeTodos: input.activeTodos ?? [],
        blockers: input.blockers ?? [],
        checkpointId: checkpoint.id,
        decisions: input.decisions ?? [],
        invalidatedAssumptions: input.invalidatedAssumptions ?? [],
        sessionId: input.sessionId ?? "active",
        transcriptItems: input.transcript?.length ?? 0,
        ...input.metadata,
      },
      source: input.source,
      provenance: {
        sessionId: input.sessionId,
        source: input.source === "system" ? "system" : "manual",
      },
      lastVerifiedAt: new Date().toISOString(),
    });

    await this.recordOperationalMetric({
      coordinates: input.coordinates,
      metric: "compaction",
    });

    return {
      checkpoint,
      compacted,
    };
  }

  async prepareAgentMemory(input: AgentMemoryPrepareInput): Promise<AgentMemoryPrepareResult> {
    this.assertCoordinates(input.coordinates);

    const actions: string[] = [];
    const profiles = await this.loadProfiles({
      project: input.coordinates.project,
      repo: input.coordinates.repo,
      tenant: input.coordinates.tenant,
      user: input.coordinates.user,
      workspace: input.coordinates.workspace,
      limit: input.profileLimit ?? 25,
    });
    actions.push(`loaded ${profiles.length} profile block${profiles.length === 1 ? "" : "s"}`);
    if (profiles.length > 0) {
      await this.recordOperationalMetric({
        coordinates: input.coordinates,
        metric: "profile_load",
        delta: profiles.length,
      });
    }

    const resumed = await this.resumeSession({
      sessionId: input.sessionId,
      project: input.coordinates.project,
      repo: input.coordinates.repo,
      scope: input.coordinates.scope,
      tenant: input.coordinates.tenant,
      user: input.coordinates.user,
      workspace: input.coordinates.workspace,
      limit: 25,
    });
    if (resumed.checkpoint) {
      actions.push("loaded session checkpoint");
      await this.recordOperationalMetric({
        coordinates: input.coordinates,
        metric: "session_resume_hit",
      });
    }
    if (resumed.compacted) {
      actions.push("loaded compacted session state");
      await this.recordOperationalMetric({
        coordinates: input.coordinates,
        metric: "compacted_resume_hit",
      });
    }

    const patternText = input.prompt?.trim() || input.goal?.trim();
    const patterns = patternText
      ? (await this.search({
          namespace: PATTERN_NAMESPACE,
          project: input.coordinates.project,
          repo: input.coordinates.repo,
          tenant: input.coordinates.tenant,
          kind: "pattern",
          text: patternText,
          limit: input.patternLimit ?? 10,
        })).map((result) => result.entry)
      : await this.list({
          namespace: PATTERN_NAMESPACE,
          project: input.coordinates.project,
          repo: input.coordinates.repo,
          tenant: input.coordinates.tenant,
          kind: "pattern",
          limit: input.patternLimit ?? 10,
        });
    actions.push(`loaded ${patterns.length} pattern${patterns.length === 1 ? "" : "s"}`);
    if (patterns.length > 0) {
      await this.recordOperationalMetric({
        coordinates: input.coordinates,
        metric: "pattern_recall",
        delta: patterns.length,
      });
    }

    const workflows = patternText
      ? (await this.search({
          namespace: WORKFLOW_NAMESPACE,
          project: input.coordinates.project,
          repo: input.coordinates.repo,
          tenant: input.coordinates.tenant,
          kind: "workflow",
          text: patternText,
          limit: input.patternLimit ?? 10,
        })).map((result) => result.entry)
      : await this.list({
          namespace: WORKFLOW_NAMESPACE,
          project: input.coordinates.project,
          repo: input.coordinates.repo,
          tenant: input.coordinates.tenant,
          kind: "workflow",
          limit: input.patternLimit ?? 10,
        });
    actions.push(`loaded ${workflows.length} workflow${workflows.length === 1 ? "" : "s"}`);
    if (workflows.length > 0) {
      await this.recordOperationalMetric({
        coordinates: input.coordinates,
        metric: "workflow_recall",
        delta: workflows.length,
      });
    }

    const cache = input.prompt?.trim()
      ? await this.getPromptCacheAuto({
          prompt: input.prompt,
          task: input.task,
          coordinates: {
            namespace: CACHE_NAMESPACE,
            project: input.coordinates.project,
            repo: input.coordinates.repo,
            scope: input.coordinates.scope,
            tenant: input.coordinates.tenant,
            user: input.coordinates.user,
            workspace: input.coordinates.workspace,
          },
          limit: input.cacheLimit ?? 20,
        })
      : null;
    if (cache) {
      actions.push("resolved prompt cache hit");
      await this.recordOperationalMetric({
        coordinates: input.coordinates,
        metric: "cache_hit",
      });
    } else if (input.prompt?.trim()) {
      actions.push("no prompt cache hit");
      await this.recordOperationalMetric({
        coordinates: input.coordinates,
        metric: "cache_miss",
      });
    }

    await this.recordOperationalMetric({
      coordinates: input.coordinates,
      metric: "agent_prepare",
    });

    const response: AgentMemoryPrepareResult = {
      actions,
      profiles,
      checkpoint: resumed.checkpoint,
      compacted: resumed.compacted,
      patterns,
      cache: cache ?? null,
      workflows,
    };

    // Automatic Prompt Caching Logic
    // If supplier is Claude or similar, tag static blocks for caching
    if (input.supplier === "claude" || input.supplier === "generic") {
      const CACHE_STABLE = { type: "ephemeral" as const };
      
      // Tag profiles (personas/workflows) as they are the most static
      response.profiles.forEach(p => p.cacheControl = CACHE_STABLE);
      
      // Tag compacted session state as it represents stable history
      if (response.compacted) {
        response.compacted.cacheControl = CACHE_STABLE;
      }
      
      actions.push(`injected ${input.supplier} prompt cache hints`);
    }

    return response;
  }

  async finalizeAgentMemory(input: AgentMemoryFinalizeInput): Promise<AgentMemoryFinalizeResult> {
    this.assertCoordinates(input.coordinates);

    const actions: string[] = [];
    const checkpoint = await this.checkpointSession({
      sessionId: input.sessionId,
      title: input.goal,
      goal: input.goal,
      summary: input.summary,
      nextStep: input.nextStep,
      status: input.status ?? "active",
      coordinates: {
        ...input.coordinates,
        namespace: SESSION_NAMESPACE,
      },
      branch: input.branch,
      files: input.files,
      blockers: input.blockers,
      decisions: input.decisions,
      todos: input.todos,
      metadata: input.metadata,
      source: input.source,
    });
    actions.push("stored session checkpoint");

    let cache: MemoryEntry | null = null;
    if (shouldStoreAutomaticCache(input)) {
      cache = await this.storePromptCacheAuto({
        prompt: input.prompt!.trim(),
        task: input.task,
        title: input.task ?? input.goal,
        content: input.output!.trim(),
        coordinates: {
          ...input.coordinates,
          namespace: CACHE_NAMESPACE,
        },
        metadata: {
          goal: input.goal,
          nextStep: input.nextStep,
          ...input.cacheMetadata,
        },
        source: input.source,
      });
      actions.push("stored automatic prompt cache");
      await this.recordOperationalMetric({
        coordinates: input.coordinates,
        metric: "cache_store",
      });
    }

    let compacted: MemoryEntry | null = null;
    if (shouldCompactAutomatically(input)) {
      const result = await this.compactSession({
        sessionId: input.sessionId,
        coordinates: {
          ...input.coordinates,
          namespace: SESSION_NAMESPACE,
        },
        goal: input.goal,
        summary: input.summary,
        transcript: input.transcript,
        decisions: input.decisions,
        blockers: input.blockers,
        nextStep: input.nextStep,
        activeFiles: input.activeFiles ?? input.files,
        activeTodos: input.activeTodos ?? input.todos,
        invalidatedAssumptions: input.invalidatedAssumptions,
        metadata: input.metadata,
        source: input.source,
      });
      compacted = result.compacted;
      actions.push("compacted session state");
    }

    if (shouldSuggestPatternPromotion(input)) {
      actions.push("reviewed session for pattern promotion");
    }

    await this.recordOperationalMetric({
      coordinates: input.coordinates,
      metric: "agent_finalize",
    });

    return {
      actions,
      cache,
      checkpoint,
      compacted,
    };
  }

  async promotePattern(input: PatternPromotionInput): Promise<MemoryEntry> {
    this.assertCoordinates(input.coordinates);
    if (!input.title.trim()) {
      throw new InvalidMemoryInputError("Pattern title is required");
    }

    const entry = await this.upsert({
      key: buildPatternKey(input),
      title: input.title,
      content: buildPatternContent(input),
      coordinates: {
        ...input.coordinates,
        namespace: PATTERN_NAMESPACE,
      },
      kind: "pattern",
      tags: Array.from(new Set(["pattern", ...(input.tags ?? [])])),
      metadata: {
        detection: input.detection,
        failure: input.failure,
        promotedFromSession: input.sessionId,
        rootCause: input.rootCause,
        safeFix: input.safeFix,
        ...input.metadata,
      },
      source: input.source,
      provenance: {
        sessionId: input.sessionId,
        source: input.source === "system" ? "system" : "manual",
      },
      confidence: input.confidence,
      lastVerifiedAt: input.lastVerifiedAt ?? new Date().toISOString(),
    });

    await this.recordOperationalMetric({
      coordinates: input.coordinates,
      metric: "pattern_promote",
    });

    return entry;
  }

  async syncPlan(
    query?: MemoryQuery,
    policy: MemorySyncPolicy = DEFAULT_MEMORY_SYNC_POLICY
  ): Promise<MemorySyncPlanResult> {
    const entries = await this.list({
      ...(query ?? {}),
      limit: query?.limit ?? 500,
    });
    return buildSyncPlan(entries, policy);
  }

  async exportBySyncTarget(
    target: Exclude<MemorySyncTarget, "both">,
    query?: MemoryQuery,
    policy: MemorySyncPolicy = DEFAULT_MEMORY_SYNC_POLICY
  ): Promise<MemoryExportBundle> {
    const entries = filterEntriesForSyncTarget(
      await this.list({
        ...(query ?? {}),
        limit: query?.limit ?? 500,
      }),
      target,
      policy
    );

    return this.createBundle(entries, `memflow:${target}`);
  }

  async update(id: string, input: MemoryUpdateInput): Promise<MemoryEntry> {
    this.assertId(id);
    const current = await this.get(id);
    if (!current) {
      throw new InvalidMemoryInputError(`Memory entry not found: ${id}`);
    }

    const next = this.ensureEmbedding({
      ...current,
      content: input.content ?? current.content,
      embedding: input.embedding ?? current.embedding,
      embeddingVersion:
        input.embeddingVersion === null
          ? undefined
          : (input.embeddingVersion ?? current.embeddingVersion),
      kind: current.kind,
    });

    return this.connector.update(id, {
      ...input,
      embedding: input.embedding ?? next?.embedding,
      embeddingVersion:
        input.embeddingVersion === null
          ? null
          : (input.embeddingVersion ?? next?.embeddingVersion ?? current.embeddingVersion),
    });
  }

  async upsert(input: MemoryWriteInput): Promise<MemoryEntry> {
    this.assertWriteInput(input);
    const enriched = this.enrichWriteInput(input);
    const embedded = this.ensureEmbedding({
      content: enriched.content,
      embedding: enriched.embedding,
      embeddingVersion: enriched.embeddingVersion,
      kind: enriched.kind ?? "knowledge",
    });
    const normalized = createMemoryEntry({
      ...enriched,
      confidence: enriched.confidence,
      embedding: enriched.embedding ?? embedded?.embedding,
      embeddingVersion: enriched.embeddingVersion ?? embedded?.embeddingVersion,
      expiresAt: enriched.expiresAt,
      kind: enriched.kind ?? "knowledge",
      lastVerifiedAt: enriched.lastVerifiedAt,
      metadata: enriched.metadata ?? {},
      tags: enriched.tags ?? [],
    });
    const stored = await this.connector.upsert(normalized);
    return this.decorateEntry(stored);
  }

  createBundle(entries: MemoryEntry[], exportedBy?: string): MemoryExportBundle {
    return {
      exportedAt: new Date().toISOString(),
      exportedBy,
      formatVersion: "1",
      entries,
    };
  }

  createId(): string {
    return randomUUID();
  }

  private async recordOperationalMetric(input: {
    coordinates: MemoryCoordinates;
    metric: string;
    delta?: number;
  }): Promise<void> {
    const key = buildOperationalMetricKey({
      coordinates: {
        ...input.coordinates,
        namespace: METRICS_NAMESPACE,
      },
      metric: input.metric,
    });

    const existing = (
      await this.list({
        namespace: METRICS_NAMESPACE,
        key,
        limit: 1,
        includeExpired: true,
      })
    )[0];

    const count = Number(existing?.metadata.count ?? 0) + (input.delta ?? 1);
    await this.upsert({
      key,
      title: `Metric ${input.metric}`,
      content: `Operational metric ${input.metric} count ${count}`,
      coordinates: {
        ...input.coordinates,
        namespace: METRICS_NAMESPACE,
      },
      kind: "knowledge",
      tags: ["metric", input.metric],
      metadata: {
        count,
        lastEventAt: new Date().toISOString(),
        metric: input.metric,
      },
      source: "system",
      provenance: {
        source: "system",
      },
    });
  }

  private async semanticSearch(query: MemoryQuery): Promise<SearchResult[]> {
    const text = query.text?.trim();
    if (!text) {
      return [];
    }

    const queryEmbedding = this.embeddingProvider.embedText(text);
    const candidates = await this.list({
      ...query,
      limit: Math.max(query.limit ?? 10, 50),
    });

    return candidates
      .map((entry) => {
        const ensured = this.ensureEmbedding(entry) ?? entry;
        return {
          entry: ensured,
          score: cosineSimilarity(queryEmbedding, ensured.embedding),
        };
      })
      .filter((result) => result.score > (query.threshold ?? 0))
      .sort((left, right) => right.score - left.score)
      .slice(0, query.limit ?? 10);
  }

  private ensureEmbedding<T extends { content: string; embedding?: MemoryEntry["embedding"]; embeddingVersion?: string; kind: MemoryEntry["kind"] }>(
    entry: T
  ): T | (T & { embedding: NonNullable<MemoryEntry["embedding"]>; embeddingVersion: string }) | null {
    if (!shouldAutoEmbed(entry.kind) || !this.embeddingProvider.supports(entry.kind)) {
      return entry;
    }

    if (entry.embedding?.values?.length) {
      return entry;
    }

    const embedding = this.embeddingProvider.embedText(entry.content);
    return {
      ...entry,
      embedding,
      embeddingVersion:
        !entry.embeddingVersion || entry.embeddingVersion === MEMFLOW_EMBEDDING_VERSION_NONE
          ? (embedding.model ?? this.embeddingProvider.name)
          : entry.embeddingVersion,
    };
  }

  private scorePromptCacheAutoCandidate(prompt: string, entry: MemoryEntry): number {
    const promptTokens = tokenize(prompt);
    if (promptTokens.length === 0) {
      return 0;
    }

    const metadataPrompt =
      typeof entry.metadata.prompt === "string" ? entry.metadata.prompt : "";
    const haystackTokens = new Set([
      ...tokenize(entry.title),
      ...tokenize(entry.content),
      ...tokenize(metadataPrompt),
      ...entry.tags.flatMap((tag) => tokenize(tag)),
    ]);

    let matches = 0;
    for (const token of promptTokens) {
      if (haystackTokens.has(token)) {
        matches += 1;
      }
    }

    return matches / promptTokens.length;
  }

  private async findCompactedSessionEntry(
    coordinates: MemoryEntry["coordinates"],
    sessionId: string
  ): Promise<MemoryEntry | null> {
    const entries = await this.list({
      namespace: CACHE_NAMESPACE,
      project: coordinates.project,
      repo: coordinates.repo,
      scope: coordinates.scope,
      tenant: coordinates.tenant,
      user: coordinates.user,
      workspace: coordinates.workspace,
      kind: "cache",
      limit: 100,
    });

    return (
      entries.find(
        (entry) =>
          entry.key === buildSessionKey(coordinates, sessionId, "compact") ||
          entry.metadata.sessionId === sessionId
      ) ?? null
    );
  }

  private async findLatestSessionEntry(query: SessionResumeQuery): Promise<MemoryEntry | null> {
    const entries = await this.list({
      namespace: SESSION_NAMESPACE,
      project: query.project,
      repo: query.repo,
      scope: query.scope,
      tenant: query.tenant,
      user: query.user,
      workspace: query.workspace,
      kind: "session",
      limit: query.limit ?? 100,
    });

    const filtered = query.sessionId
      ? entries.filter(
          (entry) =>
            entry.key ===
              buildSessionKey(entry.coordinates, query.sessionId) ||
            entry.metadata.sessionId === query.sessionId
        )
      : entries;

    return filtered.sort(byUpdatedAtDesc)[0] ?? null;
  }

  private assertBundle(bundle: MemoryExportBundle): void {
    if (bundle.formatVersion !== "1") {
      throw new InvalidMemoryInputError("Unsupported MemFlow export bundle version");
    }
  }

  private assertId(id: string): void {
    if (!id.trim()) {
      throw new InvalidMemoryInputError("Memory id is required");
    }
  }

  private assertWriteInput(input: MemoryWriteInput): void {
    if (!input.key.trim()) {
      throw new InvalidMemoryInputError("Memory key is required");
    }
    if (!input.content.trim()) {
      throw new InvalidMemoryInputError("Memory content is required");
    }
    if (!input.coordinates.namespace.trim()) {
      throw new InvalidMemoryInputError("Memory namespace is required");
    }
  }

  private assertCoordinates(coordinates: MemoryWriteInput["coordinates"]): void {
    if (!coordinates.namespace.trim()) {
      throw new InvalidMemoryInputError("Memory namespace is required");
    }
  }

  private normalizeQuery(query?: MemoryQuery): MemoryQuery | undefined {
    if (!query) {
      return undefined;
    }

    return {
      includeExpired: query.includeExpired ?? false,
      limit: query.limit ?? 10,
      offset: query.offset ?? 0,
      threshold: query.threshold,
      ...query,
      kind: query.kind === "snippet" ? "rag" : query.kind,
    };
  }

  private getDependencySnapshot(workspace?: string): ReturnType<typeof collectDependencySnapshot> {
    const key = (workspace?.trim() || process.cwd()).trim();
    return collectDependencySnapshot(key);
  }

  private enrichWriteInput(input: MemoryWriteInput): MemoryWriteInput {
    if (!this.shouldTagDependencies(input.kind)) {
      return input;
    }

    const snapshot = this.getDependencySnapshot(input.coordinates.workspace);
    if (!snapshot) {
      return input;
    }

    return {
      ...input,
      metadata: {
        ...input.metadata,
        ...dependencyMetadata(snapshot),
      },
      tags: Array.from(new Set([...(input.tags ?? []), ...dependencyTags(snapshot)])),
    };
  }

  private decorateEntry(entry: MemoryEntry, workspace?: string): MemoryEntry {
    const snapshot = this.getDependencySnapshot(workspace ?? entry.coordinates.workspace);
    const warnings = dependencyWarningsForEntry(entry, snapshot);

    if (warnings.length === 0) {
      return entry;
    }

    return {
      ...entry,
      metadata: {
        ...entry.metadata,
        dependencyWarnings: warnings,
      },
    };
  }

  private shouldTagDependencies(kind?: MemoryEntry["kind"] | MemoryWriteInput["kind"]): boolean {
    return kind !== "cache" && kind !== "session" && kind !== "persona";
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function mergeSearchResults(
  lexical: SearchResult[],
  semantic: SearchResult[],
  limit: number
): SearchResult[] {
  const merged = new Map<string, SearchResult>();

  for (const result of lexical) {
    merged.set(result.entry.id, result);
  }

  for (const result of semantic) {
    const existing = merged.get(result.entry.id);
    if (!existing) {
      merged.set(result.entry.id, result);
      continue;
    }

    merged.set(result.entry.id, {
      entry: existing.entry,
      score: Math.max(existing.score, result.score),
    });
  }

  return Array.from(merged.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function sameEmbedding(left: MemoryEntry, right: MemoryEntry): boolean {
  if (!left.embedding || !right.embedding) {
    return left.embedding === right.embedding;
  }

  return (
    left.embeddingVersion === right.embeddingVersion &&
    left.embedding.values.length === right.embedding.values.length &&
    left.embedding.values.every((value, index) => value === right.embedding?.values[index])
  );
}

function shouldSuggestPatternPromotion(input: AgentMemoryFinalizeInput): boolean {
  const haystack = [
    input.goal,
    input.summary,
    input.nextStep,
    input.prompt,
    input.task,
    input.output,
    ...(input.decisions ?? []),
    ...(input.blockers ?? []),
    ...(input.transcript ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const repeatedAttemptSignals = [
    "retry",
    "attempt",
    "repeated",
    "failed",
    "bug",
    "fix",
    "regression",
    "stale",
    "trap",
    "environment",
  ];

  return repeatedAttemptSignals.some((signal) => haystack.includes(signal));
}

function resolveMetricsCoordinatesFromQuery(query?: MemoryQuery): MemoryCoordinates {
  return {
    namespace: METRICS_NAMESPACE,
    project: query?.project,
    repo: query?.repo,
    scope: query?.scope ?? "workspace",
    tenant: query?.tenant,
    user: query?.user,
    workspace: query?.workspace,
  };
}

function shouldStoreAutomaticCache(input: AgentMemoryFinalizeInput): boolean {
  if (input.storeCache === false) {
    return false;
  }

  const prompt = input.prompt?.trim();
  const output = input.output?.trim();
  if (!prompt || !output) {
    return false;
  }

  const maxChars =
    typeof process.env.MEMFLOW_AUTO_CACHE_MAX_CHARS === "string"
      ? Number.parseInt(process.env.MEMFLOW_AUTO_CACHE_MAX_CHARS, 10)
      : 8000;

  if (Number.isFinite(maxChars) && output.length > maxChars) {
    return false;
  }

  return true;
}

function shouldCompactAutomatically(input: AgentMemoryFinalizeInput): boolean {
  if (input.compact === false) {
    return false;
  }

  if (input.compact === true) {
    return true;
  }

  return Boolean(
    input.transcript?.length ||
      input.activeFiles?.length ||
      input.activeTodos?.length ||
      input.invalidatedAssumptions?.length ||
      input.summary?.trim() ||
      input.blockers?.length ||
      input.decisions?.length
  );
}
