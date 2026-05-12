import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getDefaultConfigPath,
  getDefaultHostBootstrapPath,
  readMemFlowConfig,
} from "./config.js";
import type { MemFlowHostBootstrap } from "../types/memory.js";

export function buildHostBootstrap(configPath: string = getDefaultConfigPath()): MemFlowHostBootstrap {
  const config = readMemFlowConfig(configPath);
  const cliPath = resolveCliPath("../../dist/cli.js");
  const mcpPath = resolveCliPath("../../dist/mcp/server.js");
  const hostBootstrapPath = getDefaultHostBootstrapPath();
  const nodePath = process.execPath;

  return {
    automation: config.automation,
    configPath,
    databasePath: config.databasePath,
    generatedAt: new Date().toISOString(),
    lifecycle: {
      finalizeCommand: `${quote(nodePath)} ${quote(cliPath)} agent:finalize --config ${quote(configPath)}`,
      mcpCommand: `${quote(nodePath)} ${quote(mcpPath)} --config ${quote(configPath)}`,
      prepareCommand: `${quote(nodePath)} ${quote(cliPath)} agent:prepare --config ${quote(configPath)}`,
    },
    monitoring: {
      metricsCommand: `${quote(nodePath)} ${quote(cliPath)} metrics --config ${quote(configPath)}`,
      savingsCommand: `${quote(nodePath)} ${quote(cliPath)} savings --config ${quote(configPath)}`,
      statusCommand: `${quote(nodePath)} ${quote(cliPath)} status --config ${quote(configPath)}`,
    },
    paths: {
      cli: cliPath,
      hostBootstrap: hostBootstrapPath,
      mcp: mcpPath,
    },
    trackedProjects: config.trackedProjects.map((project) => ({
      enabled: project.enabled,
      name: project.name,
      path: project.path,
      project: project.project,
      repo: project.repo,
    })),
  };
}

export function writeHostBootstrap(configPath?: string, outputPath: string = getDefaultHostBootstrapPath()): MemFlowHostBootstrap {
  const bootstrap = buildHostBootstrap(configPath ?? getDefaultConfigPath());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(bootstrap, null, 2)}\n`, "utf8");
  return bootstrap;
}

function resolveCliPath(relativePath: string): string {
  const current = fileURLToPath(import.meta.url);
  return resolve(dirname(current), relativePath);
}

function quote(value: string): string {
  return `"${value}"`;
}
