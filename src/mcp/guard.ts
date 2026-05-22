import { InvalidMemoryInputError, SecuritySweepBlockError } from "../core/errors.js";
import { readMemFlowConfig } from "../core/config.js";
import { SecuritySweepEngine } from "../core/security-sweep.js";
import type { SecuritySweepConfig } from "../types/memory.js";

export interface ToolGuardConfig {
  maxBundleEntries: number;
  maxContentBytes: number;
  maxPayloadBytes: number;
  maxRequestsPerMinute: number;
  /** How long to cache security sweep config before re-reading from disk. Default 30s. */
  sweepConfigTtlMs?: number;
}

const DEFAULT_TOOL_GUARD_CONFIG: ToolGuardConfig = {
  maxBundleEntries: 10000,
  maxContentBytes: 64 * 1024,
  maxPayloadBytes: 256 * 1024,
  maxRequestsPerMinute: 120,
  sweepConfigTtlMs: 30_000,
};

/**
 * Tools that write user-controlled content to persistent storage.
 * Only these tools need a security sweep — read-only or metadata-only tools are excluded
 * to avoid false positives (e.g. searching for an email address triggering a PII warning).
 */
const WRITE_TOOLS = new Set([
  "memory_store",
  "memory_profile_store",
  "memory_cache_store",
  "memory_cache_auto_store",
  "memory_session_checkpoint",
  "memory_session_compact",
  "memory_agent_finalize",
  "memory_pattern_promote",
  "memory_import",
  "memory_merge",
  "mobile_respond",
]);

const DEFAULT_SWEEP_CONFIG: SecuritySweepConfig = {
  enabled: true,
  level: "warn",
  rules: {
    privateKeys: true,
    apiKeys: true,
    databaseUris: true,
    pii: false,
  },
};

export class ToolGuard {
  private requestCount = 0;
  private windowStartedAt = Date.now();
  private sweepConfigCache: { config: SecuritySweepConfig; loadedAt: number } | null = null;

  constructor(private readonly config: ToolGuardConfig = DEFAULT_TOOL_GUARD_CONFIG) {}

  async run<T>(toolName: string, args: unknown, execute: () => Promise<T>): Promise<T> {
    this.assertRateLimit();
    this.assertPayloadSize(args);
    this.assertToolSpecificLimits(toolName, args);

    // Only sweep write tools — read/query tools are excluded to prevent false positives
    const warnings: string[] = WRITE_TOOLS.has(toolName)
      ? this.runSecuritySweep(args)
      : [];

    let result = await execute();

    // Outbound response sweep for memory_agent_prepare
    const sweepConfig = this.getSweepConfig();
    if (toolName === "memory_agent_prepare" && sweepConfig.enabled && typeof result === "string") {
      let ns: string | undefined;
      if (args && typeof args === "object") {
        const record = args as Record<string, unknown>;
        if (typeof record.namespace === "string") {
          ns = record.namespace;
        } else if (record.coordinates && typeof record.coordinates === "object") {
          const coords = record.coordinates as Record<string, unknown>;
          if (typeof coords.namespace === "string") {
            ns = coords.namespace;
          }
        }
      }

      const isTrusted = ns && Array.isArray(sweepConfig.trustedNamespaces) && sweepConfig.trustedNamespaces.includes(ns);

      if (!isTrusted) {
        try {
          const parsed = JSON.parse(result);
          if (parsed !== null && typeof parsed === "object") {
            const sweepEngine = new SecuritySweepEngine(sweepConfig);
            const outboundMatches: Array<{ type: string; text: string }> = [];

            const gatherOutboundMatches = (val: unknown): void => {
              if (typeof val === "string") {
                const res = sweepEngine.sweep(val);
                if (res.hasMatches) {
                  outboundMatches.push(...res.matches);
                }
              } else if (Array.isArray(val)) {
                for (const item of val) {
                  gatherOutboundMatches(item);
                }
              } else if (val !== null && typeof val === "object") {
                for (const v of Object.values(val)) {
                  gatherOutboundMatches(v);
                }
              }
            };

            gatherOutboundMatches(parsed);

            if (outboundMatches.length > 0) {
              const matchedTypes = Array.from(new Set(outboundMatches.map((m) => m.type))).join(", ");

              if (sweepConfig.level === "block") {
                throw new SecuritySweepBlockError(
                  `[SECURITY SWEEP OUTBOUND BLOCK] Sensitive data of type [${matchedTypes}] detected in outgoing prepared memories.\n` +
                  `Clear the sensitive entries from your database or configure your security sweep rules/level to proceed.`
                );
              }

              // Under redact and warn, we redact the outbound response recursively in-place
              const redactInPlace = (obj: any): any => {
                if (typeof obj === "string") {
                  return sweepEngine.sweep(obj).redactedContent;
                } else if (Array.isArray(obj)) {
                  for (let i = 0; i < obj.length; i++) {
                    obj[i] = redactInPlace(obj[i]);
                  }
                } else if (obj !== null && typeof obj === "object") {
                  for (const key of Object.keys(obj)) {
                    obj[key] = redactInPlace(obj[key]);
                  }
                }
                return obj;
              };
              redactInPlace(parsed);

              const msg = `[SECURITY SWEEP OUTBOUND WARNING] Sensitive data of types [${matchedTypes}] detected in response memory context and automatically redacted.`;
              process.stderr.write(`${msg}\n`);
              warnings.push(msg);

              result = JSON.stringify(parsed, null, 2) as unknown as Awaited<T>;
            }
          }
        } catch (err) {
          if (err instanceof SecuritySweepBlockError) {
            throw err;
          }
          // Parse or sweep error — ignore and allow response
        }
      }
    }

    // Inject security warnings into the JSON response payload so agents can see them.
    // This is essential because MCP stdio transport does not surface stderr to the user.
    if (warnings.length > 0 && typeof result === "string") {
      try {
        const parsed = JSON.parse(result);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          return JSON.stringify(
            { ...parsed, _securityWarnings: Array.from(new Set(warnings)) },
            null,
            2
          ) as unknown as Awaited<T>;
        }
      } catch {
        // Result is not JSON-parseable — return as-is
      }
    }

