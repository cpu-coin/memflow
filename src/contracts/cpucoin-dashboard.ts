import type { MemFlowManagedAdapter } from "./managed-adapter.js";

export interface CPUcoinDashboardMetrics {
  totalTokensSaved: number;
  totalTimeSavedMs: number;
  activeAgents: number;
  storageUsedBytes: number;
}

/**
 * Interface for the CPUcoin Dashboard integration.
 * The Dashboard serves as the primary visual shell and central management
 * hub for MemFlow cloud environments and node distributions.
 */
export interface CPUcoinDashboardIntegration extends MemFlowManagedAdapter {
  /**
   * Syncs real-time operational metrics up to the dashboard
   */
  reportMetrics(metrics: CPUcoinDashboardMetrics): Promise<void>;

  /**
   * Authorizes shared memory sync across a multi-node fleet
   */
  authorizeFleetSync(fleetId: string): Promise<boolean>;

  /**
   * Registers a locally tracked project for dashboard visualization
   */
  registerProject(name: string, repo: string, localPath: string): Promise<string>;
}
