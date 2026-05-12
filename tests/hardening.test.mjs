import { test } from "node:test";
import assert from "node:assert/strict";
import { 
  findTrackedProjectForPath,
  MemoryService,
} from "../dist/index.js";

test("findTrackedProjectForPath handles case-insensitive matching on macOS", async () => {
    // This test is specifically for macOS behavior
    if (process.platform !== "darwin") return;

    const tracked = [
        {
            enabled: true,
            name: "test-project",
            path: "/users/REDACTED/projects/test",
            project: "test",
            repo: "test",
            addedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    ];

    // Current shell reports uppercase /Users
    const currentPath = "/Users/REDACTED/projects/test/src/main.js";
    const matched = findTrackedProjectForPath(tracked, currentPath);

    assert.ok(matched, "Should have matched despite casing difference");
    assert.equal(matched.name, "test-project");
});

test("prepareAgentMemory injects Claude caching hints", async () => {
    const mockConnector = {
        health: async () => ({ ok: true }),
        list: async () => [
            { 
                id: "p1", 
                key: "persona:test", 
                kind: "persona", 
                content: "persona text", 
                coordinates: { namespace: "persona", scope: "user" },
                metadata: {},
                updatedAt: new Date().toISOString() 
            },
            { 
                id: "s1", 
                key: "compact:test", 
                kind: "session", 
                content: "history text", 
                coordinates: { namespace: "sessions", scope: "workspace" },
                metadata: { sessionId: "test-session" },
                updatedAt: new Date().toISOString() 
            }
        ],
        export: async () => ({ entries: [] }),
        get: async () => null,
        search: async () => [],
        stats: async () => ({}),
        metrics: async () => ({ recent: [], totals: {} }),
        delete: async () => ({ deleted: true }),
        import: async () => ({}),
        merge: async () => ({}),
        diff: async () => ({ added: [], changed: [], removed: [] }),
        upsert: async (e) => e
    };

    const service = new MemoryService(mockConnector);
    const result = await service.prepareAgentMemory({
        coordinates: { namespace: "test", scope: "workspace" },
        supplier: "claude"
    });

    // Verify profile hints
    assert.ok(result.profiles.length > 0);
    assert.deepEqual(result.profiles[0].cacheControl, { type: "ephemeral" });

    // Verify session hint (if compacted exists)
    if (result.compacted) {
        assert.deepEqual(result.compacted.cacheControl, { type: "ephemeral" });
    }
});