    return result;
  }

  /**
   * Invalidates the cached sweep config so the next tool call reads fresh config.
   * Useful for tests and after config changes.
   */
  invalidateSweepConfigCache(): void {
    this.sweepConfigCache = null;
  }

  private assertPayloadSize(args: unknown): void {
    const bytes = Buffer.byteLength(JSON.stringify(args ?? {}), "utf8");
    if (bytes > this.config.maxPayloadBytes) {
      throw new InvalidMemoryInputError(
        `Request payload exceeds ${this.config.maxPayloadBytes} bytes`
      );
    }
  }

  private assertRateLimit(): void {
    const now = Date.now();
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.requestCount = 0;
    }

    this.requestCount += 1;
    if (this.requestCount > this.config.maxRequestsPerMinute) {
      throw new InvalidMemoryInputError("Request rate limit exceeded");
    }
  }

  private assertToolSpecificLimits(toolName: string, args: unknown): void {
    if (!args || typeof args !== "object") {
      return;
    }

    const record = args as Record<string, unknown>;

    if (toolName === "memory_store" && typeof record.content === "string") {
      const bytes = Buffer.byteLength(record.content, "utf8");
      if (bytes > this.config.maxContentBytes) {
        throw new InvalidMemoryInputError(
          `Memory content exceeds ${this.config.maxContentBytes} bytes`
        );
      }
    }

    if (
      (toolName === "memory_import" || toolName === "memory_merge" || toolName === "memory_diff") &&
      record.bundle &&
      typeof record.bundle === "object"
    ) {
      const bundle = record.bundle as { entries?: unknown[] };
      if (Array.isArray(bundle.entries) && bundle.entries.length > this.config.maxBundleEntries) {
        throw new InvalidMemoryInputError(
          `Bundle exceeds ${this.config.maxBundleEntries} entries`
        );
      }
    }
  }

  /**
   * Load the active security sweep config.
   * Uses a short-lived in-memory cache (default 30s TTL) to avoid re-reading
   * the config file on every tool call.
   */
  private getSweepConfig(): SecuritySweepConfig {
    const now = Date.now();
    const ttlMs = this.config.sweepConfigTtlMs ?? 30_000;

    if (this.sweepConfigCache && (now - this.sweepConfigCache.loadedAt) < ttlMs) {
      return this.sweepConfigCache.config;
    }

    let loaded: SecuritySweepConfig = DEFAULT_SWEEP_CONFIG;
    try {
      const memflowConfig = readMemFlowConfig();
      loaded = memflowConfig.securitySweep ?? DEFAULT_SWEEP_CONFIG;
    } catch {
      // If config is unreadable, fall back to safe defaults
    }

    this.sweepConfigCache = { config: loaded, loadedAt: now };
    return loaded;
  }

  /**
   * Run the security sweep on write-tool args.
   *
   * Returns an array of warning strings (non-empty when level === "warn" or bypass is active).
   * Mutates args in-place when level === "redact".
   * Throws SecuritySweepBlockError when level === "block".
   */
  private runSecuritySweep(args: unknown): string[] {
    if (!args || typeof args !== "object") {
      return [];
    }

    const sweepConfig = this.getSweepConfig();
    if (!sweepConfig.enabled) {
      return [];
    }

    const record = args as Record<string, unknown>;

    // Exemption Namespaces Check
    let ns: string | undefined;
    if (typeof record.namespace === "string") {
      ns = record.namespace;
    } else if (record.coordinates && typeof record.coordinates === "object") {
      const coords = record.coordinates as Record<string, unknown>;
      if (typeof coords.namespace === "string") {
        ns = coords.namespace;
      }
    }
    if (ns && Array.isArray(sweepConfig.trustedNamespaces) && sweepConfig.trustedNamespaces.includes(ns)) {
      return [];
    }

    // Check for bypass flag in top-level args, coordinates, or metadata.
    // Note: bypassSecuritySweep must be in metadata for Zod-validated endpoints
    // (coordinatesSchema now includes it, so coordinates works too).
    let bypass = false;

    if (record.bypassSecuritySweep === true) {
      bypass = true;
    }
    if (!bypass && record.coordinates && typeof record.coordinates === "object") {
      const coords = record.coordinates as Record<string, unknown>;
      if (coords.bypassSecuritySweep === true) {
        bypass = true;
      }
    }
    if (!bypass && record.metadata && typeof record.metadata === "object") {
      const meta = record.metadata as Record<string, unknown>;
      if (meta.bypassSecuritySweep === true) {
        bypass = true;
      }
    }

    const sweepEngine = new SecuritySweepEngine(sweepConfig);
    const matches: Array<{ type: string; text: string }> = [];

    // Recursively gather matches across all string values in the payload
    const gatherMatches = (val: unknown): void => {
      if (typeof val === "string") {
        const res = sweepEngine.sweep(val);
        if (res.hasMatches) {
          matches.push(...res.matches);
        }
      } else if (Array.isArray(val)) {
        for (const item of val) {
          gatherMatches(item);
        }
      } else if (val !== null && typeof val === "object") {
        for (const v of Object.values(val)) {
          gatherMatches(v);
        }
      }
    };

    gatherMatches(args);

    if (matches.length === 0) {
      return [];
    }

    const matchedTypes = Array.from(new Set(matches.map((m) => m.type))).join(", ");

    // Bypass — log to stderr and include a notice in the response, but don't block
    if (bypass) {
      const msg = `[SECURITY SWEEP BYPASSED] Sensitive data of types [${matchedTypes}] stored with explicit user authorization.`;
      process.stderr.write(`${msg}\n`);
      return [msg];
    }

    // Block — hard stop, raise an error the agent and caller will see
    if (sweepConfig.level === "block") {
      throw new SecuritySweepBlockError(
        `[SECURITY SWEEP BLOCK] Sensitive data of type [${matchedTypes}] detected in request payload.\n` +
        `Configure your security sweep level or pass { "bypassSecuritySweep": true } in request metadata to proceed.\n` +
        `Tip: run \`memflow security:sweep level warn\` to switch to warning mode, or \`memflow security:sweep level redact\` to auto-redact.`
      );
    }

    // Redact — mutate args in-place, replacing sensitive strings
    if (sweepConfig.level === "redact") {
      const redactInPlace = (obj: any): any => {
        if (typeof obj === "string") {
          return sweepEngine.sweep(obj).redactedContent;
        } else if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) {
            obj[i] = redactInPlace(obj[i]);
          }
        } else if (obj !== null && typeof obj === "object") {
          for (const key of Object.keys(obj)) {
            obj[key] = redactInPlace(obj[key]);
          }
        }
        return obj;
      };
      redactInPlace(args);

      const msg = `[SECURITY SWEEP] Automatically redacted sensitive data of types: ${matchedTypes}.`;
      process.stderr.write(`${msg}\n`);
      return [msg];
    }

    // Warn (default) — return the warning so it appears in the tool response payload
    // where the agent can actually see it. Also write to stderr as a fallback.
    const msg =
      `[SECURITY SWEEP WARNING] Sensitive data detected: ${matchedTypes}. ` +
      `This content may be logged by your AI provider. ` +
      `To suppress: pass { "bypassSecuritySweep": true } in request metadata. ` +
      `To auto-redact: run \`memflow security:sweep level redact\`. ` +
      `To block: run \`memflow security:sweep level block\`.`;
    process.stderr.write(`${msg}\n`);
    return [msg];
  }
}
