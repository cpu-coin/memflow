import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MEMORY_SYNC_POLICY,
  DefaultDeploymentScopeResolver,
  applyDeploymentScope,
  buildSyncPlan,
  resolveSyncTarget,
} from "../dist/connectors/deployment.js";

test("deployment scope resolver fills required user scope", async () => {
  const resolver = new DefaultDeploymentScopeResolver({
    connectorId: "firebase-user-memory",
    mode: "user-scoped",
    enforceTenant: true,
    enforceUser: true,
    requireWorkspace: true,
  });

  const scoped = applyDeploymentScope(
    {
      key: "persona-style",
      content: "User prefers concise answers",
      coordinates: {
        namespace: "persona",
        scope: "user",
      },
      provenance: {
        source: "manual",
      },
    },
    {
      tenant: "tenant-1",
      user: "user-1",
      workspace: "workspace-1",
    },
    resolver
  );

  assert.equal(scoped.coordinates.tenant, "tenant-1");
  assert.equal(scoped.coordinates.user, "user-1");
  assert.equal(scoped.coordinates.workspace, "workspace-1");
});

test("deployment scope resolver rejects missing required user scope", async () => {
  const resolver = new DefaultDeploymentScopeResolver({
    connectorId: "firebase-user-memory",
    mode: "user-scoped",
    enforceTenant: false,
    enforceUser: true,
  });

  assert.throws(
    () =>
      resolver.resolveCoordinates(
        {
          namespace: "persona",
          scope: "user",
        },
        {}
      ),
    /requires a user scope/
  );
});

test("default sync policy keeps workspace sessions local and project patterns shared", async () => {
  const localDecision = resolveSyncTarget(
    {
      id: "local-1",
      key: "session:workspace:active",
      title: "Active session",
      content: "checkpoint",
      namespace: "sessions",
      projectId: "memflow",
      coordinates: {
        namespace: "sessions",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
        workspace: "/tmp/memflow",
      },
      kind: "session",
      tags: [],
      metadata: {},
      source: "manual",
      provenance: {
        source: "manual",
      },
      schemaVersion: 1,
      embeddingVersion: "none",
      contentHash: "hash-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    },
    DEFAULT_MEMORY_SYNC_POLICY
  );

  const sharedDecision = resolveSyncTarget(
    {
      id: "shared-1",
      key: "pattern:project:rename-guard",
      title: "Rename guard",
      content: "pattern",
      namespace: "patterns",
      projectId: "memflow",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
      kind: "pattern",
      tags: [],
      metadata: {},
      source: "manual",
      provenance: {
        source: "manual",
      },
      schemaVersion: 1,
      embeddingVersion: "none",
      contentHash: "hash-2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    },
    DEFAULT_MEMORY_SYNC_POLICY
  );

  assert.equal(localDecision.target, "local");
  assert.equal(sharedDecision.target, "shared");
});

test("buildSyncPlan counts routed entries", async () => {
  const plan = buildSyncPlan([
    {
      id: "local-1",
      key: "session:workspace:active",
      title: "Active session",
      content: "checkpoint",
      namespace: "sessions",
      projectId: "memflow",
      coordinates: {
        namespace: "sessions",
        project: "memflow",
        repo: "memflow",
        scope: "workspace",
      },
      kind: "session",
      tags: [],
      metadata: {},
      source: "manual",
      provenance: {
        source: "manual",
      },
      schemaVersion: 1,
      embeddingVersion: "none",
      contentHash: "hash-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    },
    {
      id: "shared-1",
      key: "pattern:project:rename-guard",
      title: "Rename guard",
      content: "pattern",
      namespace: "patterns",
      projectId: "memflow",
      coordinates: {
        namespace: "patterns",
        project: "memflow",
        repo: "memflow",
        scope: "project",
      },
      kind: "pattern",
      tags: [],
      metadata: {},
      source: "manual",
      provenance: {
        source: "manual",
      },
      schemaVersion: 1,
      embeddingVersion: "none",
      contentHash: "hash-2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    },
  ]);

  assert.equal(plan.local, 1);
  assert.equal(plan.shared, 1);
  assert.equal(plan.both, 0);
  assert.equal(plan.total, 2);
});
