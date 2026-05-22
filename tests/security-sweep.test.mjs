import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate test configuration directory to avoid touching user data
const testHome = join(tmpdir(), `memflow-test-sweep-${Date.now()}`);
mkdirSync(testHome, { recursive: true });
process.env.MEMFLOW_HOME = testHome;

// Import compiled code after setting environment variables
const { SecuritySweepEngine } = await import("../dist/core/security-sweep.js");
const { ToolGuard } = await import("../dist/mcp/guard.js");
const { SecuritySweepBlockError } = await import("../dist/core/errors.js");

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

// ─── SecuritySweepEngine unit tests ──────────────────────────────────────────

test("SecuritySweepEngine - Detects and redacts PEM private key", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "warn",
    rules: { privateKeys: true, apiKeys: false, databaseUris: false, pii: false },
  });
  const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE=\n-----END OPENSSH PRIVATE KEY-----";
  const result = engine.sweep(`Config: ${key}`);
  assert.equal(result.hasMatches, true);
  assert.equal(result.matches[0].type, "Private Key");
  assert.ok(result.redactedContent.includes("[REDACTED_PRIVATE_KEY]"));
});

test("SecuritySweepEngine - Detects OpenAI API key", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "warn",
    rules: { privateKeys: false, apiKeys: true, databaseUris: false, pii: false },
  });
  const key = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";
  const result = engine.sweep(`Key: ${key}`);
  assert.equal(result.hasMatches, true);
  assert.equal(result.matches[0].type, "OpenAI API Key");
  assert.equal(result.redactedContent, "Key: [REDACTED_OPENAI_API_KEY]");
});

test("SecuritySweepEngine - Detects AWS Access Key ID (AKIA prefix)", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "warn",
    rules: { privateKeys: false, apiKeys: true, databaseUris: false, pii: false },
  });
  const key = "AKIAIOSFODNN7EXAMPLE";
  const result = engine.sweep(`Access key: ${key}`);
  assert.equal(result.hasMatches, true);
  assert.equal(result.matches[0].type, "AWS Access Key ID");
});

test("SecuritySweepEngine - Detects AWS Secret Access Key with variable context", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "warn",
    rules: { privateKeys: false, apiKeys: true, databaseUris: false, pii: false },
  });
  const content = "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
  const result = engine.sweep(content);
  assert.equal(result.hasMatches, true);
  assert.equal(result.matches[0].type, "AWS Secret Access Key");
});

test("SecuritySweepEngine - Detects Anthropic sid01 API key", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "warn",
    rules: { privateKeys: false, apiKeys: true, databaseUris: false, pii: false },
  });
  const key = "sk-ant-sid01-" + "a".repeat(93);
  const result = engine.sweep(`Key: ${key}`);
  assert.equal(result.hasMatches, true);
  assert.equal(result.matches[0].type, "Anthropic API Key");
});

test("SecuritySweepEngine - Detects Anthropic api03 API key", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "warn",
    rules: { privateKeys: false, apiKeys: true, databaseUris: false, pii: false },
  });
  const key = "sk-ant-api03-" + "b".repeat(93);
  const result = engine.sweep(`Key: ${key}`);
  assert.equal(result.hasMatches, true);
  assert.equal(result.matches[0].type, "Anthropic API Key");
});

test("SecuritySweepEngine - Detects GitHub token", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "warn",
    rules: { privateKeys: false, apiKeys: true, databaseUris: false, pii: false },
  });
  const token = "ghp_" + "A".repeat(36);
  const result = engine.sweep(`Token: ${token}`);
  assert.equal(result.hasMatches, true);
  assert.equal(result.matches[0].type, "GitHub Token");
});

