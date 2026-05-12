import type {
  MemoryCoordinates,
  MemoryEntry,
  MemorySyncPlanDecision,
  PatternPromotionInput,
  PromptCacheAutoKeyInput,
  ProfileBlockInput,
  SessionCheckpointInput,
  SessionCompactionInput,
} from "../types/memory.js";
import { computeContentHash } from "./entry.js";

export const PROFILE_NAMESPACE = "persona";
export const SESSION_NAMESPACE = "sessions";
export const CACHE_NAMESPACE = "cache";
export const PATTERN_NAMESPACE = "patterns";
export const WORKFLOW_NAMESPACE = "workflow";
export const PROJECTS_NAMESPACE = "projects";
export const METRICS_NAMESPACE = "metrics";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "entry";
}

function coordinateSegments(coordinates: MemoryCoordinates): string[] {
  return [
    coordinates.scope,
    coordinates.tenant,
    coordinates.project,
    coordinates.repo,
    coordinates.user,
    coordinates.workspace,
  ]
    .filter((value): value is string => Boolean(value))
    .map(slugify);
}

export function buildProfileKey(input: ProfileBlockInput): string {
  return ["profile", ...coordinateSegments(input.coordinates), slugify(input.name)].join(":");
}

export function buildSessionKey(
  coordinates: MemoryCoordinates,
  sessionId?: string,
  variant: "checkpoint" | "compact" = "checkpoint"
): string {
  return [
    variant === "compact" ? "compact" : "session",
    ...coordinateSegments(coordinates),
    slugify(sessionId ?? "active"),
  ].join(":");
}

export function buildPatternKey(input: PatternPromotionInput): string {
  return [
    "pattern",
    ...coordinateSegments(input.coordinates),
    slugify(input.title),
  ].join(":");
}

function normalizePrompt(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 2000);
}

export function buildPromptCacheKey(input: PromptCacheAutoKeyInput): string {
  const prompt = normalizePrompt(input.prompt);
  const task = input.task ? slugify(input.task) : "general";
  const schemaVersion = String(input.schemaVersion ?? "none");
  const embeddingVersion = slugify(input.embeddingVersion ?? "none");
  const fingerprint = computeContentHash(prompt).slice(0, 16);

  return [
    "prompt-cache",
    ...coordinateSegments({
      ...input.coordinates,
      scope: input.coordinates.scope ?? "workspace",
    }),
    task,
    `schema-${schemaVersion}`,
    `embed-${embeddingVersion}`,
    fingerprint,
  ].join(":");
}

export function buildTrackedProjectKey(project: {
  path: string;
  project: string;
  repo: string;
}): string {
  return ["tracked-project", slugify(project.project), slugify(project.repo), slugify(project.path)].join(":");
}

export function buildOperationalMetricKey(input: {
  coordinates: MemoryCoordinates;
  metric: string;
  bucket?: string;
}): string {
  return [
    "metric",
    input.bucket ?? new Date().toISOString().slice(0, 10),
    ...coordinateSegments(input.coordinates),
    slugify(input.metric),
  ].join(":");
}

function bulletList(values: string[]): string[] {
  return values.map((value) => `- ${value}`);
}

export function buildCheckpointContent(input: SessionCheckpointInput): string {
  const lines = [`Goal: ${input.goal}`];

  if (input.summary) {
    lines.push(`Summary: ${input.summary}`);
  }
  if (input.nextStep) {
    lines.push(`Next: ${input.nextStep}`);
  }
  if (input.branch) {
    lines.push(`Branch: ${input.branch}`);
  }
  if (input.files?.length) {
    lines.push("Files:");
    lines.push(...bulletList(input.files));
  }
  if (input.decisions?.length) {
    lines.push("Decisions:");
    lines.push(...bulletList(input.decisions));
  }
  if (input.blockers?.length) {
    lines.push("Blockers:");
    lines.push(...bulletList(input.blockers));
  }
  if (input.todos?.length) {
    lines.push("Open TODOs:");
    lines.push(...bulletList(input.todos));
  }

  return lines.join("\n");
}

function transcriptPreview(transcript: string[]): string[] {
  return transcript
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((entry) => entry.slice(0, 240));
}

