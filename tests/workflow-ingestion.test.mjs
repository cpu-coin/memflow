import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { parseWorkflowMarkdown, buildWorkflowWriteInput } from "../dist/core/workflow-ingestion.js";

test("parseWorkflowMarkdown extracts title from top-level heading", () => {
  const result = parseWorkflowMarkdown("# Deploy to Production\n\nSome intro text.");
  assert.equal(result.title, "Deploy to Production");
});

test("parseWorkflowMarkdown extracts ordered steps", () => {
  const markdown = [
    "# Steps",
    "",
    "1. Build the app",
    "2. Push the Docker image",
    "3. Run smoke tests",
  ].join("\n");

  const result = parseWorkflowMarkdown(markdown);
  assert.equal(result.steps.length, 3);
  assert.equal(result.steps[0], "Build the app");
  assert.equal(result.steps[2], "Run smoke tests");
});

test("parseWorkflowMarkdown extracts code blocks and shell commands", () => {
  const markdown = [
    "# Build",
    "",
    "```sh",
    "npm run build",
    "npm run deploy:staging",
    "```",
    "",
    "```typescript",
    "const x = 1;",
    "```",
  ].join("\n");

  const result = parseWorkflowMarkdown(markdown);
  assert.equal(result.codeBlocks.length, 2);
  assert.equal(result.shellCommands.length, 2);
  assert.ok(result.shellCommands.includes("npm run build"));
  assert.ok(result.shellCommands.includes("npm run deploy:staging"));
});

test("parseWorkflowMarkdown extracts prerequisites from prerequisite section", () => {
  const markdown = [
    "# Deploy",
    "",
    "## Prerequisites",
    "- Docker installed",
    "- AWS credentials configured",
    "",
    "## Steps",
    "1. Run deploy",
  ].join("\n");

  const result = parseWorkflowMarkdown(markdown);
  assert.equal(result.prerequisites.length, 2);
  assert.ok(result.prerequisites.includes("Docker installed"));
  assert.ok(result.prerequisites.includes("AWS credentials configured"));
});

test("parseWorkflowMarkdown deduplicates shell commands", () => {
  const markdown = [
    "# Build",
    "",
    "```sh",
    "npm run build",
    "```",
    "",
    "```sh",
    "npm run build",
    "```",
  ].join("\n");

  const result = parseWorkflowMarkdown(markdown);
  assert.equal(result.shellCommands.length, 1);
});

test("parseWorkflowMarkdown extracts summary from pre-heading content", () => {
  const markdown = [
    "This workflow handles production deployments.",
    "",
    "# Deploy to Production",
    "",
    "1. Build",
  ].join("\n");

  const result = parseWorkflowMarkdown(markdown);
  assert.equal(result.summary, "This workflow handles production deployments.");
});

test("parseWorkflowMarkdown falls back to sourcePath for title when no heading", () => {
  const result = parseWorkflowMarkdown("Just some text.", "/path/to/deploy-staging.md");
  assert.equal(result.title, "deploy-staging");
});

test("parseWorkflowMarkdown recognizes multiple shell command prefixes", () => {
  const markdown = [
    "# Commands",
    "",
    "```sh",
    "$ echo hello",
    "git status",
    "node index.js",
    "cargo build",
    "go run main.go",
    "yarn install",
    "pnpm build",
    "bun run dev",
    "```",
  ].join("\n");

  const result = parseWorkflowMarkdown(markdown);
  assert.equal(result.shellCommands.length, 8);
  assert.ok(result.shellCommands.includes("echo hello")); // $ prefix stripped
  assert.ok(result.shellCommands.includes("git status"));
  assert.ok(result.shellCommands.includes("cargo build"));
});

test("buildWorkflowWriteInput produces valid MemoryWriteInput", () => {
  const input = buildWorkflowWriteInput({
    content: "# Deploy\n\n1. Build\n2. Push\n\n```sh\nnpm run build\n```",
    coordinates: {
      namespace: "workflow",
      project: "test-project",
      scope: "repo",
    },
    source: "manual",
    sourcePath: "/workflows/deploy.md",
  });

  assert.equal(input.kind, "workflow");
  assert.ok(input.key.startsWith("workflow:"));
  assert.ok(input.tags.includes("workflow"));
  assert.ok(input.tags.includes("ingested"));
  assert.ok(input.tags.includes("steps"));
  assert.ok(input.tags.includes("shell"));
  assert.ok(input.tags.includes("code"));
  assert.equal(input.coordinates.namespace, "workflow");
  assert.equal(input.metadata.parsedWorkflow.steps.length, 2);
  assert.equal(input.metadata.parsedWorkflow.shellCommands.length, 1);
});

test("buildWorkflowWriteInput uses custom title when provided", () => {
  const input = buildWorkflowWriteInput({
    content: "# Auto Title\n\n1. Step one",
    coordinates: {
      namespace: "workflow",
      project: "test",
      scope: "repo",
    },
    title: "Custom Override Title",
  });

  assert.equal(input.title, "Custom Override Title");
});

test("parseWorkflowMarkdown handles empty content gracefully", () => {
  const result = parseWorkflowMarkdown("");
  assert.equal(result.title, "workflow");
  assert.equal(result.steps.length, 0);
  assert.equal(result.codeBlocks.length, 0);
  assert.equal(result.shellCommands.length, 0);
  assert.equal(result.prerequisites.length, 0);
  assert.equal(result.summary, "");
});
