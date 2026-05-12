import type { MemoryEntry } from "../types/memory.js";

/**
 * Interface for hosted/managed MemFlow deployments.
 * Unlike local SQLite or shared MongoDB connectors, Managed Adapters
 * enforce multi-tenancy, authentication, and strictly typed payload delivery.
 */
export interface MemFlowManagedAdapter {
  /**
   * The unique identifier for this managed environment (e.g., cloud provider URL)
   */
  endpoint: string;

  /**
   * Authenticates the local agent connection against the managed service
   */
  authenticate(token: string): Promise<boolean>;

  /**
   * Retrieves memory entries respecting remote RBAC and namespace scoping
   */
  fetchEntries(namespace: string, query: Record<string, any>): Promise<MemoryEntry[]>;

  /**
   * Pushes a locally generated bundle or single entry up to the managed service
   */
  pushEntry(entry: MemoryEntry): Promise<void>;

  /**
   * Initiates a remote-side backup or snapshot
   */
  snapshot(tenantId: string): Promise<string>;
}