export function buildCompactionContent(input: SessionCompactionInput): string {
  const lines: string[] = [];

  if (input.summary) {
    lines.push(`Summary: ${input.summary}`);
  } else if (input.transcript?.length) {
    lines.push("Transcript highlights:");
    lines.push(...bulletList(transcriptPreview(input.transcript)));
  } else if (input.goal) {
    lines.push(`Summary: Working toward ${input.goal}`);
  } else {
    lines.push("Summary: Session compaction checkpoint");
  }

  if (input.goal) {
    lines.push(`Goal: ${input.goal}`);
  }
  if (input.nextStep) {
    lines.push(`Next: ${input.nextStep}`);
  }
  if (input.decisions?.length) {
    lines.push("Decisions:");
    lines.push(...bulletList(input.decisions));
  }
  if (input.activeTodos?.length) {
    lines.push("Carry-forward TODOs:");
    lines.push(...bulletList(input.activeTodos));
  }
  if (input.blockers?.length) {
    lines.push("Blockers:");
    lines.push(...bulletList(input.blockers));
  }
  if (input.invalidatedAssumptions?.length) {
    lines.push("Invalidated assumptions:");
    lines.push(...bulletList(input.invalidatedAssumptions));
  }
  if (input.activeFiles?.length) {
    lines.push("Active files:");
    lines.push(...bulletList(input.activeFiles));
  }

  return lines.join("\n");
}

export function buildPatternContent(input: PatternPromotionInput): string {
  const lines = [
    `Failure: ${input.failure}`,
    `Root cause: ${input.rootCause}`,
    `Safe fix: ${input.safeFix}`,
  ];

  if (input.detection) {
    lines.push(`Detection: ${input.detection}`);
  }

  return lines.join("\n");
}

export function buildInitEntryTemplates(context: {
  actorId?: string;
  project?: string;
  repo?: string;
  tenant?: string;
  user?: string;
  workspace?: string;
}): Array<{
  coordinates: MemoryCoordinates;
  content: string;
  kind: "persona" | "workflow";
  name: string;
  tags: string[];
}> {
  const entries: Array<{
    coordinates: MemoryCoordinates;
    content: string;
    kind: "persona" | "workflow";
    name: string;
    tags: string[];
  }> = [];

  if (context.user) {
    entries.push({
      coordinates: {
        namespace: PROFILE_NAMESPACE,
        scope: "user",
        tenant: context.tenant,
        user: context.user,
      },
      content: `Default user persona for ${context.user}. Keep responses concise, store validated lessons, preserve reusable decisions instead of raw transcript noise, and promote complex repeat-fix lessons into patterns when a bug took multiple attempts to resolve.`,
      kind: "persona",
      name: "user-defaults",
      tags: ["persona", "user", "defaults"],
    });
  }

  if (context.workspace) {
    entries.push({
      coordinates: {
        namespace: PROFILE_NAMESPACE,
        scope: "workspace",
        tenant: context.tenant,
        user: context.user,
        workspace: context.workspace,
      },
      content: `Workspace ${context.workspace} owns private session recovery, prompt caches, and active worktree context. Persist only local state that should not leak to the wider team and use it as the embedded tier when MemFlow runs inside a host app.`,
      kind: "persona",
      name: "workspace-defaults",
      tags: ["persona", "workspace", "local"],
    });
  }

  if (context.project) {
    entries.push({
      coordinates: {
        namespace: PROFILE_NAMESPACE,
        project: context.project,
        scope: "project",
        tenant: context.tenant,
        user: context.user,
        workspace: context.workspace,
      },
      content: `Project ${context.project} shares architecture decisions, validated patterns, and operating workflows across contributors. Promote durable lessons here once they are verified, especially if they are dependency-sensitive or required across multiple developer environments.`,
      kind: "persona",
      name: "project-defaults",
      tags: ["persona", "project", "shared"],
    });
  }

  if (context.repo) {
    entries.push({
      coordinates: {
        namespace: WORKFLOW_NAMESPACE,
        project: context.project,
        repo: context.repo,
        scope: "repo",
        tenant: context.tenant,
        user: context.user,
        workspace: context.workspace,
      },
      content: `Repo ${context.repo} sync policy: keep session checkpoints and caches local, and promote verified project, repo, and team lessons to shared memory for reuse by other developers.`,
      kind: "workflow",
      name: "repo-sync-policy",
      tags: ["workflow", "repo", "sync"],
    });
  }

  return entries;
}

export function byUpdatedAtDesc(left: MemoryEntry, right: MemoryEntry): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.key.localeCompare(right.key);
}

export function compactDecision(entry: MemoryEntry, target: MemorySyncPlanDecision["target"], reason: string): MemorySyncPlanDecision {
  return {
    id: entry.id,
    key: entry.key,
    kind: entry.kind,
    namespace: entry.coordinates.namespace,
    scope: entry.coordinates.scope,
    target,
    reason,
  };
}
