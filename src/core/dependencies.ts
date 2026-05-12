import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { MemoryEntry } from "../types/memory.js";

export interface DependencyFingerprint {
  major: string;
  name: string;
  rawVersion: string;
  source: string;
}

export interface DependencySnapshot {
  collectedAt: string;
  dependencies: DependencyFingerprint[];
  workspace: string;
}

export interface DependencyWarning {
  expectedMajor: string;
  major: string;
  name: string;
  source: string;
  warning: string;
}

const PACKAGE_FILES = ["package.json", "Podfile", "build.gradle", "build.gradle.kts"];

export function collectDependencySnapshot(workspace?: string): DependencySnapshot | null {
  const root = resolve(workspace ?? process.cwd());
  const dependencies: DependencyFingerprint[] = [];

  for (const relativePath of PACKAGE_FILES) {
    const candidate = join(root, relativePath);
    if (!existsSync(candidate)) {
      continue;
    }

    dependencies.push(...collectFromManifest(candidate));
  }

  if (dependencies.length === 0) {
    return null;
  }

  return {
    collectedAt: new Date().toISOString(),
    dependencies: dedupeDependencies(dependencies),
    workspace: root,
  };
}

export function dependencyTags(snapshot: DependencySnapshot | null | undefined): string[] {
  if (!snapshot) {
    return [];
  }

  return snapshot.dependencies.map((dependency) =>
    `dependency:${slugify(dependency.name)}:${dependency.major}.x`
  );
}

export function dependencyMetadata(snapshot: DependencySnapshot | null | undefined): Record<string, unknown> {
  if (!snapshot) {
    return {};
  }

  return {
    dependencies: snapshot.dependencies.map((dependency) => ({
      major: dependency.major,
      name: dependency.name,
      rawVersion: dependency.rawVersion,
      source: dependency.source,
    })),
    dependencyCollectedAt: snapshot.collectedAt,
    dependencyWorkspace: snapshot.workspace,
  };
}

export function dependencyWarningsForEntry(
  entry: MemoryEntry,
  snapshot: DependencySnapshot | null | undefined
): DependencyWarning[] {
  if (!snapshot) {
    return [];
  }

  const storedDependencies = extractStoredDependencies(entry);
  if (storedDependencies.length === 0) {
    return [];
  }

  const currentMajorByName = new Map(
    snapshot.dependencies.map((dependency) => [slugify(dependency.name), dependency.major] as const)
  );
  const warnings: DependencyWarning[] = [];

  for (const stored of storedDependencies) {
    const currentMajor = currentMajorByName.get(slugify(stored.name));
    if (!currentMajor || currentMajor === stored.major) {
      continue;
    }

    warnings.push({
      expectedMajor: stored.major,
      major: currentMajor,
      name: stored.name,
      source: stored.source,
      warning: `WARNING: This entry was validated on ${stored.name} ${stored.major}.x. The workspace is now on ${stored.name} ${currentMajor}.x. Verify before applying.`,
    });
  }

  return warnings;
}

function collectFromManifest(manifestPath: string): DependencyFingerprint[] {
  if (manifestPath.endsWith("package.json")) {
    return collectFromPackageJson(manifestPath);
  }

  if (manifestPath.endsWith("Podfile")) {
    return collectFromPodfile(manifestPath);
  }

  return collectFromGradle(manifestPath);
}

function collectFromPackageJson(manifestPath: string): DependencyFingerprint[] {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    const sections = [
      parsed.dependencies,
      parsed.devDependencies,
      parsed.peerDependencies,
      parsed.optionalDependencies,
    ];
    const fingerprints: DependencyFingerprint[] = [];

    for (const section of sections) {
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        continue;
      }

      for (const [name, version] of Object.entries(section as Record<string, unknown>)) {
        if (typeof version !== "string") {
          continue;
        }

        const major = extractMajor(version);
        if (!major) {
          continue;
        }

        fingerprints.push({
          major,
          name,
          rawVersion: version,
          source: manifestPath,
        });
      }
    }

    return fingerprints;
  } catch {
    return [];
  }
}

function collectFromPodfile(manifestPath: string): DependencyFingerprint[] {
  const content = readFileSync(manifestPath, "utf8");
  const fingerprints: DependencyFingerprint[] = [];
  const podPattern = /^\s*pod\s+['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/gm;

  for (const match of content.matchAll(podPattern)) {
    const name = match[1];
    const version = match[2];
    const major = extractMajor(version);
    if (!major) {
      continue;
    }

    fingerprints.push({
      major,
      name,
      rawVersion: version,
      source: manifestPath,
    });
  }

  return fingerprints;
}

function collectFromGradle(manifestPath: string): DependencyFingerprint[] {
  const content = readFileSync(manifestPath, "utf8");
  const fingerprints: DependencyFingerprint[] = [];
  const quotedDependency = /["']([^:"']+):([^:"']+):([^"']+)["']/g;

  for (const match of content.matchAll(quotedDependency)) {
    const name = match[2];
    const version = match[3];
    const major = extractMajor(version);
    if (!major) {
      continue;
    }

    fingerprints.push({
      major,
      name,
      rawVersion: version,
      source: manifestPath,
    });
  }

  return fingerprints;
}

function extractStoredDependencies(entry: MemoryEntry): Array<Pick<DependencyFingerprint, "major" | "name" | "source">> {
  const metadata = entry.metadata as Record<string, unknown>;
  const structured = Array.isArray(metadata.dependencies)
    ? metadata.dependencies.filter((candidate): candidate is Record<string, unknown> =>
        Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate)
      )
    : [];

  return structured
    .map((candidate) => ({
      major: typeof candidate.major === "string" ? candidate.major : undefined,
      name: typeof candidate.name === "string" ? candidate.name : undefined,
      source: typeof candidate.source === "string" ? candidate.source : entry.source,
    }))
    .filter(
      (candidate): candidate is { major: string; name: string; source: string } =>
        Boolean(candidate.major && candidate.name && candidate.source)
    );
}

function dedupeDependencies(dependencies: DependencyFingerprint[]): DependencyFingerprint[] {
  const index = new Map<string, DependencyFingerprint>();

  for (const dependency of dependencies) {
    index.set(`${slugify(dependency.name)}:${dependency.major}`, dependency);
  }

  return [...index.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function extractMajor(version: string): string | undefined {
  const match = version.match(/(\d+)/);
  return match?.[1];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
