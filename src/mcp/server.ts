#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { FastMCP } from "fastmcp";

import {
  effectiveConnectorDescriptor,
  getDefaultDatabasePath,
  getProfileName,
  normalizeConnectorChoice,
  readMemFlowConfig,
} from "../core/config.js";
import { MemoryService } from "../core/memory-service.js";
import { printStartupError } from "../core/startup.js";
import { EmbeddedConnector } from "../connectors/embedded.js";
import { MongoDBConnector } from "../connectors/mongodb.js";
import { SQLiteConnector } from "../connectors/sqlite.js";
import type { DatabaseConnector } from "../connectors/types.js";
import { getVersionInfo } from "../version.js";
import { registerMemoryTools } from "./tools.js";

export interface MemFlowServerOptions {
  connector: DatabaseConnector;
  name?: string;
  transportType?: "httpStream" | "stdio";
  httpStream?: {
    endpoint?: string;
    host?: string;
    port?: number;
    sslCa?: string;
    sslCert?: string;
    sslKey?: string;
  };
  version?: `${number}.${number}.${number}`;
}

export function createMemFlowServer(options: MemFlowServerOptions): FastMCP {
  const service = new MemoryService(options.connector);
  const server = new FastMCP({
    name: options.name ?? "MemFlow MCP",
    version: options.version ?? getVersionInfo().version,
  });

  registerMemoryTools(server, service);

  return server;
}

export function createConnectorFromEnvironment(configPath?: string): DatabaseConnector {
  const config = readMemFlowConfig(configPath);
  const profile = getProfileName();
  const connector = normalizeConnectorChoice(
    process.env.MEMFLOW_CONNECTOR ?? config.connector ?? "sqlite"
  );

  if (connector === "embedded") {
    return new EmbeddedConnector({
      databasePath: process.env.MEMFLOW_EMBEDDED_DB_PATH ?? ":memory:",
    });
  }

  if (connector === "mongodb") {
    const descriptor = effectiveConnectorDescriptor(config, profile);
    const parts = descriptor.target.split("::");
    const uri = process.env.MEMFLOW_MONGODB_URI ?? config.mongo?.uri ?? parts[0];
    const database =
      process.env.MEMFLOW_MONGODB_DATABASE ?? config.mongo?.database ?? parts[1] ?? `memflow_${profile}`;
    return new MongoDBConnector({
      collection: process.env.MEMFLOW_MONGODB_COLLECTION ?? config.mongo?.collection,
      connectTimeoutMs: process.env.MEMFLOW_MONGODB_CONNECT_TIMEOUT_MS
        ? Number(process.env.MEMFLOW_MONGODB_CONNECT_TIMEOUT_MS)
        : config.mongo?.connectTimeoutMs,
      maxPoolSize: process.env.MEMFLOW_MONGODB_MAX_POOL_SIZE
        ? Number(process.env.MEMFLOW_MONGODB_MAX_POOL_SIZE)
        : config.mongo?.maxPoolSize,
      minPoolSize: process.env.MEMFLOW_MONGODB_MIN_POOL_SIZE
        ? Number(process.env.MEMFLOW_MONGODB_MIN_POOL_SIZE)
        : config.mongo?.minPoolSize,
      socketTimeoutMS: process.env.MEMFLOW_MONGODB_SOCKET_TIMEOUT_MS
        ? Number(process.env.MEMFLOW_MONGODB_SOCKET_TIMEOUT_MS)
        : config.mongo?.socketTimeoutMS,
      waitQueueTimeoutMS: process.env.MEMFLOW_MONGODB_WAIT_QUEUE_TIMEOUT_MS
        ? Number(process.env.MEMFLOW_MONGODB_WAIT_QUEUE_TIMEOUT_MS)
        : config.mongo?.waitQueueTimeoutMS,
      database,
      moduleSearchPaths: process.env.MEMFLOW_MONGODB_MODULE_PATH
        ? [process.env.MEMFLOW_MONGODB_MODULE_PATH]
        : config.mongo?.moduleSearchPaths,
      uri,
    });
  }

  return new SQLiteConnector({
    databasePath:
      process.env.MEMFLOW_SQLITE_PATH ?? config.databasePath ?? getDefaultDatabasePath(profile),
    namespace: process.env.MEMFLOW_NAMESPACE,
    readOnly: process.env.MEMFLOW_READ_ONLY === "true",
  });
}

export async function startServer(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes("-v") || argv.includes("--version")) {
    process.stdout.write(`${getVersionInfo().version}\n`);
    return;
  }

  const configIndex = argv.findIndex((arg) => arg === "--config");
  const configPath =
    configIndex >= 0 && argv[configIndex + 1] ? argv[configIndex + 1] : undefined;
  const transportIndex = argv.findIndex((arg) => arg === "--transport");
  const transport = transportIndex >= 0 && argv[transportIndex + 1]
    ? argv[transportIndex + 1]
    : "stdio";
  const portIndex = argv.findIndex((arg) => arg === "--port");
  const port = portIndex >= 0 && argv[portIndex + 1] ? Number(argv[portIndex + 1]) : 8080;
  const endpointIndex = argv.findIndex((arg) => arg === "--endpoint");
  const endpoint = (endpointIndex >= 0 && argv[endpointIndex + 1] ? argv[endpointIndex + 1] : "/mcp") as `/${string}`;
  const hostIndex = argv.findIndex((arg) => arg === "--host");
  const host = hostIndex >= 0 && argv[hostIndex + 1] ? argv[hostIndex + 1] : "0.0.0.0";
  const sslCertIndex = argv.findIndex((arg) => arg === "--ssl-cert");
  const sslKeyIndex = argv.findIndex((arg) => arg === "--ssl-key");
  const sslCaIndex = argv.findIndex((arg) => arg === "--ssl-ca");
  const sslCert = sslCertIndex >= 0 && argv[sslCertIndex + 1] ? argv[sslCertIndex + 1] : undefined;
  const sslKey = sslKeyIndex >= 0 && argv[sslKeyIndex + 1] ? argv[sslKeyIndex + 1] : undefined;
  const sslCa = sslCaIndex >= 0 && argv[sslCaIndex + 1] ? argv[sslCaIndex + 1] : undefined;

  const server = createMemFlowServer({
    connector: createConnectorFromEnvironment(configPath),
  });

  if (transport === "httpStream" || transport === "http") {
    await server.start({
      transportType: "httpStream",
      httpStream: {
        endpoint,
        host,
        port,
        sslCa,
        sslCert,
        sslKey,
      },
    });
    return;
  }

  await server.start({
    transportType: "stdio",
  });
}

const entrypoint = process.argv[1];
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  try {
    await startServer();
  } catch (error) {
    printStartupError(error);
    process.exitCode = 1;
  }
}
