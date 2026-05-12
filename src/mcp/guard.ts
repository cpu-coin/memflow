import { InvalidMemoryInputError } from "../core/errors.js";

export interface ToolGuardConfig {
  maxBundleEntries: number;
  maxContentBytes: number;
  maxPayloadBytes: number;
  maxRequestsPerMinute: number;
}

const DEFAULT_TOOL_GUARD_CONFIG: ToolGuardConfig = {
  maxBundleEntries: 10000,
  maxContentBytes: 64 * 1024,
  maxPayloadBytes: 256 * 1024,
  maxRequestsPerMinute: 120,
};

export class ToolGuard {
  private requestCount = 0;
  private windowStartedAt = Date.now();

  constructor(private readonly config: ToolGuardConfig = DEFAULT_TOOL_GUARD_CONFIG) {}

  async run<T>(toolName: string, args: unknown, execute: () => Promise<T>): Promise<T> {
    this.assertRateLimit();
    this.assertPayloadSize(args);
    this.assertToolSpecificLimits(toolName, args);
    return execute();
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
}
