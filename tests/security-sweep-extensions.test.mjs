import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testHome = join(tmpdir(), `memflow-test-sweep-ext-${Date.now()}`);
mkdirSync(testHome, { recursive: true });
process.env.MEMFLOW_HOME = testHome;

// Import compiled files
const { ToolGuard } = await import("../dist/mcp/guard.js");
const { SecuritySweepBlockError } = await import("../dist/core/errors.js");
const { MemoryService } = await import("../dist/core/memory-service.js");
const { createConnectorFromEnvironment } = await import("../dist/mcp/server.js");
const { readMemFlowConfig, writeMemFlowConfig } = await import("../dist/core/config.js");

function writeTestConfig(securitySweep) {
  const config = {
    version: "1",
    profile: "default",
    connector: "sqlite",
    databasePath: join(testHome, "memflow.sqlite"),
    automation: {
      autoCompact: true,
      autoFinalize: true,
      autoPrepare: true,
      autoPromptCache: true,
      enabled: true,
      metrics: true,
    },
    trackedProjects: [],
    securitySweep,
  };
  writeFileSync(join(testHome, "config.json"), JSON.stringify(config, null, 2), "utf8");
}

function freshGuard() {
  const g = new ToolGuard();
  g.invalidateSweepConfigCache();
  return g;
}

// ─── Trusted Namespaces Tests ───────────────────────────────────────────────

test("ToolGuard - Trusted namespace is exempt from inbound sweep blocking", async () => {
  writeTestConfig({
    enabled: true,
    level: "block",
    rules: { apiKeys: true },
    trustedNamespaces: ["trusted-ns"],
  });
  const guard = freshGuard();
  const apiKey = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";

  // In trusted namespace, it should not reject
  await assert.doesNotReject(
    guard.run("memory_store", {
      content: `Save key: ${apiKey}`,
      coordinates: { namespace: "trusted-ns", scope: "workspace" },
    }, async () => "ok"),
    "trusted namespace should bypass block rule"
  );

  // In untrusted namespace, it should reject
  await assert.rejects(
    guard.run("memory_store", {
      content: `Save key: ${apiKey}`,
      coordinates: { namespace: "untrusted-ns", scope: "workspace" },
    }, async () => "ok"),
    (err) => err instanceof SecuritySweepBlockError,
    "untrusted namespace should still block"
  );
});

// ─── Outbound Response Sweep Tests ─────────────────────────────────────────

test("ToolGuard - Outbound response sweep blocks leaks on memory_agent_prepare", async () => {
  writeTestConfig({
    enabled: true,
    level: "block",
    rules: { apiKeys: true },
  });
  const guard = freshGuard();
  const apiKey = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";

  const executeFn = async () => JSON.stringify({
    profiles: [
      { id: "1", key: "secret", content: `API Key is: ${apiKey}` },
    ],
  });

  await assert.rejects(
    guard.run("memory_agent_prepare", { coordinates: { namespace: "any-ns", scope: "workspace" } }, executeFn),
    (err) => err instanceof SecuritySweepBlockError,
    "outbound sweep should block sensitive data leakage in prepare response"
  );
});

test("ToolGuard - Outbound response sweep redacts leaks recursively in redact mode", async () => {
  writeTestConfig({
    enabled: true,
    level: "redact",
    rules: { apiKeys: true },
  });
  const guard = freshGuard();
  const apiKey = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";

  const result = await guard.run(
    "memory_agent_prepare",
    { coordinates: { namespace: "any-ns", scope: "workspace" } },
    async () => JSON.stringify({
      profiles: [
        { id: "1", key: "secret", content: `API Key is: ${apiKey}` },
      ],
    })
  );

  const parsed = JSON.parse(result);
  assert.equal(parsed.profiles[0].content, "API Key is: [REDACTED_OPENAI_API_KEY]");
  assert.ok(Array.isArray(parsed._securityWarnings));
  assert.match(parsed._securityWarnings[0], /OUTBOUND/);
});

test("ToolGuard - Outbound response sweep allows trusted namespace", async () => {
  writeTestConfig({
    enabled: true,
    level: "block",
    rules: { apiKeys: true },
    trustedNamespaces: ["trusted-outbound"],
  });
  const guard = freshGuard();
  const apiKey = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";

  const result = await guard.run(
    "memory_agent_prepare",
    { coordinates: { namespace: "trusted-outbound", scope: "workspace" } },
    async () => JSON.stringify({
      profiles: [
        { id: "1", key: "secret", content: `API Key is: ${apiKey}` },
      ],
    })
  );

  const parsed = JSON.parse(result);
  assert.equal(parsed.profiles[0].content, `API Key is: ${apiKey}`, "trusted namespace should bypass outbound redact/block");
  assert.equal(parsed._securityWarnings, undefined);
});

// ─── Static Security Audit Tests ───────────────────────────────────────────

test("MemoryService - Static Audit finds stored credentials", async () => {
  writeTestConfig({
    enabled: true,
    level: "warn",
    rules: { privateKeys: true, apiKeys: true, databaseUris: true, pii: false },
  });

  const connector = createConnectorFromEnvironment(join(testHome, "config.json"));
  const service = new MemoryService(connector);
  await service.initializeDefaults({
    project: "test-proj",
    repo: "test-repo",
    scope: "workspace",
    workspace: testHome,
    source: "manual",
  });

  // Write clean entry
  await service.upsert({
    key: "clean-entry",
    content: "Just standard configuration details without any key.",
    coordinates: { namespace: "default", scope: "workspace" },
    provenance: { source: "manual" },
  });

  // Write sensitive entry
  const apiKey = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";
  await service.upsert({
    key: "sensitive-entry",
    content: `Here is the openai secret: ${apiKey}`,
    coordinates: { namespace: "default", scope: "workspace" },
    provenance: { source: "manual" },
    metadata: { bypassSecuritySweep: true }, // Bypass in metadata
  });

  const entries = await service.list({ limit: 10000 });
  assert.ok(entries.length >= 2);

  // Perform programmatic scan (matching runSecurityAuditCommand logic)
  const { SecuritySweepEngine } = await import("../dist/core/security-sweep.js");
  const sweepEngine = new SecuritySweepEngine({
    enabled: true,
    rules: { privateKeys: true, apiKeys: true, databaseUris: true, pii: false },
  });

  const findings = [];
  for (const entry of entries) {
    const contentRes = sweepEngine.sweep(entry.content);
    if (contentRes.hasMatches) {
      findings.push({ key: entry.key, matches: contentRes.matches });
    }
  }

  assert.equal(findings.length, 1);
  assert.equal(findings[0].key, "sensitive-entry");
  assert.equal(findings[0].matches[0].type, "OpenAI API Key");
});

test.after(() => {
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures
  }
});
