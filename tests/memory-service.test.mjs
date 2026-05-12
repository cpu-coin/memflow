import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { SQLiteConnector } from "../dist/connectors/sqlite.js";
import { MemoryService } from "../dist/core/memory-service.js";
import {
  DEFAULT_MEMORY_SYNC_POLICY,
  MEMFLOW_EMBEDDING_VERSION_LOCAL,
  MEMFLOW_EMBEDDING_VERSION_NONE,
  MEMFLOW_SCHEMA_VERSION,
  computeContentHash,
} from "../dist/index.js";
import { EmbeddedConnector } from "../dist/connectors/embedded.js";
import { buildWorkflowWriteInput } from "../dist/core/workflow-ingestion.js";
import { createConnectorFromEnvironment } from "../dist/mcp/server.js";

function createService() {
  const dir = mkdtempSync(join(tmpdir(), "memflow-service-test-"));
  const connector = new SQLiteConnector({
    databasePath: join(dir, "memflow.sqlite"),
  });

  return {
    dir,
    service: new MemoryService(connector),
  };
}

test("createConnectorFromEnvironment supports embedded in-memory mode", async () => {
  const previous = process.env.MEMFLOW_CONNECTOR;
  process.env.MEMFLOW_CONNECTOR = "in-memory";

  try {
    const connector = createConnectorFromEnvironment();
    assert.equal(connector instanceof EmbeddedConnector, true);
  } finally {
    if (previous === undefined) {
      delete process.env.MEMFLOW_CONNECTOR;
    } else {
      process.env.MEMFLOW_CONNECTOR = previous;
    }
  }
});