test("SecuritySweepEngine - Database password swept before email rule fires", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "warn",
    rules: { privateKeys: false, apiKeys: false, databaseUris: true, pii: true },
  });
  // The db URI has user:pass@host — without priority ordering the @ could trigger email
  const dbUri = "mongodb+srv://admin:my-super-secret-password-123@cluster0.abcde.mongodb.net/test";
  const result = engine.sweep(`Connect via: ${dbUri}`);
  const types = result.matches.map((m) => m.type);
  // Database Password must be detected, Email Address must NOT appear
  assert.ok(types.includes("Database Password"), "should detect db password");
  assert.ok(!types.includes("Email Address"), "should not false-positive on db authority as email");
  assert.ok(result.redactedContent.includes("[REDACTED_PASSWORD]"));
  assert.ok(!result.redactedContent.includes("my-super-secret-password-123"));
});

test("SecuritySweepEngine - Credit card with separator detected, bare number not flagged", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "warn",
    rules: { privateKeys: false, apiKeys: false, databaseUris: false, pii: true },
  });
  // Standard card format (should trigger)
  const withSep = engine.sweep("Card: 4111-2222-3333-4444");
  assert.equal(withSep.hasMatches, true, "card with dashes should match");

  // Timestamp/build ID (should NOT trigger anymore)
  const noSep = engine.sweep("build: 1747695239000");
  assert.equal(noSep.hasMatches, false, "bare timestamp should not match as credit card");

  // Version string (should NOT trigger)
  const version = engine.sweep("version: 1234567890123");
  assert.equal(version.hasMatches, false, "version string should not match as credit card");
});

test("SecuritySweepEngine - Custom regex patterns", () => {
  const engine = new SecuritySweepEngine({
    enabled: true, level: "block",
    customPatterns: [{ name: "Internal Secret Token", regex: "CONFIDENTIAL-TOKEN-[A-Z]{5}" }],
  });
  const result = engine.sweep("Use CONFIDENTIAL-TOKEN-ABCDE to authenticate.");
  assert.equal(result.hasMatches, true);
  assert.equal(result.matches[0].type, "Internal Secret Token");
  assert.equal(result.redactedContent, "Use [REDACTED_INTERNAL_SECRET_TOKEN] to authenticate.");
});

test("SecuritySweepEngine - Disabled returns no matches", () => {
  const engine = new SecuritySweepEngine({ enabled: false, level: "block" });
  const result = engine.sweep("sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL");
  assert.equal(result.hasMatches, false);
});

// ─── ToolGuard integration tests ─────────────────────────────────────────────

test("ToolGuard - Write tools are swept, read tools are not", async () => {
  writeTestConfig({ enabled: true, level: "block", rules: { apiKeys: true } });
  const guard = freshGuard();
  const apiKeyContent = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";

  // memory_search is a read tool — should pass through even with block mode
  await assert.doesNotReject(
    guard.run("memory_search", { text: apiKeyContent }, async () => JSON.stringify({ results: [] })),
    "read-only tool should not be swept"
  );

  // memory_store is a write tool — should be blocked in block mode
  await assert.rejects(
    guard.run("memory_store", { content: apiKeyContent, coordinates: { namespace: "test", scope: "workspace" } }, async () => "ok"),
    (err) => err instanceof SecuritySweepBlockError,
    "write tool should be blocked"
  );
});

test("ToolGuard - Block level throws SecuritySweepBlockError with actionable message", async () => {
  writeTestConfig({ enabled: true, level: "block", rules: { apiKeys: true } });
  const guard = freshGuard();
  const anthropicKey = "sk-ant-api03-" + "X".repeat(93);

  await assert.rejects(
    guard.run("memory_store", {
      content: `Using key: ${anthropicKey}`,
      coordinates: { namespace: "deploy", scope: "workspace" },
    }, async () => "ok"),
    (err) => {
      assert.ok(err instanceof SecuritySweepBlockError);
      assert.match(err.message, /\[SECURITY SWEEP BLOCK\]/);
      assert.match(err.message, /Anthropic API Key/);
      assert.match(err.message, /bypassSecuritySweep/);
      assert.match(err.message, /memflow security:sweep level/);
      return true;
    }
  );
});

