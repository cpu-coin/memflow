import { z } from "zod";

import type { MemoryService } from "../core/memory-service.js";
import type { MemoryExportBundle } from "../types/memory.js";
import { ToolGuard } from "./guard.js";

const coordinatesSchema = z.object({
  namespace: z.string().min(1),
  project: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  scope: z.enum(["project", "repo", "session", "team", "user", "workspace"]),
  tenant: z.string().min(1).optional(),
  user: z.string().min(1).optional(),
  workspace: z.string().min(1).optional(),
  /** Set true to explicitly allow sensitive content through the security sweep for this request. */
  bypassSecuritySweep: z.boolean().optional(),
});


const provenanceSchema = z.object({
  actorId: z.string().min(1).optional(),
  connector: z.string().min(1).optional(),
  importedFrom: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  source: z.enum(["agent", "bundle-import", "connector", "manual", "system"]),
});

const querySchema = z.object({
  text: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  project: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  scope: z.enum(["project", "repo", "session", "team", "user", "workspace"]).optional(),
  tenant: z.string().min(1).optional(),
  user: z.string().min(1).optional(),
  workspace: z.string().min(1).optional(),
  kind: z.enum(["cache", "knowledge", "pattern", "persona", "snippet", "rag", "session", "workflow"]).optional(),
  tags: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().min(0).optional(),
  threshold: z.number().min(0).max(1).optional(),
  includeExpired: z.boolean().optional(),
});

const exportBundleSchema = z.object({
  exportedAt: z.string().min(1),
  exportedBy: z.string().min(1).optional(),
  formatVersion: z.literal("1"),
  entries: z.array(z.unknown()),
});

const syncTargetSchema = z.enum(["both", "local", "shared"]);

const syncPolicySchema = z.object({
  name: z.string().min(1),
  defaultTarget: syncTargetSchema,
  kindTargets: z.record(syncTargetSchema).optional(),
  scopeTargets: z.record(syncTargetSchema).optional(),
});

function asJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function registerMemoryTools(server: {
  addTool: (definition: {
    name: string;
    description: string;
    parameters: z.ZodTypeAny;
    execute: (args: any) => Promise<string>;
  }) => void;
}, service: MemoryService): void {
  const guard = new ToolGuard();

  server.addTool({
    name: "memory_store",
    description: "Store or update a MemFlow entry.",
    parameters: z.object({
      key: z.string().min(1),
      title: z.string().min(1).optional(),
      content: z.string().min(1),
      coordinates: coordinatesSchema,
      kind: z.enum(["cache", "knowledge", "pattern", "persona", "snippet", "rag", "session", "workflow"]).optional(),
      tags: z.array(z.string().min(1)).optional(),
      metadata: z.record(z.unknown()).optional(),
      source: z.string().min(1).optional(),
      provenance: provenanceSchema,
      confidence: z.number().min(0).max(1).optional(),
      embeddingVersion: z.string().min(1).optional(),
      expiresAt: z.string().min(1).optional(),
      lastVerifiedAt: z.string().min(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_store", args, async () => asJson(await service.upsert(args))),
  });

  server.addTool({
    name: "memory_search",
    description: "Search MemFlow entries using text and filters.",
    parameters: querySchema,
    execute: async (args) =>
      guard.run("memory_search", args, async () => asJson(await service.search(args))),
  });

  server.addTool({
    name: "memory_retrieve",
    description: "Retrieve a MemFlow entry by id.",
    parameters: z.object({
      id: z.string().min(1),
    }),
    execute: async ({ id }) =>
      guard.run("memory_retrieve", { id }, async () => asJson(await service.get(id))),
  });

  server.addTool({
    name: "memory_list",
    description: "List MemFlow entries using structural filters.",
    parameters: querySchema,
    execute: async (args) =>
      guard.run("memory_list", args, async () => asJson(await service.list(args))),
  });

  server.addTool({
    name: "memory_delete",
    description: "Delete a MemFlow entry by id.",
    parameters: z.object({
      id: z.string().min(1),
    }),
    execute: async ({ id }) =>
      guard.run("memory_delete", { id }, async () => asJson(await service.delete(id))),
  });

  server.addTool({
    name: "memory_import",
    description: "Import a MemFlow export bundle.",
    parameters: z.object({
      bundle: exportBundleSchema,
    }),
    execute: async ({ bundle }) =>
      guard.run("memory_import", { bundle }, async () =>
        asJson(await service.import(bundle as MemoryExportBundle))
      ),
  });

  server.addTool({
    name: "memory_export",
    description: "Export a MemFlow bundle using optional query filters.",
    parameters: querySchema,
    execute: async (args) =>
      guard.run("memory_export", args, async () => asJson(await service.export(args))),
  });

  server.addTool({
    name: "memory_merge",
    description: "Merge a MemFlow export bundle into the active connector.",
    parameters: z.object({
      bundle: exportBundleSchema,
    }),
    execute: async ({ bundle }) =>
      guard.run("memory_merge", { bundle }, async () =>
        asJson(await service.merge(bundle as MemoryExportBundle))
      ),
  });

  server.addTool({
    name: "memory_diff",
    description: "Diff a MemFlow export bundle against the active connector.",
    parameters: z.object({
      bundle: exportBundleSchema,
    }),
    execute: async ({ bundle }) =>
      guard.run("memory_diff", { bundle }, async () =>
        asJson(await service.diff(bundle as MemoryExportBundle))
      ),
  });

  server.addTool({
    name: "memory_stats",
    description: "Return connector and entry statistics for MemFlow.",
    parameters: z.object({}),
    execute: async () =>
      guard.run("memory_stats", {}, async () => asJson(await service.stats())),
  });

  server.addTool({
    name: "memory_status",
    description: "Return a lightweight MemFlow status summary (connector health and recent activity).",
    parameters: z.object({}),
    execute: async () =>
      guard.run("memory_status", {}, async () => {
        const health = await service.health();
        const metrics = await service.metrics({ days: 1, limit: 20 });
        return asJson({
          health,
          recentActivity: metrics.recent,
          totals: metrics.totals,
        });
      }),
  });

  server.addTool({
    name: "memory_metrics",
    description: "Return recent operational metrics for agent prepare/finalize, cache reuse, checkpointing, compaction, and embedding backfill.",
    parameters: z.object({
      project: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
      scope: z.enum(["project", "repo", "session", "team", "user", "workspace"]).optional(),
      tenant: z.string().min(1).optional(),
      user: z.string().min(1).optional(),
      workspace: z.string().min(1).optional(),
      days: z.number().int().positive().max(365).optional(),
      limit: z.number().int().positive().max(500).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_metrics", args, async () => asJson(await service.metrics(args))),
  });

  server.addTool({
    name: "memory_init",
    description: "Seed baseline MemFlow persona and workflow entries for a repo/workspace.",
    parameters: z.object({
      actorId: z.string().min(1).optional(),
      project: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
      tenant: z.string().min(1).optional(),
      user: z.string().min(1).optional(),
      workspace: z.string().min(1).optional(),
      source: z.string().min(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_init", args, async () => asJson(await service.initializeDefaults(args))),
  });

  server.addTool({
    name: "memory_profile_store",
    description: "Store a scoped persona/profile block for a user, workspace, project, repo, or team.",
    parameters: z.object({
      name: z.string().min(1),
      title: z.string().min(1).optional(),
      content: z.string().min(1),
      coordinates: coordinatesSchema,
      tags: z.array(z.string().min(1)).optional(),
      metadata: z.record(z.unknown()).optional(),
      source: z.string().min(1).optional(),
      confidence: z.number().min(0).max(1).optional(),
      lastVerifiedAt: z.string().min(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_profile_store", args, async () =>
        asJson(await service.upsertProfile(args))
      ),
  });

  server.addTool({
    name: "memory_cache_store",
    description: "Store a prompt cache entry scoped to project, repo, workspace, or user context.",
    parameters: z.object({
      key: z.string().min(1),
      title: z.string().min(1).optional(),
      content: z.string().min(1),
      coordinates: coordinatesSchema,
      tags: z.array(z.string().min(1)).optional(),
      metadata: z.record(z.unknown()).optional(),
      source: z.string().min(1).optional(),
      embeddingVersion: z.string().min(1).optional(),
      schemaVersion: z.number().int().positive().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_cache_store", args, async () =>
        asJson(await service.storePromptCache(args))
      ),
  });

  server.addTool({
    name: "memory_cache_get",
    description: "Resolve the best matching prompt cache entry by exact key or scoped text lookup.",
    parameters: z.object({
      key: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
      coordinates: coordinatesSchema.partial().extend({
        namespace: z.string().min(1),
      }),
      limit: z.number().int().positive().max(500).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_cache_get", args, async () =>
        asJson(await service.getPromptCache(args))
      ),
  });

  server.addTool({
    name: "memory_cache_auto_get",
    description: "Resolve a prompt cache entry using a deterministic prompt fingerprint, with scoped text fallback.",
    parameters: z.object({
      prompt: z.string().min(1),
      task: z.string().min(1).optional(),
      coordinates: coordinatesSchema.partial().extend({
        namespace: z.string().min(1),
      }),
      schemaVersion: z.number().int().positive().optional(),
      embeddingVersion: z.string().min(1).optional(),
      limit: z.number().int().positive().max(500).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_cache_auto_get", args, async () =>
        asJson(await service.getPromptCacheAuto(args))
      ),
  });

  server.addTool({
    name: "memory_cache_auto_store",
    description: "Store a prompt cache entry using a deterministic prompt fingerprint for automatic reuse.",
    parameters: z.object({
      prompt: z.string().min(1),
      task: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      content: z.string().min(1),
      coordinates: coordinatesSchema,
      tags: z.array(z.string().min(1)).optional(),
      metadata: z.record(z.unknown()).optional(),
      source: z.string().min(1).optional(),
      embeddingVersion: z.string().min(1).optional(),
      schemaVersion: z.number().int().positive().optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_cache_auto_store", args, async () =>
        asJson(await service.storePromptCacheAuto(args))
      ),
  });

  server.addTool({
    name: "memory_cache_invalidate",
    description: "Invalidate prompt-cache entries by namespace, project, repo, workspace, or version.",
    parameters: z.object({
      namespace: z.string().min(1),
      project: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
      scope: z.enum(["project", "repo", "session", "team", "user", "workspace"]).optional(),
      tenant: z.string().min(1).optional(),
      user: z.string().min(1).optional(),
      workspace: z.string().min(1).optional(),
      schemaVersion: z.number().int().positive().optional(),
      embeddingVersion: z.string().min(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_cache_invalidate", args, async () =>
        asJson(await service.invalidatePromptCache(args))
      ),
  });

  server.addTool({
    name: "memory_profile_load",
    description: "Load persona/profile blocks matching the given scope filters.",
    parameters: z.object({
      project: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
      scope: z.enum(["project", "repo", "session", "team", "user", "workspace"]).optional(),
      tenant: z.string().min(1).optional(),
      user: z.string().min(1).optional(),
      workspace: z.string().min(1).optional(),
      limit: z.number().int().positive().max(500).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_profile_load", args, async () =>
        asJson(await service.loadProfiles(args))
      ),
  });

  server.addTool({
    name: "memory_session_checkpoint",
    description: "Store a structured session checkpoint for recovery and continuity.",
    parameters: z.object({
      sessionId: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      goal: z.string().min(1),
      summary: z.string().min(1).optional(),
      nextStep: z.string().min(1).optional(),
      status: z.enum(["active", "blocked", "completed"]).optional(),
      coordinates: coordinatesSchema,
      branch: z.string().min(1).optional(),
      files: z.array(z.string().min(1)).optional(),
      blockers: z.array(z.string().min(1)).optional(),
      decisions: z.array(z.string().min(1)).optional(),
      todos: z.array(z.string().min(1)).optional(),
      metadata: z.record(z.unknown()).optional(),
      source: z.string().min(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_session_checkpoint", args, async () =>
        asJson(await service.checkpointSession(args))
      ),
  });

  server.addTool({
    name: "memory_session_resume",
    description: "Load the latest matching checkpoint plus its compacted state.",
    parameters: z.object({
      sessionId: z.string().min(1).optional(),
      project: z.string().min(1).optional(),
      repo: z.string().min(1).optional(),
      scope: z.enum(["project", "repo", "session", "team", "user", "workspace"]).optional(),
      tenant: z.string().min(1).optional(),
      user: z.string().min(1).optional(),
      workspace: z.string().min(1).optional(),
      limit: z.number().int().positive().max(500).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_session_resume", args, async () =>
        asJson(await service.resumeSession(args))
      ),
  });

  server.addTool({
    name: "memory_session_compact",
    description: "Compact active session state into a recovery checkpoint and cache summary.",
    parameters: z.object({
      sessionId: z.string().min(1).optional(),
      coordinates: coordinatesSchema,
      goal: z.string().min(1).optional(),
      summary: z.string().min(1).optional(),
      transcript: z.array(z.string().min(1)).optional(),
      decisions: z.array(z.string().min(1)).optional(),
      blockers: z.array(z.string().min(1)).optional(),
      nextStep: z.string().min(1).optional(),
      activeFiles: z.array(z.string().min(1)).optional(),
      activeTodos: z.array(z.string().min(1)).optional(),
      invalidatedAssumptions: z.array(z.string().min(1)).optional(),
      metadata: z.record(z.unknown()).optional(),
      source: z.string().min(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_session_compact", args, async () =>
        asJson(await service.compactSession(args))
      ),
  });

  server.addTool({
    name: "memory_agent_prepare",
    description: "Load profiles, session recovery state, patterns, and automatic prompt-cache context for an agent turn.",
    parameters: z.object({
      coordinates: coordinatesSchema,
      sessionId: z.string().min(1).optional(),
      goal: z.string().min(1).optional(),
      prompt: z.string().min(1).optional(),
      task: z.string().min(1).optional(),
      supplier: z.enum(["claude", "openai", "generic"]).optional(),
      profileLimit: z.number().int().positive().max(500).optional(),
      patternLimit: z.number().int().positive().max(500).optional(),
      cacheLimit: z.number().int().positive().max(500).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_agent_prepare", args, async () =>
        asJson(await service.prepareAgentMemory(args))
      ),
  });

  server.addTool({
    name: "memory_agent_finalize",
    description: "Persist checkpoint, compact session state, and store prompt cache automatically after an agent turn.",
    parameters: z.object({
      coordinates: coordinatesSchema,
      sessionId: z.string().min(1).optional(),
      goal: z.string().min(1),
      summary: z.string().min(1).optional(),
      nextStep: z.string().min(1).optional(),
      status: z.enum(["active", "blocked", "completed"]).optional(),
      prompt: z.string().min(1).optional(),
      task: z.string().min(1).optional(),
      output: z.string().min(1).optional(),
      branch: z.string().min(1).optional(),
      files: z.array(z.string().min(1)).optional(),
      blockers: z.array(z.string().min(1)).optional(),
      decisions: z.array(z.string().min(1)).optional(),
      todos: z.array(z.string().min(1)).optional(),
      activeFiles: z.array(z.string().min(1)).optional(),
      activeTodos: z.array(z.string().min(1)).optional(),
      invalidatedAssumptions: z.array(z.string().min(1)).optional(),
      transcript: z.array(z.string().min(1)).optional(),
      compact: z.boolean().optional(),
      storeCache: z.boolean().optional(),
      cacheMetadata: z.record(z.unknown()).optional(),
      metadata: z.record(z.unknown()).optional(),
      source: z.string().min(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_agent_finalize", args, async () =>
        asJson(await service.finalizeAgentMemory(args))
      ),
  });

  server.addTool({
    name: "memory_pattern_promote",
    description: "Promote a verified failure and fix into a reusable pattern entry.",
    parameters: z.object({
      title: z.string().min(1),
      failure: z.string().min(1),
      rootCause: z.string().min(1),
      safeFix: z.string().min(1),
      detection: z.string().min(1).optional(),
      coordinates: coordinatesSchema,
      tags: z.array(z.string().min(1)).optional(),
      confidence: z.number().min(0).max(1).optional(),
      lastVerifiedAt: z.string().min(1).optional(),
      sessionId: z.string().min(1).optional(),
      metadata: z.record(z.unknown()).optional(),
      source: z.string().min(1).optional(),
    }),
    execute: async (args) =>
      guard.run("memory_pattern_promote", args, async () =>
        asJson(await service.promotePattern(args))
      ),
  });

  server.addTool({
    name: "memory_embeddings_backfill",
    description: "Generate local embeddings for existing MemFlow records so hybrid retrieval can work across imported data.",
    parameters: querySchema,
    execute: async (args) =>
      guard.run("memory_embeddings_backfill", args, async () =>
        asJson(await service.backfillEmbeddings(args))
      ),
  });

  server.addTool({
    name: "memory_sync_plan",
    description: "Classify entries into local and shared sync targets using the active sync policy.",
    parameters: z.object({
      query: querySchema.optional(),
      policy: syncPolicySchema.optional(),
    }),
    execute: async ({ policy, query }) =>
      guard.run("memory_sync_plan", { policy, query }, async () =>
        asJson(await service.syncPlan(query, policy))
      ),
  });

  server.addTool({
    name: "memory_sync_export",
    description: "Export the entries that should sync to the requested target.",
    parameters: z.object({
      target: z.enum(["local", "shared"]),
      query: querySchema.optional(),
      policy: syncPolicySchema.optional(),
    }),
    execute: async ({ policy, query, target }) =>
      guard.run("memory_sync_export", { policy, query, target }, async () =>
        asJson(await service.exportBySyncTarget(target, query, policy))
      ),
  });

  // --- AG Bridge Mobile Tools ---
  // These two tools close the mobile ↔ agent response loop via MemFlow as the bus.
  // The ag_bridge server writes mobile messages to ag_bridge/inbox and polls
  // ag_bridge/outbox every 5s to relay agent responses back to the mobile UI.

  server.addTool({
    name: "mobile_read_inbox",
    description: `Read pending messages sent from the mobile device to the agent.
Call this when you see a [Mobile] prefix on a message, or when you want to check
for new mobile requests. Returns unread messages from the ag_bridge inbox.
Always call mobile_respond after processing a mobile message.`,
    parameters: z.object({
      project: z.string().min(1).optional().describe("Filter by project name"),
      limit: z.number().int().positive().max(50).optional().describe("Max messages to return (default 10)"),
    }),
    execute: async ({ project, limit }) =>
      guard.run("mobile_read_inbox", { project, limit }, async () => {
        const entries: any[] = await service.list({
          namespace: "ag_bridge/inbox",
          tags: ["pending"],
          ...(project ? { project } : {}),
          limit: limit ?? 10,
        });
        // Mark as read by swapping "pending" tag to "read"
        for (const entry of entries) {
          await service.upsert({
            ...entry,
            tags: Array.isArray(entry.tags)
              ? entry.tags.map((t: string) => t === "pending" ? "read" : t)
              : ["read"],
          }).catch(() => {});
        }
        return asJson({
          ok: true,
          count: entries.length,
          messages: entries.map((e: any) => ({
            id: e.id,
            text: e.content,
            from: e.metadata?.from ?? "user",
            project: e.metadata?.project ?? project ?? "global",
            sentAt: e.metadata?.mobileTimestamp ?? e.createdAt,
          })),
        });
      }),
  });

  server.addTool({
    name: "mobile_respond",
    description: `Send a response back to the mobile device.
Call this after handling a mobile message to send your reply to the user's phone.
The ag_bridge server polls for these responses every 5 seconds and displays them
in the mobile UI. Always include the project context when available.`,
    parameters: z.object({
      message: z.string().min(1).describe("The response text to send to mobile"),
      project: z.string().min(1).optional().describe("Project context for the response"),
      inReplyTo: z.string().min(1).optional().describe("ID of the mobile message being replied to"),
    }),
    execute: async ({ message, project, inReplyTo }) =>
      guard.run("mobile_respond", { message, project, inReplyTo }, async () => {
        const msgId = `resp_${Date.now().toString(36)}`;
        const now = new Date().toISOString();
        const result = await service.upsert({
          key: `ag_bridge/outbox/${msgId}`,
          title: `Mobile response ${msgId}`,
          content: message,
          coordinates: {
            namespace: "ag_bridge/outbox",
            scope: "workspace",
            ...(project ? { project } : {}),
          },
          kind: "knowledge",
          tags: ["agent-response", "unread", "ag_bridge", ...(project ? [project] : [])],
          metadata: {
            msgId,
            from: "agent",
            to: "user",
            channel: "work",
            timestamp: now,
            status: "unread",
            project: project ?? "global",
            inReplyTo: inReplyTo ?? null,
          },
          provenance: { source: "agent", actorId: "antigravity" },
        });
        return asJson({ ok: true, msgId, method: "memflow_outbox", result });
      }),
  });
}