test("MemoryService rejects unsupported bundle versions on import", async () => {
  const { service, dir } = createService();

  try {
    await assert.rejects(
      service.import({
        exportedAt: new Date().toISOString(),
        formatVersion: "2",
        entries: [],
      }),
      /Unsupported MemFlow export bundle version/
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService upsert normalizes v1 schema fields", async () => {
  const { service, dir } = createService();

  try {
    const entry = await service.upsert({
      key: "cache-auth-snippet",
      content: "Reusable auth snippet for session-aware handlers.",
      coordinates: {
        namespace: "cache",
        project: "memflow",
        scope: "project",
      },
      provenance: {
        source: "manual",
      },
      kind: "cache",
    });

    assert.equal(entry.title, "cache-auth-snippet");
    assert.equal(entry.namespace, "cache");
    assert.equal(entry.projectId, "memflow");
    assert.equal(entry.source, "manual");
    assert.equal(entry.schemaVersion, MEMFLOW_SCHEMA_VERSION);
    assert.equal(entry.embeddingVersion, MEMFLOW_EMBEDDING_VERSION_LOCAL);
    assert.equal(entry.embedding?.dimensions > 0, true);
    assert.equal(entry.contentHash, computeContentHash(entry.content));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService accepts snippet aliases and stores them as rag entries", async () => {
  const { service, dir } = createService();

  try {
    const entry = await service.upsert({
      key: "snippet-alias",
      content: "<button class=\"primary\">Save</button>",
      coordinates: {
        namespace: "code",
        project: "memflow",
        scope: "project",
      },
      provenance: {
        source: "manual",
      },
      kind: "snippet",
    });

    assert.equal(entry.kind, "rag");

    const fetched = await service.get(entry.id);
    assert.equal(fetched?.kind, "rag");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService tags dependency majors and warns when the workspace bumps versions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memflow-deps-test-"));
  const dbPath = join(dir, "memflow.sqlite");
  const workspace = join(dir, "workspace");
  const packageJsonPath = join(workspace, "package.json");
  const connector = new SQLiteConnector({
    databasePath: dbPath,
  });

  try {
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: "memflow-workspace",
          version: "1.0.0",
          dependencies: {
            react: "^18.2.0",
          },
        },
        null,
        2
      )
    );

    const service = new MemoryService(connector);
    const stored = await service.upsert({
      key: "dependency-sensitive-pattern",
      content: "Use the React 18 layout shell.",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        repo: "memflow",
        scope: "project",
        workspace,
      },
      kind: "pattern",
      provenance: {
        source: "manual",
      },
    });

    assert.match(stored.tags.join(" "), /dependency:react:18\.x/);
    assert.ok(Array.isArray(stored.metadata.dependencies));

    writeFileSync(
      packageJsonPath,
      JSON.stringify(
        {
          name: "memflow-workspace",
          version: "1.0.0",
          dependencies: {
            react: "^19.0.0",
          },
        },
        null,
        2
      )
    );

    const refreshedService = new MemoryService(
      new SQLiteConnector({
        databasePath: dbPath,
      })
    );
    const fetched = await refreshedService.get(stored.id);

    assert.ok(fetched);
    assert.ok(Array.isArray(fetched.metadata.dependencyWarnings));
    assert.match(fetched.metadata.dependencyWarnings[0].warning, /React 18\.x/);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService surfaces matching workflow entries during prepare", async () => {
  const { service, dir } = createService();

  try {
    const workflow = await service.upsert(
      buildWorkflowWriteInput({
        content: [
          "# Deploy to staging",
          "",
          "1. Build the app",
          "2. Push the image",
          "",
          "## Prerequisites",
          "- Docker access",
          "- Environment variables set",
          "",
          "```sh",
          "npm run build",
          "npm run deploy:staging",
          "```",
        ].join("\n"),
        coordinates: {
          namespace: "workflow",
          project: "memflow",
          repo: "memflow",
          scope: "repo",
        },
        source: "manual",
        sourcePath: join(dir, ".agent/workflows/deploy-staging.md"),
      })
    );

    const prepared = await service.prepareAgentMemory({
      coordinates: {
        namespace: "sessions",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
        workspace: dir,
      },
      prompt: "deploy to staging",
      goal: "Deploy to staging",
    });

    assert.ok(prepared.workflows.some((entry) => entry.id === workflow.id));
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService seeds defaults and resumes compacted session state", async () => {
  const { service, dir } = createService();

  try {
    const initialized = await service.initializeDefaults({
      project: "memflow",
      repo: "memflow",
      user: "sean",
      workspace: "/tmp/memflow",
    });

    assert.equal(initialized.entries.length >= 3, true);
    assert.equal(initialized.syncPolicy.name, DEFAULT_MEMORY_SYNC_POLICY.name);

    const checkpoint = await service.checkpointSession({
      sessionId: "session-1",
      goal: "Finish automation layer",
      summary: "Wiring checkpoint and resume behavior",
      nextStep: "Run the build",
      coordinates: {
        namespace: "sessions",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
        user: "sean",
        workspace: "/tmp/memflow",
      },
      files: ["src/core/memory-service.ts", "src/mcp/tools.ts"],
    });

    assert.equal(checkpoint.kind, "session");
    assert.equal(checkpoint.coordinates.namespace, "sessions");

    const compacted = await service.compactSession({
      sessionId: "session-1",
      coordinates: {
        namespace: "sessions",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
        user: "sean",
        workspace: "/tmp/memflow",
      },
      goal: "Finish automation layer",
      summary: "Checkpoint, compaction, and sync routing are implemented.",
      nextStep: "Run npm test",
      activeFiles: ["src/core/memory-service.ts"],
      activeTodos: ["verify MCP tools"],
      transcript: ["Added automation service methods", "Need final verification"],
    });

    assert.equal(compacted.compacted.kind, "cache");
    assert.equal(compacted.compacted.coordinates.namespace, "cache");

    const resumed = await service.resumeSession({
      sessionId: "session-1",
      project: "memflow",
      repo: "memflow",
      scope: "workspace",
      user: "sean",
      workspace: "/tmp/memflow",
    });

    assert.equal(resumed.checkpoint?.metadata.sessionId, "session-1");
    assert.equal(resumed.compacted?.metadata.sessionId, "session-1");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService promotes patterns and exports by sync target", async () => {
  const { service, dir } = createService();

  try {
    const localSession = await service.checkpointSession({
      goal: "Local checkpoint",
      coordinates: {
        namespace: "sessions",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
        user: "sean",
        workspace: "/tmp/memflow",
      },
    });

    const sharedPattern = await service.promotePattern({
      title: "Avoid stale migration renames",
      failure: "Renamed RuFlo semantics instead of only the module path",
      rootCause: "Mixed product rename intent with migration codename behavior",
      safeFix: "Keep RuFlo API names stable and only rename internal product file paths",
      detection: "Flag changes that alter public migration command names",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
      tags: ["migration", "rename"],
    });

    const syncPlan = await service.syncPlan({
      project: "memflow",
      repo: "memflow",
      limit: 50,
    });

    const localDecision = syncPlan.decisions.find((decision) => decision.id === localSession.id);
    const sharedDecision = syncPlan.decisions.find((decision) => decision.id === sharedPattern.id);

    assert.equal(localDecision?.target, "local");
    assert.equal(sharedDecision?.target, "shared");

    const sharedBundle = await service.exportBySyncTarget("shared", {
      project: "memflow",
      repo: "memflow",
      limit: 50,
    });

    assert.equal(sharedBundle.entries.some((entry) => entry.id === sharedPattern.id), true);
    assert.equal(sharedBundle.entries.some((entry) => entry.id === localSession.id), false);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService stores, resolves, and invalidates prompt cache entries", async () => {
  const { service, dir } = createService();

  try {
    const stored = await service.storePromptCache({
      key: "auth-handler-v1",
      content: "Use the session-aware auth handler template.",
      coordinates: {
        namespace: "cache",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
      schemaVersion: 1,
      embeddingVersion: "none",
      tags: ["auth"],
    });

    assert.equal(stored.kind, "cache");

    const exact = await service.getPromptCache({
      key: "auth-handler-v1",
      coordinates: {
        namespace: "cache",
        project: "memflow",
        repo: "memflow",
      },
    });

    assert.equal(exact?.id, stored.id);

    const semantic = await service.getPromptCache({
      text: "session aware auth template",
      coordinates: {
        namespace: "cache",
        project: "memflow",
        repo: "memflow",
      },
    });

    assert.equal(semantic?.id, stored.id);

    const invalidated = await service.invalidatePromptCache({
      namespace: "cache",
      project: "memflow",
      repo: "memflow",
      schemaVersion: 1,
    });

    assert.equal(invalidated.deleted, 1);
    assert.deepEqual(invalidated.ids, [stored.id]);
    assert.equal(
      await service.getPromptCache({
        key: "auth-handler-v1",
        coordinates: {
          namespace: "cache",
          project: "memflow",
          repo: "memflow",
        },
      }),
      null
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService auto-resolves prompt cache entries from prompt fingerprint and fallback text", async () => {
  const { service, dir } = createService();

  try {
    const prompt = "Generate a session-aware auth handler for Express with workspace context.";
    const stored = await service.storePromptCacheAuto({
      prompt,
      task: "auth-handler",
      content: "Use the session-aware auth handler template.",
      coordinates: {
        namespace: "cache",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
      schemaVersion: 1,
      embeddingVersion: "none",
      tags: ["auth"],
    });

    assert.match(stored.key, /^prompt-cache:/);
    assert.equal(stored.metadata.task, "auth-handler");

    const exact = await service.getPromptCacheAuto({
      prompt,
      task: "auth-handler",
      coordinates: {
        namespace: "cache",
        project: "memflow",
        repo: "memflow",
      },
      schemaVersion: 1,
      embeddingVersion: "none",
    });

    assert.equal(exact?.id, stored.id);

    const fallback = await service.getPromptCacheAuto({
      prompt: "session aware auth handler express workspace",
      task: "different-task-name",
      coordinates: {
        namespace: "cache",
        project: "memflow",
        repo: "memflow",
      },
    });

    assert.equal(fallback?.id, stored.id);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService auto-embeds stored records and supports hybrid semantic search", async () => {
  const { service, dir } = createService();

  try {
    const stored = await service.upsert({
      key: "shared-pattern-auth-session",
      content: "Use session aware authentication middleware with workspace scoped recovery notes.",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
      provenance: {
        source: "manual",
      },
      kind: "pattern",
    });

    assert.equal(stored.embeddingVersion, MEMFLOW_EMBEDDING_VERSION_LOCAL);
    assert.equal(stored.embedding?.dimensions > 0, true);

    const results = await service.search({
      namespace: "patterns",
      project: "memflow",
      repo: "memflow",
      text: "workspace authentication recovery middleware",
      limit: 5,
    });

    assert.equal(results.length >= 1, true);
    assert.equal(results[0].entry.id, stored.id);
    assert.equal(results[0].score > 0, true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService prepare and finalize agent memory automate cache and compaction flow", async () => {
  const { service, dir } = createService();

  try {
    await service.upsertProfile({
      name: "workspace-defaults",
      content: "Keep coding context concise and reusable.",
      coordinates: {
        namespace: "persona",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
        user: "sean",
        workspace: "/tmp/memflow",
      },
    });

    await service.promotePattern({
      title: "Avoid stale auth cache",
      failure: "Old cache reused after schema change",
      rootCause: "Cache key ignored schema version",
      safeFix: "Invalidate cache on schema changes",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
    });

    const prepareBefore = await service.prepareAgentMemory({
      coordinates: {
        namespace: "sessions",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
        user: "sean",
        workspace: "/tmp/memflow",
      },
      sessionId: "agent-1",
      goal: "Avoid stale auth cache",
      prompt: "Avoid stale auth cache during auth patch generation",
      task: "auth-patch",
    });

    assert.equal(prepareBefore.profiles.length, 1);
    assert.equal(prepareBefore.patterns.length >= 1, true);
    assert.equal(prepareBefore.cache, null);

    const finalized = await service.finalizeAgentMemory({
      coordinates: {
        namespace: "sessions",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
        user: "sean",
        workspace: "/tmp/memflow",
      },
      sessionId: "agent-1",
      goal: "Avoid stale auth cache",
      summary: "Patched auth handler and preserved recovery state.",
      nextStep: "Run auth tests",
      prompt: "Avoid stale auth cache during auth patch generation",
      task: "auth-patch",
      output: "Use the session-aware auth handler template.",
      files: ["src/auth.ts"],
      activeFiles: ["src/auth.ts"],
      activeTodos: ["run auth tests"],
      transcript: ["Found stale handler", "Patched handler", "Saved cache"],
    });

    assert.equal(finalized.checkpoint.kind, "session");
    assert.equal(finalized.cache?.kind, "cache");
    assert.equal(finalized.compacted?.kind, "cache");

    const prepareAfter = await service.prepareAgentMemory({
      coordinates: {
        namespace: "sessions",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
        user: "sean",
        workspace: "/tmp/memflow",
      },
      sessionId: "agent-1",
      goal: "Avoid stale auth cache",
      prompt: "Avoid stale auth cache during auth patch generation",
      task: "auth-patch",
    });

    assert.equal(prepareAfter.cache?.id, finalized.cache?.id);
    assert.equal(prepareAfter.checkpoint?.metadata.sessionId, "agent-1");
    assert.equal(prepareAfter.compacted?.metadata.sessionId, "agent-1");

    const metrics = await service.metrics({
      project: "memflow",
      repo: "memflow",
      days: 7,
    });

    assert.equal(metrics.totals.agent_prepare >= 2, true);
    assert.equal(metrics.totals.agent_finalize >= 1, true);
    assert.equal(metrics.totals.cache_miss >= 1, true);
    assert.equal(metrics.totals.cache_hit >= 1, true);
    assert.equal(metrics.totals.cache_store >= 1, true);
    assert.equal(metrics.totals.checkpoint >= 1, true);
    assert.equal(metrics.totals.compaction >= 1, true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("MemoryService backfills embeddings for existing connector records", async () => {
  const { service, dir } = createService();

  try {
    const existing = await service.getConnector().upsert({
      key: "legacy-pattern-entry",
      content: "Legacy imported pattern without embeddings.",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
      provenance: {
        source: "bundle-import",
      },
      kind: "pattern",
    });

    assert.equal(existing.embeddingVersion, MEMFLOW_EMBEDDING_VERSION_NONE);

    const result = await service.backfillEmbeddings({
      namespace: "patterns",
      project: "memflow",
      repo: "memflow",
    });

    assert.equal(result.updated, 1);

    const refreshed = await service.get(existing.id);
    assert.equal(refreshed?.embeddingVersion, MEMFLOW_EMBEDDING_VERSION_LOCAL);
    assert.equal(refreshed?.embedding?.dimensions > 0, true);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
