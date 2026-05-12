import { basename } from "node:path";

import type { MemoryCoordinates, MemoryWriteInput } from "../types/memory.js";

export interface ParsedWorkflowMarkdown {
  codeBlocks: string[];
  notes: string[];
  prerequisites: string[];
  sections: Array<{
    name: string;
    lines: string[];
  }>;
  shellCommands: string[];
  steps: string[];
  summary: string;
  title: string;
}

export interface WorkflowIngestionInput {
  content: string;
  coordinates: MemoryCoordinates;
  source?: string;
  sourcePath?: string;
  title?: string;
}

export function parseWorkflowMarkdown(content: string, sourcePath?: string): ParsedWorkflowMarkdown {
  const lines = content.split(/\r?\n/);
  const sections: ParsedWorkflowMarkdown["sections"] = [];
  const steps: string[] = [];
  const prerequisites: string[] = [];
  const notes: string[] = [];
  const codeBlocks: string[] = [];
  const shellCommands: string[] = [];
  const summaryLines: string[] = [];

  let title = sourcePath ? stripExtension(basename(sourcePath)) : "workflow";
  let currentSection = "summary";
  let currentLines: string[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];

  const flushSection = (): void => {
    if (currentLines.length > 0) {
      sections.push({
        name: currentSection,
        lines: [...currentLines],
      });
      currentLines = [];
    }
  };

  const pushText = (line: string): void => {
    if (!line.trim()) {
      return;
    }

    if (currentSection === "summary") {
      summaryLines.push(line.trim());
      return;
    }

    currentLines.push(line.trim());
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      if (!inCodeBlock) {
        const code = codeBlockLines.join("\n").trim();
        if (code) {
          codeBlocks.push(code);
          for (const command of extractShellCommands(code)) {
            shellCommands.push(command);
          }
        }
        codeBlockLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(rawLine);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushSection();
      currentSection = slugify(heading[2]);
      if (heading[1] === "#") {
        title = heading[2].trim();
      }
      continue;
    }

    const orderedStep = line.match(/^\d+\.\s+(.*)$/);
    if (orderedStep) {
      steps.push(orderedStep[1].trim());
      pushText(line);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      const value = bullet[1].trim();
      if (currentSection.includes("prereq")) {
        prerequisites.push(value);
      } else if (currentSection.includes("note")) {
        notes.push(value);
      } else {
        notes.push(value);
      }
      pushText(line);
      continue;
    }

    pushText(line);
  }

  flushSection();

  const summary = summaryLines.join(" ").replace(/\s+/g, " ").trim();

  return {
    codeBlocks,
    notes,
    prerequisites,
    sections,
    shellCommands: Array.from(new Set(shellCommands)),
    steps,
    summary,
    title,
  };
}

export function buildWorkflowWriteInput(input: WorkflowIngestionInput): MemoryWriteInput {
  const parsed = parseWorkflowMarkdown(input.content, input.sourcePath);

  return {
    key: buildWorkflowKey(input.sourcePath, parsed.title),
    title: input.title ?? parsed.title,
    content: input.content,
    coordinates: input.coordinates,
    kind: "workflow",
    metadata: {
      parsedAt: new Date().toISOString(),
      parsedWorkflow: parsed,
      sourcePath: input.sourcePath,
    },
    provenance: {
      source: input.source === "system" ? "system" : "manual",
      importedFrom: input.sourcePath,
    },
    source: input.source ?? input.sourcePath ?? "manual",
    tags: ["workflow", "ingested", ...workflowTags(parsed)],
  };
}

function buildWorkflowKey(sourcePath: string | undefined, title: string): string {
  const source = sourcePath ? stripExtension(basename(sourcePath)) : "workflow";
  return `workflow:${slugify(source)}:${slugify(title)}`;
}

function extractShellCommands(code: string): string[] {
  return code
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("$") || line.startsWith("npm ") || line.startsWith("pnpm ") || line.startsWith("yarn ") || line.startsWith("bun ") || line.startsWith("node ") || line.startsWith("git ") || line.startsWith("cargo ") || line.startsWith("go "))
    .map((line) => line.replace(/^\$\s*/, ""));
}

function workflowTags(parsed: ParsedWorkflowMarkdown): string[] {
  const tags = new Set<string>();
  if (parsed.steps.length > 0) {
    tags.add("steps");
  }
  if (parsed.prerequisites.length > 0) {
    tags.add("prerequisites");
  }
  if (parsed.codeBlocks.length > 0) {
    tags.add("code");
  }
  if (parsed.shellCommands.length > 0) {
    tags.add("shell");
  }
  return [...tags];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "workflow";
}

function stripExtension(value: string): string {
  return value.replace(/\.[^.]+$/, "");
}