test("ToolGuard - Redact level replaces strings in-place including arrays", async () => {
  writeTestConfig({ enabled: true, level: "redact", rules: { apiKeys: true } });
  const guard = freshGuard();
  const stripeKey = "sk_test_" + "123456789012345678901234";

  const payload = {
    key: "stripe-config",
    content: `Configure stripe token: ${stripeKey}`,
    transcript: [`First message with key: ${stripeKey}`, "Second clean message"],
    coordinates: { namespace: "config", scope: "workspace" },
  };

  await guard.run("memory_store", payload, async () => JSON.stringify({ stored: true }));

  // content field must be redacted
  assert.equal(payload.content, "Configure stripe token: [REDACTED_STRIPE_API_KEY]");
  // array items must also be redacted
  assert.equal(payload.transcript[0], "First message with key: [REDACTED_STRIPE_API_KEY]");
  assert.equal(payload.transcript[1], "Second clean message");
});

test("ToolGuard - Warn level returns warning inside JSON response", async () => {
  writeTestConfig({ enabled: true, level: "warn", rules: { apiKeys: true } });
  const guard = freshGuard();
  const openaiKey = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";

  const result = await guard.run(
    "memory_store",
    { content: `Key: ${openaiKey}`, coordinates: { namespace: "test", scope: "workspace" } },
    async () => JSON.stringify({ id: "abc123", stored: true })
  );

  const parsed = JSON.parse(result);
  assert.ok(Array.isArray(parsed._securityWarnings), "response should contain _securityWarnings");
  assert.ok(parsed._securityWarnings.length > 0, "should have at least one warning");
  assert.match(parsed._securityWarnings[0], /SECURITY SWEEP WARNING/);
  assert.match(parsed._securityWarnings[0], /OpenAI API Key/);
  // Original fields should still be present
  assert.equal(parsed.id, "abc123");
  assert.equal(parsed.stored, true);
});

test("ToolGuard - Bypass via coordinates passes through block mode", async () => {
  writeTestConfig({ enabled: true, level: "block", rules: { apiKeys: true } });
  const guard = freshGuard();
  const openaiKey = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";

  // bypass in coordinates (now valid because bypassSecuritySweep is in coordinatesSchema)
  const result = await guard.run(
    "memory_store",
    {
      content: `Key: ${openaiKey}`,
      coordinates: { namespace: "test", scope: "workspace", bypassSecuritySweep: true },
    },
    async () => JSON.stringify({ id: "bypassed" })
  );

  const parsed = JSON.parse(result);
  assert.equal(parsed.id, "bypassed");
  // bypass notice should appear in warnings
  assert.ok(Array.isArray(parsed._securityWarnings));
  assert.match(parsed._securityWarnings[0], /BYPASSED/);
});

test("ToolGuard - Bypass via metadata passes through block mode", async () => {
  writeTestConfig({ enabled: true, level: "block", rules: { apiKeys: true } });
  const guard = freshGuard();
  const openaiKey = "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDeFgHiJkL";

  const result = await guard.run(
    "memory_store",
    {
      content: `Key: ${openaiKey}`,
      coordinates: { namespace: "test", scope: "workspace" },
      metadata: { bypassSecuritySweep: true },
    },
    async () => JSON.stringify({ id: "bypassed-meta" })
  );

  const parsed = JSON.parse(result);
  assert.equal(parsed.id, "bypassed-meta");
});

test("ToolGuard - Disabled sweep passes all content unchanged", async () => {
  writeTestConfig({ enabled: false, level: "block", rules: { apiKeys: true } });
  const guard = freshGuard();

  const result = await guard.run(
    "memory_store",
    { content: "sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789", coordinates: { namespace: "x", scope: "workspace" } },
    async () => JSON.stringify({ ok: true })
  );
  const parsed = JSON.parse(result);
  assert.equal(parsed.ok, true);
  assert.equal(parsed._securityWarnings, undefined, "no warnings when sweep is disabled");
});

// Cleanup test home directory
test.after(() => {
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures
  }
});
