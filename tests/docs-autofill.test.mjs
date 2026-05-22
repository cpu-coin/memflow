import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Import compiled or source docs-autofill utility
const { autofillFileDocs } = await import("../dist/core/docs-autofill.js");

const testHome = join(tmpdir(), `memflow-test-docs-${Date.now()}`);
mkdirSync(testHome, { recursive: true });

test("Docs Autofill - Injects module header and JSDoc for functions with parameters", () => {
  const filePath = join(testHome, "sample.ts");
  const code = [
    `export function calculateOperationalSavings(cacheHits: number, totalTokens?: number): number {`,
    `  return cacheHits * 0.0015;`,
    `}`,
    ``,
    `export const formatGuideline = (text: string, flag = false) => {`,
    `  return text.trim();`,
    `};`
  ].join("\n");
  
  writeFileSync(filePath, code, "utf8");
  
  const result = autofillFileDocs(filePath);
  assert.equal(result.updated, true, "should report file as updated");
  assert.equal(result.injectedHeader, true, "should report header as injected");
  assert.deepEqual(result.injectedItems, ["calculateOperationalSavings", "formatGuideline"], "should find both exports");
  
  const updatedContent = readFileSync(filePath, "utf8");
  
  // Verify top-level header is present
  assert.ok(updatedContent.includes("@file sample.ts"), "header should reference file name");
  assert.ok(updatedContent.includes("@description Automatically documented module."), "header description should exist");
  
  // Verify calculateOperationalSavings JSDoc
  assert.ok(updatedContent.includes("calculateOperationalSavings"), "should have JSDoc for function");
  assert.ok(updatedContent.includes("@param cacheHits"), "should parse first parameter");
  assert.ok(updatedContent.includes("@param totalTokens"), "should parse second optional parameter");
  
  // Verify formatGuideline arrow JSDoc
  assert.ok(updatedContent.includes("formatGuideline"), "should have JSDoc for arrow function");
  assert.ok(updatedContent.includes("@param text"), "should parse arrow parameter");
  assert.ok(updatedContent.includes("@param flag"), "should parse arrow default parameter");
});

test("Docs Autofill - Injects JSDoc for class exports", () => {
  const filePath = join(testHome, "model.ts");
  const code = [
    `/**`,
    ` * @file model.ts`,
    ` */`,
    `export class SecurityAuditLogs {`,
    `  constructor() {}`,
    `}`
  ].join("\n");
  
  writeFileSync(filePath, code, "utf8");
  
  const result = autofillFileDocs(filePath);
  assert.equal(result.updated, true, "should update file");
  assert.equal(result.injectedHeader, false, "should NOT inject header as comment block already exists at top");
  assert.deepEqual(result.injectedItems, ["SecurityAuditLogs"], "should list class");
  
  const updatedContent = readFileSync(filePath, "utf8");
  assert.ok(updatedContent.includes("SecurityAuditLogs"), "JSDoc should be present");
});

test("Docs Autofill - Does not overwrite existing documentation", () => {
  const filePath = join(testHome, "documented.ts");
  const code = [
    `/**`,
    ` * @file documented.ts`,
    ` */`,
    ``,
    `/**`,
    ` * Computes absolute savings based on token cache efficiency.`,
    ` * @param ratio efficiency ratio`,
    ` */`,
    `export function computeAbs(ratio: number) {`,
    `  return ratio * 100;`,
    `}`,
    ``,
    `// Pre-existing double-slash docs`,
    `export const retrieveStats = () => {`,
    `  return {};`,
    `};`
  ].join("\n");
  
  writeFileSync(filePath, code, "utf8");
  
  const result = autofillFileDocs(filePath);
  assert.equal(result.updated, false, "should make no modifications");
  assert.equal(result.injectedHeader, false);
  assert.equal(result.injectedItems.length, 0, "no items should be injected since all have preceding comments");
});

test.after(() => {
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});
