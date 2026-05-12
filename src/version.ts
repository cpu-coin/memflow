import { createRequire } from "node:module";

export interface MemFlowVersionInfo {
  gitRef?: string;
  gitSha?: string;
  name: string;
  repository?: string;
  version: `${number}.${number}.${number}`;
}

type PackageJson = {
  name: string;
  version: `${number}.${number}.${number}`;
};

export function getVersionInfo(): MemFlowVersionInfo {
  const require = createRequire(import.meta.url);
  const pkg = require("../package.json") as PackageJson;

  return {
    gitRef: process.env.GITHUB_REF_NAME || process.env.MEMFLOW_GIT_REF,
    gitSha: shortenSha(process.env.GITHUB_SHA || process.env.MEMFLOW_GIT_SHA),
    name: pkg.name,
    repository: process.env.GITHUB_REPOSITORY || process.env.MEMFLOW_GITHUB_REPOSITORY,
    version: pkg.version,
  };
}

export function formatVersion(info: MemFlowVersionInfo = getVersionInfo()): string {
  const parts = [`${info.name} ${info.version}`];

  if (info.gitRef) {
    parts.push(`ref:${info.gitRef}`);
  }

  if (info.gitSha) {
    parts.push(`sha:${info.gitSha}`);
  }

  return parts.join(" ");
}

function shortenSha(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  return input.slice(0, 7);
}
