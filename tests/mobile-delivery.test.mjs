import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MOBILE_CHANNEL_PREVIEW_MAX_CHARS,
  MOBILE_RESPONSE_MAX_CHARS,
  mobileChannelPreview,
  mobileSafeOutboxWrite,
  mobileSafeResponse,
  normalizeMobileChannel,
} from "../dist/core/mobile-delivery.js";

test("mobileSafeResponse passes concise plain text through unchanged", () => {
  const result = mobileSafeResponse("Done. I changed the mobile bridge and ran tests.");

  assert.equal(result.delivered, "Done. I changed the mobile bridge and ran tests.");
  assert.equal(result.reason, "ok");
  assert.equal(result.truncated, false);
});

test("mobileSafeResponse caps long plain text", () => {
  const result = mobileSafeResponse("a".repeat(MOBILE_RESPONSE_MAX_CHARS + 500));

  assert.equal(result.reason, "large");
  assert.equal(result.truncated, true);
  assert.match(result.delivered, /Mobile-safe preview/);
  assert.ok(result.delivered.length < MOBILE_RESPONSE_MAX_CHARS + 300);
});

test("mobileSafeResponse withholds code-heavy payloads from mobile", () => {
  const codeDump = [
    "Here is the implementation:",
    "```ts",
    "export function example() {",
    ...Array.from({ length: 80 }, (_, index) => `  const line${index} = ${index};`),
    "}",
    "```",
  ].join("\n");

  const result = mobileSafeResponse(codeDump);

  assert.equal(result.reason, "code-heavy");
  assert.equal(result.truncated, true);
  assert.match(result.delivered, /appears to contain code or diff output/);
  assert.doesNotMatch(result.delivered, /const line79/);
  assert.doesNotMatch(result.delivered, /```/);
});

test("mobileSafeResponse withholds short code-heavy payloads from mobile", () => {
  const result = mobileSafeResponse([
    "export function saveResult(value) {",
    "  const normalized = String(value).trim();",
    "  return normalized;",
    "}",
  ].join("\n"));

  assert.equal(result.reason, "code-heavy");
  assert.equal(result.truncated, true);
  assert.match(result.delivered, /appears to contain code or diff output/);
  assert.doesNotMatch(result.delivered, /const normalized/);
});

test("mobileSafeOutboxWrite sanitizes direct ag_bridge outbox writes", () => {
  const write = mobileSafeOutboxWrite({
    key: "ag_bridge/outbox/manual",
    content: [
      "```ts",
      "export const leaked = true;",
      "```",
    ].join("\n"),
    coordinates: { namespace: "ag_bridge/outbox", scope: "workspace" },
    tags: ["agent-response"],
    metadata: { channel: "work" },
    provenance: { source: "agent" },
  });

  assert.match(write.content, /Mobile-safe notice/);
  assert.doesNotMatch(write.content, /export const leaked/);
  assert.ok(write.tags.includes("unread"));
  assert.ok(write.tags.includes("ag_bridge"));
  assert.equal(write.metadata.status, "unread");
  assert.equal(write.metadata.mobileDelivery.reason, "code-heavy");
  assert.equal(write.metadata.mobileDelivery.truncated, true);
});

test("mobileSafeOutboxWrite leaves non-outbox writes unchanged", () => {
  const write = {
    content: "```ts\nexport const keep = true;\n```",
    coordinates: { namespace: "notes", scope: "workspace" },
  };

  assert.equal(mobileSafeOutboxWrite(write), write);
});

test("mobileChannelPreview caps dashboard channel text", () => {
  const preview = mobileChannelPreview("x".repeat(MOBILE_CHANNEL_PREVIEW_MAX_CHARS + 100));

  assert.equal(preview.length, MOBILE_CHANNEL_PREVIEW_MAX_CHARS);
  assert.match(preview, /\.\.\.$/);
});

test("normalizeMobileChannel keeps debug separate and sanitizes labels", () => {
  assert.equal(normalizeMobileChannel("debug"), "debug");
  assert.equal(normalizeMobileChannel(" Debug Session "), "debug-session");
  assert.equal(normalizeMobileChannel(undefined), "work");
});
