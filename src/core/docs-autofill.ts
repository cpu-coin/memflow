import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

export interface DocsAutofillResult {
  checked: string[];
  updated: string[];
  changesCount: number;
  details: {
    file: string;
    injectedHeader: boolean;
    injectedItems: string[];
  }[];
}

/**
 * Checks if the content immediately preceding an index contains a comment block.
 */
function hasPrecedingComment(content: string, index: number): boolean {
  const prev = content.substring(0, index).trimEnd();
  if (prev.endsWith("*/")) {
    const commentStart = prev.lastIndexOf("/**");
    if (commentStart !== -1) {
      const commentText = prev.substring(commentStart);
      if (commentText.includes("@file")) {
        return false; // It's a file header, not function/class docs
      }
    }
    return true;
  }
  const lines = prev.split("\n");
  const lastLine = lines[lines.length - 1]?.trim();
  if (lastLine?.startsWith("//")) {
    return true;
  }
  return false;
}

/**
 * Parses a parameter list string and extracts the argument names.
 * e.g., "a: string, b?: number, c = true" -> ["a", "b", "c"]
 */
function parseParameters(paramList: string): string[] {
  if (!paramList || !paramList.trim()) {
    return [];
  }
  
  const params: string[] = [];
  let depth = 0;
  let current = "";
  
  // Parse character by character to handle nested brackets/parentheses correctly
  for (let i = 0; i < paramList.length; i++) {
    const char = paramList[i];
    if (char === "{" || char === "[" || char === "<") {
      depth++;
    } else if (char === "}" || char === "]" || char === ">") {
      depth--;
    }
    
    if (char === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    params.push(current.trim());
  }

  return params
    .map((p) => {
      // Handle destructured parameters (e.g. "{ name, age }") or rest parameters (e.g. "...args")
      if (p.startsWith("{") || p.startsWith("[")) {
        return "payload";
      }
      if (p.startsWith("...")) {
        return p.slice(3).trim().split(/[?:\s=]/)[0];
      }
      // Extract parameter name before typing or default value
      const match = p.match(/^([a-zA-Z0-9_]+)/);
      return match ? match[1] : "";
    })
    .filter(Boolean);
}

/**
 * Scans a staged file, automatically inserts missing JSDocs and file headers,
 * and staging the updated file.
 */
export function autofillFileDocs(filePath: string): {
  updated: boolean;
  injectedHeader: boolean;
  injectedItems: string[];
} {
  if (!existsSync(filePath)) {
    return { updated: false, injectedHeader: false, injectedItems: [] };
  }

  const filename = basename(filePath);
  let content = readFileSync(filePath, "utf8");
  const initialContent = content;
  let originalContent = content;
  let injectedHeader = false;
  const injectedItems: string[] = [];

  // 1. Verify/Autofill top-level File Header if missing
  const hasTopComment = content.trim().startsWith("/**") || content.trim().startsWith("//");
  if (!hasTopComment) {
    let insertIndex = 0;
    if (content.startsWith("#!")) {
      const shebangEnd = content.indexOf("\n");
      if (shebangEnd !== -1) {
        insertIndex = shebangEnd + 1;
      }
    }
    
    const header = [
      `/**`,
      ` * @file ${filename}`,
      ` * @description Automatically documented module.`,
      ` */`,
      `\n`
    ].join("\n");
    
    content = content.substring(0, insertIndex) + header + content.substring(insertIndex);
    injectedHeader = true;
  }

  // 2. Scan and verify Exported Functions, Classes, and Methods
  // Patterns:
  // a) export [async] function name(args)
  // b) export const name = (args) =>
  // c) export class name
  const functionRegex = /\bexport\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
  const arrowRegex = /\bexport\s+const\s+([a-zA-Z0-9_]+)\s*=\s*\(([^)]*)\)\s*=>/g;
  const classRegex = /\bexport\s+class\s+([a-zA-Z0-9_]+)/g;

  let match: RegExpExecArray | null;
  let offset = 0;

  // Helper to insert JSDoc at index
  const insertJsDoc = (name: string, params: string[], index: number) => {
    // Check if there is already a comment block before the export keyword
    if (hasPrecedingComment(content, index + offset)) {
      return;
    }

    const docLines = [
      `/**`,
      ` * ${name}`,
      ` *`,
    ];
    for (const p of params) {
      docLines.push(` * @param ${p}`);
    }
    docLines.push(` */`);
    
    const docString = docLines.join("\n") + "\n";
    content = content.substring(0, index + offset) + docString + content.substring(index + offset);
    offset += docString.length;
    injectedItems.push(name);
  };

  // Scan standard functions
  while ((match = functionRegex.exec(originalContent)) !== null) {
    const name = match[1];
    const paramsText = match[2];
    const params = parseParameters(paramsText);
    insertJsDoc(name, params, match.index);
  }

  // Reset offset and scan classes
  originalContent = content;
  offset = 0;
  while ((match = classRegex.exec(originalContent)) !== null) {
    const name = match[1];
    insertJsDoc(name, [], match.index);
  }

  // Reset offset and scan arrow functions
  originalContent = content;
  offset = 0;
  while ((match = arrowRegex.exec(originalContent)) !== null) {
    const name = match[1];
    const paramsText = match[2];
    const params = parseParameters(paramsText);
    insertJsDoc(name, params, match.index);
  }

  const updated = content !== initialContent;
  if (updated) {
    writeFileSync(filePath, content, "utf8");
    try {
      execSync(`git add "${filePath}"`, { stdio: "ignore" });
    } catch {
      // Ignore git stage failures in non-git environments
    }
  }

  return { updated, injectedHeader, injectedItems };
}

/**
 * Scans all staged files in the git repository and verifies/autofills their documentation.
 */
export async function runDocsVerify(cwd = process.cwd()): Promise<DocsAutofillResult> {
  const result: DocsAutofillResult = {
    checked: [],
    updated: [],
    changesCount: 0,
    details: [],
  };

  let stagedFiles: string[] = [];
  try {
    const output = execSync("git diff --cached --name-only", { cwd, encoding: "utf8" });
    stagedFiles = output
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    // Not a git repository or git not available
    return result;
  }

  // Supported source extensions
  const docExtensions = [".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"];

  for (const file of stagedFiles) {
    const ext = "." + file.split(".").pop();
    if (!docExtensions.includes(ext)) {
      continue;
    }

    const fullPath = join(cwd, file);
    result.checked.push(file);

    const { updated, injectedHeader, injectedItems } = autofillFileDocs(fullPath);
    if (updated) {
      result.updated.push(file);
      result.changesCount += (injectedHeader ? 1 : 0) + injectedItems.length;
      result.details.push({
        file,
        injectedHeader,
        injectedItems,
      });
    }
  }

  return result;
}

/**
 * Installs the pre-commit hook into the active repository.
 */
export function installPreCommitHook(cwd = process.cwd()): boolean {
  const gitDir = join(cwd, ".git");
  if (!existsSync(gitDir)) {
    return false;
  }

  const hooksDir = join(gitDir, "hooks");
  if (!existsSync(hooksDir)) {
    return false;
  }

  const preCommitPath = join(hooksDir, "pre-commit");
  
  const hookContent = [
    `#!/bin/sh`,
    `# MemFlow Auto-Documentation Pre-Commit Hook`,
    `# Verify and autofill staged files before committing`,
    ``,
    `echo "⏳ [MemFlow] Verifying documentation standards..."`,
    `memflow docs:verify --pre-commit`,
    ``,
  ].join("\n");

  writeFileSync(preCommitPath, hookContent, { mode: 0o755, encoding: "utf8" });
  return true;
}
