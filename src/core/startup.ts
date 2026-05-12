import { detectProfileCollisions, getProfileName, readMemFlowConfig } from "./config.js";

export interface RuntimePreflightResult {
  betterSqlite3: {
    message?: string;
    ok: boolean;
  };
  collisions?: string[];
  checks: string[];
  currentNode: string;
  ok: boolean;
  supportedNode: boolean;
}

export function formatStartupError(error: unknown): string {
  const details = error instanceof Error ? error.message : String(error);

  if (isBetterSqliteAbiMismatch(details)) {
    return [
      "MemFlow could not start because `better-sqlite3` was built for a different Node.js version.",
      `Current Node.js: ${process.version}`,
      "Fix:",
      "1. Use Node 22 or newer for this repo.",
      "2. Run `npm rebuild better-sqlite3` in that same shell and Node version.",
      "3. Run `npm run build` and retry.",
    ].join("\n");
  }

  return details;
}

export function printStartupError(error: unknown): void {
  process.stderr.write(`${formatStartupError(error)}\n`);
}

export async function runRuntimePreflight(configPath?: string): Promise<RuntimePreflightResult> {
  const checks: string[] = [];
  const currentNode = process.version;
  const major = Number.parseInt(currentNode.replace(/^v/, "").split(".")[0] ?? "0", 10);
  const supportedNode = Number.isFinite(major) && major >= 22;
  checks.push(
    supportedNode
      ? `Node runtime supported: ${currentNode}`
      : `Node runtime unsupported: ${currentNode}. MemFlow currently requires Node 22 or newer.`
  );

  try {
    await import("better-sqlite3");
    checks.push("better-sqlite3 native binding loaded");
  } catch (error) {
    const message = formatStartupError(error);
    checks.push(message);
    return {
      betterSqlite3: {
        message,
        ok: false,
      },
      checks,
      currentNode,
      ok: false,
      supportedNode,
    };
  }

  const config = readMemFlowConfig(configPath);
  const profile = getProfileName();
  const collisions = detectProfileCollisions(config, profile, configPath ?? undefined);
  if (collisions.length > 0) {
    checks.push(...collisions);
  }

  return {
    betterSqlite3: {
      ok: true,
    },
    collisions,
    checks,
    currentNode,
    ok: supportedNode && collisions.length === 0,
    supportedNode,
  };
}

function isBetterSqliteAbiMismatch(message: string): boolean {
  return (
    message.includes("better_sqlite3.node") &&
    message.includes("compiled against a different Node.js version")
  );
}
