import type { MemoryEntry } from "../types/memory.js";

/**
 * Interface for Vibecraft API Client Integration.
 * Vibecraft serves as an early third-party client leveraging MemFlow's
 * local-to-shared continuum for syncing memory experiences across devices.
 */
export interface VibecraftClientIntegration {
  /**
   * Pushes a Vibecraft profile export to the local MemFlow registry
   */
  exportVibecraftProfile(profileData: Record<string, any>): Promise<MemoryEntry>;

  /**
   * Retrieves cross-device patterns stored in MemFlow relevant to current Vibecraft context
   */
  fetchVibecraftPatterns(tags: string[]): Promise<MemoryEntry[]>;

  /**
   * Signals MemFlow that a Vibecraft session has been compacted and
   * should trigger a prompt-cache invalidation.
   */
  signalSessionCompaction(sessionId: string, newCheckpointHash: string): Promise<void>;
}
